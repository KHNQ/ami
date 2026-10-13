import { describe, test, expect, beforeAll } from "bun:test";
import { db } from "../src/db/index.js";
import { GET, POST, PATCH, DELETE, signup, signupAdmin, createProduct, PASSWORD } from "./httpHelpers.js";
import { auditSystem, systemStats } from "./systemAudit.js";

// A full dress rehearsal for production.
//
// Ten real users are signed up over HTTP and then driven through the whole
// product: funding, genesis purchases that open their own Spaces, referral
// cascades that build multi-level trees, the same people playing the
// opposite role on a second product, commissions, refunds,
// support, scheduled jobs -- with an admin watching and controlling all of
// it from the other side. Every step goes through the real routes and the
// real middleware; nothing calls a service directly.
//
// The final phase runs tests/systemAudit.js over the entire resulting
// database, which re-derives every structural and financial invariant from
// the rows themselves.

const world = {
  admin: null,
  users: [], // u[0..9]
  products: {}, // alpha, beta, gamma
  spaces: {},
  nodes: {},
  codes: {},
  purchases: {},
};

const u = (i) => world.users[i];
const token = (i) => world.users[i].token;

/**
 * Puts money in a wallet. Top-ups through the app were removed -- payment is
 * collected in person -- so a fixture credits the ledger directly.
 */
function fundAndApprove(user, amountCents) {
  db.wallet.credit(user.user.id, amountCents, { type: "adjustment", note: "test fixture" });
}

/** Buys as `user`, optionally under `code`. Returns the parsed receipt. */
async function purchase(user, product, code) {
  const body = { product_id: product.id };
  if (code) body.redeem_code = code;
  const res = await POST("/purchases", body, { token: user.token });
  expect(res.status).toBe(201);
  return res.body;
}

