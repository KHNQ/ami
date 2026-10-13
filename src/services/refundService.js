import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { bpOf } from "../lib/money.js";

// Invariant 5: refund/clawback consistency. Clawback always walks the
// ledger entries actually written for this transaction (never a live tree
// walk -- tree shape could differ from what was originally paid).
export const refundService = {
  refund({ transactionId, amountCents, actorUserId, reason }) {
    const tx = db.transactions.get(transactionId);
    if (!tx) throw Errors.notFound("Transaction not found");
    if (tx.status === "refunded") throw Errors.unprocessable("Transaction is already fully refunded", "already_refunded");

    // What can be handed back is what was actually COLLECTED, not what the order
    // is worth. A part-paid installment order is worth more than the customer
    // has paid so far, and refunding the order value would credit their wallet
    // with money that never arrived. (For a wallet purchase and a paid-in-full
    // walk-in the two figures are the same.)
    const collectedCents = tx.amount_received_cents;
    const remainingRefundable = collectedCents - tx.refunded_amount_cents;
    if (remainingRefundable <= 0) {
      throw Errors.unprocessable("Nothing has been collected on this order, so there is nothing to refund", "nothing_to_refund");
    }
    const refundAmountCents = amountCents ?? remainingRefundable;
    if (!Number.isInteger(refundAmountCents) || refundAmountCents <= 0) {
      throw Errors.badRequest("amountCents must be a positive integer");
    }
    if (refundAmountCents > remainingRefundable) {
      throw Errors.unprocessable(
        `Cannot refund ${refundAmountCents}; only ${remainingRefundable} remains refundable on this transaction`,
        "refund_exceeds_remaining"
      );
    }

    // The refund that returns everything collected unwinds the sale, and an
    // unwound sale must leave nothing behind -- no commission, no reserve cut.
    // Proportional rounding (always down, Invariant 6) would otherwise leave a
    // few cents with the upline on every split refund, so the closing refund
    // reverses whatever is still outstanding instead of applying a ratio.
    const closesTheSale = refundAmountCents === remainingRefundable;

    // Fraction of what was collected that this call returns -- used to
    // proportionally claw back everything that scaled off the sale (per-level
    // commissions, reserve cut) for a PARTIAL refund.
    const ratioBp = Math.floor((refundAmountCents * 10000) / collectedCents);

    return db.transaction(() => {
      const entries = db.ledger.listByTransaction(transactionId);
      const clawbacks = [];

      for (const entry of entries) {
        if (entry.status === "clawed_back") continue; // nothing left to claw back
        // Quota-mode entries were never a pending/paid wallet payout -- the
        // amount was redirected into tier progress at purchase time and is
        // non-retroactive, same as rank_bonus_periods once distributed.
        if (entry.status === "quota_applied") continue;
        const payable = entry.amount_cents - entry.clawed_back_cents;
        if (payable <= 0) continue;
        let clawbackCents = closesTheSale ? payable : Math.min(bpOf(entry.amount_cents, ratioBp), payable);
        if (clawbackCents <= 0) continue;

        const newClawedTotal = entry.clawed_back_cents + clawbackCents;
        const fullyClawed = newClawedTotal >= entry.amount_cents;

        if (entry.status === "paid" || entry.status === "partially_clawed_back") {
          // Funds already sat in the node's wallet -- pull them back out.
          // Allowed to go negative: the node owes this back regardless of
          // current balance (tracked via the ledger entry either way).
          db.wallet.debit(entry.user_id, clawbackCents, {
            type: "commission_clawback",
            refType: "commission_ledger_entry",
            refId: entry.id,
            allowNegative: true,
            note: reason,
          });
          db.ledger.applyClawback(entry.id, clawbackCents, fullyClawed ? "clawed_back" : "partially_clawed_back");
        } else {
          // Still pending release -- just shrink what will eventually be
          // paid out; no wallet movement needed since it never left Trex.
          db.ledger.applyClawback(entry.id, clawbackCents, fullyClawed ? "clawed_back" : "pending");
        }
        clawbacks.push({ ledger_entry_id: entry.id, node_id: entry.node_id, clawed_back_cents: clawbackCents });
      }

      const reserveLeft = tx.reserve_amount_cents - db.reserve.debitedForTransaction(transactionId);
      const reserveClawbackCents = Math.max(
        0,
        closesTheSale ? reserveLeft : Math.min(bpOf(tx.reserve_amount_cents, ratioBp), reserveLeft)
      );
      if (reserveClawbackCents > 0) {
        db.reserve.debit(reserveClawbackCents, { transactionId, note: "refund clawback" });
      }

      // Trex refunds the buyer out of pocket for the refunded amount.
      db.wallet.credit(tx.buyer_user_id, refundAmountCents, {
        type: "refund",
        refType: "transaction",
        refId: transactionId,
        note: reason,
      });

      const newRefundedTotal = tx.refunded_amount_cents + refundAmountCents;
      const newStatus = closesTheSale ? "refunded" : "partially_refunded";
      const updatedTx = db.transactions.applyRefund(transactionId, { refundedAmountCents: newRefundedTotal, status: newStatus });

      db.logs.record({
        actorUserId,
        action: "transaction.refund",
        entityType: "transaction",
        entityId: transactionId,
        meta: { refundAmountCents, reserveClawbackCents, clawbacks: clawbacks.length, reason },
      });

      return { transaction: updatedTx, refundAmountCents, reserveClawbackCents, clawbacks };
    });
  },
};
