import { describe, test, expect } from "bun:test";
import { POST, signup, signupAdmin, createProduct, fund } from "./httpHelpers.js";
import { runAgent } from "../src/services/agent/loop.js";
import { aiConfirmService } from "../src/services/aiConfirmService.js";
import { db } from "../src/db/index.js";
import { walletService } from "../src/services/walletService.js";
import { aiSessionService } from "../src/services/aiSessionService.js";
import "../src/services/agentService.js";

// Consequential actions.
//
// The property under test is not "can it buy a device" -- it is that it cannot
// buy one TWICE, cannot buy one without being asked, and cannot buy one for
// somebody else. Everything else here is supporting detail.

const enc = new TextEncoder();
const frame = (o) => `data: ${JSON.stringify(o)}\n\n`;
const say = (t) => frame({ choices: [{ delta: { content: t } }] });
const callTool = (name, args) =>
  frame({
    choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: JSON.stringify(args) } }] } }],
  });

function scripted(turns) {
  let i = 0;
  const seen = [];
  const fn = async (req) => {
    seen.push(req);
    const chunks = turns[Math.min(i, turns.length - 1)];
    i++;
    return {
      body: new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    };
  };
  fn.calls = seen;
  return fn;
}

/** A tool context wired to the real proposal channel, as the route builds it. */
function agentCtx(user, sessionId, emitted = []) {
  return {
    userId: user.user.id,
    permissions: [],
    isAdmin: false,
    canReadAllSupport: false,
    ip: "203.0.113.9",
    sessionId,
    emit: (name, data) => emitted.push({ name, data }),
    proposeTool: ({ tool, args, preview }) => {
      const proposal = aiConfirmService.propose({ sessionId, userId: user.user.id, tool, args, preview });
      emitted.push({ name: "confirm_required", data: proposal });
      return proposal;
    },
  };
}

async function buyerWithProposal(prefix) {
  const admin = await signupAdmin(`${prefix}-admin`);
  const product = await createProduct(admin.token, { name: `${prefix} Device` });
  const user = await signup(prefix);
  fund(user.user.id, 50_000_000);

  const session = aiSessionService.resolve({ userId: user.user.id, message: "buy it" });
  const emitted = [];
  const transport = scripted([
    [callTool("purchase_device", { product_id: product.id })],
    [say("Tap confirm and I will complete it.")],
  ]);

  const run = await runAgent({
    message: "buy the device",
    context: "…",
    ctx: agentCtx(user, session.id, emitted),
    transport,
  });

  const card = emitted.find((e) => e.name === "confirm_required")?.data;
  return { admin, product, user, session, emitted, run, card, transport };
}

describe("proposing", () => {
  test("a purchase does NOT happen during the turn -- only a card appears", async () => {
    const { user, card, run } = await buyerWithProposal("cf-propose");

    expect(card).toBeTruthy();
    expect(card.title).toContain("Buy");
    // The row exists, unresolved, and no money has moved.
    expect(db.aiToolCalls.get(card.id).status).toBe("proposed");
    expect(db.transactions.list({ buyerUserId: user.user.id, limit: 5 }).length).toBe(0);
    expect(walletService.getWallet(user.user.id).balance_cents).toBe(50_000_000);
    // And the run stopped, leaving the decision with the visitor.
    expect(run.awaiting).toEqual([card.id]);
  });

  test("the card states the numbers being agreed to, not just a question", async () => {
    const { card } = await buyerWithProposal("cf-detail");
    const labels = card.details.map((d) => d.label);
    // "Confirm purchase?" with no figures is not consent.
    expect(labels).toContain("Price");
    expect(labels).toContain("Wallet now");
    expect(labels).toContain("Wallet after");
    expect(card.danger).toBe(true);
  });

  test("the model is told to describe, not to claim it is done", async () => {
    const { transport } = await buyerWithProposal("cf-told");
    const toolMessage = transport.calls[1].messages.at(-1);
    const payload = JSON.parse(toolMessage.content);
    expect(payload.status).toBe("awaiting_confirmation");
    expect(payload.note).toContain("Do NOT say it is done");
    // The closing turn must be sent with no tools, so it cannot re-propose.
    expect(transport.calls[1].tools).toBeUndefined();
  });

  test("an unaffordable purchase is refused at preview, before any card", async () => {
    const admin = await signupAdmin("cf-poor-admin");
    const product = await createProduct(admin.token, { name: "Pricey" });
    const user = await signup("cf-poor"); // deliberately unfunded
    const session = aiSessionService.resolve({ userId: user.user.id, message: "buy" });
    const emitted = [];

    await runAgent({
      message: "buy it",
      context: "…",
      ctx: agentCtx(user, session.id, emitted),
      transport: scripted([[callTool("purchase_device", { product_id: product.id })], [say("You cannot afford it.")]]),
    });

    // Being told before tapping beats failing after.
    expect(emitted.some((e) => e.name === "confirm_required")).toBe(false);
    const result = emitted.find((e) => e.name === "tool_result")?.data;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("does not cover");
  });
});

