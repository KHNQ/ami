import { Hono } from "hono";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { commissionPlanService } from "../services/commissionPlanService.js";
import { rankService } from "../services/rankService.js";
import { quotaService } from "../services/quotaService.js";

export const commissionPlanRoutes = new Hono();

commissionPlanRoutes.get("/:productId", (c) => c.json(commissionPlanService.get(c.req.param("productId"))));

// MUST validate sum(level_rates) <= payout_pool_pct server-side before
// saving (Invariant 2) -- enforced inside commissionPlanService.update.
commissionPlanRoutes.patch("/:productId", requireAuth, requirePermission("plans.write"), async (c) => {
  const body = await c.req.json();
  const plan = commissionPlanService.update(
    c.req.param("productId"),
    {
      minMarginThresholdCents: body.min_margin_threshold_cents,
      payoutPoolPctBp: body.payout_pool_pct_bp,
      levelRatesBp: body.level_rates_bp,
      maxPayoutDepth: body.max_payout_depth,
      activityMinPvCents: body.activity_min_pv_cents,
      activityPeriodDays: body.activity_period_days,
      decayInactiveDays: body.decay_inactive_days,
      decayPctPerPeriodBp: body.decay_pct_per_period_bp,
      reservePctBp: body.reserve_pct_bp,
      compressionEnabled: body.compression_enabled,
      rankBonusPoolPctBp: body.rank_bonus_pool_pct_bp,
      payoutMode: body.payout_mode,
    },
    c.get("userId")
  );
  return c.json(plan);
});

// Rank/leadership bonus tiers (idea.md Section 7 item 4) -- viewable by
// anyone (same as the base plan), editable by admins only.
commissionPlanRoutes.get("/:productId/rank-tiers", (c) => c.json(rankService.listTiers(c.req.param("productId"))));

commissionPlanRoutes.post("/:productId/rank-tiers", requireAuth, requirePermission("plans.write"), async (c) => {
  const body = await c.req.json();
  const tier = rankService.createTier(c.req.param("productId"), {
    rankOrder: body.rank_order,
    name: body.name,
    teamVolumeThresholdCents: body.team_volume_threshold_cents,
    personalVolumeThresholdCents: body.personal_volume_threshold_cents,
    poolShareBp: body.pool_share_bp,
  });
  return c.json(tier);
});

commissionPlanRoutes.patch("/:productId/rank-tiers/:tierId", requireAuth, requirePermission("plans.write"), async (c) => {
  const body = await c.req.json();
  const tier = rankService.updateTier(c.req.param("tierId"), {
    name: body.name,
    teamVolumeThresholdCents: body.team_volume_threshold_cents,
    personalVolumeThresholdCents: body.personal_volume_threshold_cents,
    poolShareBp: body.pool_share_bp,
    status: body.status,
  });
  return c.json(tier);
});

// Quota/tier progression tiers (Blue/Silver/Gold/Platinum/Diamond by
// convention) -- viewable by anyone, editable by admins only. Independent
// of rank tiers above: this feature only takes effect once a plan's
// payout_mode is set to 'quota'.
commissionPlanRoutes.get("/:productId/quota-tiers", (c) => c.json(quotaService.listTiers(c.req.param("productId"))));

commissionPlanRoutes.post("/:productId/quota-tiers", requireAuth, requirePermission("plans.write"), async (c) => {
  const body = await c.req.json();
  const tier = quotaService.createTier(c.req.param("productId"), {
    tier_order: body.tier_order,
    name: body.name,
    quota_target_cents: body.quota_target_cents,
    cash_bonus_cents: body.cash_bonus_cents,
    rate_bonus_bp: body.rate_bonus_bp,
    perks: body.perks,
  });
  return c.json(tier);
});

commissionPlanRoutes.patch("/:productId/quota-tiers/:tierId", requireAuth, requirePermission("plans.write"), async (c) => {
  const body = await c.req.json();
  const tier = quotaService.updateTier(c.req.param("productId"), c.req.param("tierId"), {
    name: body.name,
    quota_target_cents: body.quota_target_cents,
    cash_bonus_cents: body.cash_bonus_cents,
    rate_bonus_bp: body.rate_bonus_bp,
    perks: body.perks,
    status: body.status,
  });
  return c.json(tier);
});
