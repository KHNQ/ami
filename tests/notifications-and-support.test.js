import { describe, test, expect } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, signupStaff } from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import { notificationService } from "../src/services/notificationService.js";
import { USERS_ADMIN, CONTENT_ADMIN } from "../src/lib/permissions.js";

describe("notification queue", () => {
  test("enqueue is synchronous, so it can run inside db.transaction()", () => {
    // This is the whole reason the queue exists: bun:sqlite transactions
    // cannot await, so anything that wants to notify from inside one has to
    // be able to write the row synchronously. If this ever throws, the
    // cheque-reminder path in Phase 2 has no way to work.
    const user = db.users.create({ email: `tx-${Date.now()}@t.local`, passwordHash: "x", name: "Tx" });
    const queued = db.transaction(() =>
      notificationService.enqueue({
        userId: user.id,
        channel: "email",
        recipient: user.email,
        template: "cheque_due",
        payload: { cheque_number: "1", amount: "$1.00", due_date: "2026-01-01", days_until: 1, company: "Co" },
      })
    );
    expect(queued.status).toBe("pending");
  });

  test("a duplicate dedupe_key is refused by the database, not by app logic", () => {
    const key = `cheque_due:test:${Date.now()}`;
    const payload = { cheque_number: "7", amount: "$10.00", due_date: "2026-02-02", days_until: 7, company: "Co" };

    const first = notificationService.enqueue({
      channel: "sms",
      recipient: "+9891000000",
      template: "cheque_due",
      payload,
      dedupeKey: key,
    });
    expect(first).not.toBe(null);

    // Reminder jobs get re-run -- by cron, by an admin, after a deploy. The
    // second attempt must be a no-op, and the guarantee has to live in a
    // UNIQUE index rather than in a check some future refactor could drop.
    const second = notificationService.enqueue({
      channel: "sms",
      recipient: "+9891000000",
      template: "cheque_due",
      payload,
      dedupeKey: key,
    });
    expect(second).toBe(null);

    const all = db.notifications.list({ limit: 500 }).filter((n) => n.dedupe_key === key);
    expect(all.length).toBe(1);
  });

  test("an unknown template is refused at enqueue time, not at send time", () => {
    // Failing here means a bad deploy shows up immediately; failing at send
    // time means it shows up hours later, in a queue nobody is watching.
    expect(() =>
      notificationService.enqueue({ channel: "email", recipient: "a@b.c", template: "no_such_template" })
    ).toThrow(/unknown notification template/i);
  });

  test("draining the queue marks each message and reports a tally", async () => {
    const before = db.notifications.list({ status: "pending", limit: 500 }).length;
    notificationService.enqueue({
      channel: "email",
      recipient: "drain@test.local",
      template: "request_received",
      payload: { name: "Drain", company: "Co" },
      dedupeKey: `drain:${Date.now()}`,
    });
    expect(db.notifications.list({ status: "pending", limit: 500 }).length).toBe(before + 1);

    // No provider configured in tests, so the transports log and resolve --
    // which is exactly the fallback path production uses before credentials
    // are wired up.
    const result = await notificationService.sendDue({ limit: 500 });
    expect(result.sent).toBeGreaterThan(0);
    expect(db.notifications.list({ status: "pending", limit: 500 }).length).toBe(0);
  });

  test("running the drain twice does not re-send anything", async () => {
    notificationService.enqueue({
      channel: "email",
      recipient: "twice@test.local",
      template: "request_received",
      payload: { name: "Twice", company: "Co" },
      dedupeKey: `twice:${Date.now()}`,
    });
    const first = await notificationService.sendDue({ limit: 500 });
    expect(first.sent).toBeGreaterThan(0);
    const second = await notificationService.sendDue({ limit: 500 });
    expect(second.considered).toBe(0);
    expect(second.sent).toBe(0);
  });

  test("a scheduled message is not sent before its time", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const queued = notificationService.enqueue({
      channel: "email",
      recipient: "later@test.local",
      template: "request_received",
      payload: { name: "Later", company: "Co" },
      dedupeKey: `later:${Date.now()}`,
      scheduledFor: future,
    });

    await notificationService.sendDue({ limit: 500 });
    expect(db.notifications.get(queued.id).status).toBe("pending");

    // ...but is picked up once that time arrives.
    await notificationService.sendDue({ limit: 500, now: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    expect(db.notifications.get(queued.id).status).toBe("sent");
  });

  test("one bad message does not stop the rest of the batch", async () => {
    // Corrupt a row's template after it is queued -- the batch must record
    // the failure against that row and carry on, not abort.
    const good = notificationService.enqueue({
      channel: "email",
      recipient: "good@test.local",
      template: "request_received",
      payload: { name: "Good", company: "Co" },
      dedupeKey: `good:${Date.now()}`,
    });
    const bad = notificationService.enqueue({
      channel: "email",
      recipient: "bad@test.local",
      template: "request_received",
      payload: { name: "Bad", company: "Co" },
      dedupeKey: `bad:${Date.now()}`,
    });
    db._raw.query(`UPDATE notifications SET template = 'gone' WHERE id = ?`).run(bad.id);

    const result = await notificationService.sendDue({ limit: 500 });
    expect(result.failed).toBeGreaterThan(0);
    expect(db.notifications.get(good.id).status).toBe("sent");
    expect(db.notifications.get(bad.id).status).toBe("failed");
    expect(db.notifications.get(bad.id).error).toContain("gone");
  });

  test("a failed message can be retried, a sent one cannot", async () => {
    const failed = db.notifications.list({ status: "failed", limit: 10 })[0];
    expect(failed).toBeTruthy();
    expect(notificationService.retry(failed.id).status).toBe("pending");

    const sent = db.notifications.list({ status: "sent", limit: 10 })[0];
    expect(() => notificationService.retry(sent.id)).toThrow(/only failed/i);
  });

  test("the queue is visible to admins and nobody else", async () => {
    const admin = await signupAdmin("ntfadmin");
    const user = await signup("ntfuser");
    expect((await GET("/admin/notifications", { token: admin.token })).status).toBe(200);
    expect((await GET("/admin/notifications", { token: user.token })).status).toBe(403);
    expect((await GET("/admin/notifications")).status).toBe(401);
  });
});

describe("support requests", () => {
  test("anyone can leave a request without an account", async () => {
    const res = await POST("/support/requests", {
      name: "Dr Walk-in",
      contact: "+982188665828",
      message: "Interested in the Angela. Can I visit?",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    // The response deliberately echoes only an id: this endpoint is
    // anonymous, so returning the stored row would let anyone confirm what
    // was captured about someone else.
    expect(res.body.name).toBeUndefined();
    expect(res.body.contact).toBeUndefined();
  });

  test("name, contact and message are all required", async () => {
    const ok = { name: "Ghost", contact: "ghost@x.com", message: "call me" };
    for (const key of ["name", "contact", "message"]) {
      const res = await POST("/support/requests", { ...ok, [key]: "   " });
      expect(`${key}=${res.status}`).toBe(`${key}=400`);
      const missing = await POST("/support/requests", { ...ok, [key]: undefined });
      expect(`${key}=${missing.status}`).toBe(`${key}=400`);
    }
  });

  test("the message is bounded", async () => {
    const res = await POST("/support/requests", { name: "Long", contact: "a@b.co", message: "x".repeat(4001) });
    expect(res.status).toBe(400);
  });

  test("a signed-in sender is attributed; an anonymous one is not", async () => {
    const user = await signup("support-sender");
    const mine = await POST("/support/requests", { name: "Me", contact: "me@x.com", message: "hi" }, { token: user.token });
    expect(db.support.get(mine.body.id).user_id).toBe(user.user.id);
    const anon = await POST("/support/requests", { name: "Anon", contact: "anon@x.com", message: "hi" });
    expect(db.support.get(anon.body.id).user_id).toBeNull();
  });

  test("an email contact queues an acknowledgement; a phone number does not", async () => {
    const withEmail = await POST("/support/requests", {
      name: "Acked",
      contact: `ack-${Date.now()}@test.local`,
      message: "hello",
    });
    const queued = db.notifications.findByDedupeKey(`support_ack:${withEmail.body.id}`);
    expect(queued).toBeTruthy();
    expect(queued.template).toBe("request_received");

    const withPhone = await POST("/support/requests", { name: "Phone", contact: "+98910", message: "hello" });
    expect(db.notifications.findByDedupeKey(`support_ack:${withPhone.body.id}`)).toBeFalsy();
  });

  test("reading and working the queue is permission-gated", async () => {
    const root = await signupAdmin("supportroot");
    const people = await signupStaff(USERS_ADMIN, "supportpeople");
    const content = await signupStaff(CONTENT_ADMIN, "supportcontent");
    const user = await signup("supportuser");

    expect((await GET("/support/requests")).status).toBe(401);
    expect((await GET("/support/requests", { token: user.token })).status).toBe(403);
    // Answering people is the users admin's job.
    expect((await GET("/support/requests", { token: people.token })).status).toBe(200);
    expect((await GET("/support/requests", { token: root.token })).status).toBe(200);
    // A content admin has no reason to see customer contact details.
    expect((await GET("/support/requests", { token: content.token })).status).toBe(403);
  });

  test("a request can be worked through its statuses, and a bad status refused", async () => {
    const people = await signupStaff(USERS_ADMIN, "workpeople");
    const created = await POST("/support/requests", { name: "Worked", contact: "+98910", message: "broken" });

    const handled = await PATCH(
      `/support/requests/${created.body.id}`,
      { status: "in_progress", admin_note: "called, visiting Tuesday" },
      { token: people.token }
    );
    expect(handled.status).toBe(200);
    expect(handled.body.status).toBe("in_progress");
    expect(handled.body.admin_note).toBe("called, visiting Tuesday");
    expect(handled.body.handled_by).toBe(people.user.id);

    expect(
      (await PATCH(`/support/requests/${created.body.id}`, { status: "nonsense" }, { token: people.token })).status
    ).toBe(400);
    expect((await GET(`/support/requests/${created.body.id}`, { token: people.token })).body.name).toBe("Worked");
    expect((await GET("/support/requests/req_nope", { token: people.token })).status).toBe(404);
  });

  test("the listing carries a status summary and filters by status", async () => {
    const root = await signupAdmin("summaryroot");
    const created = await POST("/support/requests", { name: "Filter", contact: "f@x.com", message: "m" });
    await PATCH(`/support/requests/${created.body.id}`, { status: "resolved" }, { token: root.token });

    const all = await GET("/support/requests", { token: root.token });
    expect(Array.isArray(all.body.requests)).toBe(true);
    expect(Array.isArray(all.body.summary)).toBe(true);
    expect(all.body.summary.some((s) => s.status === "new")).toBe(true);

    const resolved = await GET("/support/requests?status=resolved", { token: root.token });
    expect(resolved.body.requests.length).toBeGreaterThan(0);
    expect(resolved.body.requests.every((r) => r.status === "resolved")).toBe(true);
    expect((await GET("/support/requests?status=bogus", { token: root.token })).status).toBe(400);
  });

  test("the intake can be closed with the support_tickets_enabled flag", async () => {
    const root = await signupAdmin("flagroot");
    await PATCH("/admin/settings", { support_tickets_enabled: false }, { token: root.token });
    try {
      const res = await POST("/support/requests", { name: "Late", contact: "l@x.com", message: "m" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("support_disabled");
    } finally {
      await POST("/admin/settings/support_tickets_enabled/reset", {}, { token: root.token });
    }
  });

  test("the old ticket, lead and chat endpoints are gone", async () => {
    const root = await signupAdmin("goneroot");
    for (const [method, path] of [
      ["POST", "/support/tickets"],
      ["GET", "/support/tickets"],
      ["POST", "/leads"],
      ["GET", "/leads"],
      ["POST", "/chat/sessions"],
    ]) {
      const res =
        method === "GET" ? await GET(path, { token: root.token }) : await POST(path, {}, { token: root.token });
      expect(`${method} ${path}=${res.status}`).toBe(`${method} ${path}=404`);
    }
  });
});
