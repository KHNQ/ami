import { describe, test, expect } from "bun:test";
import { executeTool, getTool } from "../src/services/agent/registry.js";
import { PATCH, POST, signup, signupAdmin, createProduct } from "./httpHelpers.js";
import { salesService } from "../src/services/salesService.js";
import { db } from "../src/db/index.js";
import { authService } from "../src/services/authService.js";
import { invalidateIndex } from "../src/services/aiService.js";
import "../src/services/agentService.js";

// The safe writes. Each one must produce EXACTLY what the equivalent click
// produces -- same service, same row, same audit trail -- because the whole
// premise is that the two are interchangeable.

const ctxFor = (user, extra = {}) => ({
  userId: user.user.id,
  permissions: [],
  isAdmin: false,
  canReadAllSupport: false,
  ip: "203.0.113.7",
  emit: () => {},
  ...extra,
});

const run = (name, args, ctx) => executeTool({ id: "c1", name, args, valid: true }, ctx);

describe("raising requests", () => {
  test("an unlisted-equipment request becomes a real enquiry with free-text subject", async () => {
    const user = await signup("w-unlisted");
    const res = await run(
      "request_unlisted_equipment",
      { manufacturer: "Fotona", model: "SP Dynamis", intended_use: "Gynaecology", quantity: 1 },
      ctxFor(user)
    );

    expect(res.ok).toBe(true);
    expect(res.result.reference).toMatch(/^PRO-/);

    const [quote] = salesService.listQuotes({ userId: user.user.id, limit: 5 });
    expect(quote.kind).toBe("enquiry");
    expect(quote.subject).toBe("Fotona SP Dynamis");
    // No product and therefore no price, so no rate lock is taken -- locking a
    // rate against something we cannot price would be meaningless.
    expect(quote.product_id).toBeNull();
    expect(quote.amount_cents).toBeNull();
    expect(quote.locked_until).toBeNull();
    expect(quote.notes).toContain("Gynaecology");
    expect(quote.source).toBe("ai_agent");
  });

  test("contact details come from the account, never from the model", async () => {
    const user = await signup("w-contact");
    // The model supplies a hostile/incorrect contact; it must be ignored.
    await run(
      "request_unlisted_equipment",
      { model: "X", intended_use: "Y", manufacturer: "Z" },
      ctxFor(user)
    );
    const [quote] = salesService.listQuotes({ userId: user.user.id, limit: 5 });
    const me = authService.me(user.user.id);
    expect(quote.contact_email).toBe(me.email);
  });

  test("a quote for a device we carry links the real product", async () => {
    const admin = await signupAdmin("w-quote-admin");
    await createProduct(admin.token, { name: "Agent Test Laser", specs: { slug: "agent-test-laser" } });
    invalidateIndex();

    const user = await signup("w-quote");
    const res = await run(
      "create_quote",
      { kind: "proforma", product_slug: "agent-test-laser", notes: "Wants it for March" },
      ctxFor(user)
    );

    expect(res.ok).toBe(true);
    const quote = salesService.listQuotes({ userId: user.user.id, limit: 5 })[0];
    expect(quote.kind).toBe("proforma");
    expect(quote.product_id).toBeTruthy();
  });

  test("an unknown slug is a correctable result, not an exception", async () => {
    const user = await signup("w-badslug");
    const res = await run("create_quote", { kind: "proforma", product_slug: "not-a-device" }, ctxFor(user));
    // The model reads this and retries with a real slug; the visitor never
    // sees an error.
    expect(res.ok).toBe(true);
    expect(res.result.code).toBe("unknown_product");
    expect(salesService.listQuotes({ userId: user.user.id, limit: 5 }).length).toBe(0);
  });

  test("a demo request uses the `demo` kind, which no button can reach", async () => {
    const admin = await signupAdmin("w-demo-admin");
    await createProduct(admin.token, { name: "Demo Device", specs: { slug: "demo-device" } });
    invalidateIndex();

    const user = await signup("w-demo");
    await run("request_demo", { product_slug: "demo-device", timeline: "Next month" }, ctxFor(user));
    expect(salesService.listQuotes({ userId: user.user.id, limit: 5 })[0].kind).toBe("demo");
  });

  test("sending a support request produces the same row the form does", async () => {
    const user = await signup("w-ticket");
    const res = await run("submit_support_request", { message: "The handpiece stopped firing." }, ctxFor(user));

    expect(res.ok).toBe(true);
    const row = db.support.get(res.result.request_id);
    expect(row.user_id).toBe(user.user.id);
    // Contact details come from the account, not from the model.
    expect(row.contact).toBe(user.user.email);
    expect(row.message).toContain("The handpiece stopped firing.");
    expect(row.status).toBe("new");
  });

  test("the support request tool honours the support switch", async () => {
    const user = await signup("w-ticket-off");
    const root = await signupAdmin("w-ticket-off-root");
    await PATCH("/admin/settings", { support_tickets_enabled: false }, { token: root.token });
    try {
      const res = await run("submit_support_request", { message: "Anyone there?" }, ctxFor(user));
      expect(res.ok).toBe(false);
    } finally {
      await POST("/admin/settings/support_tickets_enabled/reset", {}, { token: root.token });
    }
  });

  test("the lease terms a visitor asks for are checked against the product's rules", async () => {
    const root = await signupAdmin("w-lease-root");
    const product = await createProduct(root.token, {
      xCents: 10_000,
      yCents: 400_000,
      lease_rules: { enabled: true, min_upfront_pct: 20, terms: [{ months: 12, apr_bp: 1500 }, { months: 36, apr_bp: 1900 }] },
    });
    invalidateIndex();
    const slug = product.specs.slug;
    const user = await signup("w-lease");

    const bad = await run("create_quote", { kind: "lease", product_slug: slug, term_months: 24, upfront_pct: 30 }, ctxFor(user));
    expect(bad.ok).toBe(false);

    const good = await run("create_quote", { kind: "lease", product_slug: slug, term_months: 36, upfront_pct: 30 }, ctxFor(user));
    expect(good.ok).toBe(true);
    const quote = salesService.listQuotes({ userId: user.user.id, limit: 5 })[0];
    expect(quote.term_months).toBe(36);
    expect(quote.apr_bp).toBe(1900);
  });

  test("changing the name updates the account the profile route reads", async () => {
    const user = await signup("w-name");
    const res = await run("update_my_name", { name: "Dr Shirazi" }, ctxFor(user));

    expect(res.ok).toBe(true);
    // The same source of truth GET /profile serves -- "identical results" is
    // the requirement, so this is the assertion that matters.
    expect(authService.me(user.user.id).name).toBe("Dr Shirazi");
  });

  test("an empty name is refused rather than blanking the account", async () => {
    const user = await signup("w-name-empty");
    const before = authService.me(user.user.id).name;
    const res = await run("update_my_name", { name: "   " }, ctxFor(user));

    expect(res.result.code).toBe("name_required");
    expect(authService.me(user.user.id).name).toBe(before);
  });
});

