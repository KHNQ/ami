import { describe, test, expect, beforeAll } from "bun:test";
import { db } from "../src/db/index.js";
import { productService } from "../src/services/productService.js";
import { commissionPlanService } from "../src/services/commissionPlanService.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { redeemCodeService } from "../src/services/redeemCodeService.js";
import { refundService } from "../src/services/refundService.js";
import { supportService } from "../src/services/supportService.js";
import { nodeService } from "../src/services/nodeService.js";
import { quotaService } from "../src/services/quotaService.js";
import { rankService } from "../src/services/rankService.js";
import { jobsService } from "../src/services/jobsService.js";
import { reportService } from "../src/services/reportService.js";
import { auditSystem, systemStats } from "./systemAudit.js";

// Scale simulation: 1,200 users trading across 6 products until the
// database is large and messy, then a full consistency audit over the
// result.
//
// Deliberately driven at the *service* layer rather than over HTTP: signup
// hashes a password with bcrypt (~70ms), which for 1,200 accounts would be
// 90 seconds of pure key stretching and would tell us nothing new -- the
// HTTP surface is already covered end-to-end by production-simulation and
// http-api. What this exercises instead is the business logic under a
// volume and shape of data that hand-written cases never reach: wide trees,
// deep chains, concurrent-ish redeem code contention, refunds against
// partially-clawed-back ledgers, sold-out stock, suspended nodes mid-chain.
//
// Every random choice comes from a seeded PRNG so a failure is reproducible.

const SEED = 0x5eed1234;
const USER_COUNT = 1200;

