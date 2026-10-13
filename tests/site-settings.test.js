import { describe, test, expect, afterEach } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, createProduct, fund, PASSWORD } from "./httpHelpers.js";
import { settingsService } from "../src/services/settingsService.js";
import { db } from "../src/db/index.js";

// Settings are global, so anything flipped here has to be put back or it
// leaks into every other test file sharing the in-memory database.
const touched = new Set();
async function setFlag(adminToken, key, value) {
  touched.add(key);
  return PATCH("/admin/settings", { [key]: value }, { token: adminToken });
}
afterEach(() => {
  for (const key of touched) db.siteSettings.clear(key);
  touched.clear();
});

describe("site settings -- defaults and public config", () => {
  test("a fresh database is already configured from coded defaults", () => {
    // No seeding step: an absent row means "use the default", so there is no
    // migration or fixture that can be forgotten and leave the site broken.
    expect(db.siteSettings.all()).toEqual({});
    expect(settingsService.get("online_purchase_enabled")).toBe(true);
    expect(settingsService.get("contact").email).toBe("info@ashkan-medical.com");
  });

  test("GET /site-config is public and exposes only public keys", async () => {
    const res = await GET("/site-config");
    expect(res.status).toBe(200);
    expect(res.body.online_purchase_enabled).toBe(true);
    expect(res.body.contact.address).toContain("Vanak");
    expect(res.body.social.linkedin).toContain("linkedin");

    // Private settings must never appear in the anonymous payload.
    expect(res.body.require_down_payment_covers_payout).toBeUndefined();
    expect(res.body.cheque_reminder_lead_days).toBeUndefined();
  });

  test("public config default is closed -- every key is opt-in", () => {
    const defs = settingsService.definitions();
    const publicKeys = Object.keys(settingsService.publicConfig());
    for (const key of publicKeys) {
      expect(defs[key].public).toBe(true);
    }
  });
});

describe("site settings -- admin control", () => {
  test("reading and writing settings requires admin", async () => {
    const user = await signup();
    expect((await GET("/admin/settings")).status).toBe(401);
    expect((await GET("/admin/settings", { token: user.token })).status).toBe(403);
    expect((await PATCH("/admin/settings", { show_prices: false }, { token: user.token })).status).toBe(403);
  });

  test("admin reads values alongside defaults and override state", async () => {
    const admin = await signupAdmin();
    const res = await GET("/admin/settings", { token: admin.token });
    expect(res.status).toBe(200);
    const flag = res.body.settings.find((s) => s.key === "online_purchase_enabled");
    expect(flag).toMatchObject({ value: true, default: true, is_overridden: false, type: "boolean" });
    expect(flag.label).toBeTruthy();
  });

  test("unknown keys and wrong types are refused, not ignored", async () => {
    const admin = await signupAdmin();

    const unknown = await PATCH("/admin/settings", { not_a_setting: true }, { token: admin.token });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("unknown_setting");

    // A silently-coerced "false" string would read as truthy and leave the
    // feature the operator meant to disable still running.
    const wrongType = await PATCH("/admin/settings", { show_prices: "false" }, { token: admin.token });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe("invalid_setting_type");
  });

  test("an update is recorded in the audit log and can be reset", async () => {
    const admin = await signupAdmin();
    await setFlag(admin.token, "show_prices", false);
    expect(settingsService.get("show_prices")).toBe(false);

    const logged = db.logs.list({ action: "settings.updated", limit: 5 });
    expect(logged.some((l) => l.entity_id === "show_prices")).toBe(true);

    const reset = await POST("/admin/settings/show_prices/reset", {}, { token: admin.token });
    expect(reset.status).toBe(200);
    expect(settingsService.get("show_prices")).toBe(true);
  });

  test("a hand-corrupted value falls back to its default rather than propagating", () => {
    touched.add("online_purchase_enabled");
    db.siteSettings.set("online_purchase_enabled", '"yes"', null);
    // "yes" is truthy in JS, so a naive read would look enabled by accident.
    // Type-checking on read means a bad row degrades to the coded default.
    expect(settingsService.get("online_purchase_enabled")).toBe(true);

    db.siteSettings.set("online_purchase_enabled", "not json at all", null);
    expect(settingsService.get("online_purchase_enabled")).toBe(true);
  });
});

