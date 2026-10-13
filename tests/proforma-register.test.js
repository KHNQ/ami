import { describe, test, expect } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, createProduct } from "./httpHelpers.js";
import { db } from "../src/db/index.js";

// A proforma is a promise: the customer walks in holding a price, and the
// person at the counter records the sale from it. These cover the three things
// that have to hold for that to work -- the order is charged what the proforma
// says, the referral link the visitor arrived through is remembered, and the
// proforma stops being open once it has been sold.

const PRICE_ON_PROFORMA = 3_800_000; // what the customer was quoted
const PRICE_IN_CATALOGUE = 8_500_000; // what the product row still says
const COST = 2_000_000;

async function setup(prefix) {
  const admin = await signupAdmin(prefix);
  const product = await createProduct(admin.token, { xCents: COST, yCents: PRICE_IN_CATALOGUE });
  return { admin, product };
}

async function member(admin, product, prefix) {
  const user = await signup(prefix);
  const order = await POST(
    "/admin/orders/manual",
    { user_id: user.user.id, product_id: product.id, amount_received_cents: PRICE_IN_CATALOGUE },
    { token: admin.token }
  );
  expect(order.status).toBe(201);
  return { user, code: order.body.ownRedeemCode.code, node: order.body.node };
}

function quoteFor(product, extra = {}) {
  return POST("/sales/quotes", {
    kind: "proforma",
    product_id: product.id,
    subject: product.name,
    contact_name: "Dr Buyer",
    contact_email: `buyer-${Math.random().toString(36).slice(2)}@clinic.test`,
    amount_cents: PRICE_ON_PROFORMA,
    ...extra,
  });
}

