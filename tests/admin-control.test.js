import { describe, test, expect } from "bun:test";
import { GET, POST, PATCH, api, signup, signupAdmin, createProduct, buy } from "./httpHelpers.js";

// The admin authority sweep: proves an admin can actually reach and change
// every entity the platform owns -- users, money, catalogue, plans, tiers,
// network, orders, support, scheduled jobs, reporting, audit log -- and,
// just as importantly, that nobody else can.

// One row per admin-only route. Used both to assert the guard on every
// single one and as a checklist against src/routes/* so a newly added
// admin route without a guard shows up as an omission here.
const ADMIN_ROUTES = [
  ["GET", "/admin/users"],
  ["PATCH", "/admin/users/usr_x/status", { status: "active" }],
  ["PATCH", "/admin/users/usr_x/role", { role: "user" }],
  ["POST", "/admin/jobs/recalculate-activity", {}],
  ["POST", "/admin/jobs/release-commissions", {}],
  ["POST", "/admin/jobs/run-all", {}],
  ["POST", "/admin/jobs/fund-rank-pool", { product_id: "prod_x" }],
  ["POST", "/admin/jobs/distribute-rank-bonuses", { period_id: "rbp_x" }],
  ["POST", "/admin/jobs/release-rank-bonuses", {}],
  ["GET", "/admin/orders"],
  ["GET", "/admin/orders/tx_x"],
  ["POST", "/admin/orders/tx_x/refund", {}],
  ["GET", "/admin/monitoring/overview"],
  ["GET", "/admin/monitoring/reports/trex-net"],
  ["GET", "/admin/monitoring/reports/reserve-fund"],
  ["GET", "/admin/monitoring/reports/audit-invariants"],
  ["GET", "/admin/monitoring/reports/rank-bonus-periods"],
  ["GET", "/admin/monitoring/reports/rank-bonus-periods/rbp_x"],
  ["GET", "/admin/logs"],
];

describe("admin surface is locked down", () => {
  test("every /admin/* route rejects anonymous callers with 401", async () => {
    for (const [method, path, body] of ADMIN_ROUTES) {
      const res = await api(method, path, { body });
      expect(res.status).toBe(401);
    }
  });

  test("every /admin/* route rejects a signed-in non-admin with 403", async () => {
    const user = await signup("plainuser");
    for (const [method, path, body] of ADMIN_ROUTES) {
      const res = await api(method, path, { token: user.token, body });
      expect(res.status).toBe(403);
    }
  });

  test("every /admin/* route is reachable by an admin (no 401/403)", async () => {
    const admin = await signupAdmin("sweepadmin");
    for (const [method, path, body] of ADMIN_ROUTES) {
      const res = await api(method, path, { token: admin.token, body });
      // 404/422 on the fake ids above is expected and fine -- what matters
      // is that the admin got past the guard to the handler at all.
      expect([401, 403]).not.toContain(res.status);
    }
  });

  test("the admin's own privileges are revoked the moment their role or status changes", async () => {
    const senior = await signupAdmin("senioradmin");
    const junior = await signupAdmin("junioradmin");

    expect((await GET("/admin/users", { token: junior.token })).status).toBe(200);

    // Demoted by another admin -> instantly loses the admin surface.
    expect((await PATCH(`/admin/users/${junior.user.id}/role`, { role: "user" }, { token: senior.token })).status).toBe(200);
    expect((await GET("/admin/users", { token: junior.token })).status).toBe(403);
    // ...but keeps their ordinary account.
    expect((await GET("/profile", { token: junior.token })).status).toBe(200);

    // Re-promoted -> gets it straight back, same token.
    expect((await PATCH(`/admin/users/${junior.user.id}/role`, { role: "admin" }, { token: senior.token })).status).toBe(200);
    expect((await GET("/admin/users", { token: junior.token })).status).toBe(200);

    // Suspended by another admin -> loses everything, not just /admin.
    expect((await PATCH(`/admin/users/${junior.user.id}/status`, { status: "suspended" }, { token: senior.token })).status).toBe(200);
    expect((await GET("/admin/users", { token: junior.token })).status).toBe(403);
    expect((await GET("/profile", { token: junior.token })).status).toBe(403);
  });

  test("an admin cannot lock themselves out of the platform", async () => {
    const admin = await signupAdmin("selflockadmin");

    const selfDemote = await PATCH(`/admin/users/${admin.user.id}/role`, { role: "user" }, { token: admin.token });
    expect(selfDemote.status).toBe(400);
    expect(selfDemote.body.error.code).toBe("cannot_lock_self_out");

    const selfSuspend = await PATCH(`/admin/users/${admin.user.id}/status`, { status: "suspended" }, { token: admin.token });
    expect(selfSuspend.status).toBe(400);
    expect(selfSuspend.body.error.code).toBe("cannot_lock_self_out");

    // Still fully in control.
    expect((await GET("/admin/users", { token: admin.token })).status).toBe(200);
  });
});

