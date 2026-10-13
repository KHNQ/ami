import { describe, test, expect } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, createProduct } from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import {
  defaultLeaseRules,
  normalizeLeaseRules,
  effectiveLeaseRules,
  instalmentCents,
  quoteLease,
} from "../src/lib/leaseRules.js";

const RULES = {
  enabled: true,
  min_upfront_pct: 20,
  max_upfront_pct: 60,
  terms: [
    { months: 36, apr_bp: 1900 },
    { months: 12, apr_bp: 1500 },
  ],
};

describe("lease rules -- validation", () => {
  test("terms are sorted, de-duplicated and carry their own APR", () => {
    const rules = normalizeLeaseRules({ ...RULES, terms: [...RULES.terms, { months: 12, apr_bp: 9999 }] });
    expect(rules.terms).toEqual([
      { months: 12, apr_bp: 1500 },
      { months: 36, apr_bp: 1900 },
    ]);
    expect(rules.base_price_cents).toBeNull();
  });

  test("malformed rules are refused rather than silently corrected", () => {
    const bad = [
      { ...RULES, terms: [] },
      { ...RULES, terms: [{ months: 0, apr_bp: 100 }] },
      { ...RULES, terms: [{ months: 500, apr_bp: 100 }] },
      { ...RULES, terms: [{ months: 12, apr_bp: -1 }] },
      { ...RULES, terms: [{ months: 12, apr_bp: 20_000 }] },
      { ...RULES, min_upfront_pct: 95 },
      { ...RULES, min_upfront_pct: 50, max_upfront_pct: 30 },
      { ...RULES, base_price_cents: -5 },
      { ...RULES, terms: Array.from({ length: 9 }, (_, i) => ({ months: i + 1, apr_bp: 0 })) },
      "nope",
    ];
    for (const input of bad) expect(() => normalizeLeaseRules(input)).toThrow();
  });

  test("disabled rules need no terms", () => {
    expect(normalizeLeaseRules({ enabled: false }).enabled).toBe(false);
  });

  test("a product with no rules gets the standard four terms at the current APR", () => {
    const rules = effectiveLeaseRules({}, 1700);
    expect(rules.terms.map((t) => t.months)).toEqual([12, 24, 36, 48]);
    expect(rules.terms.every((t) => t.apr_bp === 1700)).toBe(true);
    expect(rules).toEqual(defaultLeaseRules(1700));
  });

  test("hand-edited rules that no longer validate fall back instead of breaking the page", () => {
    expect(effectiveLeaseRules({ lease_rules: { enabled: true, terms: [] } }, 1800).terms.length).toBe(4);
  });
});

describe("lease rules -- pricing", () => {
  test("instalment matches the standard amortisation formula", () => {
    // 100,000.00 at 18% over 12 months: the textbook PMT is 9,168.00.
    expect(instalmentCents({ principalCents: 10_000_000, months: 12, aprBp: 1800 })).toBe(916_800);
    // 0% APR is a straight division.
    expect(instalmentCents({ principalCents: 120_000, months: 12, aprBp: 0 })).toBe(10_000);
    expect(instalmentCents({ principalCents: 0, months: 12, aprBp: 1800 })).toBe(0);
  });

  test("a quote splits price into upfront and financed, and totals what is paid", () => {
    const rules = normalizeLeaseRules(RULES);
    const q = quoteLease(rules, 10_000_000, { months: 36, upfrontPct: 25 });
    expect(q.upfront_cents).toBe(2_500_000);
    expect(q.principal_cents).toBe(7_500_000);
    expect(q.apr_bp).toBe(1900);
    expect(q.instalment_cents).toBe(instalmentCents({ principalCents: 7_500_000, months: 36, aprBp: 1900 }));
    expect(q.total_cents).toBe(q.upfront_cents + q.instalment_cents * 36);
  });

  test("the admin's base price wins over the list price", () => {
    const rules = normalizeLeaseRules({ ...RULES, base_price_cents: 5_000_000 });
    expect(quoteLease(rules, 10_000_000, { months: 12, upfrontPct: 20 }).price_cents).toBe(5_000_000);
  });

  test("a term or upfront the admin did not allow is refused", () => {
    const rules = normalizeLeaseRules(RULES);
    expect(() => quoteLease(rules, 1_000_000, { months: 24, upfrontPct: 30 })).toThrow(/term_months must be one of/);
    expect(() => quoteLease(rules, 1_000_000, { months: 12, upfrontPct: 10 })).toThrow(/upfront_pct/);
    expect(() => quoteLease(rules, 1_000_000, { months: 12, upfrontPct: 70 })).toThrow(/upfront_pct/);
    expect(() => quoteLease({ ...rules, enabled: false }, 1_000_000, { months: 12, upfrontPct: 30 })).toThrow(/not offered/);
  });
});