// The point of these: a flag that only hides a button in the UI is not a
// flag. Each one has to be refused by the API itself.
describe("feature flags are enforced server-side", () => {
  test("online_purchase_enabled=false refuses POST /purchases", async () => {
    const admin = await signupAdmin();
    const product = await createProduct(admin.token, { yCents: 20_000 });
    const buyer = await signup();
    await fund(buyer.user.id, 100_000);

    await setFlag(admin.token, "online_purchase_enabled", false);
    const blocked = await POST("/purchases", { product_id: product.id }, { token: buyer.token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("online_purchase_disabled");

    // And the switch genuinely reverses -- the same call succeeds once back on.
    await setFlag(admin.token, "online_purchase_enabled", true);
    const allowed = await POST("/purchases", { product_id: product.id }, { token: buyer.token });
    expect(allowed.status).toBe(201);
  });

  test("wallet top-ups and withdrawals no longer exist, whatever the settings say", async () => {
    const user = await signup();
    await fund(user.user.id, 50_000);
    expect((await POST("/wallet/deposit", { amount_cents: 5000 }, { token: user.token })).status).toBe(404);
    expect((await POST("/wallet/withdraw", { amount_cents: 1000 }, { token: user.token })).status).toBe(404);

    // Reading what you hold is unaffected.
    expect((await GET("/wallet", { token: user.token })).body.balance_cents).toBe(50_000);
    expect((await GET("/wallet/ledger", { token: user.token })).status).toBe(200);

    // And the switches that used to govern them are gone from the console.
    const admin = await signupAdmin();
    const keys = (await GET("/admin/settings", { token: admin.token })).body.settings.map((x) => x.key);
    for (const gone of ["payments_enabled", "withdrawals_enabled", "live_chat_enabled"]) {
      expect(keys).not.toContain(gone);
    }
  });

  test("signup_enabled=false closes registration but not login", async () => {
    const admin = await signupAdmin();
    const existing = await signup();
    await setFlag(admin.token, "signup_enabled", false);

    const blocked = await POST("/auth/signup", {
      email: `closed-${Date.now()}@example.com`,
      password: PASSWORD,
      name: "Nope",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("signup_disabled");

    // Existing accounts must still be able to get in.
    const login = await POST("/auth/login", { email: existing.email, password: existing.password });
    expect(login.status).toBe(200);
  });

  test("support_tickets_enabled=false closes the support intake", async () => {
    const admin = await signupAdmin();
    const user = await signup();
    const open = await POST("/support/requests", { name: "Hi", contact: "hi@x.com", message: "Before" }, { token: user.token });
    expect(open.status).toBe(201);

    await setFlag(admin.token, "support_tickets_enabled", false);

    const blocked = await POST("/support/requests", { name: "Hi", contact: "hi@x.com", message: "After" }, { token: user.token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("support_disabled");

    // What was already submitted stays in the queue for staff.
    const queue = await GET("/support/requests", { token: admin.token });
    expect(queue.body.requests.some((r) => r.id === open.body.id)).toBe(true);
    await POST("/admin/settings/support_tickets_enabled/reset", {}, { token: admin.token });
  });
});

describe("price and cost exposure", () => {
  test("show_prices=false strips the list price from public product reads", async () => {
    const admin = await signupAdmin();
    const product = await createProduct(admin.token, { yCents: 44_000 });

    const shown = await GET(`/products/${product.id}`);
    expect(shown.body.list_price_y_cents).toBe(44_000);

    await setFlag(admin.token, "show_prices", false);

    const hidden = await GET(`/products/${product.id}`);
    expect(hidden.status).toBe(200);
    expect(hidden.body.list_price_y_cents).toBeUndefined();
    expect(hidden.body.price_on_request).toBe(true);

    const list = await GET("/products");
    expect(list.body.every((p) => p.list_price_y_cents === undefined)).toBe(true);
  });

  test("hiding prices does not break buying -- the price comes from the database", async () => {
    const admin = await signupAdmin();
    const product = await createProduct(admin.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup();
    await fund(buyer.user.id, 100_000);

    await setFlag(admin.token, "show_prices", false);

    const bought = await POST("/purchases", { product_id: product.id }, { token: buyer.token });
    expect(bought.status).toBe(201);
    expect(bought.body.transaction.y_at_sale_cents).toBe(30_000);
  });

  test("warehouse cost is never public, flag or no flag", async () => {
    const admin = await signupAdmin();
    const product = await createProduct(admin.token, { xCents: 12_345, yCents: 40_000 });

    // The per-unit purchase cost is exactly the company's margin on the
    // device. It has no business in an anonymous response.
    const anon = await GET(`/products/${product.id}`);
    expect(anon.body.current_x_cents).toBeUndefined();

    const list = await GET("/products");
    expect(list.body.every((p) => p.current_x_cents === undefined)).toBe(true);

    // Nor does the cost history.
    expect((await GET(`/products/${product.id}/warehouse-cost`)).status).toBe(401);
    const user = await signup();
    expect((await GET(`/products/${product.id}/warehouse-cost`, { token: user.token })).status).toBe(403);

    // Admins still get it -- they have to manage it.
    const history = await GET(`/products/${product.id}/warehouse-cost`, { token: admin.token });
    expect(history.status).toBe(200);
    expect(history.body[0].x_cents).toBe(12_345);

    // And an admin reading the product itself gets the full row, which is
    // what the product management screens render.
    const asAdmin = await GET(`/products/${product.id}`, { token: admin.token });
    expect(asAdmin.body.current_x_cents).toBe(12_345);
    expect(asAdmin.body.list_price_y_cents).toBe(40_000);
  });

  test("an admin still sees prices when show_prices is off", async () => {
    const admin = await signupAdmin();
    const product = await createProduct(admin.token, { xCents: 9_000, yCents: 25_000 });
    await setFlag(admin.token, "show_prices", false);

    // The flag is a storefront presentation choice, not an access control on
    // the people who set the prices.
    const asAdmin = await GET(`/products/${product.id}`, { token: admin.token });
    expect(asAdmin.body.list_price_y_cents).toBe(25_000);
    expect(asAdmin.body.price_on_request).toBeUndefined();

    const asAnon = await GET(`/products/${product.id}`);
    expect(asAnon.body.list_price_y_cents).toBeUndefined();
  });
});

describe("the admin console's 'changed' marker", () => {
  test("a setting toggled off and back on is not reported as changed", async () => {
    // The console badges altered settings and offers a revert button. It read
    // "has an override row", so flipping a switch off and on again left the
    // setting badged forever with a revert that visibly did nothing -- and an
    // operator scanning for what had been altered was told the wrong answer.
    const admin = await signupAdmin("changed-marker");

    const before = settingsService.adminConfig().find((s) => s.key === "show_prices");
    expect(before.is_overridden).toBe(false);

    settingsService.update({ show_prices: false }, admin.user.id);
    expect(settingsService.adminConfig().find((s) => s.key === "show_prices").is_overridden).toBe(true);

    // Back to the default value -- the row still exists, but nothing differs.
    settingsService.update({ show_prices: true }, admin.user.id);
    const after = settingsService.adminConfig().find((s) => s.key === "show_prices");
    expect(after.is_overridden).toBe(false);
    expect(after.value).toBe(after.default);
  });

  test("an object setting compares structurally, not by key order", async () => {
    const admin = await signupAdmin("changed-object");
    const def = settingsService.adminConfig().find((s) => s.key === "social").default;

    // Same values, keys written in a different order -- as a hand-edited row
    // or a differently-ordered client payload would produce.
    const reordered = Object.fromEntries(Object.entries(def).reverse());
    settingsService.update({ social: reordered }, admin.user.id);

    expect(settingsService.adminConfig().find((s) => s.key === "social").is_overridden).toBe(false);
    settingsService.reset("social", admin.user.id);
  });
});