describe("admin control -- users", () => {
  test("lists, filters and paginates the whole userbase without leaking hashes", async () => {
    const admin = await signupAdmin("userlistadmin");
    const target = await signup("listedtarget");

    const all = await GET("/admin/users", { token: admin.token });
    expect(all.status).toBe(200);
    expect(all.body.some((u) => u.id === target.user.id)).toBe(true);
    expect(all.body.every((u) => u.password_hash === undefined)).toBe(true);

    const admins = await GET("/admin/users?role=admin", { token: admin.token });
    expect(admins.body.every((u) => u.role === "admin")).toBe(true);
    expect(admins.body.some((u) => u.id === admin.user.id)).toBe(true);
    expect(admins.body.some((u) => u.id === target.user.id)).toBe(false);

    await PATCH(`/admin/users/${target.user.id}/status`, { status: "banned" }, { token: admin.token });
    const banned = await GET("/admin/users?status=banned", { token: admin.token });
    expect(banned.body.some((u) => u.id === target.user.id)).toBe(true);

    const one = await GET("/admin/users?limit=1", { token: admin.token });
    expect(one.body.length).toBe(1);
  });

  test("suspend, ban and reinstate take effect on the target's live session", async () => {
    const admin = await signupAdmin("statusadmin");
    const target = await signup("statustarget");

    expect((await GET("/profile", { token: target.token })).status).toBe(200);

    expect((await PATCH(`/admin/users/${target.user.id}/status`, { status: "suspended" }, { token: admin.token })).status).toBe(200);
    expect((await GET("/profile", { token: target.token })).status).toBe(403);

    expect((await PATCH(`/admin/users/${target.user.id}/status`, { status: "banned" }, { token: admin.token })).status).toBe(200);
    expect((await POST("/auth/login", { email: target.email, password: target.password })).status).toBe(403);

    expect((await PATCH(`/admin/users/${target.user.id}/status`, { status: "active" }, { token: admin.token })).status).toBe(200);
    expect((await GET("/profile", { token: target.token })).status).toBe(200);
    expect((await POST("/auth/login", { email: target.email, password: target.password })).status).toBe(200);
  });

  test("promotion grants the full admin surface immediately", async () => {
    const admin = await signupAdmin("promoteradmin");
    const target = await signup("promotee");

    expect((await GET("/admin/monitoring/overview", { token: target.token })).status).toBe(403);

    const promoted = await PATCH(`/admin/users/${target.user.id}/role`, { role: "admin" }, { token: admin.token });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe("admin");
    expect(promoted.body.password_hash).toBeUndefined();

    // Same token the user has held since signup -- the role is read off the
    // user row per request, not baked into the JWT.
    expect((await GET("/admin/monitoring/overview", { token: target.token })).status).toBe(200);
    expect((await GET("/admin/users", { token: target.token })).status).toBe(200);
  });

  test("invalid statuses/roles and unknown users are refused", async () => {
    const admin = await signupAdmin("badinputadmin");
    const target = await signup("badinputtarget");

    expect((await PATCH(`/admin/users/${target.user.id}/status`, { status: "vaporized" }, { token: admin.token })).status).toBe(400);
    expect((await PATCH(`/admin/users/${target.user.id}/role`, { role: "superuser" }, { token: admin.token })).status).toBe(400);
    expect((await PATCH("/admin/users/usr_nope/status", { status: "active" }, { token: admin.token })).status).toBe(404);
    expect((await PATCH("/admin/users/usr_nope/role", { role: "admin" }, { token: admin.token })).status).toBe(404);
    // A missing/garbled body is a client error, not a server fault.
    const noBody = await api("PATCH", `/admin/users/${target.user.id}/role`, {
      token: admin.token,
      headers: { "content-type": "application/json" },
    });
    expect(noBody.status).toBe(400);
    expect(noBody.body.error.code).toBe("invalid_json");
  });
});

