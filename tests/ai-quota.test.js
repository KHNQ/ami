import { describe, test, expect, afterEach } from "bun:test";
import { GET, POST, signup, signupAdmin, freshIp } from "./httpHelpers.js";
import { quotaDay, dailyLimit } from "../src/middleware/aiQuota.js";
import { settingsService } from "../src/services/settingsService.js";
import { config } from "../src/config.js";
import { db } from "../src/db/index.js";

// The daily allowance. Two properties matter: it is per ACCOUNT (not per IP,
// so a clinic behind one NAT is not one customer), and it is DURABLE (so a
// restart does not hand everybody a fresh twenty).

afterEach(() => {
  settingsService.reset("ai_daily_prompt_limit", null);
});

describe("the calendar day", () => {
  test("is computed in the configured timezone, not sliced off a UTC string", () => {
    // 22:00 UTC on the 7th is already the 8th in Tehran (+03:30). A
    // deployment serving Iranian clinics that got this wrong would refill
    // everyone's allowance in the middle of their afternoon.
    const at = new Date("2026-09-07T22:00:00Z");
    expect(quotaDay("UTC", at)).toBe("2026-09-07");
    expect(quotaDay("Asia/Tehran", at)).toBe("2026-09-08");
  });

  test("an invalid timezone falls back to UTC instead of throwing", () => {
    // This runs on every request; a typo in an env var must not take the
    // assistant down.
    expect(quotaDay("Not/AZone", new Date("2026-09-07T10:00:00Z"))).toBe("2026-09-07");
  });
});

describe("the limit", () => {
  test("defaults to the deployment value and is overridable live by an operator", async () => {
    expect(dailyLimit()).toBe(config.aiDailyPromptLimit);

    const admin = await signupAdmin("quota-setting");
    settingsService.update({ ai_daily_prompt_limit: 3 }, admin.user.id);
    expect(dailyLimit()).toBe(3);
  });

  test("is exposed publicly, so the composer can warn before the visitor runs out", () => {
    expect(settingsService.publicConfig()).toHaveProperty("ai_daily_prompt_limit");
  });
});

describe("counting", () => {
  test("increments are atomic and read back exactly", async () => {
    const user = await signup("quota-count");
    const day = quotaDay();
    let last;
    for (let i = 0; i < 20; i++) last = db.aiUsage.incrementPrompts(user.user.id, day);
    expect(last.prompts).toBe(20);
  });

  test("two users are metered independently", async () => {
    const a = await signup("quota-a");
    const b = await signup("quota-b");
    const day = quotaDay();
    db.aiUsage.incrementPrompts(a.user.id, day, 5);
    expect(db.aiUsage.get(b.user.id, day).prompts).toBe(0);
  });

  test("the count survives being read back from the database, not a process cache", async () => {
    const user = await signup("quota-durable");
    const day = quotaDay();
    db.aiUsage.incrementPrompts(user.user.id, day, 7);
    // Straight to SQL: whatever the service layer caches, the row is the truth.
    const row = db._raw
      .query("SELECT prompts FROM ai_usage_daily WHERE user_id = ? AND day = ?")
      .get(user.user.id, day);
    expect(row.prompts).toBe(7);
  });
});

describe("enforcement", () => {
  test("the request after the limit is refused with a code the UI can act on", async () => {
    const admin = await signupAdmin("quota-enforce-admin");
    settingsService.update({ ai_daily_prompt_limit: 2 }, admin.user.id);

    const user = await signup("quota-enforce");
    const ip = freshIp();
    const ask = () => POST("/ai/ask", { message: "hello" }, { token: user.token, ip });

    // The assistant has no key configured under test, so a permitted request
    // fails at the model rather than at the gate. What matters here is which
    // failure: anything other than ai_quota_exhausted means it got through.
    const first = await ask();
    const second = await ask();
    expect(first.body?.error?.code).not.toBe("ai_quota_exhausted");
    expect(second.body?.error?.code).not.toBe("ai_quota_exhausted");

    const third = await ask();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("ai_quota_exhausted");
    // The message has to name the number, or the visitor cannot tell whether
    // they hit a limit or a bug.
    expect(third.body.error.message).toContain("2");
  });

  test("one user exhausting their day does not affect another on the same IP", async () => {
    const admin = await signupAdmin("quota-nat-admin");
    settingsService.update({ ai_daily_prompt_limit: 1 }, admin.user.id);

    const sharedIp = freshIp();
    const a = await signup("quota-nat-a");
    const b = await signup("quota-nat-b");

    await POST("/ai/ask", { message: "hi" }, { token: a.token, ip: sharedIp });
    const aBlocked = await POST("/ai/ask", { message: "hi" }, { token: a.token, ip: sharedIp });
    expect(aBlocked.body.error.code).toBe("ai_quota_exhausted");

    // The whole point of moving optionalAuth ahead of the limiter: B is a
    // different customer who happens to sit behind the same office router.
    const bFirst = await POST("/ai/ask", { message: "hi" }, { token: b.token, ip: sharedIp });
    expect(bFirst.body?.error?.code).not.toBe("ai_quota_exhausted");
  });

  test("anonymous callers are metered by IP and write no usage rows", async () => {
    const before = db._raw.query("SELECT COUNT(*) AS n FROM ai_usage_daily").get().n;
    const ip = freshIp();
    for (let i = 0; i < config.aiAnonHourlyLimit; i++) {
      await POST("/ai/ask", { message: "hi" }, { ip });
    }
    const over = await POST("/ai/ask", { message: "hi" }, { ip });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("rate_limited");
    // A visitor with no account has no row to write; the teaser is governed
    // entirely by the IP limiter.
    expect(db._raw.query("SELECT COUNT(*) AS n FROM ai_usage_daily").get().n).toBe(before);
  });
});

describe("GET /ai/quota", () => {
  test("reports what the counter actually holds", async () => {
    const user = await signup("quota-endpoint");
    db.aiUsage.incrementPrompts(user.user.id, quotaDay(), 4);

    const res = await GET("/ai/quota", { token: user.token });
    expect(res.status).toBe(200);
    expect(res.body.used).toBe(4);
    expect(res.body.limit).toBe(dailyLimit());
    expect(res.body.remaining).toBe(dailyLimit() - 4);
  });

  test("needs an account", async () => {
    expect((await GET("/ai/quota")).status).toBe(401);
  });
});
