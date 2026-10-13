import { db } from "../db/index.js";
import { bpOf } from "../lib/money.js";
import { Errors } from "../lib/errors.js";

// idea.md Section 7 item 4: rank/leadership bonus pool. Unlike per-transaction
// commission (paid immediately, per sale), this is a PERIODIC pool funded
// from a % of a product's already-collected trex_net over a date range, then
// split among nodes that hit both team-volume and personal-volume thresholds
// for a rank. "Team volume" only means something within one Space (one tree
// per product per root), so tiers/periods/ledger are scoped per product, same
// as commission_plans -- see db.nodes.teamVolumeBySpace for the per-space walk.

// Highest tier (by rank_order) whose thresholds are BOTH met. `tiersDesc`
// must already be sorted highest rank_order first (db.rankTiers.listByProduct
// returns them that way).
function assignRank({ teamVolumeCents, personalVolumeCents }, tiersDesc) {
  for (const tier of tiersDesc) {
    if (teamVolumeCents >= tier.team_volume_threshold_cents && personalVolumeCents >= tier.personal_volume_threshold_cents) {
      return tier;
    }
  }
  return null;
}

// sum(pool_share_bp) across a product's active tiers must stay <= 10000, same
// "validate the shape at save time, not at distribution time" discipline as
// commissionPlanService's level_rates_bp <= payout_pool_pct_bp check.
function validateTierShare(productId, { excludeTierId, addingPoolShareBp } = {}) {
  const existing = db.rankTiers.listByProduct(productId).filter((t) => t.id !== excludeTierId);
  const sum = existing.reduce((a, t) => a + t.pool_share_bp, 0) + (addingPoolShareBp || 0);
  if (sum > 10000) {
    throw Errors.unprocessable(`sum(pool_share_bp)=${sum} exceeds 10000 for product ${productId}`, "rank_tier_share_exceeded", {
      sum,
    });
  }
}

