import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../src/db/index.js";
import { settingsService } from "../src/services/settingsService.js";
import { salesService } from "../src/services/salesService.js";
import { GET, POST, PATCH, signup, signupAdmin, signupStaff, createProduct } from "./httpHelpers.js";

// The storefront's "live activity" pop-up. It must show REAL recent requests only,
// must be off until an admin says otherwise, and -- because the feed is public -- must
// never publish anything a visitor typed.

let root;
let finance;
let product;

const quote = (body) =>
  POST("/sales/quotes", {
    contact_name: "Private Person Name",
    contact_email: "private.person@secret-clinic.test",
    contact_phone: "+98 912 555 1234",
    ...body,
  });

const setFlag = (value, token = root.token) => PATCH("/admin/settings", { show_live_activity: value }, { token });

beforeAll(async () => {
  root = await signupAdmin("activity-root");
  finance = await signupStaff("FINANCE_ADMIN", "activity-finance");
  product = await createProduct(root.token, { name: "Activity Laser 3000", xCents: 100_000, yCents: 300_000 });
  settingsService.reset("show_live_activity");
});
afterAll(() => settingsService.reset("show_live_activity"));

describe("live activity feed", () => {
  test("it is off by default: the feed is empty even when real requests exist, and the flag says so", async () => {
    await quote({ kind: "proforma", product_id: product.id, amount_cents: 300_000, clinic_city: "Tehran" });
    const feed = await GET("/sales/activity");
    expect(feed.status).toBe(200);
    expect(feed.body).toEqual({ enabled: false, events: [] });
    expect((await GET("/site-config")).body.show_live_activity).toBe(false);
  });

  test("only root can switch it on; a finance admin and a customer are refused", async () => {
    expect((await setFlag(true, finance.token)).status).toBe(403);
    expect((await setFlag(true, (await signup("activity-user")).token)).status).toBe(403);
    expect((await GET("/sales/activity")).body.enabled).toBe(false);
    expect((await setFlag(true)).status).toBe(200);
    expect((await GET("/site-config")).body.show_live_activity).toBe(true);
  });

  test("switched on, it shows the real request -- device and time, nothing else", async () => {
    const feed = (await GET("/sales/activity")).body;
    expect(feed.enabled).toBe(true);
    const mine = feed.events.filter((e) => e.device === "Activity Laser 3000");
    expect(mine.length).toBe(1);
    expect(mine[0].kind).toBe("proforma");
    expect(Math.abs(Date.now() - new Date(mine[0].at).getTime())).toBeLessThan(60_000);
    expect(Object.keys(mine[0]).sort()).toEqual(["at", "device", "kind"]);
  });

  test("no name, phone, email, city or typed text is ever published, however hostile", async () => {
    await quote({
      kind: "proforma",
      product_id: product.id,
      amount_cents: 300_000,
      contact_name: "<script>alert('x')</script>",
      clinic_city: "Buy cheap pills at example.com",
      subject: "ATTACKER CONTROLLED SUBJECT",
      notes: "ATTACKER CONTROLLED NOTES",
      specialty: "ATTACKER SPECIALTY",
    });
    const raw = JSON.stringify((await GET("/sales/activity")).body);
    for (const leaked of ["Private Person", "private.person", "secret-clinic", "555 1234", "script", "Tehran", "cheap pills", "ATTACKER", "example.com"]) {
      expect(raw, `must not publish "${leaked}"`).not.toContain(leaked);
    }
  });

  test("leases count; enquiries, demos and requests with no device do not", async () => {
    await quote({ kind: "lease", product_id: product.id, term_months: 24, upfront_pct: 30 });
    await quote({ kind: "enquiry", product_id: product.id });
    await quote({ kind: "demo", product_id: product.id });
    await quote({ kind: "proforma", subject: "A machine that is not in the catalogue", amount_cents: 1000 });
    const events = salesService.recentActivity({ limit: 10_000 }).events.filter((e) => e.device === "Activity Laser 3000");
    expect(events.map((e) => e.kind).sort()).toEqual(["lease", "proforma", "proforma"]);
    expect(JSON.stringify(salesService.recentActivity({ limit: 10_000 }))).not.toContain("not in the catalogue");
  });

  test("a request the admin declines drops out of the feed, and so does an old one", async () => {
    // Counted through the service with a high limit: the HTTP feed is capped, and the suite
    // shares one database, so other files' recent quotes could otherwise crowd these out.
    const mine = () => salesService.recentActivity({ limit: 10_000 }).events.filter((e) => e.device === "Activity Laser 3000").length;

    const junk = (await quote({ kind: "proforma", product_id: product.id, amount_cents: 1 })).body;
    const before = mine();
    expect((await PATCH(`/sales/quotes/${junk.id}`, { status: "declined" }, { token: finance.token })).status).toBe(200);
    expect(mine()).toBe(before - 1);

    const stale = (await quote({ kind: "proforma", product_id: product.id, amount_cents: 300_000 })).body;
    const now = mine();
    db._raw.query(`UPDATE sales_quotes SET created_at = ? WHERE id = ?`).run(new Date(Date.now() - 30 * 86_400_000).toISOString(), stale.id);
    expect(mine()).toBe(now - 1);
  });

  test("it is newest-first and capped, so a busy day cannot flood the pop-up", async () => {
    for (let i = 0; i < 12; i++) await quote({ kind: "proforma", product_id: product.id, amount_cents: 300_000 });
    const { events } = (await GET("/sales/activity")).body;
    expect(events.length).toBeLessThanOrEqual(8);
    const times = events.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  test("switching it off empties the feed at once, for anonymous callers too", async () => {
    expect((await setFlag(false)).status).toBe(200);
    expect((await GET("/sales/activity")).body).toEqual({ enabled: false, events: [] });
    expect((await GET("/site-config")).body.show_live_activity).toBe(false);
  });
});