describe("admin control -- money in and out", () => {
  test("wallet top-ups and withdrawals are gone, with their admin queues", async () => {
    const admin = await signupAdmin("moneygoneadmin");
    const user = await signup("moneygoneuser");
    for (const [method, path] of [
      ["POST", "/wallet/deposit"],
      ["POST", "/wallet/withdraw"],
      ["GET", "/wallet/deposits"],
      ["GET", "/wallet/withdrawals"],
      ["GET", "/admin/deposits"],
      ["GET", "/admin/withdrawals"],
      ["POST", "/admin/deposits/dep_x/approve"],
      ["POST", "/admin/withdrawals/wd_x/approve"],
    ]) {
      const token = path.startsWith("/admin") ? admin.token : user.token;
      const res = method === "GET" ? await GET(path, { token }) : await POST(path, {}, { token });
      expect(`${method} ${path}=${res.status}`).toBe(`${method} ${path}=404`);
    }
  });
});

describe("admin control -- catalogue, plans and tiers", () => {
  test("an admin owns the full product lifecycle end to end", async () => {
    const admin = await signupAdmin("lifecycleadmin");

    const created = await POST(
      "/products",
      { name: "Admin Lifecycle Device", description: "created by admin", stockCount: 4, xCents: 30_000, yCents: 90_000 },
      { token: admin.token }
    );
    expect(created.status).toBe(201);
    const id = created.body.id;
    // Creation auto-provisions a sellable commission plan.
    expect((await GET(`/commission-plans/${id}`)).status).toBe(200);

    expect((await PATCH(`/products/${id}`, { name: "Renamed By Admin" }, { token: admin.token })).body.name).toBe("Renamed By Admin");
    expect((await PATCH(`/products/${id}/price`, { y_cents: 95_000 }, { token: admin.token })).body.list_price_y_cents).toBe(95_000);
    expect((await POST(`/products/${id}/warehouse-cost`, { x_cents: 31_000 }, { token: admin.token })).status).toBe(201);
    expect((await PATCH(`/products/${id}/stock`, { delta: 10 }, { token: admin.token })).body.stock_count).toBe(14);
    expect((await PATCH(`/products/${id}/status`, { status: "discontinued" }, { token: admin.token })).body.status).toBe("discontinued");
    expect((await PATCH(`/products/${id}/status`, { status: "active" }, { token: admin.token })).body.status).toBe("active");

    const history = await GET(`/products/${id}/warehouse-cost`, { token: admin.token });
    expect(history.body.length).toBe(2); // the create-time cost plus the append
  });

  test("an admin can retune a live plan and switch it into quota mode", async () => {
    const admin = await signupAdmin("planctladmin");
    const product = await createProduct(admin.token);

    const retuned = await PATCH(
      `/commission-plans/${product.id}`,
      {
        min_margin_threshold_cents: 250,
        payout_pool_pct_bp: 5500,
        level_rates_bp: [2500, 1500, 800],
        max_payout_depth: 3,
        reserve_pct_bp: 1500,
        compression_enabled: true,
        rank_bonus_pool_pct_bp: 500,
        payout_mode: "quota",
      },
      { token: admin.token }
    );
    expect(retuned.status).toBe(200);
    expect(retuned.body.payout_mode).toBe("quota");
    expect(retuned.body.rank_bonus_pool_pct_bp).toBe(500);
    expect(retuned.body.compression_enabled).toBeTruthy();
    // Version bumps so historical sales stay attributable to the old plan.
    expect(retuned.body.version).toBeGreaterThan(1);

    // And the public read reflects it immediately.
    expect((await GET(`/commission-plans/${product.id}`)).body.payout_mode).toBe("quota");
  });

  test("an admin configures the quota ladder that actually drives tier progress", async () => {
    const admin = await signupAdmin("quotactladmin");
    const sponsor = await signup("quotasponsor");
    const buyer = await signup("quotabuyer");
    const product = await createProduct(admin.token, { xCents: 20_000, yCents: 100_000 });

    await PATCH(`/commission-plans/${product.id}`, { payout_mode: "quota" }, { token: admin.token });
    const tier = await POST(
      `/commission-plans/${product.id}/quota-tiers`,
      { tier_order: 1, name: "Blue", quota_target_cents: 1_000, cash_bonus_cents: 500, rate_bonus_bp: 100, perks: ["Priority support"] },
      { token: admin.token }
    );
    expect(tier.status).toBe(200);

    const sponsorBuy = await buy(sponsor, product);
    await buy(buyer, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code });

    // The sponsor's share was redirected into quota progress rather than a
    // pending wallet payout, and the admin can see it on their node.
    const quota = await GET(`/nodes/${sponsorBuy.body.node.id}/quota`, { token: admin.token });
    expect(quota.status).toBe(200);
    // The redirected share cleared the (deliberately small) 1,000c target,
    // so the tier the admin configured is now the sponsor's current one and
    // its rate bonus is live.
    expect(quota.body.current_tier.name).toBe("Blue");
    expect(quota.body.next_tier).toBeNull();
    expect(quota.body.unlocked_rate_bonus_bp).toBe(100);

    const completions = await GET(`/nodes/${sponsorBuy.body.node.id}/quota-bonuses`, { token: admin.token });
    expect(completions.body.length).toBe(1);
    expect(completions.body[0].cash_bonus_cents).toBe(500);

    const earnings = await GET(`/nodes/${sponsorBuy.body.node.id}/earnings`, { token: admin.token });
    expect(earnings.body.entries.some((e) => e.status === "quota_applied")).toBe(true);
    // Quota-mode entries are progress, not a cash payout -- they must not
    // inflate the node's earnings totals.
    expect(earnings.body.totals.total_cents).toBe(0);
  });

  test("an admin configures rank tiers and runs the whole bonus-pool cycle", async () => {
    const admin = await signupAdmin("rankctladmin");
    const sponsor = await signup("ranksponsor");
    const buyer = await signup("rankbuyer");
    const product = await createProduct(admin.token, { xCents: 20_000, yCents: 100_000 });

    await PATCH(`/commission-plans/${product.id}`, { rank_bonus_pool_pct_bp: 1000 }, { token: admin.token });
    await POST(
      `/commission-plans/${product.id}/rank-tiers`,
      { rank_order: 1, name: "Leader", team_volume_threshold_cents: 1, personal_volume_threshold_cents: 1, pool_share_bp: 10000 },
      { token: admin.token }
    );

    const sponsorBuy = await buy(sponsor, product);
    await buy(buyer, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code });

    const periodStart = new Date(Date.now() - 86_400_000).toISOString();
    const periodEnd = new Date(Date.now() + 86_400_000).toISOString();

    const funded = await POST(
      "/admin/jobs/fund-rank-pool",
      { product_id: product.id, period_start: periodStart, period_end: periodEnd },
      { token: admin.token }
    );
    expect(funded.status).toBe(200);
    expect(funded.body.pool_amount_cents).toBeGreaterThan(0);

    const distributed = await POST("/admin/jobs/distribute-rank-bonuses", { period_id: funded.body.id }, { token: admin.token });
    expect(distributed.status).toBe(200);

    // Reporting shows the period, and drilling in shows the per-node split.
    const periods = await GET(`/admin/monitoring/reports/rank-bonus-periods?product_id=${product.id}`, { token: admin.token });
    expect(periods.body.some((p) => p.id === funded.body.id)).toBe(true);

    const detail = await GET(`/admin/monitoring/reports/rank-bonus-periods/${funded.body.id}`, { token: admin.token });
    expect(detail.status).toBe(200);
    expect(detail.body.period.id).toBe(funded.body.id);
    expect(detail.body.entries.length).toBeGreaterThan(0);

    expect((await GET("/admin/monitoring/reports/rank-bonus-periods/rbp_nope", { token: admin.token })).status).toBe(404);
  });
});