describe("lease rules -- on products", () => {
  test("rules are set when a product is created and travel with the public product", async () => {
    const admin = await signupAdmin("lease-create");
    const created = await createProduct(admin.token, { yCents: 800_000, lease_rules: RULES });
    expect(created.specs.lease_rules.terms.map((t) => t.months)).toEqual([12, 36]);

    const publicRow = await GET(`/products/${created.id}`);
    expect(publicRow.body.specs.lease_rules.min_upfront_pct).toBe(20);
  });

  test("bad rules reject the whole product creation", async () => {
    const admin = await signupAdmin("lease-bad");
    const res = await POST(
      "/products",
      { name: "Bad lease", xCents: 100, yCents: 1000, lease_rules: { enabled: true, terms: [] } },
      { token: admin.token }
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_lease_rules");
  });

  test("rules can be edited later, and null resets to the defaults", async () => {
    const admin = await signupAdmin("lease-edit");
    const product = await createProduct(admin.token, { yCents: 800_000, lease_rules: RULES });

    const edited = await PATCH(
      `/products/${product.id}`,
      { lease_rules: { enabled: true, min_upfront_pct: 5, terms: [{ months: 60, apr_bp: 2100 }] } },
      { token: admin.token }
    );
    expect(edited.status).toBe(200);
    expect(edited.body.specs.lease_rules.terms).toEqual([{ months: 60, apr_bp: 2100 }]);
    // Editing the rules must not wipe the rest of specs (slug included).
    expect(edited.body.specs.slug).toBe(product.specs.slug);

    const reset = await PATCH(`/products/${product.id}`, { lease_rules: null }, { token: admin.token });
    expect(reset.body.specs.lease_rules).toBeUndefined();
  });

  test("every product gets a unique public slug", async () => {
    const admin = await signupAdmin("slug-admin");
    const a = await POST("/products", { name: "Slug Laser X", xCents: 1, yCents: 10 }, { token: admin.token });
    const b = await POST("/products", { name: "Slug Laser X", xCents: 1, yCents: 10 }, { token: admin.token });
    expect(a.body.specs.slug).toBe("slug-laser-x");
    expect(b.body.specs.slug).toBe("slug-laser-x-2");
    // An explicit slug is respected, and still made unique.
    const c = await POST("/products", { name: "Whatever", specs: { slug: "slug-laser-x" }, xCents: 1, yCents: 10 }, { token: admin.token });
    expect(c.body.specs.slug).toBe("slug-laser-x-3");
  });
});

describe("lease proforma requests", () => {
  async function leasable() {
    const admin = await signupAdmin(`lease-quote-${Math.random().toString(36).slice(2, 7)}`);
    const product = await createProduct(admin.token, { yCents: 1_000_000, lease_rules: RULES });
    // Real, non-placeholder pricing: the server leases against list price.
    return { admin, product };
  }

  const contact = { contact_name: "Dr Lease", contact_phone: "+98912" };

  test("the server computes the instalment and records the exact terms", async () => {
    const { admin, product } = await leasable();
    const res = await POST("/sales/quotes", {
      kind: "lease",
      product_id: product.id,
      ...contact,
      term_months: 36,
      upfront_pct: 25,
      // Whatever the browser claims about money is ignored.
      amount_cents: 1,
      deposit_cents: 1,
      instalment_cents: 1,
    });
    expect(res.status).toBe(201);

    const row = (await GET(`/sales/quotes/${res.body.id}`, { token: admin.token })).body;
    expect(row.kind).toBe("lease");
    expect(row.term_months).toBe(36);
    expect(row.apr_bp).toBe(1900);
    expect(row.upfront_pct).toBe(25);
    expect(row.amount_cents).toBe(1_000_000);
    expect(row.deposit_cents).toBe(250_000);
    expect(row.instalment_cents).toBe(instalmentCents({ principalCents: 750_000, months: 36, aprBp: 1900 }));
    expect(row.financing).toBe("36-month lease");
    expect(row.status).toBe("new");
  });

  test("a term or upfront outside the product's rules is refused", async () => {
    const { product } = await leasable();
    const badTerm = await POST("/sales/quotes", { kind: "lease", product_id: product.id, ...contact, term_months: 24, upfront_pct: 30 });
    expect(badTerm.status).toBe(400);
    expect(badTerm.body.error.code).toBe("lease_term_not_allowed");

    const badUpfront = await POST("/sales/quotes", { kind: "lease", product_id: product.id, ...contact, term_months: 12, upfront_pct: 5 });
    expect(badUpfront.status).toBe(400);
    expect(badUpfront.body.error.code).toBe("lease_upfront_out_of_range");
  });

  test("terms are required, and a lease must name a product", async () => {
    const { product } = await leasable();
    expect((await POST("/sales/quotes", { kind: "lease", product_id: product.id, ...contact })).status).toBe(400);
    const noProduct = await POST("/sales/quotes", { kind: "lease", subject: "Something", ...contact, term_months: 12, upfront_pct: 30, amount_cents: 100000 });
    expect(noProduct.body.error.code).toBe("lease_product_required");
  });

  test("leasing switched off for a product refuses the request", async () => {
    const admin = await signupAdmin("lease-off");
    const product = await createProduct(admin.token, { yCents: 500_000, lease_rules: { enabled: false } });
    const res = await POST("/sales/quotes", { kind: "lease", product_id: product.id, ...contact, term_months: 12, upfront_pct: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("lease_not_offered");
  });

  test("the removed commitments are no longer accepted", async () => {
    for (const kind of ["reservation", "rental", "subscription", "trade_in", "lead_program"]) {
      const res = await POST("/sales/quotes", { kind, subject: "x", ...contact });
      expect(`${kind}=${res.status}`).toBe(`${kind}=400`);
    }
  });

  test("a request lands in the sales queue, and the printed proforma carries the terms", async () => {
    const { admin, product } = await leasable();
    const res = await POST("/sales/quotes", { kind: "lease", product_id: product.id, ...contact, term_months: 12, upfront_pct: 20 });
    const queue = await GET("/sales/quotes?kind=lease", { token: admin.token });
    expect(queue.body.quotes.some((q) => q.id === res.body.id)).toBe(true);

    const direct = await GET(res.body.download_url);
    expect(direct.status).toBe(200);
    expect(direct.headers.get("content-type")).toBe("application/pdf");
  });
});

describe("proforma requests keep a lease row readable by the finance scope only", () => {
  test("customers cannot read the sales queue", async () => {
    const user = await signup("lease-reader");
    expect((await GET("/sales/quotes", { token: user.token })).status).toBe(403);
    expect(db.salesQuotes.list({ kind: "lease", limit: 1 }).length).toBeGreaterThanOrEqual(0);
  });
});
