import { db } from "../db/index.js";
import { bpOf } from "../lib/money.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS;
}

export const activityService = {
  // Section 6 "meets_activity_requirement": a node only qualifies for
  // override commissions in the current period if its rolling personal
  // volume clears the plan's floor. personal_volume_period_cents is
  // incremented whenever the node itself completes a purchase, and reset
  // by resetPeriodIfDue below once activity_period_days has elapsed.
  meetsActivityRequirement(node, plan) {
    return node.personal_volume_period_cents >= plan.activity_min_pv_cents;
  },

  // Section 6/7 decay rule: a node inactive longer than
  // decay_inactive_days tapers its effective rate down by
  // decay_pct_per_period_bp for every additional full period of
  // continued inactivity, asymptotically toward zero (never negative).
  effectiveRateBp(node, plan, baseRateBp, asOf = new Date().toISOString()) {
    const inactiveDays = daysBetween(node.last_active_at, asOf);
    if (inactiveDays <= plan.decay_inactive_days) return baseRateBp;
    const overDays = inactiveDays - plan.decay_inactive_days;
    const periodsInactive = Math.floor(overDays / plan.activity_period_days) + 1;
    const retentionFractionBp = 10000 - plan.decay_pct_per_period_bp; // e.g. 9000 = keep 90% per period
    let rate = baseRateBp;
    for (let i = 0; i < periodsInactive; i++) {
      rate = bpOf(rate, retentionFractionBp);
      if (rate <= 0) return 0;
    }
    return rate;
  },

  // Scheduled job (Section 10, item 7): roll every node's personal-volume
  // period counter over once activity_period_days has elapsed since its
  // last reset. Idempotent to call repeatedly; only resets nodes that are due.
  recalculatePeriods(asOf = new Date().toISOString()) {
    const nodes = db.nodes.listAll({ limit: 100000 });
    let resetCount = 0;
    for (const node of nodes) {
      const plan = db.commissionPlans.get(
        db.products.get(node.product_id)?.commission_plan_id
      );
      const periodDays = plan ? plan.activity_period_days : 30;
      if (daysBetween(node.last_period_reset_at, asOf) >= periodDays) {
        db.nodes.resetPeriodVolume(node.id);
        resetCount++;
      }
    }
    return { checked: nodes.length, reset: resetCount };
  },
};