describe("confirming", () => {
  test("confirming executes it exactly once, and a second tap is refused", async () => {
    const { user, card } = await buyerWithProposal("cf-once");

    const first = await POST("/ai/confirm", { proposal_id: card.id }, { token: user.token });
    const second = await POST("/ai/confirm", { proposal_id: card.id }, { token: user.token });

    expect(first.status).toBe(200);
    expect(first.body.result.purchased).toBe(true);
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("proposal_unavailable");

    expect(db.transactions.list({ buyerUserId: user.user.id, limit: 10 }).length).toBe(1);
  });

  test("two SIMULTANEOUS confirmations still buy only one device", async () => {
    // The real hazard: a double-tap, or a retried request. The guard is a
    // single conditional UPDATE, not a read followed by a write.
    const { user, card } = await buyerWithProposal("cf-race");

    const [a, b] = await Promise.all([
      POST("/ai/confirm", { proposal_id: card.id }, { token: user.token }),
      POST("/ai/confirm", { proposal_id: card.id }, { token: user.token }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    expect(db.transactions.list({ buyerUserId: user.user.id, limit: 10 }).length).toBe(1);
  });

  test("another user cannot confirm a card that is not theirs", async () => {
    const { card } = await buyerWithProposal("cf-other");
    const bob = await signup("cf-other-bob");

    const res = await POST("/ai/confirm", { proposal_id: card.id }, { token: bob.token });
    expect(res.status).toBe(400);
    expect(db.aiToolCalls.get(card.id).status).toBe("proposed");
  });

  test("an expired card is refused, with copy that tells the visitor what to do", async () => {
    const { user, card } = await buyerWithProposal("cf-expired");
    db._raw
      .query("UPDATE ai_tool_calls SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), card.id);

    const res = await POST("/ai/confirm", { proposal_id: card.id }, { token: user.token });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("expired");
  });

  test("rejecting leaves the action undone and the card spent", async () => {
    const { user, card } = await buyerWithProposal("cf-reject");

    const res = await POST("/ai/confirm", { proposal_id: card.id, decision: "reject" }, { token: user.token });
    expect(res.body.rejected).toBe(true);
    expect(db.aiToolCalls.get(card.id).status).toBe("rejected");
    expect(db.transactions.list({ buyerUserId: user.user.id, limit: 5 }).length).toBe(0);

    // And a rejected card cannot then be confirmed.
    expect((await POST("/ai/confirm", { proposal_id: card.id }, { token: user.token })).status).toBe(400);
  });

  test("a confirmed action is audited the same way a clicked one is", async () => {
    const { user, card } = await buyerWithProposal("cf-audit");
    await POST("/ai/confirm", { proposal_id: card.id }, { token: user.token });

    const logged = db.logs
      .list({ limit: 50 })
      .find((l) => l.action === "ai.tool_executed" && l.entity_id === card.id);
    expect(logged).toBeTruthy();
    expect(logged.actor_user_id).toBe(user.user.id);
  });

  test("anonymous callers cannot confirm anything", async () => {
    const { card } = await buyerWithProposal("cf-anon");
    expect((await POST("/ai/confirm", { proposal_id: card.id })).status).toBe(401);
  });
});

describe("sweeping", () => {
  test("stale proposals are marked expired rather than left looking live", async () => {
    const { card } = await buyerWithProposal("cf-sweep");
    db._raw
      .query("UPDATE ai_tool_calls SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), card.id);

    aiConfirmService.expireStale();
    expect(db.aiToolCalls.get(card.id).status).toBe("expired");
  });
});
