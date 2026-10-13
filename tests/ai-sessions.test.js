import { describe, test, expect } from "bun:test";
import { GET, PATCH, DELETE, signup } from "./httpHelpers.js";
import { aiSessionService } from "../src/services/aiSessionService.js";
import { db } from "../src/db/index.js";

// Conversations are now durable for signed-in visitors and ephemeral for
// everyone else. These tests cover the seam between those two stores, and the
// ownership boundary -- which is the only part of this that is a security
// property rather than a convenience.

describe("session resolution", () => {
  test("an anonymous caller gets an ephemeral session and no database row", async () => {
    const before = db._raw.query("SELECT COUNT(*) AS n FROM ai_sessions").get().n;
    const session = aiSessionService.resolve({ sessionId: "s_browser_generated", message: "hi" });

    expect(session.persistent).toBe(false);
    expect(session.id).toBe("s_browser_generated");
    // The important half: a visitor with no account cannot fill this table
    // with rows nobody can ever list, open or delete.
    expect(db._raw.query("SELECT COUNT(*) AS n FROM ai_sessions").get().n).toBe(before);
  });

  test("a signed-in caller with no session gets one created, titled from the question", async () => {
    const user = await signup("aisess-new");
    const session = aiSessionService.resolve({
      userId: user.user.id,
      message: "Which laser suits a dermatology clinic in Tehran?",
    });

    expect(session.persistent).toBe(true);
    expect(session.created).toBe(true);
    expect(session.row.title).toBe("Which laser suits a dermatology clinic in Tehran?");
  });

  test("a long opening question is truncated, not stored whole, as the title", async () => {
    const user = await signup("aisess-long");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "x".repeat(200) });
    expect(session.row.title.length).toBe(58); // 57 chars + the ellipsis
    expect(session.row.title.endsWith("…")).toBe(true);
  });

  test("an existing owned session is reused rather than duplicated", async () => {
    const user = await signup("aisess-reuse");
    const first = aiSessionService.resolve({ userId: user.user.id, message: "one" });
    const second = aiSessionService.resolve({
      sessionId: first.id,
      userId: user.user.id,
      message: "two",
    });

    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });

  test("someone else's session id starts a fresh conversation instead of joining theirs", async () => {
    const alice = await signup("aisess-alice");
    const bob = await signup("aisess-bob");
    const hers = aiSessionService.resolve({ userId: alice.user.id, message: "alice's thread" });

    // Not an error: the client cannot always tell a stale id from a foreign
    // one, and refusing the message would lose it. But it must never join.
    const his = aiSessionService.resolve({
      sessionId: hers.id,
      userId: bob.user.id,
      message: "bob's thread",
    });

    expect(his.id).not.toBe(hers.id);
    expect(his.created).toBe(true);
  });
});

describe("history round-trip", () => {
  test("a persisted conversation survives and replays in order", async () => {
    const user = await signup("aisess-hist");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "first" });

    await aiSessionService.appendTurn(session, { message: "first", reply: "answer one" });
    await aiSessionService.appendTurn(session, { message: "second", reply: "answer two" });

    // Re-resolve the way a later request would, rather than reusing the object.
    const reopened = aiSessionService.resolve({
      sessionId: session.id,
      userId: user.user.id,
      message: "third",
    });
    const history = await aiSessionService.loadHistory(reopened);

    expect(history.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:first",
      "assistant:answer one",
      "user:second",
      "assistant:answer two",
    ]);
  });

  test("history opening mid-tool-exchange drops the orphaned tool result", async () => {
    const user = await signup("aisess-orphan");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "q" });

    // A window that starts on a `tool` row is invalid to send upstream: its
    // requesting assistant turn fell off the top, leaving a result answering
    // nothing. Providers reject the whole array for this.
    db.aiMessages.append(session.id, { role: "tool", toolCallId: "call_x", content: "{}" });
    db.aiMessages.append(session.id, { role: "assistant", content: "done" });

    const history = await aiSessionService.loadHistory(session);
    expect(history[0].role).not.toBe("tool");
  });
});

describe("the /ai/sessions routes", () => {
  test("listing is scoped to the caller", async () => {
    const alice = await signup("aisess-list-a");
    const bob = await signup("aisess-list-b");
    aiSessionService.resolve({ userId: alice.user.id, message: "alice only" });

    const hers = await GET("/ai/sessions", { token: alice.token });
    const his = await GET("/ai/sessions", { token: bob.token });

    expect(hers.body.sessions.some((s) => s.title === "alice only")).toBe(true);
    expect(his.body.sessions.some((s) => s.title === "alice only")).toBe(false);
  });

  test("another user's conversation is a 404, not a 403", async () => {
    const alice = await signup("aisess-404-a");
    const bob = await signup("aisess-404-b");
    const hers = aiSessionService.resolve({ userId: alice.user.id, message: "private" });

    // 404 rather than 403 on purpose: a 403 would confirm the id exists.
    const res = await GET(`/ai/sessions/${hers.id}`, { token: bob.token });
    expect(res.status).toBe(404);
  });

  test("anonymous callers cannot list conversations at all", async () => {
    expect((await GET("/ai/sessions")).status).toBe(401);
  });

  test("rename and delete work, and delete takes the messages with it", async () => {
    const user = await signup("aisess-crud");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "before" });
    await aiSessionService.appendTurn(session, { message: "before", reply: "ok" });

    const renamed = await PATCH(`/ai/sessions/${session.id}`, { title: "After" }, { token: user.token });
    expect(renamed.body.title).toBe("After");

    const removed = await DELETE(`/ai/sessions/${session.id}`, null, { token: user.token });
    expect(removed.status).toBe(200);
    expect(await GET(`/ai/sessions/${session.id}`, { token: user.token })).toMatchObject({ status: 404 });
    expect(db.aiMessages.all(session.id).length).toBe(0);
  });

  test("a replayed conversation omits tool plumbing but keeps what was said", async () => {
    const user = await signup("aisess-replay");
    const session = aiSessionService.resolve({ userId: user.user.id, message: "q" });
    db.aiMessages.append(session.id, { role: "user", content: "q" });
    db.aiMessages.append(session.id, {
      role: "assistant",
      toolCalls: [{ id: "c1", function: { name: "search_catalogue", arguments: "{}" } }],
    });
    db.aiMessages.append(session.id, { role: "tool", toolCallId: "c1", content: '{"found":true}' });
    db.aiMessages.append(session.id, { role: "assistant", content: "Yes, we do." });

    const res = await GET(`/ai/sessions/${session.id}`, { token: user.token });
    const roles = res.body.messages.map((m) => m.role);

    expect(roles).toEqual(["user", "assistant"]);
    expect(res.body.messages[1].content).toBe("Yes, we do.");
  });
});
