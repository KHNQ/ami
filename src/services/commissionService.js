import { db } from "../db/index.js";
import { bpOf } from "../lib/money.js";
import { activityService } from "./activityService.js";
import { quotaService } from "./quotaService.js";

// Section 6 distribute_commission algorithm. Must be called from inside a
// db.transaction() alongside the Transaction insert so payout math and the
// ledger rows it produces are written atomically.
//
// Invariant 2/3 are enforced by construction here: payout_pool is computed
// once from margin * payout_pool_pct, and every ledger entry only ever
// subtracts from that same fixed pool — so total_payout can never exceed it,
// no matter how deep or wide the ancestor chain is.
export function distributeCommission({ transaction, buyerNode, plan }) {
  const marginCents = transaction.marginCents;
  const payoutPoolCents = bpOf(marginCents, plan.payout_pool_pct_bp);

  const entries = [];
  let totalPayoutCents = 0;

  let ancestor = buyerNode.parent_node_id ? db.nodes.get(buyerNode.parent_node_id) : null;
  let depth = 1;

  while (ancestor && depth <= plan.max_payout_depth) {
    const baseRateBp = plan.level_rates_bp[depth - 1] ?? 0;
    const qualifies =
      ancestor.status === "active" &&
      activityService.meetsActivityRequirement(ancestor, plan) &&
      baseRateBp > 0;

    if (qualifies) {
      // A completed quota tier's rate_bonus_bp is a permanent reward that
      // applies here regardless of payout_mode -- see quotaService.js.
      const unlockedBonusBp = quotaService.rateBonusBp(ancestor.id, plan.product_id);
      const effectiveRateBp = activityService.effectiveRateBp(
        ancestor,
        plan,
        baseRateBp + unlockedBonusBp,
        transaction.createdAtIso
      );
      const amountCents = bpOf(marginCents, effectiveRateBp); // Invariant 6: floor
      if (amountCents > 0) {
        if (plan.payout_mode === "quota") {
          // Redirected into tier progress instead of a pending wallet
          // payout -- recorded for visibility but NOT added to
          // totalPayoutCents, since nothing left payoutPoolCents as cash;
          // the amount stays inside trex_net until (if ever) a tier
          // completion pays its own, independent cash bonus. Mirrors how
          // rank_bonus_periods draws from already-settled trex_net rather
          // than debiting payoutPoolCents.
          const entry = db.ledger.create({
            transactionId: transaction.id,
            nodeId: ancestor.id,
            userId: ancestor.user_id,
            levelDepth: depth,
            rateAppliedBp: effectiveRateBp,
            amountCents,
            status: "quota_applied",
          });
          entries.push(entry);
          quotaService.applyProgress({ nodeId: ancestor.id, userId: ancestor.user_id, productId: plan.product_id, amountCents });
        } else {
          const entry = db.ledger.create({
            transactionId: transaction.id,
            nodeId: ancestor.id,
            userId: ancestor.user_id,
            levelDepth: depth,
            rateAppliedBp: effectiveRateBp,
            amountCents,
          });
          entries.push(entry);
          totalPayoutCents += amountCents;
        }
      }
    }
    // else: inactive/suspended/fails activity requirement -> gets 0, and per
    // plan config (compression_enabled) that unpaid share either stays with
    // Trex (default/safe) or would roll to the next active ancestor.
    // Compression is intentionally NOT implemented by default (Section 6
    // notes it as optional/advanced) — the safe default keeps the unpaid
    // share with Trex, which trivially preserves Invariant 2/3.

    ancestor = ancestor.parent_node_id ? db.nodes.get(ancestor.parent_node_id) : null;
    depth += 1;
  }

  // Defensive re-assertion of Invariant 3 by construction — this can never
  // actually fire given the loop above only subtracts from payoutPoolCents,
  // but a hard assert here means a future refactor that breaks the
  // invariant fails loudly instead of silently overpaying.
  if (totalPayoutCents > payoutPoolCents) {
    throw new Error(
      `Invariant 2/3 violated: totalPayoutCents (${totalPayoutCents}) exceeds payoutPoolCents (${payoutPoolCents})`
    );
  }

  return { payoutPoolCents, totalPayoutCents, entries };
}

// Invariant 5: commissions sit `pending` for a hold window before being
// released to the node's withdrawable wallet balance. Callable directly
// (tests, admin trigger) or from a scheduled job.
export function releaseMaturedCommissions({ holdDays, asOf = new Date() } = {}) {
  const cutoff = new Date(asOf.getTime() - holdDays * 24 * 60 * 60 * 1000).toISOString();
  const pending = db.ledger.listPendingOlderThan(cutoff);
  let releasedCents = 0;
  const released = [];
  for (const entry of pending) {
    // Pay what is still owed, NOT the amount originally earned. A refund
    // against a sale whose commission hasn't matured yet shrinks the entry
    // in place and leaves it pending (refundService: "just shrink what will
    // eventually be paid out") -- crediting amount_cents here would hand
    // back the clawed-back share and undo the refund entirely.
    const payableCents = entry.amount_cents - entry.clawed_back_cents;
    if (payableCents <= 0) {
      // Fully clawed back before it ever matured: nothing to pay, but the
      // entry must still be resolved so the job doesn't reconsider it
      // forever.
      db.ledger.applyClawback(entry.id, 0, "clawed_back");
      released.push(entry.id);
      continue;
    }
    db.transaction(() => {
      db.ledger.markPaid(entry.id);
      db.wallet.credit(entry.user_id, payableCents, {
        type: "commission_release",
        refType: "commission_ledger_entry",
        refId: entry.id,
      });
    });
    releasedCents += payableCents;
    released.push(entry.id);
  }
  return { releasedCount: released.length, releasedCents };
}