describe("production simulation -- 10 users, 3 products, one admin", () => {
  beforeAll(async () => {
    world.admin = await signupAdmin("prodsim-admin");
    for (let i = 0; i < 10; i++) world.users.push(await signup(`prodsim-u${i}`));
    // Three price points, so margin/commission maths differs per product
    // and a single hard-coded number can't accidentally satisfy everything.
    world.products.alpha = await createProduct(world.admin.token, {
      name: "Sim Alpha Analyzer",
      xCents: 20_000,
      yCents: 60_000,
      stockCount: 200,
    });
    world.products.beta = await createProduct(world.admin.token, {
      name: "Sim Beta Laser",
      xCents: 40_000,
      yCents: 120_000,
      stockCount: 200,
    });
    world.products.gamma = await createProduct(world.admin.token, {
      name: "Sim Gamma Platform",
      xCents: 10_000,
      yCents: 25_000,
      stockCount: 5,
    });
  });

  // ---------------------------------------------------------------- phase 1
  test("phase 1 -- ten accounts exist and the admin can see every one of them", async () => {
    for (let i = 0; i < 10; i++) {
      const me = await GET("/auth/me", { token: token(i) });
      expect(me.status).toBe(200);
      expect(me.body.role).toBe("user");
    }

    const listed = await GET("/admin/users?limit=50", { token: world.admin.token });
    expect(listed.status).toBe(200);
    for (let i = 0; i < 10; i++) {
      expect(listed.body.some((row) => row.id === u(i).user.id)).toBe(true);
    }
    // Never leaks credentials, even to an admin.
    expect(listed.body.every((row) => row.password_hash === undefined)).toBe(true);
  });

  // ---------------------------------------------------------------- phase 2
  test("phase 2 -- wallets are funded, and the app offers no way to top one up itself", async () => {
    for (let i = 0; i < 10; i++) {
      fundAndApprove(u(i), 500_000);
      const wallet = await GET("/wallet", { token: token(i) });
      expect(wallet.body.balance_cents).toBe(500_000);
    }

    // The old self-service money movements are gone, not merely switched off.
    expect((await POST("/wallet/deposit", { amount_cents: 500_000 }, { token: token(9) })).status).toBe(404);
    expect((await POST("/wallet/withdraw", { amount_cents: 500_000 }, { token: token(9) })).status).toBe(404);
    expect((await GET("/admin/deposits", { token: world.admin.token })).status).toBe(404);
    expect((await GET("/admin/withdrawals", { token: world.admin.token })).status).toBe(404);
    expect((await GET("/wallet", { token: token(9) })).body.balance_cents).toBe(500_000);
  });

  // ---------------------------------------------------------------- phase 3
  test("phase 3 -- three users each open their own Space by buying with no code", async () => {
    for (const i of [0, 1, 2]) {
      const receipt = await purchase(u(i), world.products.alpha);
      world.spaces[`alpha${i}`] = receipt.space;
      world.nodes[`alpha${i}`] = receipt.node;
      world.codes[`alpha${i}`] = receipt.ownRedeemCode.code;
      world.purchases[`alpha${i}`] = receipt.transaction;

      expect(receipt.node.parent_node_id).toBeNull();
      expect(receipt.space.root_node_id).toBe(receipt.node.id);
      expect(receipt.space.root_user_id).toBe(u(i).user.id);
      expect(receipt.ledgerEntries).toEqual([]); // a root sale pays nobody
    }

    // Three genuinely separate trees, not one shared one.
    const ids = new Set([0, 1, 2].map((i) => world.spaces[`alpha${i}`].id));
    expect(ids.size).toBe(3);
  });

  // ---------------------------------------------------------------- phase 4
  test("phase 4 -- referral cascade builds a real multi-level tree", async () => {
    // space alpha0:  u0 -> u3 -> u4 -> u5   and  u0 -> u9  (breadth + depth)
    world.purchases.u3 = await purchase(u(3), world.products.alpha, world.codes.alpha0);
    world.codes.u3 = world.purchases.u3.ownRedeemCode.code;
    world.purchases.u4 = await purchase(u(4), world.products.alpha, world.codes.u3);
    world.codes.u4 = world.purchases.u4.ownRedeemCode.code;
    world.purchases.u5 = await purchase(u(5), world.products.alpha, world.codes.u4);
    world.purchases.u9 = await purchase(u(9), world.products.alpha, world.codes.alpha0);

    // space alpha1:  u1 -> u6 -> u8
    world.purchases.u6 = await purchase(u(6), world.products.alpha, world.codes.alpha1);
    world.codes.u6 = world.purchases.u6.ownRedeemCode.code;
    world.purchases.u8 = await purchase(u(8), world.products.alpha, world.codes.u6);

    // space alpha2:  u2 -> u7
    world.purchases.u7 = await purchase(u(7), world.products.alpha, world.codes.alpha2);

    // Everyone landed in the space their sponsor belongs to.
    expect(world.purchases.u3.space.id).toBe(world.spaces.alpha0.id);
    expect(world.purchases.u5.space.id).toBe(world.spaces.alpha0.id);
    expect(world.purchases.u9.space.id).toBe(world.spaces.alpha0.id);
    expect(world.purchases.u8.space.id).toBe(world.spaces.alpha1.id);
    expect(world.purchases.u7.space.id).toBe(world.spaces.alpha2.id);

    // And under the right parent.
    expect(world.purchases.u3.node.parent_node_id).toBe(world.nodes.alpha0.id);
    expect(world.purchases.u4.node.parent_node_id).toBe(world.purchases.u3.node.id);
    expect(world.purchases.u5.node.parent_node_id).toBe(world.purchases.u4.node.id);
    expect(world.purchases.u9.node.parent_node_id).toBe(world.nodes.alpha0.id);

    // The tree the root sees matches what we built: two direct children,
    // one of which is three deep.
    const tree = await GET(`/spaces/${world.spaces.alpha0.id}/tree`, { token: token(0) });
    expect(tree.status).toBe(200);
    expect(tree.body.root.node_id).toBe(world.nodes.alpha0.id);
    expect(tree.body.root.children.length).toBe(2);
    const deepBranch = tree.body.root.children.find((c) => c.node_id === world.purchases.u3.node.id);
    expect(deepBranch.children[0].node_id).toBe(world.purchases.u4.node.id);
    expect(deepBranch.children[0].children[0].node_id).toBe(world.purchases.u5.node.id);
  });

  test("phase 4b -- the upline chain reported for the deepest node is exact", async () => {
    const detail = await GET(`/nodes/${world.purchases.u5.node.id}`, { token: token(5) });
    expect(detail.status).toBe(200);
    expect(detail.body.upline.map((a) => a.user_id)).toEqual([u(4).user.id, u(3).user.id, u(0).user.id]);
  });

  // ---------------------------------------------------------------- phase 5
  test("phase 5 -- commissions flow strictly upline, by level, and never to the buyer", async () => {
    // u5's purchase sits three levels under u0, so exactly three ancestors
    // are paid: u4 at level 1, u3 at level 2, u0 at level 3.
    const entries = db.ledger.listByTransaction(world.purchases.u5.transaction.id);
    expect(entries.length).toBe(3);

    const byDepth = new Map(entries.map((e) => [e.level_depth, e]));
    expect(byDepth.get(1).user_id).toBe(u(4).user.id);
    expect(byDepth.get(2).user_id).toBe(u(3).user.id);
    expect(byDepth.get(3).user_id).toBe(u(0).user.id);
    // The buyer earns nothing from their own purchase.
    expect(entries.some((e) => e.user_id === u(5).user.id)).toBe(false);

    // Rates taper with depth, and the whole payout stays inside the pool.
    expect(byDepth.get(1).amount_cents).toBeGreaterThan(byDepth.get(2).amount_cents);
    expect(byDepth.get(2).amount_cents).toBeGreaterThan(byDepth.get(3).amount_cents);
    const tx = db.transactions.get(world.purchases.u5.transaction.id);
    const paid = entries.reduce((a, e) => a + e.amount_cents, 0);
    expect(paid).toBe(tx.total_payout_cents);
    expect(paid).toBeLessThanOrEqual(tx.payout_pool_amount_cents);
    expect(tx.trex_net_amount_cents).toBeGreaterThan(0);

    // All of it is held, not spendable, until the release job runs.
    expect(entries.every((e) => e.status === "pending")).toBe(true);
    expect((await GET("/wallet", { token: token(0) })).body.balance_cents).toBe(500_000 - 60_000);
  });

  // ---------------------------------------------------------------- phase 6
  test("phase 6 -- roles reverse on a second product: a leaf becomes a root, a root becomes a leaf", async () => {
    // u5 was the deepest leaf in Alpha. On Beta they open their own Space...
    const beta5 = await purchase(u(5), world.products.beta);
    expect(beta5.node.parent_node_id).toBeNull();
    expect(beta5.space.root_user_id).toBe(u(5).user.id);
    world.codes.beta5 = beta5.ownRedeemCode.code;
    world.spaces.beta5 = beta5.space;

    // ...and u0, the Alpha root, joins *under* them.
    const beta0 = await purchase(u(0), world.products.beta, world.codes.beta5);
    expect(beta0.space.id).toBe(beta5.space.id);
    expect(beta0.node.parent_node_id).toBe(beta5.node.id);

    // The two products' trees are completely independent.
    expect(beta5.space.id).not.toBe(world.spaces.alpha0.id);

    // u0 now holds two positions -- root of one tree, downline of another.
    const mine = await GET("/nodes/mine", { token: token(0) });
    expect(mine.body.length).toBe(2);
    expect(new Set(mine.body.map((n) => n.product_id)).size).toBe(2);

    // The reversal really paid: u5 earns from u0's Beta purchase.
    const entries = db.ledger.listByTransaction(beta0.transaction.id);
    expect(entries.length).toBe(1);
    expect(entries[0].user_id).toBe(u(5).user.id);
    expect(entries[0].level_depth).toBe(1);
  });

  // ---------------------------------------------------------------- phase 7
  test("phase 7 -- the abuse cases are all refused", async () => {
    // Buying the same product twice.
    const twice = await POST("/purchases", { product_id: world.products.alpha.id }, { token: token(3) });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("already_has_node");

    // Redeeming your own code.
    const selfRef = await POST(
      "/purchases",
      { product_id: world.products.alpha.id, redeem_code: world.codes.u3 },
      { token: token(3) }
    );
    expect(selfRef.status).toBe(409);

    // A code from the wrong product.
    const wrongProduct = await POST(
      "/purchases",
      { product_id: world.products.beta.id, redeem_code: world.codes.alpha0 },
      { token: token(1) }
    );
    expect(wrongProduct.status).toBe(400);
    expect(wrongProduct.body.error.code).toBe("redeem_code_wrong_product");

    // An invented code. Needs someone with no Alpha position yet --
    // everyone above already has one, and the duplicate-node guard is
    // checked first (correctly: it's the stronger refusal).
    const newcomer = await signup("prodsim-fakecode");
    await fundAndApprove(newcomer, 100_000);
    const fake = await POST(
      "/purchases",
      { product_id: world.products.alpha.id, redeem_code: "NOPE-NOPE-NOPE" },
      { token: newcomer.token }
    );
    expect(fake.status).toBe(404);
    expect(fake.body.error.code).toBe("redeem_code_not_found");
    // A failed lookup must not have charged them.
    expect((await GET("/wallet", { token: newcomer.token })).body.balance_cents).toBe(100_000);

    // Buying with an empty wallet, and confirming the failure left nothing behind.
    const broke = await signup("prodsim-broke");
    const spacesBefore = (await GET("/admin/orders?limit=200", { token: world.admin.token })).body.length;
    const failed = await POST("/purchases", { product_id: world.products.alpha.id }, { token: broke.token });
    expect(failed.status).toBe(422);
    expect((await GET("/nodes/mine", { token: broke.token })).body.length).toBe(0);
    expect((await GET("/admin/orders?limit=200", { token: world.admin.token })).body.length).toBe(spacesBefore);
  });

  test("phase 7b -- a limited code stops working once it is used up", async () => {
    const limited = await POST(
      "/redeem-codes",
      { product_id: world.products.gamma.id, max_uses: 1 },
      { token: token(0) }
    );
    // u0 has no Gamma position yet, so they cannot hand out Gamma invites.
    expect(limited.status).toBe(404);
    expect(limited.body.error.code).toBe("no_node_for_product");

    await purchase(u(0), world.products.gamma);
    const code = await POST("/redeem-codes", { product_id: world.products.gamma.id, max_uses: 1 }, { token: token(0) });
    expect(code.status).toBe(201);

    // First taker succeeds, second is turned away.
    await purchase(u(1), world.products.gamma, code.body.code);
    const exhausted = await POST(
      "/purchases",
      { product_id: world.products.gamma.id, redeem_code: code.body.code },
      { token: token(2) }
    );
    expect(exhausted.status).toBeGreaterThanOrEqual(400);
    expect((await GET(`/redeem-codes/${code.body.code}`)).body.usable).toBe(false);
  });

  test("phase 7c -- the last unit of stock is sold exactly once", async () => {
    // Gamma started with 5 and has sold 2.
    const before = (await GET(`/products/${world.products.gamma.id}`)).body.stock_count;
    expect(before).toBe(3);

    for (const i of [2, 3, 4]) await purchase(u(i), world.products.gamma);
    expect((await GET(`/products/${world.products.gamma.id}`)).body.stock_count).toBe(0);

    const soldOut = await POST("/purchases", { product_id: world.products.gamma.id }, { token: token(6) });
    expect(soldOut.status).toBe(422);
    expect(soldOut.body.error.code).toBe("out_of_stock");
    // Refused without taking their money.
    expect((await GET("/wallet", { token: token(6) })).body.balance_cents).toBe(500_000 - 60_000);
  });

  // ---------------------------------------------------------------- phase 8
  test("phase 8 -- privacy holds: one user cannot read another's money, network or tickets", async () => {
    const stranger = u(8);
    expect((await GET(`/nodes/${world.nodes.alpha0.id}`, { token: stranger.token })).status).toBe(403);
    expect((await GET(`/nodes/${world.nodes.alpha0.id}/earnings`, { token: stranger.token })).status).toBe(403);
    expect((await GET(`/spaces/${world.spaces.alpha2.id}/tree`, { token: stranger.token })).status).toBe(403);
    expect((await GET(`/purchases/${world.purchases.alpha0.id}`, { token: stranger.token })).status).toBe(403);
    expect((await GET("/wallet/ledger", { token: stranger.token })).body.every((e) => e.user_id === stranger.user.id)).toBe(true);

    // The admin, by contrast, reaches all of it.
    for (const path of [
      `/nodes/${world.nodes.alpha0.id}`,
      `/nodes/${world.nodes.alpha0.id}/earnings`,
      `/spaces/${world.spaces.alpha2.id}/tree`,
      `/purchases/${world.purchases.alpha0.id}`,
    ]) {
      expect((await GET(path, { token: world.admin.token })).status).toBe(200);
    }
  });

  // ---------------------------------------------------------------- phase 9
  test("phase 9 -- support: anyone can leave a request, only staff can read and triage it", async () => {
    const request = await POST(
      "/support/requests",
      { name: "Buyer Four", contact: "buyer4@example.com", message: "Alpha arrived with a cracked bezel." },
      { token: token(4) }
    );
    expect(request.status).toBe(201);
    world.requestId = request.body.id;

    // The queue is staff only; a customer cannot read it, not even their own.
    expect((await GET("/support/requests", { token: token(4) })).status).toBe(403);
    expect((await GET(`/support/requests/${world.requestId}`, { token: token(7) })).status).toBe(403);

    const queue = await GET("/support/requests", { token: world.admin.token });
    expect(queue.body.requests.some((r) => r.id === world.requestId)).toBe(true);

    const handled = await PATCH(
      `/support/requests/${world.requestId}`,
      { status: "resolved", admin_note: "Replacement dispatched." },
      { token: world.admin.token }
    );
    expect(handled.body.status).toBe("resolved");
    expect(handled.body.admin_note).toBe("Replacement dispatched.");
  });

  // --------------------------------------------------------------- phase 10
  test("phase 10 -- the admin refunds a mid-tree sale and the clawback is proportional", async () => {
    const txId = world.purchases.u4.transaction.id;
    const before = db.ledger.listByTransaction(txId);
    expect(before.length).toBeGreaterThan(0);
    const reserveBefore = (await GET("/admin/monitoring/reports/reserve-fund", { token: world.admin.token })).body
      .balance_cents;
    const buyerBefore = (await GET("/wallet", { token: token(4) })).body.balance_cents;

    const half = await POST(
      `/admin/orders/${txId}/refund`,
      { amount_cents: 30_000, reason: "cracked bezel" },
      { token: world.admin.token }
    );
    expect(half.status).toBe(200);
    expect(half.body.transaction.status).toBe("partially_refunded");

    // Buyer is made whole for the refunded half.
    expect((await GET("/wallet", { token: token(4) })).body.balance_cents).toBe(buyerBefore + 30_000);
    // Reserve gives back its share.
    const reserveAfter = (await GET("/admin/monitoring/reports/reserve-fund", { token: world.admin.token })).body
      .balance_cents;
    expect(reserveAfter).toBeLessThan(reserveBefore);
    // Upline commissions shrink, but never below zero.
    const after = db.ledger.listByTransaction(txId);
    expect(after.some((e) => e.clawed_back_cents > 0)).toBe(true);
    expect(after.every((e) => e.clawed_back_cents <= e.amount_cents)).toBe(true);

    // Over-refunding the remainder is refused; a bare refund closes it out.
    expect((await POST(`/admin/orders/${txId}/refund`, { amount_cents: 40_000 }, { token: world.admin.token })).status).toBe(422);
    const rest = await POST(`/admin/orders/${txId}/refund`, {}, { token: world.admin.token });
    expect(rest.body.transaction.status).toBe("refunded");
    expect((await POST(`/admin/orders/${txId}/refund`, {}, { token: world.admin.token })).status).toBe(422);
  });

  // --------------------------------------------------------------- phase 11
  test("phase 11 -- the release job is what turns pending commissions into spendable money", async () => {
    // Scoped to this simulation's own users throughout. The whole backend
    // suite shares one in-memory database, so the job also settles entries
    // belonging to other test files -- a global before/after comparison
    // would be measuring their commissions as well as ours.
    const ourUserIds = world.users.map((user) => user.user.id);
    const placeholders = ourUserIds.map(() => "?").join(",");
    const ourPending = () =>
      db._raw
        .query(`SELECT * FROM commission_ledger_entries WHERE status = 'pending' AND user_id IN (${placeholders})`)
        .all(...ourUserIds);

    const pendingBefore = ourPending();
    expect(pendingBefore.length).toBeGreaterThan(0);
    const owed = pendingBefore.reduce((a, e) => a + (e.amount_cents - e.clawed_back_cents), 0);
    expect(owed).toBeGreaterThan(0);

    const walletsBefore = ourUserIds.map((id) => db.wallet.getBalance(id));

    // Nothing matures before the hold window elapses.
    await POST("/admin/jobs/release-commissions", {}, { token: world.admin.token });
    ourUserIds.forEach((id, i) => expect(db.wallet.getBalance(id)).toBe(walletsBefore[i]));
    expect(ourPending().length).toBe(pendingBefore.length);

    // Run it as though the hold period had passed.
    const released = await POST("/admin/jobs/release-commissions", { holdDays: 0 }, { token: world.admin.token });
    expect(released.status).toBe(200);
    expect(released.body.releasedCount).toBeGreaterThanOrEqual(pendingBefore.length);

    // Every one of ours is now paid, and the money landed in the right
    // wallets -- each user gained exactly what they were owed, no more.
    expect(ourPending().length).toBe(0);
    const owedPerUser = new Map();
    for (const e of pendingBefore) {
      owedPerUser.set(e.user_id, (owedPerUser.get(e.user_id) || 0) + e.amount_cents);
    }
    ourUserIds.forEach((id, i) => {
      expect(db.wallet.getBalance(id) - walletsBefore[i]).toBe(owedPerUser.get(id) || 0);
    });
  });

  // --------------------------------------------------------------- phase 12
  test("phase 12 -- earnings are owed and settled on the payout sheet, not withdrawn", async () => {
    const sheet = await GET("/admin/payouts", { token: world.admin.token });
    expect(sheet.status).toBe(200);
  });

  // --------------------------------------------------------------- phase 13
  test("phase 13 -- the admin runs the rank bonus cycle over real trading history", async () => {
    const product = world.products.alpha;
    await PATCH(`/commission-plans/${product.id}`, { rank_bonus_pool_pct_bp: 800 }, { token: world.admin.token });
    const tier = await POST(
      `/commission-plans/${product.id}/rank-tiers`,
      {
        rank_order: 1,
        name: "Leader",
        team_volume_threshold_cents: 1,
        personal_volume_threshold_cents: 1,
        pool_share_bp: 10000,
      },
      { token: world.admin.token }
    );
    expect(tier.status).toBe(200);

    const funded = await POST(
      "/admin/jobs/fund-rank-pool",
      {
        product_id: product.id,
        period_start: new Date(Date.now() - 86_400_000).toISOString(),
        period_end: new Date(Date.now() + 86_400_000).toISOString(),
      },
      { token: world.admin.token }
    );
    expect(funded.status).toBe(200);
    expect(funded.body.pool_amount_cents).toBeGreaterThan(0);

    const distributed = await POST(
      "/admin/jobs/distribute-rank-bonuses",
      { period_id: funded.body.id },
      { token: world.admin.token }
    );
    expect(distributed.status).toBe(200);

    const detail = await GET(`/admin/monitoring/reports/rank-bonus-periods/${funded.body.id}`, {
      token: world.admin.token,
    });
    expect(detail.body.entries.length).toBeGreaterThan(0);
    // The split never exceeds what was funded.
    const handedOut = detail.body.entries.reduce((a, e) => a + e.amount_cents, 0);
    expect(handedOut).toBeLessThanOrEqual(funded.body.pool_amount_cents);

    const beforeRelease = db.wallet.getBalance(u(0).user.id);
    const releasedRanks = await POST("/admin/jobs/release-rank-bonuses", { holdDays: 0 }, { token: world.admin.token });
    expect(releasedRanks.status).toBe(200);
    expect(db.wallet.getBalance(u(0).user.id)).toBeGreaterThanOrEqual(beforeRelease);
  });

  // --------------------------------------------------------------- phase 14
  test("phase 14 -- admin controls: suspend a node, suspend a user, promote a deputy", async () => {
    // Suspending a node stops it earning without touching its history.
    const nodeId = world.purchases.u6.node.id;
    const earningsBefore = (await GET(`/nodes/${nodeId}/earnings`, { token: world.admin.token })).body.entries.length;
    expect((await PATCH(`/nodes/${nodeId}/status`, { status: "suspended" }, { token: world.admin.token })).status).toBe(200);
    // A sale under a suspended sponsor pays them nothing.
    const newcomer = await signup("prodsim-under-suspended");
    await fundAndApprove(newcomer, 100_000);
    await purchase(newcomer, world.products.alpha, world.codes.u6);
    expect((await GET(`/nodes/${nodeId}/earnings`, { token: world.admin.token })).body.entries.length).toBe(earningsBefore);
    await PATCH(`/nodes/${nodeId}/status`, { status: "active" }, { token: world.admin.token });

    // Suspending a user locks them out immediately, mid-session.
    expect((await GET("/profile", { token: token(7) })).status).toBe(200);
    await PATCH(`/admin/users/${u(7).user.id}/status`, { status: "suspended" }, { token: world.admin.token });
    expect((await GET("/profile", { token: token(7) })).status).toBe(403);
    expect((await POST("/auth/login", { email: u(7).email, password: PASSWORD })).status).toBe(403);
    await PATCH(`/admin/users/${u(7).user.id}/status`, { status: "active" }, { token: world.admin.token });
    expect((await GET("/profile", { token: token(7) })).status).toBe(200);

    // Promotion grants the whole admin surface on the existing token.
    expect((await GET("/admin/users", { token: token(8) })).status).toBe(403);
    await PATCH(`/admin/users/${u(8).user.id}/role`, { role: "admin" }, { token: world.admin.token });
    expect((await GET("/admin/users", { token: token(8) })).status).toBe(200);
    expect((await GET("/admin/monitoring/overview", { token: token(8) })).status).toBe(200);
    await PATCH(`/admin/users/${u(8).user.id}/role`, { role: "user" }, { token: world.admin.token });
    expect((await GET("/admin/users", { token: token(8) })).status).toBe(403);
  });

  // --------------------------------------------------------------- phase 15
  test("phase 15 -- a user changes their password and another deletes their account", async () => {
    const changer = u(6);
    const newPassword = "a-completely-new-password";
    expect(
      (await PATCH("/profile/password", { current_password: PASSWORD, new_password: newPassword }, { token: changer.token }))
        .status
    ).toBe(200);
    expect((await POST("/auth/login", { email: changer.email, password: PASSWORD })).status).toBe(401);
    expect((await POST("/auth/login", { email: changer.email, password: newPassword })).status).toBe(200);

    // Deleting an account must not erase the network or financial history
    // that other people's earnings depend on.
    const quitter = u(9);
    const quitterNodeId = world.purchases.u9.node.id;
    const uplineEarningsBefore = db.ledger.listByNode(world.nodes.alpha0.id).length;

    expect((await DELETE("/profile", { password: PASSWORD }, { token: quitter.token })).status).toBe(200);
    expect((await POST("/auth/login", { email: quitter.email, password: PASSWORD })).status).toBe(401);
    expect((await GET("/profile", { token: quitter.token })).status).toBe(403);

    // Their node, their sponsor's commissions and the tree all survive.
    expect(db.nodes.get(quitterNodeId)).toBeTruthy();
    expect(db.ledger.listByNode(world.nodes.alpha0.id).length).toBe(uplineEarningsBefore);
    const tree = await GET(`/spaces/${world.spaces.alpha0.id}/tree`, { token: world.admin.token });
    expect(JSON.stringify(tree.body).includes(quitterNodeId)).toBe(true);
  });

  // --------------------------------------------------------------- phase 16
  test("phase 16 -- the admin's oversight surface reports the whole platform", async () => {
    const t = world.admin.token;

    const overview = await GET("/admin/monitoring/overview", { token: t });
    expect(overview.status).toBe(200);
    expect(overview.body.transactions_recent.length).toBeGreaterThan(0);
    expect(overview.body.reserve_balance_cents).toBeGreaterThan(0);
    expect(overview.body.trex_net_summary.tx_count).toBeGreaterThan(0);

    const orders = await GET("/admin/orders?limit=200", { token: t });
    expect(orders.body.length).toBeGreaterThan(10);
    expect((await GET(`/admin/orders?product_id=${world.products.beta.id}`, { token: t })).body.every((o) => o.product_id === world.products.beta.id)).toBe(true);
    expect((await GET(`/admin/orders?buyer_user_id=${u(0).user.id}`, { token: t })).body.every((o) => o.buyer_user_id === u(0).user.id)).toBe(true);
    expect((await GET("/admin/orders?status=refunded", { token: t })).body.every((o) => o.status === "refunded")).toBe(true);

    const net = await GET(`/admin/monitoring/reports/trex-net?product_id=${world.products.alpha.id}`, { token: t });
    expect(net.body.total_trex_net_cents).toBeGreaterThan(0);
    // Refunds happened on this product, and the report must say so rather
    // than presenting an as-booked net figure as money kept.
    expect(net.body.total_refunded_cents).toBeGreaterThan(0);

    const logs = await GET("/admin/logs?limit=200", { token: t });
    expect(logs.body.some((l) => l.action === "purchase.completed")).toBe(true);
    expect(logs.body.some((l) => l.action === "transaction.refund")).toBe(true);

    // The standing invariant audit the platform runs on itself.
    const audit = await GET("/admin/monitoring/reports/audit-invariants", { token: t });
    expect(audit.body.ok).toBe(true);
    expect(audit.body.violations).toEqual([]);
    expect(audit.body.checked).toBeGreaterThan(10);
  });

  // --------------------------------------------------------------- phase 17
  test("phase 17 -- the whole database is structurally and financially consistent", () => {
    const stats = systemStats();
    console.log("\n  --- 10-user production simulation ---");
    console.log(`  users ${stats.users} | products ${stats.products} | spaces ${stats.spaces} | nodes ${stats.nodes}`);
    console.log(`  transactions ${stats.transactions} | commission entries ${stats.commissionEntries} | max tree depth ${stats.maxTreeDepth}`);
    console.log(
      `  gross $${(stats.grossRevenueCents / 100).toFixed(2)} | payouts $${(stats.totalPayoutCents / 100).toFixed(2)} | ` +
        `trex_net $${(stats.trexNetCents / 100).toFixed(2)} | refunded $${(stats.refundedCents / 100).toFixed(2)} | ` +
        `reserve $${(stats.reserveCents / 100).toFixed(2)}`
    );

    const problems = auditSystem();
    if (problems.length) console.error("  AUDIT PROBLEMS:\n   - " + problems.join("\n   - "));
    expect(problems).toEqual([]);

    expect(stats.maxTreeDepth).toBeGreaterThanOrEqual(3);
    expect(stats.spaces).toBeGreaterThanOrEqual(5);
  });
});