describe("admin control -- orders and refunds", () => {
  test("an admin sees every order, filtered, with its full commission ledger", async () => {
    const admin = await signupAdmin("orderadmin");
    const buyer = await signup("orderbuyer");
    const product = await createProduct(admin.token);

    const purchase = await buy(buyer, product);
    const txId = purchase.body.transaction.id;

    const all = await GET("/admin/orders", { token: admin.token });
    expect(all.body.some((t) => t.id === txId)).toBe(true);

    expect((await GET(`/admin/orders?product_id=${product.id}`, { token: admin.token })).body.every((t) => t.product_id === product.id)).toBe(true);
    expect((await GET(`/admin/orders?buyer_user_id=${buyer.user.id}`, { token: admin.token })).body.every((t) => t.buyer_user_id === buyer.user.id)).toBe(true);
    expect((await GET(`/admin/orders?space_id=${purchase.body.space.id}`, { token: admin.token })).body.some((t) => t.id === txId)).toBe(true);
    expect((await GET("/admin/orders?status=completed", { token: admin.token })).body.every((t) => t.status === "completed")).toBe(true);
    expect((await GET("/admin/orders?limit=1", { token: admin.token })).body.length).toBe(1);

    const detail = await GET(`/admin/orders/${txId}`, { token: admin.token });
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.ledger_entries)).toBe(true);
    expect(detail.body.trex_net_amount_cents).toBeGreaterThan(0);

    expect((await GET("/admin/orders/tx_nope", { token: admin.token })).status).toBe(404);
  });

  test("a partial refund pays the buyer back, claws commissions proportionally, then a second refund closes it out", async () => {
    const admin = await signupAdmin("refundadmin");
    const sponsor = await signup("refundsponsor");
    const buyer = await signup("refundbuyer");
    const product = await createProduct(admin.token, { xCents: 20_000, yCents: 100_000 });

    const sponsorBuy = await buy(sponsor, product);
    const purchase = await buy(buyer, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code });
    const txId = purchase.body.transaction.id;

    const sponsorEarnedBefore = (await GET(`/nodes/${sponsorBuy.body.node.id}/earnings`, { token: admin.token })).body.totals.total_cents;
    expect(sponsorEarnedBefore).toBeGreaterThan(0);
    const reserveBefore = (await GET("/admin/monitoring/reports/reserve-fund", { token: admin.token })).body.balance_cents;

    const half = await POST(`/admin/orders/${txId}/refund`, { amount_cents: 50_000, reason: "damaged in transit" }, { token: admin.token });
    expect(half.status).toBe(200);
    expect(half.body.transaction.status).toBe("partially_refunded");
    expect(half.body.refundAmountCents).toBe(50_000);
    expect(half.body.clawbacks.length).toBeGreaterThan(0);
    expect(half.body.reserveClawbackCents).toBeGreaterThan(0);

    // Buyer got money back into their wallet.
    expect((await GET("/wallet", { token: buyer.token })).body.balance_cents).toBe(50_000);
    // Reserve gave its proportional share back.
    const reserveAfter = (await GET("/admin/monitoring/reports/reserve-fund", { token: admin.token })).body.balance_cents;
    expect(reserveAfter).toBeLessThan(reserveBefore);
    // Sponsor's pending commission shrank.
    const sponsorEntries = (await GET(`/nodes/${sponsorBuy.body.node.id}/earnings`, { token: admin.token })).body.entries;
    expect(sponsorEntries.some((e) => e.clawed_back_cents > 0)).toBe(true);

    // Over-refunding the remainder is refused...
    const tooMuch = await POST(`/admin/orders/${txId}/refund`, { amount_cents: 60_000 }, { token: admin.token });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.code).toBe("refund_exceeds_remaining");

    // ...but a bare refund closes out exactly what's left.
    const rest = await POST(`/admin/orders/${txId}/refund`, {}, { token: admin.token });
    expect(rest.status).toBe(200);
    expect(rest.body.transaction.status).toBe("refunded");
    expect((await GET("/wallet", { token: buyer.token })).body.balance_cents).toBe(100_000);

    // A fully refunded order can't be refunded again.
    const third = await POST(`/admin/orders/${txId}/refund`, {}, { token: admin.token });
    expect(third.status).toBe(422);
    expect(third.body.error.code).toBe("already_refunded");
  });

  test("refunds validate their amount and target", async () => {
    const admin = await signupAdmin("refundvalidadmin");
    const buyer = await signup("refundvalidbuyer");
    const product = await createProduct(admin.token);
    const purchase = await buy(buyer, product);

    expect((await POST("/admin/orders/tx_nope/refund", {}, { token: admin.token })).status).toBe(404);
    expect(
      (await POST(`/admin/orders/${purchase.body.transaction.id}/refund`, { amount_cents: 0 }, { token: admin.token })).status
    ).toBe(400);
    expect(
      (await POST(`/admin/orders/${purchase.body.transaction.id}/refund`, { amount_cents: -5 }, { token: admin.token })).status
    ).toBe(400);
  });

  test("a refund never breaks the standing trex_net invariant audit", async () => {
    const admin = await signupAdmin("auditadmin");
    const buyer = await signup("auditbuyer");
    const product = await createProduct(admin.token);
    const purchase = await buy(buyer, product);
    await POST(`/admin/orders/${purchase.body.transaction.id}/refund`, {}, { token: admin.token });

    const audit = await GET("/admin/monitoring/reports/audit-invariants", { token: admin.token });
    expect(audit.status).toBe(200);
    expect(audit.body.violations).toEqual([]);
    expect(audit.body.ok).toBe(true);
    expect(audit.body.checked).toBeGreaterThan(0);
  });
});

