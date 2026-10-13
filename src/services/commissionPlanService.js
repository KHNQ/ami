import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

// Invariant 2 lives here: sum(level_rates) MUST be <= payout_pool_pct,
// validated at save time (not per-transaction) so it can never be violated
// by a bad config slipping through.
function validatePlanShape(fields) {
  const {
    minMarginThresholdCents,
    payoutPoolPctBp,
    levelRatesBp,
    maxPayoutDepth,
    activityMinPvCents,
    activityPeriodDays,
    decayInactiveDays,
    decayPctPerPeriodBp,
    reservePctBp,
  } = fields;

  if (!Number.isInteger(minMarginThresholdCents) || minMarginThresholdCents <= 0) {
    throw Errors.badRequest("minMarginThresholdCents must be a positive integer (Invariant 1 floor)");
  }
  if (!Number.isInteger(payoutPoolPctBp) || payoutPoolPctBp < 0 || payoutPoolPctBp >= 10000) {
    throw Errors.badRequest("payoutPoolPctBp must be in [0, 10000)");
  }
  if (!Array.isArray(levelRatesBp) || levelRatesBp.length === 0) {
    throw Errors.badRequest("levelRatesBp must be a non-empty array");
  }
  for (const r of levelRatesBp) {
    if (!Number.isInteger(r) || r < 0) throw Errors.badRequest("each levelRatesBp entry must be a non-negative integer");
  }
  const sum = levelRatesBp.reduce((a, b) => a + b, 0);
  if (sum > payoutPoolPctBp) {
    throw Errors.unprocessable(
      `sum(level_rates_bp)=${sum} exceeds payout_pool_pct_bp=${payoutPoolPctBp} (Invariant 2)`,
      "invariant2_violation",
      { sum, payoutPoolPctBp }
    );
  }
  if (!Number.isInteger(maxPayoutDepth) || maxPayoutDepth <= 0) {
    throw Errors.badRequest("maxPayoutDepth must be a positive integer");
  }
  if (maxPayoutDepth > levelRatesBp.length) {
    throw Errors.badRequest("maxPayoutDepth cannot exceed the number of levelRatesBp entries provided");
  }
  if (!Number.isInteger(activityMinPvCents) || activityMinPvCents < 0) {
    throw Errors.badRequest("activityMinPvCents must be a non-negative integer");
  }
  if (!Number.isInteger(activityPeriodDays) || activityPeriodDays <= 0) {
    throw Errors.badRequest("activityPeriodDays must be a positive integer");
  }
  if (!Number.isInteger(decayInactiveDays) || decayInactiveDays <= 0) {
    throw Errors.badRequest("decayInactiveDays must be a positive integer");
  }
  if (!Number.isInteger(decayPctPerPeriodBp) || decayPctPerPeriodBp < 0 || decayPctPerPeriodBp > 10000) {
    throw Errors.badRequest("decayPctPerPeriodBp must be in [0, 10000]");
  }
  // reservePctBp must stay strictly < 10000 so trex_net after the reserve
  // cut is still guaranteed > 0 whenever pre-reserve trex_net is > 0.
  if (!Number.isInteger(reservePctBp) || reservePctBp < 0 || reservePctBp >= 10000) {
    throw Errors.badRequest("reservePctBp must be in [0, 10000)");
  }
  if (
    fields.rankBonusPoolPctBp !== undefined &&
    (!Number.isInteger(fields.rankBonusPoolPctBp) || fields.rankBonusPoolPctBp < 0 || fields.rankBonusPoolPctBp > 10000)
  ) {
    throw Errors.badRequest("rankBonusPoolPctBp must be in [0, 10000]");
  }
  if (fields.payoutMode !== undefined && !["wallet", "quota"].includes(fields.payoutMode)) {
    throw Errors.badRequest("payoutMode must be 'wallet' or 'quota'");
  }
}

export const commissionPlanService = {
  upsert(productId, fields) {
    validatePlanShape(fields);
    return db.commissionPlans.upsert({ productId, ...fields });
  },

  update(productId, patch, actorUserId) {
    const existing = db.commissionPlans.getByProductId(productId);
    if (!existing) throw Errors.notFound("No commission plan exists for this product yet");
    const merged = {
      minMarginThresholdCents: patch.minMarginThresholdCents ?? existing.min_margin_threshold_cents,
      payoutPoolPctBp: patch.payoutPoolPctBp ?? existing.payout_pool_pct_bp,
      levelRatesBp: patch.levelRatesBp ?? existing.level_rates_bp,
      maxPayoutDepth: patch.maxPayoutDepth ?? existing.max_payout_depth,
      activityMinPvCents: patch.activityMinPvCents ?? existing.activity_min_pv_cents,
      activityPeriodDays: patch.activityPeriodDays ?? existing.activity_period_days,
      decayInactiveDays: patch.decayInactiveDays ?? existing.decay_inactive_days,
      decayPctPerPeriodBp: patch.decayPctPerPeriodBp ?? existing.decay_pct_per_period_bp,
      reservePctBp: patch.reservePctBp ?? existing.reserve_pct_bp,
      compressionEnabled: patch.compressionEnabled ?? !!existing.compression_enabled,
      rankBonusPoolPctBp: patch.rankBonusPoolPctBp ?? existing.rank_bonus_pool_pct_bp,
      payoutMode: patch.payoutMode ?? existing.payout_mode,
    };
    validatePlanShape(merged);
    const plan = db.commissionPlans.upsert({ productId, ...merged });
    db.logs.record({ actorUserId, action: "commission_plan.update", entityType: "commission_plan", entityId: plan.id, meta: merged });
    return plan;
  },

  get(productId) {
    const plan = db.commissionPlans.getByProductId(productId);
    if (!plan) throw Errors.notFound("No commission plan for this product");
    return plan;
  },
};