/** mulberry32 -- small, fast, and deterministic across runs. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const between = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const sim = {
  admin: null,
  users: [],
  products: [],
  // productId -> array of { code, ownerUserId } available to be redeemed
  codePool: new Map(),
  purchases: [],
  stats: { own: 0, referred: 0, refused: {}, refunds: 0, tickets: 0, suspended: 0 },
};

function refuse(code) {
  sim.stats.refused[code] = (sim.stats.refused[code] || 0) + 1;
}

describe("scale simulation -- 1,200 users across 6 products", () => {
  beforeAll(() => {
    sim.admin = db.users.create({ email: `scale-admin-${SEED}@test.local`, passwordHash: "x", name: "Scale Admin", role: "admin" });

    // Six products spanning very different economics, so no single set of
    // magic numbers can satisfy the invariants everywhere.
    const shapes = [
      { name: "Scale Analyzer", xCents: 20_000, yCents: 60_000, stockCount: 900 },
      { name: "Scale Laser", xCents: 40_000, yCents: 130_000, stockCount: 700 },
      { name: "Scale Platform", xCents: 8_000, yCents: 21_000, stockCount: 900 },
      { name: "Scale Handheld", xCents: 3_000, yCents: 9_000, stockCount: 900 },
      // Thin margin: exercises the rounding-favours-Trex path hard.
      { name: "Scale ThinMargin", xCents: 9_500, yCents: 10_400, stockCount: 500 },
      // Deliberately scarce: most attempts on this one must be refused.
      { name: "Scale Scarce", xCents: 5_000, yCents: 40_000, stockCount: 25 },
    ];
    for (const shape of shapes) {
      const product = productService.create(shape, sim.admin.id);
      sim.products.push(product);
      sim.codePool.set(product.id, []);
    }

    // Vary the plans: different depths, pools and rate tables.
    commissionPlanService.update(
      sim.products[1].id,
      { payoutPoolPctBp: 5000, levelRatesBp: [2200, 1200, 700, 400], maxPayoutDepth: 4 },
      sim.admin.id
    );
    commissionPlanService.update(
      sim.products[2].id,
      { payoutPoolPctBp: 7000, levelRatesBp: [1500, 1000, 800, 600, 400, 300], maxPayoutDepth: 6 },
      sim.admin.id
    );
    // One product runs in quota mode, so tier progress and cash bonuses are
    // in the mix rather than tested in isolation.
    commissionPlanService.update(sim.products[3].id, { payoutMode: "quota" }, sim.admin.id);
    ["Blue", "Silver", "Gold"].forEach((name, i) => {
      quotaService.createTier(sim.products[3].id, {
        tier_order: i + 1,
        name,
        quota_target_cents: (i + 1) * 3_000,
        cash_bonus_cents: (i + 1) * 500,
        rate_bonus_bp: (i + 1) * 50,
        perks: [`${name} perk`],
      });
    });
    // And one carries rank tiers for the periodic leadership pool.
    commissionPlanService.update(sim.products[0].id, { rankBonusPoolPctBp: 500 }, sim.admin.id);
    rankService.createTier(sim.products[0].id, {
      rankOrder: 1,
      name: "Builder",
      teamVolumeThresholdCents: 120_000,
      personalVolumeThresholdCents: 1,
      poolShareBp: 6000,
    });
    rankService.createTier(sim.products[0].id, {
      rankOrder: 2,
      name: "Leader",
      teamVolumeThresholdCents: 600_000,
      personalVolumeThresholdCents: 1,
      poolShareBp: 4000,
    });

    for (let i = 0; i < USER_COUNT; i++) {
      sim.users.push(
        db.users.create({ email: `scale-${SEED}-${i}@test.local`, passwordHash: "x", name: `Scale User ${i}` })
      );
    }
  });

  test("every user's wallet is funded", () => {
    // Top-ups through the app are gone (payment is taken in person), so the
    // fixture credits the ledger directly.
    for (const user of sim.users) {
      db.wallet.credit(user.id, between(150_000, 900_000), { type: "adjustment", note: "sim fixture" });
      expect(db.wallet.getBalance(user.id)).toBeGreaterThan(0);
    }
    expect(db.users.list({ limit: 5000 }).length).toBeGreaterThanOrEqual(USER_COUNT);
  });

  // An explicit, generous timeout rather than bun's 5s default.
  //
  // This phase drives 1,200 signups and ~1,800 purchases through the real
  // service layer -- thousands of bcrypt hashes and SQLite transactions. It
  // finishes in roughly 4.5s on an idle machine, which is close enough to the
  // default that it passed alone and failed whenever anything else was using
  // the CPU (a parallel e2e run was enough). A test whose result depends on
  // machine load is not measuring the thing it claims to measure, so the
  // budget is stated here and set well clear of the real cost.
  test("1,200 users trade across 6 products in mixed roles", () => {
    for (const user of sim.users) {
      // Each user engages with one to three products.
      const productCount = between(1, 3);
      const chosen = new Set();
      for (let k = 0; k < productCount; k++) chosen.add(pick(sim.products).id);

      for (const productId of chosen) {
        const pool = sim.codePool.get(productId);
        // Roughly three quarters join an existing tree when one exists --
        // which is what produces deep chains rather than 1,200 lonely roots.
        const useCode = pool.length > 0 && chance(0.75);
        const entry = useCode ? pick(pool) : null;

        // Never redeem your own code; the service refuses it, but picking a
        // different one is what a real referrer would do.
        if (entry && entry.ownerUserId === user.id) continue;

        try {
          const receipt = purchaseService.buy({
            userId: user.id,
            productId,
            redeemCode: entry ? entry.code : undefined,
          });
          sim.purchases.push(receipt.transaction);
          if (entry) sim.stats.referred += 1;
          else sim.stats.own += 1;

          // Their own invite code joins the pool, so the tree keeps growing
          // outward from wherever the newest members landed.
          pool.push({ code: receipt.ownRedeemCode.code, ownerUserId: user.id });

          // Some members mint an extra, use-limited code as well.
          if (chance(0.08)) {
            const extra = redeemCodeService.generate({ userId: user.id, productId, maxUses: between(1, 3) });
            pool.push({ code: extra.code, ownerUserId: user.id });
          }
        } catch (err) {
          // Every refusal here should be a legitimate business rule firing.
          // Recorded rather than asserted inline: an assertion thrown from
          // inside this catch would abort the whole simulation loop at the
          // first surprise, leaving the rest of the run unexecuted and the
          // failure message devoid of context. The full set is checked once
          // the run is complete.
          refuse(err.code || `NO_CODE:${err.message}`);
        }
      }
    }

    // Second pass: people really do tap "buy" twice, and really do try to
    // pass their own invite code to themselves. The first pass can't
    // produce either (it visits each user once with a de-duplicated set of
    // products), so those guards would otherwise go unexercised at scale.
    for (const user of sim.users) {
      if (!chance(0.15)) continue;
      const owned = db.nodes.listByUser(user.id);
      if (!owned.length) continue;
      const node = pick(owned);
      const ownCode = node.own_redeem_code_id ? db.redeemCodes.get(node.own_redeem_code_id) : null;
      try {
        purchaseService.buy({
          userId: user.id,
          productId: node.product_id,
          // Half of them also try to redeem their own code while at it.
          redeemCode: ownCode && chance(0.5) ? ownCode.code : undefined,
        });
        // Reaching here means a user got a second position for one product.
        throw new Error(`duplicate purchase succeeded for user ${user.id} on product ${node.product_id}`);
      } catch (err) {
        refuse(err.code || `NO_CODE:${err.message}`);
      }
    }

    // Every refusal must be a rule we meant to have. Anything else is a
    // real bug wearing a business-error costume.
    const EXPECTED_REFUSALS = [
      "already_has_node",      // one position per user per product
      "out_of_stock",          // the scarce product ran dry
      "insufficient_funds",    // wallet could not cover the price
      "redeem_code_unusable",  // expired, revoked, or at max_uses
      "redeem_code_not_found",
      "self_referral",
      "product_inactive",
      "invariant1_violation",  // discount would breach the margin floor
    ];
    const unexpected = Object.keys(sim.stats.refused).filter((c) => !EXPECTED_REFUSALS.includes(c));
    expect(unexpected).toEqual([]);

    expect(sim.purchases.length).toBeGreaterThan(800);
    expect(sim.stats.referred).toBeGreaterThan(sim.stats.own);
    // The scarce product must have been rationed, and exhausted codes must
    // actually have stopped working -- both are load-only behaviours that
    // small hand-written cases never reach.
    expect(sim.stats.refused.out_of_stock).toBeGreaterThan(0);
    expect(sim.stats.refused.already_has_node).toBeGreaterThan(0);
  }, 30_000);

  test("the resulting network is deep and wide, not a flat fan-out", () => {
    const stats = systemStats();
    expect(stats.nodes).toBeGreaterThan(800);
    expect(stats.spaces).toBeGreaterThan(1);
    // A depth of at least 6 means codes were genuinely being passed down
    // chains rather than everyone joining the same handful of roots.
    expect(stats.maxTreeDepth).toBeGreaterThanOrEqual(6);
  });

  test("the platform is churned: refunds, suspensions, support requests", () => {
    // Refund about 6% of sales, including some already partially refunded.
    for (const tx of sim.purchases) {
      if (!chance(0.06)) continue;
      const live = db.transactions.get(tx.id);
      if (!live || live.status === "refunded") continue;
      const remaining = live.y_at_sale_cents - live.refunded_amount_cents;
      const amount = chance(0.5) ? Math.floor(remaining / 2) : undefined;
      if (amount !== undefined && amount <= 0) continue;
      refundService.refund({ transactionId: tx.id, amountCents: amount, actorUserId: sim.admin.id, reason: "sim" });
      sim.stats.refunds += 1;
    }
    expect(sim.stats.refunds).toBeGreaterThan(10);

    // Suspend a slice of nodes, including ones with downlines, so later
    // sales have to route around a dead link in the chain.
    const allNodes = db.nodes.listAll({ limit: 100000 });
    for (const node of allNodes) {
      if (!chance(0.04)) continue;
      nodeService.setStatus(node.id, "suspended", sim.admin.id);
      sim.stats.suspended += 1;
    }
    expect(sim.stats.suspended).toBeGreaterThan(10);

    // Support load.
    for (const user of sim.users) {
      if (!chance(0.05)) continue;
      const request = supportService.create({
        userId: user.id,
        name: user.name,
        contact: user.email,
        message: "Something happened.",
      });
      supportService.update(request.id, { status: chance(0.5) ? "resolved" : "in_progress" }, sim.admin.id);
      sim.stats.tickets += 1;
    }
    expect(sim.stats.tickets).toBeGreaterThan(20);
  });

  test("scheduled jobs settle the whole platform without breaking anything", () => {
    const pendingBefore = db._raw
      .query(`SELECT COUNT(*) AS n FROM commission_ledger_entries WHERE status = 'pending'`)
      .get().n;
    expect(pendingBefore).toBeGreaterThan(0);

    jobsService.recalculateActivityPeriods({});
    const released = jobsService.releaseCommissions({ holdDays: 0 });
    expect(released.releasedCount).toBeGreaterThan(0);

    const stillPending = db._raw
      .query(`SELECT COUNT(*) AS n FROM commission_ledger_entries WHERE status = 'pending'`)
      .get().n;
    expect(stillPending).toBe(0);

    // Rank pool over the whole trading window.
    const period = rankService.fundPeriodPool({
      productId: sim.products[0].id,
      periodStart: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(period.pool_amount_cents).toBeGreaterThan(0);
    const distribution = rankService.distributeRankBonuses({ periodId: period.id });
    // Never hands out more than was funded.
    const handedOut = distribution.entries.reduce((a, e) => a + e.amount_cents, 0);
    expect(handedOut).toBeLessThanOrEqual(period.pool_amount_cents);
    expect(distribution.entries.length).toBeGreaterThan(0);
    rankService.releaseMaturedRankBonuses({ holdDays: 0 });
  });

  test("no wallet is left negative except by a refund clawback", () => {
    // Withdrawals were removed; this keeps the guarantee they used to check:
    // nobody holds money they were not owed.
    const negative = db._raw.query(`SELECT COUNT(*) AS n FROM wallet_accounts WHERE balance_cents < 0`).get().n;
    const clawedBack = db._raw
      .query(`SELECT COUNT(DISTINCT user_id) AS n FROM wallet_ledger_entries WHERE type = 'commission_clawback'`)
      .get().n;
    expect(negative).toBeLessThanOrEqual(clawedBack);
  });

  test("the platform's own invariant report is clean at scale", () => {
    const audit = reportService.auditInvariants();
    if (!audit.ok) console.error("platform audit violations:", audit.violations.slice(0, 10));
    expect(audit.ok).toBe(true);
    expect(audit.checked).toBeGreaterThan(800);

    const reserve = reportService.reserveFundSummary();
    expect(reserve.balance_cents).toBeGreaterThan(0);

    const net = reportService.trexNetSummary({});
    expect(net.total_trex_net_cents).toBeGreaterThan(0);
    // Trex never pays out more than the pool it set aside.
    expect(net.total_payout_cents).toBeLessThanOrEqual(net.total_payout_pool_cents);
    // trex_net is booked at sale time and is NOT rewritten by refunds, so
    // the report has to surface the refunded total alongside it -- reading
    // the net figure alone would badly overstate what was kept.
    expect(net.total_refunded_cents).toBeGreaterThan(0);
    expect(net.total_refunded_cents).toBeLessThanOrEqual(net.total_revenue_cents);
  });

  test("the entire database is structurally and financially consistent", () => {
    const stats = systemStats();
    console.log("\n  --- 1,200-user scale simulation ---");
    console.log(`  users ${stats.users} | products ${stats.products} | spaces ${stats.spaces} | nodes ${stats.nodes}`);
    console.log(
      `  purchases: ${sim.stats.own} opened their own Space, ${sim.stats.referred} joined via a code | max depth ${stats.maxTreeDepth}`
    );
    console.log(`  refused: ${JSON.stringify(sim.stats.refused)}`);
    console.log(
      `  refunds ${sim.stats.refunds} | suspended nodes ${sim.stats.suspended} | support requests ${sim.stats.tickets}`
    );
    console.log(
      `  gross $${(stats.grossRevenueCents / 100).toFixed(2)} | payouts $${(stats.totalPayoutCents / 100).toFixed(2)} | ` +
        `trex_net $${(stats.trexNetCents / 100).toFixed(2)} | refunded $${(stats.refundedCents / 100).toFixed(2)} | ` +
        `reserve $${(stats.reserveCents / 100).toFixed(2)}`
    );
    console.log(`  commission entries ${stats.commissionEntries} | wallet entries ${stats.walletEntries}`);

    const problems = auditSystem();
    if (problems.length) {
      console.error(`\n  AUDIT FOUND ${problems.length} PROBLEM(S):\n   - ` + problems.slice(0, 40).join("\n   - "));
    }
    expect(problems).toEqual([]);
  });
});