describe("registering a walk-in sale from a proforma", () => {
  test("the order is priced from the proforma, not the catalogue row", async () => {
    const { admin, product } = await setup("pf-price");
    const quote = (await quoteFor(product)).body;
    const customer = await signup("pf-price-buyer");

    const res = await POST(
      "/admin/orders/manual",
      { user_id: customer.user.id, quote_id: quote.id, amount_received_cents: PRICE_ON_PROFORMA },
      { token: admin.token }
    );
    expect(res.status).toBe(201);
    expect(res.body.transaction.y_at_sale_cents).toBe(PRICE_ON_PROFORMA);
    expect(res.body.balance.order_value_cents).toBe(PRICE_ON_PROFORMA);
    expect(res.body.balance.outstanding_cents).toBe(0);
  });

  test("a proforma that has been sold cannot be sold twice", async () => {
    const { admin, product } = await setup("pf-once");
    const quote = (await quoteFor(product)).body;
    const first = await signup("pf-once-a");
    const second = await signup("pf-once-b");

    const ok = await POST(
      "/admin/orders/manual",
      { user_id: first.user.id, quote_id: quote.id, amount_received_cents: PRICE_ON_PROFORMA },
      { token: admin.token }
    );
    expect(ok.status).toBe(201);

    const stored = db.salesQuotes.get(quote.id);
    expect(stored.status).toBe("converted");
    expect(stored.transaction_id).toBe(ok.body.transaction.id);

    const again = await POST(
      "/admin/orders/manual",
      { user_id: second.user.id, quote_id: quote.id, amount_received_cents: PRICE_ON_PROFORMA },
      { token: admin.token }
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("quote_closed");
  });

  test("a refused order leaves the proforma open", async () => {
    const { admin, product } = await setup("pf-refused");
    const sponsor = await member(admin, product, "pf-refused-sponsor");
    const quote = (await quoteFor(product, { referral_code: sponsor.code })).body;
    const customer = await signup("pf-refused-buyer");

    // The sponsor earns commission on this sale, so cash below it is refused
    // -- and a refusal must not burn the proforma.
    const refused = await POST(
      "/admin/orders/manual",
      { user_id: customer.user.id, quote_id: quote.id, amount_received_cents: 0, payment_terms: "installment" },
      { token: admin.token }
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("down_payment_below_payout");
    expect(db.salesQuotes.get(quote.id).status).toBe("new");
  });

  test("a proforma priced below the device's cost is refused with an explanation", async () => {
    const admin = await signupAdmin("pf-margin");
    const product = await createProduct(admin.token, { xCents: 9_000_000, yCents: 9_500_000 });
    const quote = (await quoteFor(product, { amount_cents: 4_000_000 })).body;
    const customer = await signup("pf-margin-buyer");

    const res = await POST(
      "/admin/orders/manual",
      { user_id: customer.user.id, quote_id: quote.id, amount_received_cents: 4_000_000 },
      { token: admin.token }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("quote_price_below_margin");
    expect(res.body.error.message).toContain("$40,000.00");
    expect(db.salesQuotes.get(quote.id).status).toBe("new");
  });

  test("the device must match the proforma", async () => {
    const { admin, product } = await setup("pf-mismatch");
    const other = await createProduct(admin.token, { xCents: COST, yCents: PRICE_IN_CATALOGUE });
    const quote = (await quoteFor(product)).body;
    const customer = await signup("pf-mismatch-buyer");

    const res = await POST(
      "/admin/orders/manual",
      { user_id: customer.user.id, product_id: other.id, quote_id: quote.id, amount_received_cents: PRICE_ON_PROFORMA },
      { token: admin.token }
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("quote_product_mismatch");
  });
});

describe("referral links", () => {
  test("a proforma remembers the member whose link it came through", async () => {
    const { admin, product } = await setup("ref-keep");
    const sponsor = await member(admin, product, "ref-keep-sponsor");

    const quote = (await quoteFor(product, { referral_code: sponsor.code })).body;
    const listed = await GET("/sales/quotes?status=new", { token: admin.token });
    const row = listed.body.quotes.find((q) => q.id === quote.id);
    expect(row.referral_code).toBe(sponsor.code);
    expect(row.referrer.name).toBe(sponsor.user.user.name);
    expect(row.referrer.usable).toBe(true);
  });

  test("registering the sale attaches the buyer under that member without typing the code", async () => {
    const { admin, product } = await setup("ref-attach");
    const sponsor = await member(admin, product, "ref-attach-sponsor");
    const quote = (await quoteFor(product, { referral_code: sponsor.code })).body;
    const buyer = await signup("ref-attach-buyer");

    const res = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, quote_id: quote.id, amount_received_cents: PRICE_ON_PROFORMA },
      { token: admin.token }
    );
    expect(res.status).toBe(201);
    expect(res.body.node.parent_node_id).toBe(sponsor.node.id);
  });

  test("the desk can remove a prefilled code by sending an empty one", async () => {
    const { admin, product } = await setup("ref-clear");
    const sponsor = await member(admin, product, "ref-clear-sponsor");
    const quote = (await quoteFor(product, { referral_code: sponsor.code })).body;
    const buyer = await signup("ref-clear-buyer");

    const res = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, quote_id: quote.id, redeem_code: "", amount_received_cents: PRICE_ON_PROFORMA },
      { token: admin.token }
    );
    expect(res.status).toBe(201);
    expect(res.body.node.parent_node_id).toBeNull();
  });

  test("a code for another device, or no code at all, never blocks the proforma", async () => {
    const { admin, product } = await setup("ref-bad");
    const otherProduct = await createProduct(admin.token, { xCents: COST, yCents: PRICE_IN_CATALOGUE });
    const sponsor = await member(admin, otherProduct, "ref-bad-sponsor");

    const wrongProduct = await quoteFor(product, { referral_code: sponsor.code });
    expect(wrongProduct.status).toBe(201);
    const nonsense = await quoteFor(product, { referral_code: "NOT-A-CODE" });
    expect(nonsense.status).toBe(201);

    expect(db.salesQuotes.get(wrongProduct.body.id).referral_code).toBeNull();
    expect(db.salesQuotes.get(nonsense.body.id).referral_code).toBeNull();
  });

  test("the customer's own list of quotes does not name their referrer", async () => {
    const { admin, product } = await setup("ref-private");
    const sponsor = await member(admin, product, "ref-private-sponsor");
    const buyer = await signup("ref-private-buyer");
    await POST(
      "/sales/quotes",
      {
        kind: "proforma",
        product_id: product.id,
        subject: product.name,
        contact_name: "Buyer",
        contact_email: "private@clinic.test",
        amount_cents: PRICE_ON_PROFORMA,
        referral_code: sponsor.code,
      },
      { token: buyer.token }
    );
    const mine = await GET("/sales/mine", { token: buyer.token });
    expect(mine.body.quotes.length).toBeGreaterThan(0);
    expect(mine.body.quotes[0].referrer).toBeUndefined();
  });
});

describe("setting a real price", () => {
  test("an admin price edit stops the product counting as a placeholder", async () => {
    const admin = await signupAdmin("pf-placeholder");
    const product = await createProduct(admin.token, {
      specs: { placeholder_pricing: true },
      xCents: COST,
      yCents: PRICE_IN_CATALOGUE,
    });
    expect(product.specs.placeholder_pricing).toBe(true);

    const res = await PATCH(`/products/${product.id}/price`, { y_cents: 4_200_000 }, { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.body.specs.placeholder_pricing).toBeUndefined();
  });
});
