import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { commissionPlanService } from "../src/services/commissionPlanService.js";
import { rankService } from "../src/services/rankService.js";
import { jobsService } from "../src/services/jobsService.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { refundService } from "../src/services/refundService.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";

// Wide enough to bracket every purchase a test makes without touching
// unrelated products (periods are scoped per-product anyway).
function widePeriod() {
  return {
    periodStart: new Date(Date.now() - 3600_000).toISOString(),
    periodEnd: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function buyChain(product, count) {
  const root = makeUser("rb_root");
  fundWallet(root.id, 1_000_000);
  let result = purchaseService.buy({ userId: root.id, productId: product.id });
  const chain = [result];
  let code = result.ownRedeemCode.code;
  for (let i = 0; i < count - 1; i++) {
    const u = makeUser(`rb_${i}`);
    fundWallet(u.id, 1_000_000);
    result = purchaseService.buy({ userId: u.id, productId: product.id, redeemCode: code });
    chain.push(result);
    code = result.ownRedeemCode.code;
  }
  return chain;
}

describe("Rank/leadership bonus pool -- tier config validation", () => {
  test("rejects tiers whose pool_share_bp sum exceeds 10000", () => {
    const product = makeProduct();
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Bronze",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 7000,
    });
    expect(() =>
      rankService.createTier(product.id, {
        rankOrder: 2,
        name: "Silver",
        teamVolumeThresholdCents: 0,
        personalVolumeThresholdCents: 0,
        poolShareBp: 4000,
      })
    ).toThrow();
  });

  test("accepts tiers whose pool_share_bp sum is exactly 10000", () => {
    const product = makeProduct();
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Bronze",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 6000,
    });
    const silver = rankService.createTier(product.id, {
      rankOrder: 2,
      name: "Silver",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 4000,
    });
    expect(silver.pool_share_bp).toBe(4000);
  });
});

describe("Rank/leadership bonus pool -- rank assignment", () => {
  test("exact-threshold boundary qualifies; one cent under does not", () => {
    const tiers = [
      { rank_order: 1, team_volume_threshold_cents: 1000, personal_volume_threshold_cents: 500 },
    ];
    expect(rankService.assignRank({ teamVolumeCents: 1000, personalVolumeCents: 500 }, tiers)).not.toBeNull();
    expect(rankService.assignRank({ teamVolumeCents: 999, personalVolumeCents: 500 }, tiers)).toBeNull();
    expect(rankService.assignRank({ teamVolumeCents: 1000, personalVolumeCents: 499 }, tiers)).toBeNull();
  });

  test("a node qualifying for multiple tiers is assigned only its highest", () => {
    const tiersDesc = [
      { id: "gold", rank_order: 2, team_volume_threshold_cents: 500, personal_volume_threshold_cents: 0 },
      { id: "bronze", rank_order: 1, team_volume_threshold_cents: 0, personal_volume_threshold_cents: 0 },
    ];
    const tier = rankService.assignRank({ teamVolumeCents: 900, personalVolumeCents: 0 }, tiersDesc);
    expect(tier.id).toBe("gold");
  });
});

describe("Rank/leadership bonus pool -- funding", () => {
  test("pool_amount_cents is a fixed % of completed-transaction trex_net in range", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 1000 }, "admin"); // 10%
    const [{ transaction }] = buyChain(product, 1);

    const { periodStart, periodEnd } = widePeriod();
    const period = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });

    expect(period.trex_net_base_cents).toBe(transaction.trex_net_amount_cents);
    expect(period.pool_amount_cents).toBe(Math.floor((transaction.trex_net_amount_cents * 1000) / 10000));
  });

  test("re-funding the same product+range is idempotent (no double-funding)", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 1000 }, "admin");
    buyChain(product, 1);
    const { periodStart, periodEnd } = widePeriod();

    const first = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    const second = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    expect(second.id).toBe(first.id);
    expect(db.rankBonusPeriods.listByProduct(product.id).length).toBe(1);
  });
});