export const rankService = {
  assignRank,

  listTiers(productId) {
    return db.rankTiers.listByProduct(productId, { includeDisabled: true });
  },

  createTier(productId, { rankOrder, name, teamVolumeThresholdCents, personalVolumeThresholdCents, poolShareBp }) {
    if (!Number.isInteger(rankOrder) || rankOrder <= 0) throw Errors.badRequest("rankOrder must be a positive integer");
    if (!name) throw Errors.badRequest("name is required");
    if (!Number.isInteger(teamVolumeThresholdCents) || teamVolumeThresholdCents < 0) {
      throw Errors.badRequest("teamVolumeThresholdCents must be a non-negative integer");
    }
    if (!Number.isInteger(personalVolumeThresholdCents) || personalVolumeThresholdCents < 0) {
      throw Errors.badRequest("personalVolumeThresholdCents must be a non-negative integer");
    }
    if (!Number.isInteger(poolShareBp) || poolShareBp <= 0 || poolShareBp > 10000) {
      throw Errors.badRequest("poolShareBp must be in (0, 10000]");
    }
    validateTierShare(productId, { addingPoolShareBp: poolShareBp });
    return db.rankTiers.create({ productId, rankOrder, name, teamVolumeThresholdCents, personalVolumeThresholdCents, poolShareBp });
  },

  updateTier(tierId, patch) {
    const existing = db.rankTiers.get(tierId);
    if (!existing) throw Errors.notFound("Rank tier not found");
    if (patch.poolShareBp !== undefined) {
      if (!Number.isInteger(patch.poolShareBp) || patch.poolShareBp <= 0 || patch.poolShareBp > 10000) {
        throw Errors.badRequest("poolShareBp must be in (0, 10000]");
      }
      validateTierShare(existing.product_id, { excludeTierId: tierId, addingPoolShareBp: patch.poolShareBp });
    }
    return db.rankTiers.update(tierId, patch);
  },

  computeTeamVolumes(spaceId) {
    return db.nodes.teamVolumeBySpace(spaceId);
  },

  // Sums trex_net_amount_cents from this product's *fully completed*
  // transactions in [periodStart, periodEnd) and funds a capped pool from a
  // fixed % of that. Refunded/partially_refunded transactions are excluded
  // rather than netted out -- trex_net_amount_cents is never reduced by a
  // refund (see refundService.js, which claws back commissions/reserve but
  // leaves the original transaction's trex_net figure untouched), so
  // including them would overstate real accumulated profit for the period.
  // Idempotent: re-running for the same product+range returns the
  // already-funded period rather than double-funding it (UNIQUE constraint
  // backs this, but check first so this reads cleanly as a safe retry).
  //
  // Ranges are validated and normalised first. Two different-but-overlapping
  // ranges would each total the same sales into their own pool, paying the same
  // profit out twice -- so an overlap with an already-funded period is refused,
  // and only the identical range is the idempotent "safe retry".
  fundPeriodPool({ productId, periodStart: rawStart, periodEnd: rawEnd }) {
    const startMs = Date.parse(rawStart);
    const endMs = Date.parse(rawEnd);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw Errors.badRequest("period_start and period_end must be valid dates", "invalid_period");
    }
    if (startMs >= endMs) throw Errors.badRequest("period_start must be before period_end", "invalid_period");
    const periodStart = new Date(startMs).toISOString();
    const periodEnd = new Date(endMs).toISOString();

    const existing = db.rankBonusPeriods.getByProductAndRange(productId, periodStart, periodEnd);
    if (existing) return existing;
    const overlap = db.rankBonusPeriods.findOverlapping(productId, periodStart, periodEnd);
    if (overlap) {
      throw Errors.unprocessable(
        `This range overlaps an already-funded period (${overlap.period_start} to ${overlap.period_end}); its sales are already counted`,
        "period_overlaps",
        { periodId: overlap.id }
      );
    }

    const plan = db.commissionPlans.getByProductId(productId);
    if (!plan) throw Errors.notFound("No commission plan for this product");

    const agg = db.transactions.aggregateNet({ productId, fromDate: periodStart, toDate: periodEnd, status: "completed" });
    const trexNetBaseCents = agg.total_trex_net_cents;
    const poolAmountCents = bpOf(trexNetBaseCents, plan.rank_bonus_pool_pct_bp);

    return db.rankBonusPeriods.create({
      productId,
      periodStart,
      periodEnd,
      trexNetBaseCents,
      fundedPctBp: plan.rank_bonus_pool_pct_bp,
      poolAmountCents,
    });
  },

  // Assigns every node in the product's spaces to its single highest
  // qualifying tier, then splits each tier's slice of the pool equally among
  // that tier's qualifiers. Follows the same "cap computed once, entries
  // only ever subtract from it, hard-assert never exceeded" pattern as
  // commissionService.distributeCommission.
  distributeRankBonuses({ periodId }) {
    return db.transaction(() => {
      const period = db.rankBonusPeriods.get(periodId);
      if (!period) throw Errors.notFound("Rank bonus period not found");
      if (period.status !== "funded") {
        throw Errors.unprocessable(`Period is already ${period.status}, cannot distribute again`, "period_not_fundable");
      }

      const tiersDesc = db.rankTiers.listByProduct(period.product_id);
      if (tiersDesc.length === 0 || period.pool_amount_cents <= 0) {
        const updated = db.rankBonusPeriods.applyDistribution(period.id, 0);
        return { period: updated, entries: [] };
      }

      const qualifiersByTier = new Map(tiersDesc.map((t) => [t.id, []]));
      const spaces = db.spaces.listByProduct(period.product_id, { limit: 1_000_000 });
      for (const space of spaces) {
        const teamVolumes = db.nodes.teamVolumeBySpace(space.id);
        for (const node of db.nodes.listBySpace(space.id)) {
          const teamVolumeCents = teamVolumes.get(node.id) || 0;
          const personalVolumeCents = node.personal_volume_period_cents;
          const tier = assignRank({ teamVolumeCents, personalVolumeCents }, tiersDesc);
          if (tier) qualifiersByTier.get(tier.id).push({ node, teamVolumeCents, personalVolumeCents });
        }
      }

      let distributedCents = 0;
      const entries = [];
      for (const tier of tiersDesc) {
        const qualifiers = qualifiersByTier.get(tier.id);
        if (!qualifiers.length) continue;
        const tierPoolCents = bpOf(period.pool_amount_cents, tier.pool_share_bp);
        // Invariant 6-style rounding: floor division, remainder stays with
        // Trex rather than being distributed unevenly.
        const perNodeCents = Math.floor(tierPoolCents / qualifiers.length);
        if (perNodeCents <= 0) continue;
        for (const q of qualifiers) {
          const entry = db.rankBonusLedger.create({
            periodId: period.id,
            nodeId: q.node.id,
            userId: q.node.user_id,
            rankTierId: tier.id,
            teamVolumeCents: q.teamVolumeCents,
            personalVolumeCents: q.personalVolumeCents,
            amountCents: perNodeCents,
          });
          entries.push(entry);
          distributedCents += perNodeCents;
        }
      }

      if (distributedCents > period.pool_amount_cents) {
        throw new Error(
          `Invariant violated: rank bonus distributed (${distributedCents}) exceeds funded pool (${period.pool_amount_cents}) for period ${period.id}`
        );
      }

      const updatedPeriod = db.rankBonusPeriods.applyDistribution(period.id, distributedCents);
      db.logs.record({
        action: "rank_bonus.distributed",
        entityType: "rank_bonus_period",
        entityId: period.id,
        meta: { distributedCents, entryCount: entries.length },
      });
      return { period: updatedPeriod, entries };
    });
  },

  // Same hold-then-release pattern as commissionService.releaseMaturedCommissions.
  releaseMaturedRankBonuses({ holdDays, asOf = new Date() } = {}) {
    const cutoff = new Date(asOf.getTime() - holdDays * 24 * 60 * 60 * 1000).toISOString();
    const pending = db.rankBonusLedger.listPendingOlderThan(cutoff);
    let releasedCents = 0;
    const released = [];
    for (const entry of pending) {
      db.transaction(() => {
        db.rankBonusLedger.markPaid(entry.id);
        db.wallet.credit(entry.user_id, entry.amount_cents, {
          type: "rank_bonus_release",
          refType: "rank_bonus_ledger_entry",
          refId: entry.id,
        });
      });
      releasedCents += entry.amount_cents;
      released.push(entry.id);
    }
    return { releasedCount: released.length, releasedCents };
  },
};
