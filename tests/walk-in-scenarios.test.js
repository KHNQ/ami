import { describe, test, expect } from "bun:test";
import {
  GET,
  POST,
  PATCH,
  signup,
  signupAdmin,
  signupStaff,
  createProduct,
  fund,
} from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import { auditSystem } from "./systemAudit.js";

// End-to-end scenarios for the way this business actually sells: a customer
// walks into the Tehran office, an admin records the sale, part is paid on the
// day and the rest arrives as post-dated cheques.
//
// The existing manual-orders test proves one walk-in produces the same row
// shape as one web sale. This file is about the *scenarios around* that:
// several customers under one another, staff with limited roles doing their
// piece, cheques clearing and bouncing, refunds, and the network paying out
// correctly through all of it.

const PRICE = 2_000_000; // $20,000 -- a realistic device price
const COST = 1_200_000; // $12,000

/** Cash amount that always satisfies the down-payment floor. */
function fullPayment() {
  return PRICE;
}

describe("a walk-in customer becomes a full network participant", () => {
  test("a chain of three in-person sales builds a real upline that earns", async () => {
    const root = await signupAdmin("walkin-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });

    // --- 1. First customer walks in. Nobody referred them. ---
    const alice = await signup("walkin-alice");
    const aliceOrder = await POST(
      "/admin/orders/manual",
      { user_id: alice.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );
    expect(aliceOrder.status).toBe(201);
    const aliceCode = aliceOrder.body.ownRedeemCode.code;
    expect(aliceOrder.body.node.parent_node_id).toBeNull();

    // --- 2. Alice refers Bob, who also buys at the office. ---
    const bob = await signup("walkin-bob");
    const bobOrder = await POST(
      "/admin/orders/manual",
      {
        user_id: bob.user.id,
        product_id: product.id,
        redeem_code: aliceCode,
        amount_received_cents: fullPayment(),
      },
      { token: root.token }
    );
    expect(bobOrder.status).toBe(201);
    expect(bobOrder.body.node.parent_node_id).toBe(aliceOrder.body.node.id);

    // --- 3. Bob refers Carol. ---
    const carol = await signup("walkin-carol");
    const carolOrder = await POST(
      "/admin/orders/manual",
      {
        user_id: carol.user.id,
        product_id: product.id,
        redeem_code: bobOrder.body.ownRedeemCode.code,
        amount_received_cents: fullPayment(),
      },
      { token: root.token }
    );
    expect(carolOrder.status).toBe(201);

    // The upline earned from a sale that never touched the website.
    const aliceNode = db.nodes.get(aliceOrder.body.node.id);
    const bobNode = db.nodes.get(bobOrder.body.node.id);
    // Commission entries are keyed by NODE, not by user -- one person can
    // hold a node in several Spaces, so per-node is the meaningful unit.
    const aliceEarnings = db.ledger.listByNode(aliceNode.id, { limit: 100 });
    const bobEarnings = db.ledger.listByNode(bobNode.id, { limit: 100 });

    expect(aliceNode.space_id).toBe(bobNode.space_id);
    // Alice sits two levels above Carol, so she is paid on both downstream
    // sales; Bob only on Carol's.
    expect(aliceEarnings.length).toBeGreaterThanOrEqual(2);
    expect(bobEarnings.length).toBeGreaterThanOrEqual(1);
  });

  test("a walk-in buyer can later be referred by their own code from the website", async () => {
    // Mixed channels in one tree: this is the normal case, not an edge case.
    const root = await signupAdmin("mixed-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });

    const walkIn = await signup("mixed-walkin");
    const manual = await POST(
      "/admin/orders/manual",
      { user_id: walkIn.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );

    const webBuyer = await signup("mixed-web");
    fund(webBuyer.user.id, PRICE);
    const web = await POST(
      "/purchases",
      { product_id: product.id, redeem_code: manual.body.ownRedeemCode.code },
      { token: webBuyer.token }
    );
    expect(web.status).toBe(201);
    expect(web.body.node.parent_node_id).toBe(manual.body.node.id);
    // Same Space, one tree, regardless of how each of them paid.
    expect(web.body.node.space_id).toBe(manual.body.node.space_id);
  });
});

describe("leasing: the cheque ledger beside a walk-in sale", () => {
  test("a part-paid order records its cheques and tracks what is outstanding", async () => {
    const root = await signupAdmin("lease-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const buyer = await signup("lease-buyer");

    // $8,000 down, $12,000 across three post-dated cheques.
    const down = 800_000;
    const cheques = [
      { amount_cents: 400_000, due_date: "2026-10-01", cheque_number: "111", bank_name: "Bank Melli" },
      { amount_cents: 400_000, due_date: "2026-11-01", cheque_number: "112", bank_name: "Bank Melli" },
      { amount_cents: 400_000, due_date: "2026-12-01", cheque_number: "113", bank_name: "Bank Melli" },
    ];

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: down,
        payment_terms: "installment",
        cheques,
        // The down payment is below the commission payout, so the floor has
        // to be explicitly overridden -- see the dedicated test below.
        override_down_payment: true,
        note: "Walk-in, 3 cheques -- CEO approved terms",
      },
      { token: root.token }
    );
    expect(order.status).toBe(201);

    const list = await GET(`/admin/orders/${order.body.transaction.id}/cheques`, { token: root.token });
    expect(list.status).toBe(200);
    expect(list.body.cheques).toHaveLength(3);
    expect(list.body.cheques.every((c) => c.status === "pending")).toBe(true);

    // down + cheques must reconcile to the order value, which is the whole
    // point of recording them.
    const chequeTotal = list.body.cheques.reduce((n, c) => n + c.amount_cents, 0);
    expect(down + chequeTotal).toBe(PRICE);
  });

  test("commission is booked on the full price at signing, not on cash collected", async () => {
    // The decision recorded in the plan: the upline earns when they cause a
    // sale, not eighteen months later when the last cheque clears.
    const root = await signupAdmin("lease-commission");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const sponsor = await signup("lease-sponsor");
    const sponsorOrder = await POST(
      "/admin/orders/manual",
      { user_id: sponsor.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );

    const buyer = await signup("lease-partial");
    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        redeem_code: sponsorOrder.body.ownRedeemCode.code,
        amount_received_cents: 900_000, // less than half
        payment_terms: "installment",
        cheques: [{ amount_cents: 1_100_000, due_date: "2027-01-01" }],
        override_down_payment: true,
        // An override without a stated reason is refused -- fronting
        // uncollected cash has to be attributable to a decision, not just
        // to a boolean somebody set.
        note: "Established clinic, terms agreed with the CEO",
      },
      { token: root.token }
    );
    expect(order.status).toBe(201);

    const tx = order.body.transaction;
    // Booked against the full $20,000, not the $9,000 in hand.
    expect(tx.y_at_sale_cents).toBe(PRICE);
    expect(tx.margin_cents).toBe(PRICE - COST);
    // The per-row identity still holds, which is what keeps every report and
    // the audit consistent.
    expect(tx.total_payout_cents + tx.reserve_amount_cents + tx.trex_net_amount_cents).toBe(tx.margin_cents);
  });

  test("the down-payment floor refuses an order that would pay out more than was collected", async () => {
    const root = await signupAdmin("floor-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });

    // A sponsor is required for this to mean anything: with no upline there
    // is no commission to front, total_payout is 0, and the floor correctly
    // has nothing to protect against. The exposure only exists once somebody
    // upstream is owed money on a sale that has not been collected.
    const sponsor = await signup("floor-sponsor");
    const sponsorOrder = await POST(
      "/admin/orders/manual",
      { user_id: sponsor.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );
    const buyer = await signup("floor-buyer");

    // $100 down on a $20,000 device: the payout pool dwarfs it.
    const res = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        redeem_code: sponsorOrder.body.ownRedeemCode.code,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 1_990_000, due_date: "2027-01-01" }],
      },
      { token: root.token }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("down_payment_below_payout");
  });

  test("a root admin can override the floor, and the override is auditable", async () => {
    const root = await signupAdmin("override-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const sponsor = await signup("override-sponsor");
    const sponsorOrder = await POST(
      "/admin/orders/manual",
      { user_id: sponsor.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );
    const buyer = await signup("override-buyer");

    const res = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        redeem_code: sponsorOrder.body.ownRedeemCode.code,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 1_990_000, due_date: "2027-01-01" }],
        override_down_payment: true,
        note: "CEO approved -- long-standing customer",
      },
      { token: root.token }
    );
    expect(res.status).toBe(201);

    // Fronting cash you have not collected is a real exposure, so the
    // decision has to be traceable to a person afterwards.
    const logs = db.logs.list({ limit: 200 });
    const entry = logs.find((l) => l.entity_id === res.body.transaction.id);
    expect(entry).toBeTruthy();
  });

  test("clearing and bouncing cheques is recorded and does not disturb the order", async () => {
    const root = await signupAdmin("cheque-life-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const buyer = await signup("cheque-life-buyer");

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 1_000_000,
        payment_terms: "installment",
        cheques: [
          { amount_cents: 500_000, due_date: "2026-10-01" },
          { amount_cents: 500_000, due_date: "2026-11-01" },
        ],
        override_down_payment: true,
        note: "Terms agreed at the office",
      },
      { token: root.token }
    );
    const txId = order.body.transaction.id;
    const before = db.transactions.get(txId);

    const cheques = (await GET(`/admin/orders/${txId}/cheques`, { token: root.token })).body.cheques;

    const cleared = await POST(`/cheques/${cheques[0].id}/status`, { status: "cleared" }, { token: root.token });
    expect(cleared.status).toBe(200);
    expect(cleared.body.status).toBe("cleared");

    const bounced = await POST(`/cheques/${cheques[1].id}/status`, { status: "bounced" }, { token: root.token });
    expect(bounced.status).toBe(200);
    expect(bounced.body.status).toBe("bounced");

    // A bounced cheque raises an alert for a human; it deliberately does NOT
    // auto-reverse the sale. Unwinding a booked order is a decision with
    // clawback consequences, so it stays a deliberate admin action.
    const after = db.transactions.get(txId);
    expect(after.status).toBe(before.status);
    expect(after.total_payout_cents).toBe(before.total_payout_cents);
  });

  test("the customer can see their own cheques and nobody else's", async () => {
    const root = await signupAdmin("cheque-priv-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const mine = await signup("cheque-mine");
    const other = await signup("cheque-other");

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: mine.user.id,
        product_id: product.id,
        amount_received_cents: 1_500_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 500_000, due_date: "2026-10-01" }],
        override_down_payment: true,
        note: "Terms agreed at the office",
      },
      { token: root.token }
    );
    const chequeId = (await GET(`/admin/orders/${order.body.transaction.id}/cheques`, { token: root.token }))
      .body.cheques[0].id;

    // The customer's own surface is the list, not a by-id read: GET
    // /cheques/:id is a staff endpoint (it is how an agent inspects any
    // cheque), so the owner reads theirs through /cheques/mine.
    const own = await GET("/cheques/mine", { token: mine.token });
    expect(own.status).toBe(200);
    expect(own.body.cheques.map((c) => c.id)).toContain(chequeId);

    // Another customer's list must not contain it...
    const theirs = await GET("/cheques/mine", { token: other.token });
    expect(theirs.body.cheques.map((c) => c.id)).not.toContain(chequeId);

    // ...and a cheque carries a bank account number, so the scan itself is
    // owner-or-staff only, never another customer and never anonymous.
    expect((await GET(`/cheques/${chequeId}/image`, { token: other.token })).status).toBe(403);
    expect((await GET(`/cheques/${chequeId}`, { token: other.token })).status).toBe(403);
    expect((await GET(`/cheques/${chequeId}`)).status).toBe(401);
  });
});

