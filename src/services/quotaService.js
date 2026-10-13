import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

// Quota/tier progression mode (idea.md Section 7). Alternative to the
// default per-transaction wallet payout: when a commission_plan's
// payout_mode is 'quota', distributeCommission (commissionService.js)
// redirects an ancestor's would-be direct/indirect margin share into their
// progress toward the next tier instead of a pending wallet payout. See the
// schema.sql comment above quota_tiers for the full design rationale.
export const DEFAULT_TIER_NAMES = ["Blue", "Silver", "Gold", "Platinum", "Diamond"];

function parseTier(tier) {
  if (!tier) return tier;
  return { ...tier, perks: JSON.parse(tier.perks_json) };
}

export const quotaService = {
  listTiers(productId) {
    return db.quotaTiers.listByProduct(productId, { includeDisabled: true }).map(parseTier);
  },

  validateTierShape({ tierOrder, name, quotaTargetCents, cashBonusCents, rateBonusBp, perks }) {
    if (!Number.isInteger(tierOrder) || tierOrder < 1) {
      throw Errors.badRequest("tier_order must be a positive integer");
    }
    if (!name || typeof name !== "string") {
      throw Errors.badRequest("name is required");
    }
    if (!Number.isInteger(quotaTargetCents) || quotaTargetCents <= 0) {
      throw Errors.badRequest("quota_target_cents must be a positive integer");
    }
    if (cashBonusCents !== undefined && (!Number.isInteger(cashBonusCents) || cashBonusCents < 0)) {
      throw Errors.badRequest("cash_bonus_cents must be a non-negative integer");
    }
    // The bonus has to be self-funding. Completing a tier means the node
    // accumulated quota_target_cents of commission that was redirected into
    // progress instead of paid out -- money Trex retained. Paying back up to
    // that amount is covered by the retention; paying more is a guaranteed
    // loss on every completion, and nothing downstream re-checks it (unlike
    // per-sale payouts, which are capped by the payout pool). Validated at
    // save time, the same discipline as sum(level_rates) <= payout_pool and
    // sum(pool_share_bp) <= 10000.
    if (cashBonusCents !== undefined && quotaTargetCents !== undefined && cashBonusCents > quotaTargetCents) {
      throw Errors.badRequest(
        `cash_bonus_cents (${cashBonusCents}) cannot exceed quota_target_cents (${quotaTargetCents}) -- ` +
          `the bonus is funded by the commission redirected to reach the tier`,
        "cash_bonus_exceeds_quota"
      );
    }
    if (rateBonusBp !== undefined && (!Number.isInteger(rateBonusBp) || rateBonusBp < 0 || rateBonusBp > 10000)) {
      throw Errors.badRequest("rate_bonus_bp must be between 0 and 10000");
    }
    if (perks !== undefined && (!Array.isArray(perks) || perks.some((p) => typeof p !== "string"))) {
      throw Errors.badRequest("perks must be an array of strings");
    }
  },

  createTier(productId, body) {
    const tierOrder = body.tier_order;
    const name = body.name;
    const quotaTargetCents = body.quota_target_cents;
    const cashBonusCents = body.cash_bonus_cents ?? 0;
    const rateBonusBp = body.rate_bonus_bp ?? 0;
    const perks = body.perks ?? [];
    this.validateTierShape({ tierOrder, name, quotaTargetCents, cashBonusCents, rateBonusBp, perks });

    const existing = db.quotaTiers.listByProduct(productId, { includeDisabled: true });
    if (existing.some((t) => t.tier_order === tierOrder)) {
      throw Errors.conflict(`A tier with tier_order ${tierOrder} already exists for this product`, "duplicate_tier_order");
    }

    return parseTier(
      db.quotaTiers.create({ productId, tierOrder, name, quotaTargetCents, cashBonusCents, rateBonusBp, perks })
    );
  },

  updateTier(productId, tierId, patch) {
    const existing = db.quotaTiers.get(tierId);
    if (!existing || existing.product_id !== productId) throw Errors.notFound("Quota tier not found");

    const merged = {
      tierOrder: existing.tier_order,
      name: patch.name ?? existing.name,
      quotaTargetCents: patch.quota_target_cents ?? existing.quota_target_cents,
      cashBonusCents: patch.cash_bonus_cents ?? existing.cash_bonus_cents,
      rateBonusBp: patch.rate_bonus_bp ?? existing.rate_bonus_bp,
      perks: patch.perks ?? JSON.parse(existing.perks_json),
    };
    this.validateTierShape(merged);
    if (patch.status !== undefined && !["active", "disabled"].includes(patch.status)) {
      throw Errors.badRequest("status must be 'active' or 'disabled'");
    }

    return parseTier(
      db.quotaTiers.update(tierId, {
        name: merged.name,
        quotaTargetCents: merged.quotaTargetCents,
        cashBonusCents: merged.cashBonusCents,
        rateBonusBp: merged.rateBonusBp,
        perks: merged.perks,
        status: patch.status,
      })
    );
  },

  // GET /nodes/:id/quota -- live progress toward the next tier.
  getNodeState(nodeId, productId) {
    const state = db.nodeQuotaState.ensure(nodeId, productId);
    const tiers = db.quotaTiers.listByProduct(productId).map(parseTier);
    const currentTier = tiers.find((t) => t.tier_order === state.completed_tier_order) || null;
    const nextTier = tiers.find((t) => t.tier_order === state.completed_tier_order + 1) || null;
    return {
      node_id: nodeId,
      product_id: productId,
      current_tier: currentTier,
      next_tier: nextTier,
      accumulated_cents: state.accumulated_cents,
      unlocked_rate_bonus_bp: state.unlocked_rate_bonus_bp,
    };
  },

  listCompletions(nodeId, opts) {
    return db.quotaCompletions.listByNode(nodeId, opts);
  },

  // Called from inside commissionService.distributeCommission, which itself
  // runs inside purchaseService's outer db.transaction() -- this function
  // must NOT open its own transaction, it just extends that same atomic
  // write. A single large purchase can complete more than one tier in a row
  // (the while loop below), each completion paying its own cash bonus and
  // stacking its own rate_bonus_bp.
  applyProgress({ nodeId, userId, productId, amountCents }) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { completions: [] };

    const tiers = db.quotaTiers.listByProduct(productId); // active only, ascending tier_order
    const state = db.nodeQuotaState.ensure(nodeId, productId);

    let remaining = amountCents;
    let completedTierOrder = state.completed_tier_order;
    let accumulated = state.accumulated_cents;
    let unlockedRateBonusBp = state.unlocked_rate_bonus_bp;
    const completions = [];

    while (remaining > 0) {
      const nextTier = tiers.find((t) => t.tier_order === completedTierOrder + 1);
      if (!nextTier) break; // maxed out every configured tier -- stop tracking further progress

      accumulated += remaining;
      if (accumulated < nextTier.quota_target_cents) {
        remaining = 0;
        break;
      }

      remaining = accumulated - nextTier.quota_target_cents;
      accumulated = 0;
      completedTierOrder = nextTier.tier_order;
      unlockedRateBonusBp += nextTier.rate_bonus_bp;

      db.quotaCompletions.create({
        nodeId,
        userId,
        productId,
        quotaTierId: nextTier.id,
        tierOrder: nextTier.tier_order,
        cashBonusCents: nextTier.cash_bonus_cents,
        rateBonusBp: nextTier.rate_bonus_bp,
      });

      if (nextTier.cash_bonus_cents > 0) {
        db.wallet.credit(userId, nextTier.cash_bonus_cents, {
          type: "quota_tier_bonus",
          refType: "quota_tier",
          refId: nextTier.id,
        });
      }

      completions.push(nextTier);
    }

    db.nodeQuotaState.updateProgress(nodeId, productId, {
      completedTierOrder,
      accumulatedCents: accumulated,
      unlockedRateBonusBp,
    });

    return { completions };
  },

  // Applied on top of a node's base level rate in BOTH quota and wallet
  // mode -- a tier's rate_bonus_bp is a permanent reward, not tied to
  // whether the product currently redirects payouts into quota progress.
  rateBonusBp(nodeId, productId) {
    const state = db.nodeQuotaState.get(nodeId, productId);
    return state ? state.unlocked_rate_bonus_bp : 0;
  },
};