describe("admin control -- network, support and codes", () => {
  test("an admin reaches any node, Space and tree they had no part in", async () => {
    const admin = await signupAdmin("networkadmin");
    const root = await signup("networkroot");
    const child = await signup("networkchild");
    const product = await createProduct(admin.token);

    const rootBuy = await buy(root, product);
    const childBuy = await buy(child, product, { redeemCode: rootBuy.body.ownRedeemCode.code });
    const spaceId = rootBuy.body.space.id;

    expect((await GET(`/spaces/${spaceId}`, { token: admin.token })).status).toBe(200);
    const tree = await GET(`/spaces/${spaceId}/tree`, { token: admin.token });
    expect(tree.body.root.children[0].node_id).toBe(childBuy.body.node.id);

    // The platform-wide Space listing is admin-only behaviour.
    const listed = await GET("/spaces", { token: admin.token });
    expect(listed.body.some((s) => s.id === spaceId)).toBe(true);
    expect((await GET(`/spaces?product_id=${product.id}`, { token: admin.token })).body.some((s) => s.id === spaceId)).toBe(true);

    for (const suffix of ["", "/downline", "/earnings", "/redeem-codes", "/rank", "/rank-bonuses", "/quota", "/quota-bonuses"]) {
      expect((await GET(`/nodes/${rootBuy.body.node.id}${suffix}`, { token: admin.token })).status).toBe(200);
    }
  });

  test("an admin can suspend and reinstate any node, and revoke anyone's code", async () => {
    const admin = await signupAdmin("nodectladmin");
    const owner = await signup("nodectlowner");
    const product = await createProduct(admin.token);
    const purchase = await buy(owner, product);

    const suspended = await PATCH(`/nodes/${purchase.body.node.id}/status`, { status: "suspended" }, { token: admin.token });
    expect(suspended.body.status).toBe("suspended");
    const reinstated = await PATCH(`/nodes/${purchase.body.node.id}/status`, { status: "active" }, { token: admin.token });
    expect(reinstated.body.status).toBe("active");
    expect((await PATCH(`/nodes/${purchase.body.node.id}/status`, { status: "melted" }, { token: admin.token })).status).toBe(400);

    // Someone else's auto-issued invite code, revoked by an admin.
    const revoked = await POST(`/redeem-codes/${purchase.body.ownRedeemCode.id}/revoke`, {}, { token: admin.token });
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("revoked");
    expect((await GET(`/redeem-codes/${purchase.body.ownRedeemCode.code}`)).body.usable).toBe(false);
  });

  test("an admin can read, triage and close any support request", async () => {
    const admin = await signupAdmin("supportctladmin");
    const user = await signup("supportctluser");

    const sent = await POST(
      "/support/requests",
      { name: "Clinic", contact: "+98912", message: "Readings are off." },
      { token: user.token }
    );
    const id = sent.body.id;

    const all = await GET("/support/requests", { token: admin.token });
    expect(all.body.requests.some((r) => r.id === id)).toBe(true);
    expect((await GET("/support/requests?status=new", { token: admin.token })).body.requests.some((r) => r.id === id)).toBe(true);

    expect((await GET(`/support/requests/${id}`, { token: admin.token })).status).toBe(200);
    const triaged = await PATCH(`/support/requests/${id}`, { status: "in_progress", admin_note: "Booking a service visit." }, { token: admin.token });
    expect(triaged.body.status).toBe("in_progress");
    expect((await PATCH(`/support/requests/${id}`, { status: "closed" }, { token: admin.token })).body.status).toBe("closed");
    expect((await GET("/support/requests?status=new", { token: admin.token })).body.requests.some((r) => r.id === id)).toBe(false);

    // The sender gets no read access to the queue, even to their own entry.
    expect((await GET(`/support/requests/${id}`, { token: user.token })).status).toBe(403);
  });
});