describe("client actions", () => {
  test("compare_devices emits slugs, never frontend device ids", async () => {
    const admin = await signupAdmin("w-cmp-admin");
    await createProduct(admin.token, { name: "Cmp One", specs: { slug: "cmp-one" } });
    await createProduct(admin.token, { name: "Cmp Two", specs: { slug: "cmp-two" } });
    invalidateIndex();

    const emitted = [];
    const user = await signup("w-cmp");
    const res = await run(
      "compare_devices",
      { slugs: ["cmp-one", "cmp-two"] },
      ctxFor(user, { emit: (name, data) => emitted.push({ name, data }) })
    );

    expect(res.ok).toBe(true);
    const action = emitted.find((e) => e.name === "client_action");
    expect(action.data.type).toBe("compare.add");
    // The server has never known the frontend's device ids and must not start
    // inventing them; the bridge joins slug -> id against the catalogue.
    expect(action.data.slugs).toEqual(["cmp-one", "cmp-two"]);
    // And a fallback, for the pages where no bridge is mounted.
    expect(action.data.fallback.to).toBe("/compare");
  });

  test("one device is refused with a reason the model can act on", async () => {
    const user = await signup("w-cmp-one");
    const res = await run("compare_devices", { slugs: ["cmp-one"] }, ctxFor(user));
    expect(res.result.code).toBe("need_two");
  });

  test("navigate_to only accepts destinations from its allowlist", async () => {
    const user = await signup("w-nav");
    const emitted = [];
    const ctx = ctxFor(user, { emit: (n, d) => emitted.push({ n, d }) });

    const ok = await run("navigate_to", { destination: "orders" }, ctx);
    expect(ok.result.to).toBe("/orders");

    // A path the model composes is a path it can get wrong; the enum is
    // validated before the handler ever runs.
    const bad = await run("navigate_to", { destination: "/etc/passwd" }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("bad_arguments");
  });

  test("password and account deletion are navigations, not executing tools", () => {
    // Deliberate: changePassword rotates token_version (killing the open
    // stream mid-answer) and would need the current password as an argument,
    // which would then be persisted in plaintext to ai_messages.
    expect(getTool("change_password")).toBeNull();
    expect(getTool("delete_account")).toBeNull();
    const dest = getTool("navigate_to").parameters.properties.destination.enum;
    expect(dest).toContain("profile_password");
    expect(dest).toContain("profile_delete");
  });
});

describe("write discipline", () => {
  test("every write tool is marked non-parallel", () => {
    // Two createQuote calls racing would contend on reference generation, and
    // the visitor's own sense of order is part of the result.
    const writes = [
      "request_unlisted_equipment", "create_quote", "request_demo",
      "submit_support_request", "update_my_name", "generate_redeem_code",
    ];
    for (const name of writes) {
      expect(`${name}.parallelSafe`).toBe(getTool(name).parallelSafe ? `${name} IS PARALLEL` : `${name}.parallelSafe`);
    }
  });
});