describe("Rank/leadership bonus pool -- distribution", () => {
  test("distributed_cents never exceeds the funded pool cap, across many qualifying nodes", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 6500 }, "admin"); // aggressive, stress the cap
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Bronze",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 10000,
    });
    buyChain(product, 12);

    const { periodStart, periodEnd } = widePeriod();
    const period = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    const { period: distributed, entries } = rankService.distributeRankBonuses({ periodId: period.id });

    expect(distributed.distributed_cents).toBeLessThanOrEqual(distributed.pool_amount_cents);
    const sumEntries = entries.reduce((a, e) => a + e.amount_cents, 0);
    expect(sumEntries).toBe(distributed.distributed_cents);
  });

  test("re-distributing an already-distributed period is rejected (no double-payment)", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 1000 }, "admin");
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Bronze",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 10000,
    });
    buyChain(product, 2);
    const { periodStart, periodEnd } = widePeriod();
    const period = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    rankService.distributeRankBonuses({ periodId: period.id });

    expect(() => rankService.distributeRankBonuses({ periodId: period.id })).toThrow();
    // UNIQUE(period_id, node_id) backs this too -- entry count stays what it was.
    const entries = db.rankBonusLedger.listByPeriod(period.id);
    const nodeIds = entries.map((e) => e.node_id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  test("only nodes clearing both thresholds for a tier receive a payout", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 1000 }, "admin");
    // Threshold above what a single small purchase can reach.
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Gold",
      teamVolumeThresholdCents: 1_000_000,
      personalVolumeThresholdCents: 1_000_000,
      poolShareBp: 10000,
    });
    buyChain(product, 3);
    const { periodStart, periodEnd } = widePeriod();
    const period = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    const { entries } = rankService.distributeRankBonuses({ periodId: period.id });
    expect(entries.length).toBe(0);
  });
});

describe("Rank/leadership bonus pool -- refund interaction", () => {
  test("a refund on a transaction from an already-distributed period does not alter that period's entries", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 1000 }, "admin");
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Bronze",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 10000,
    });
    const [{ transaction }] = buyChain(product, 1);
    const { periodStart, periodEnd } = widePeriod();
    const period = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    const { entries: before } = rankService.distributeRankBonuses({ periodId: period.id });

    refundService.refund({ transactionId: transaction.id, actorUserId: "admin", reason: "test" });

    const after = db.rankBonusLedger.listByPeriod(period.id);
    expect(after.length).toBe(before.length);
    expect(after.map((e) => e.amount_cents)).toEqual(before.map((e) => e.amount_cents));
    expect(after.map((e) => e.status)).toEqual(before.map((e) => e.status));
  });
});

describe("Rank/leadership bonus pool -- release", () => {
  test("release job moves pending -> paid and credits the wallet exactly once past the hold window", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { rankBonusPoolPctBp: 1000 }, "admin");
    rankService.createTier(product.id, {
      rankOrder: 1,
      name: "Bronze",
      teamVolumeThresholdCents: 0,
      personalVolumeThresholdCents: 0,
      poolShareBp: 10000,
    });
    const [{ node }] = buyChain(product, 1);
    const { periodStart, periodEnd } = widePeriod();
    const period = rankService.fundPeriodPool({ productId: product.id, periodStart, periodEnd });
    const { entries } = rankService.distributeRankBonuses({ periodId: period.id });
    expect(entries.length).toBe(1);
    const entryId = entries[0].id;

    // The release job is global (mirrors releaseMaturedCommissions), so other
    // tests in this file may also have pending entries at this point -- scope
    // every assertion to this test's own node/entry rather than the job's
    // aggregate counters.
    const balanceBefore = db.wallet.getBalance(node.user_id);
    jobsService.releaseRankBonuses({ holdDays: -1 });
    expect(db.rankBonusLedger.get(entryId).status).toBe("paid");
    const balanceAfter = db.wallet.getBalance(node.user_id);
    expect(balanceAfter - balanceBefore).toBe(entries[0].amount_cents);

    // Calling again is a no-op for this entry -- already paid, won't be
    // picked up or credited a second time.
    jobsService.releaseRankBonuses({ holdDays: -1 });
    expect(db.wallet.getBalance(node.user_id)).toBe(balanceAfter);
  });
});