describe("staff roles doing their actual jobs", () => {
  test("a finance admin can book a walk-in but cannot touch settings, jobs or other admins", async () => {
    const root = await signupAdmin("roles-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const agent = await signupStaff("FINANCE_ADMIN", "roles-agent");
    const buyer = await signup("roles-buyer");

    // The job they exist to do.
    const order = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: agent.token }
    );
    expect(order.status).toBe(201);

    // ...and the things they must not be able to do, even though booking an
    // order is a far more sensitive action than any of them.
    const settings = await PATCH("/admin/settings", { show_prices: false }, { token: agent.token });
    expect(settings.status).toBe(403);

    const jobs = await POST("/admin/jobs/release-commissions", {}, { token: agent.token });
    expect(jobs.status).toBe(403);

    const promote = await PATCH(`/admin/users/${buyer.user.id}/role`, { role: "admin" }, { token: agent.token });
    expect(promote.status).toBe(403);
  });

  test("a content admin can neither touch stock and prices nor book an order", async () => {
    const root = await signupAdmin("inv-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const inv = await signupStaff("CONTENT_ADMIN", "inv-agent");
    const buyer = await signup("inv-buyer");

    expect((await PATCH(`/products/${product.id}/price`, { y_cents: PRICE + 1000 }, { token: inv.token })).status).toBe(403);
    expect((await PATCH(`/products/${product.id}/stock`, { delta: 1 }, { token: inv.token })).status).toBe(403);
    expect(
      (
        await POST(
          "/admin/orders/manual",
          { user_id: buyer.user.id, product_id: product.id, amount_received_cents: fullPayment() },
          { token: inv.token }
        )
      ).status
    ).toBe(403);
  });

  test("a finance admin cannot override the down-payment floor", async () => {
    // Overriding it means the business fronts cash it has not collected --
    // a decision that belongs to a root admin, not to whoever is booking.
    const root = await signupAdmin("floor-role-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });
    const agent = await signupStaff("FINANCE_ADMIN", "floor-role-agent");
    const sponsor = await signup("floor-role-sponsor");
    const sponsorOrder = await POST(
      "/admin/orders/manual",
      { user_id: sponsor.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );
    const buyer = await signup("floor-role-buyer");

    const res = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        redeem_code: sponsorOrder.body.ownRedeemCode.code,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 1_990_000, due_date: "2027-01-01" }],
        override_down_payment: true,
        note: "agent trying to self-approve",
      },
      { token: agent.token }
    );
    // Either refused outright, or the override ignored and the floor applied.
    expect([403, 422]).toContain(res.status);
  });
});