describe("admin control -- jobs, monitoring and the audit log", () => {
  test("the release-commissions job is what turns pending commissions into spendable money", async () => {
    const admin = await signupAdmin("releaseadmin");
    const sponsor = await signup("releasesponsor");
    const buyer = await signup("releasebuyer");
    const product = await createProduct(admin.token, { xCents: 20_000, yCents: 100_000 });

    const sponsorBuy = await buy(sponsor, product);
    await buy(buyer, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code });

    const pending = (await GET(`/nodes/${sponsorBuy.body.node.id}/earnings?status=pending`, { token: admin.token })).body;
    expect(pending.entries.length).toBeGreaterThan(0);
    const owed = pending.entries.reduce((a, e) => a + e.amount_cents, 0);
    const balanceBefore = (await GET("/wallet", { token: sponsor.token })).body.balance_cents;

    // Nothing matures before the hold window elapses.
    const early = await POST("/admin/jobs/release-commissions", {}, { token: admin.token });
    expect(early.status).toBe(200);
    expect((await GET("/wallet", { token: sponsor.token })).body.balance_cents).toBe(balanceBefore);

    // Run the job as if the hold period had passed -- same payload the
    // admin dashboard's "release" button sends.
    const released = await POST("/admin/jobs/release-commissions", { holdDays: 0 }, { token: admin.token });
    expect(released.status).toBe(200);

    const after = (await GET("/wallet", { token: sponsor.token })).body.balance_cents;
    expect(after).toBe(balanceBefore + owed);
    const paid = (await GET(`/nodes/${sponsorBuy.body.node.id}/earnings`, { token: admin.token })).body.entries;
    expect(paid.every((e) => e.status === "paid")).toBe(true);
  });

  test("activity recalculation and run-all are triggerable and report what they did", async () => {
    const admin = await signupAdmin("jobsadmin");

    const activity = await POST("/admin/jobs/recalculate-activity", {}, { token: admin.token });
    expect(activity.status).toBe(200);

    const all = await POST("/admin/jobs/run-all", {}, { token: admin.token });
    expect(all.status).toBe(200);
    expect(all.body.activity).toBeDefined();
    expect(all.body.releases).toBeDefined();

    const rankRelease = await POST("/admin/jobs/release-rank-bonuses", {}, { token: admin.token });
    expect(rankRelease.status).toBe(200);
  });

  test("rank-pool jobs refuse bad targets instead of failing silently", async () => {
    const admin = await signupAdmin("jobsvalidadmin");
    const bad = await POST(
      "/admin/jobs/fund-rank-pool",
      { product_id: "prod_nope", period_start: new Date().toISOString(), period_end: new Date().toISOString() },
      { token: admin.token }
    );
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);

    const badPeriod = await POST("/admin/jobs/distribute-rank-bonuses", { period_id: "rbp_nope" }, { token: admin.token });
    expect(badPeriod.status).toBeGreaterThanOrEqual(400);
    expect(badPeriod.status).toBeLessThan(500);
  });

  test("the monitoring dashboard reports live platform state", async () => {
    const admin = await signupAdmin("monitoradmin");
    const buyer = await signup("monitorbuyer");
    const product = await createProduct(admin.token);
    const purchase = await buy(buyer, product);

    const overview = await GET("/admin/monitoring/overview", { token: admin.token });
    expect(overview.status).toBe(200);
    expect(overview.body.transactions_recent.some((t) => t.id === purchase.body.transaction.id)).toBe(true);
    expect(overview.body.deposits_pending).toBeUndefined();
    expect(overview.body.withdrawals_pending).toBeUndefined();
    expect(overview.body.reserve_balance_cents).toBeGreaterThan(0);
    expect(overview.body.trex_net_summary.tx_count).toBeGreaterThan(0);
    expect(overview.body.users_recent.every((u) => u.password_hash === undefined)).toBe(true);

    const net = await GET(`/admin/monitoring/reports/trex-net?product_id=${product.id}`, { token: admin.token });
    expect(net.status).toBe(200);
    expect(net.body.tx_count).toBe(1);
    expect(net.body.total_trex_net_cents).toBeGreaterThan(0);

    // Date-window filtering narrows it to nothing for a past window.
    const past = await GET("/admin/monitoring/reports/trex-net?from=2000-01-01&to=2000-01-02", { token: admin.token });
    expect(past.body.tx_count).toBe(0);

    const reserve = await GET("/admin/monitoring/reports/reserve-fund", { token: admin.token });
    expect(reserve.body.balance_cents).toBeGreaterThan(0);
    expect(reserve.body.recent_entries.length).toBeGreaterThan(0);
  });

  test("every privileged action lands in the audit log, filterable by actor, action and entity", async () => {
    const admin = await signupAdmin("logadmin");
    const target = await signup("logtarget");
    const product = await createProduct(admin.token);
    await PATCH(`/admin/users/${target.user.id}/status`, { status: "suspended" }, { token: admin.token });
    await PATCH(`/admin/users/${target.user.id}/status`, { status: "active" }, { token: admin.token });

    const mine = await GET(`/admin/logs?actor_user_id=${admin.user.id}`, { token: admin.token });
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThan(0);
    expect(mine.body.every((l) => l.actor_user_id === admin.user.id)).toBe(true);
    expect(mine.body.some((l) => l.action === "admin.user.set_status")).toBe(true);
    expect(mine.body.some((l) => l.action === "product.create")).toBe(true);

    const byAction = await GET("/admin/logs?action=admin.user.set_status", { token: admin.token });
    expect(byAction.body.every((l) => l.action === "admin.user.set_status")).toBe(true);
    expect(byAction.body.some((l) => l.entity_id === target.user.id)).toBe(true);

    const byEntity = await GET("/admin/logs?entity_type=product", { token: admin.token });
    expect(byEntity.body.every((l) => l.entity_type === "product")).toBe(true);
    expect(byEntity.body.some((l) => l.entity_id === product.id)).toBe(true);

    expect((await GET("/admin/logs?limit=1", { token: admin.token })).body.length).toBe(1);
  });
});
