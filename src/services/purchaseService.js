import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { bpOf } from "../lib/money.js";
import { distributeCommission } from "./commissionService.js";
import { productService } from "./productService.js";
import { commissionPlanService } from "./commissionPlanService.js";
import { settingsService } from "./settingsService.js";

// The full purchase flow from idea.md Sections 2-6 & 8:
//   no code  -> new Space, buyer becomes root node
//   with code -> buyer attaches as a child of the code owner, in that Space
// Every step below (space/node creation, redeem-code increment, wallet
// debit, transaction + ledger writes, reserve cut, volume increment) runs
// inside a single db.transaction() so a failure anywhere rolls the whole
// purchase back -- there's no way to end up with, say, a debited wallet but
// no Node, or a Node with no corresponding Transaction.
export const purchaseService = {
  // Self-service purchase from the storefront: paid from the buyer's wallet.
  buy({ userId, productId, redeemCode, discountCents = 0 }) {
    return this.placeOrder({ userId, productId, redeemCode, discountCents, payment: { mode: "wallet" } });
  },

  /**
   * The order flow, shared by both channels.
   *
   * `payment` is the ONLY thing that differs between a customer buying on the
   * site and an admin recording a walk-in:
   *   { mode: "wallet" }   debit the buyer's wallet (storefront)
   *   { mode: "offline", recordedByAdminId, amountReceivedCents, paymentTerms }
   *                        money changed hands at the office; no wallet touched
   *
   * Everything else -- Space/Node creation, redeem-code attachment, commission
   * distribution, the reserve cut, volume increments, the audit log -- is the
   * same code running the same way, which is the entire point: a walk-in sale
   * is a first-class citizen of the tree, not a parallel universe with its own
   * subtly different money maths.
   */
  placeOrder({ userId, productId, redeemCode, discountCents = 0, priceCents, payment = { mode: "wallet" } }) {
    if (!productId) throw Errors.badRequest("productId is required");
    // `priceCents` is the price agreed for THIS sale, used in place of the
    // product's list price. It exists for the walk-in desk: a customer who
    // holds a proforma must be charged what that proforma says, not whatever
    // the catalogue row happens to say today. The storefront never passes it.
    if (priceCents !== undefined && priceCents !== null && (!Number.isInteger(priceCents) || priceCents <= 0)) {
      throw Errors.badRequest("priceCents must be a positive integer");
    }
    if (!Number.isInteger(discountCents) || discountCents < 0) {
      throw Errors.badRequest("discountCents must be a non-negative integer");
    }
    if (!["wallet", "offline"].includes(payment.mode)) {
      throw Errors.badRequest("payment.mode must be 'wallet' or 'offline'");
    }

    const isOffline = payment.mode === "offline";
    const paymentTerms = isOffline ? payment.paymentTerms || "full" : "full";
    if (!["full", "installment"].includes(paymentTerms)) {
      throw Errors.badRequest("payment_terms must be 'full' or 'installment'", "invalid_payment_terms");
    }
    if (isOffline && (!Number.isInteger(payment.amountReceivedCents) || payment.amountReceivedCents < 0)) {
      throw Errors.badRequest("amount_received_cents must be a non-negative integer");
    }

    const product = productService.get(productId);
    if (product.status !== "active") throw Errors.unprocessable("Product is not available for purchase", "product_inactive");
    // Early, friendly rejection. The authoritative guard is the conditional
    // decrement inside the transaction below -- this one just avoids doing
    // any of the setup work for a sale that can't happen.
    if (product.stock_count <= 0) throw Errors.unprocessable("Product is out of stock", "out_of_stock");
    const plan = commissionPlanService.get(productId);

    // Clear error up front (Section 8 edge case); the UNIQUE(user_id,
    // product_id) constraint is the real race-proof backstop.
    const already = db.nodes.getByUserProduct(userId, productId);
    if (already) throw Errors.conflict("You already have a position for this product", "already_has_node");

    // Invariant 4: lock x/y at sale time from the product's current values;
    // never re-resolved later even if current_x/list price change.
    const xAtSaleCents = product.current_x_cents;
    const yAtSaleCents = (priceCents ?? product.list_price_y_cents) - discountCents;
    if (yAtSaleCents <= 0) throw Errors.badRequest("discount cannot meet or exceed list price");
    const marginCents = yAtSaleCents - xAtSaleCents;

    // Invariant 1: reject rather than silently clamp an over-large discount.
    if (marginCents < plan.min_margin_threshold_cents) {
      throw Errors.unprocessable(
        `Discounted price would leave margin ${marginCents} below the required minimum ${plan.min_margin_threshold_cents}`,
        "invariant1_violation",
        { marginCents, minMarginThresholdCents: plan.min_margin_threshold_cents }
      );
    }

    let redeemCodeRow = null;
    let ownerNode = null;
    if (redeemCode) {
      redeemCodeRow = db.redeemCodes.getByCode(redeemCode);
      if (!redeemCodeRow) throw Errors.notFound("Redeem code not found", "redeem_code_not_found");
      if (redeemCodeRow.product_id !== productId) {
        throw Errors.badRequest("Redeem code is not valid for this product", "redeem_code_wrong_product");
      }
      ownerNode = db.nodes.get(redeemCodeRow.owner_node_id);
      // Self-referral prevention (Section 8) -- also structurally impossible
      // once one-node-per-product is enforced, but validate explicitly with
      // a clear message.
      if (ownerNode.user_id === userId) {
        throw Errors.badRequest("You cannot redeem your own code", "self_referral");
      }
    }

    return db.transaction(() => {
      // Claim the unit first: a conditional UPDATE that only matches while
      // stock is still positive. Doing it here (rather than the unguarded
      // decrement this used to do at the end) means two buyers racing for
      // the last unit produce one sale and one clean 422, and a throw
      // anywhere later in this transaction hands the unit back.
      if (!db.products.tryDecrementStock(productId)) {
        throw Errors.unprocessable("Product is out of stock", "out_of_stock");
      }

      let spaceId, parentNodeId;

      if (redeemCodeRow) {
        // Atomic use-count increment; throws if expired/revoked/at max_uses
        // (Section 8: concurrent redeem-code use at the max_uses boundary).
        db.redeemCodes.tryIncrementUse(redeemCodeRow.id);
        spaceId = redeemCodeRow.space_id;
        parentNodeId = ownerNode.id;
      } else {
        const space = db.spaces.create({ productId, rootUserId: userId });
        spaceId = space.id;
        parentNodeId = null;
      }

      const node = db.nodes.create({ spaceId, productId, userId, parentNodeId });
      if (!redeemCodeRow) db.spaces.setRootNode(spaceId, node.id);

      const ownCode = db.redeemCodes.create({ ownerNodeId: node.id, productId, spaceId });
      db.nodes.setOwnRedeemCode(node.id, ownCode.id);

      // Pay for it. On the storefront path an underfunded wallet throws here
      // and rolls back everything created above. On the offline path the money
      // arrived at the office, so there is nothing to debit -- the amount
      // actually collected is recorded on the transaction instead, and any
      // remainder is tracked as cheques.
      if (!isOffline) {
        db.wallet.debit(userId, yAtSaleCents, { type: "purchase", refType: "product", refId: productId });
      }

      const nowIso = new Date().toISOString();
      const payoutPoolCents = bpOf(marginCents, plan.payout_pool_pct_bp);

      // Ledger entries FK to transaction_id, so the Transaction row has to
      // exist before distribute_commission runs; totals get patched in
      // right after via applyPayoutTotals.
      const txDraft = db.transactions.create({
        productId,
        spaceId,
        buyerNodeId: node.id,
        buyerUserId: userId,
        redeemCodeId: redeemCodeRow ? redeemCodeRow.id : null,
        xAtSaleCents,
        yAtSaleCents,
        discountCents,
        marginCents,
        payoutPoolAmountCents: payoutPoolCents,
        totalPayoutCents: 0,
        reserveAmountCents: 0,
        trexNetAmountCents: 0,
        channel: isOffline ? "in_person" : "online",
        recordedByAdminId: isOffline ? payment.recordedByAdminId || null : null,
        amountReceivedCents: isOffline ? payment.amountReceivedCents : yAtSaleCents,
        paymentTerms,
      });

      const { totalPayoutCents, entries } = distributeCommission({
        transaction: { id: txDraft.id, marginCents, createdAtIso: nowIso },
        buyerNode: node,
        plan,
      });

      // Invariant 3: trex_net (pre-reserve) must be strictly positive. Holds
      // by construction since totalPayoutCents <= payoutPoolCents ==
      // margin * payout_pool_pct_bp/10000 < margin -- asserted anyway so a
      // future refactor that breaks it fails loudly instead of silently.
      const trexNetPreReserveCents = marginCents - totalPayoutCents;
      if (trexNetPreReserveCents <= 0) {
        throw new Error(`Invariant 3 violated: trex_net_pre_reserve=${trexNetPreReserveCents} for tx ${txDraft.id}`);
      }

      // Dev/reserve fund cut, taken only from realized trex_net -- never
      // from margin directly and never from fees (Invariant 7).
      // reserve_pct_bp is validated < 10000 at plan save time, so
      // trexNetFinalCents stays > 0 whenever trexNetPreReserveCents > 0.
      const reserveCents = bpOf(trexNetPreReserveCents, plan.reserve_pct_bp);
      const trexNetFinalCents = trexNetPreReserveCents - reserveCents;
      if (trexNetFinalCents <= 0) {
        throw new Error(`Invariant 3 violated after reserve cut: trex_net_final=${trexNetFinalCents} for tx ${txDraft.id}`);
      }

      // The down-payment floor.
      //
      // Commission books on the full price at signing (see the note above),
      // which means without this the business can pay the upline more than it
      // has actually collected: a $20,000 order at $12,000 cost has a $5,200
      // payout pool, so $2,000 down and a stack of cheques that all bounce is
      // real money gone. Requiring the cash in hand to cover the payout buys
      // the safety property of pro-rata commission for the cost of one
      // comparison, and leaves the commission engine untouched.
      //
      // Checked here rather than up front because total_payout_cents is only
      // known once distribution has run -- and being inside the transaction
      // means a refusal cleanly unwinds the node, the space and the stock
      // decrement along with it.
      if (isOffline && payment.enforceDownPayment !== false && settingsService.isEnabled("require_down_payment_covers_payout")) {
        if (payment.amountReceivedCents < totalPayoutCents) {
          throw Errors.unprocessable(
            `Cash received (${payment.amountReceivedCents}) does not cover the commission payable on this order (${totalPayoutCents}). ` +
              `Collect a larger down payment, or have a root admin override with a reason.`,
            "down_payment_below_payout",
            { amountReceivedCents: payment.amountReceivedCents, totalPayoutCents }
          );
        }
      }

      db.transactions.applyPayoutTotals(txDraft.id, {
        totalPayoutCents,
        reserveAmountCents: reserveCents,
        trexNetAmountCents: trexNetFinalCents,
      });

      if (reserveCents > 0) {
        db.reserve.credit(reserveCents, { transactionId: txDraft.id, note: "purchase reserve cut" });
      }

      // The buyer's own purchase counts toward their own PV activity gate.
      db.nodes.incrementVolume(node.id, yAtSaleCents);

      db.logs.record({
        actorUserId: userId,
        action: "purchase.completed",
        entityType: "transaction",
        entityId: txDraft.id,
        meta: { productId, spaceId, marginCents, totalPayoutCents, reserveCents, trexNetFinalCents },
      });

      return {
        transaction: db.transactions.get(txDraft.id),
        node,
        space: db.spaces.get(spaceId),
        ownRedeemCode: ownCode,
        ledgerEntries: entries,
      };
    });
  },
};