describe("the whole thing stays consistent", () => {
  test("a mixed book of walk-in and online sales passes the full system audit", async () => {
    const root = await signupAdmin("audit-root");
    const product = await createProduct(root.token, { xCents: COST, yCents: PRICE });

    // Seed a small mixed tree: some paid in full at the office, some on
    // cheques, some online, one refunded.
    const sponsor = await signup("audit-sponsor");
    const sponsorOrder = await POST(
      "/admin/orders/manual",
      { user_id: sponsor.user.id, product_id: product.id, amount_received_cents: fullPayment() },
      { token: root.token }
    );
    const code = sponsorOrder.body.ownRedeemCode.code;

    for (let i = 0; i < 3; i++) {
      const u = await signup(`audit-walkin-${i}`);
      await POST(
        "/admin/orders/manual",
        {
          user_id: u.user.id,
          product_id: product.id,
          redeem_code: code,
          amount_received_cents: 1_600_000,
          payment_terms: "installment",
          cheques: [{ amount_cents: 400_000, due_date: "2026-12-01" }],
        },
        { token: root.token }
      );
    }

    for (let i = 0; i < 2; i++) {
      const u = await signup(`audit-web-${i}`);
      fund(u.user.id, PRICE);
      await POST("/purchases", { product_id: product.id, redeem_code: code }, { token: u.token });
    }

    const refundMe = await signup("audit-refund");
    const refundOrder = await POST(
      "/admin/orders/manual",
      { user_id: refundMe.user.id, product_id: product.id, redeem_code: code, amount_received_cents: fullPayment() },
      { token: root.token }
    );
    const refunded = await POST(
      `/admin/orders/${refundOrder.body.transaction.id}/refund`,
      { reason: "Customer changed their mind" },
      { token: root.token }
    );
    expect(refunded.status).toBe(200);

    // The real check: every money invariant in the system, over a book that
    // mixes both channels, instalments, and a clawback.
    // auditSystem() returns an array of problem strings; empty means every
    // money invariant in the schema still holds.
    expect(auditSystem()).toEqual([]);
  });
});
