import { db } from "../db/index.js";
import { AppError, Errors } from "../lib/errors.js";
import { purchaseService } from "./purchaseService.js";
import { chequeService } from "./chequeService.js";
import { ROOT, staffRoleOf } from "../lib/permissions.js";
import { salesService } from "./salesService.js";

// Walk-in sales: a customer comes to the office, pays there, and a member of
// staff records it.
//
// The order itself goes through exactly the same code as a storefront
// purchase (purchaseService.placeOrder) -- same Space and Node creation, same
// redeem-code attachment, same commission distribution, same reserve cut. The
// only difference is that no wallet is debited, because the money arrived in
// person. That sameness is the point: a walk-in buyer is a full participant
// in the network, not a second-class record bolted on beside it.

export const manualOrderService = {
  create({
    userId,
    productId,
    redeemCode,
    discountCents = 0,
    amountReceivedCents,
    paymentTerms = "full",
    cheques = [],
    note,
    overrideDownPayment = false,
    // The proforma this sale is being recorded from, if any. See below.
    quoteId,
    actor,
  }) {
    // Registering a sale FROM a proforma. The proforma is what the customer
    // was promised, so it supplies the three things staff would otherwise
    // retype -- and could mistype:
    //
    //   the device    the proforma's product
    //   the price     the proforma's amount, not the catalogue row's. The two
    //                 can differ (the storefront shows an indicative price
    //                 while a product still carries a placeholder), and
    //                 charging the catalogue figure is how a customer ends up
    //                 paying something other than the document in their hand.
    //   the referrer  the code from the referral link the visitor arrived
    //                 through, so nobody has to type an invite code.
    //
    // An explicit redeemCode still wins, including "" meaning "none": staff
    // can see the prefilled code on screen and must be able to remove it.
    let quote = null;
    let agreedPriceCents;
    if (quoteId) {
      quote = salesService.getQuoteRow(quoteId);
      if (["converted", "declined"].includes(quote.status)) {
        throw Errors.conflict(`This proforma is already ${quote.status}`, "quote_closed");
      }
      if (!quote.product_id) {
        throw Errors.badRequest("This proforma is not for a listed device, so it cannot be turned into an order", "quote_no_product");
      }
      if (productId && productId !== quote.product_id) {
        throw Errors.badRequest("The device does not match the proforma", "quote_product_mismatch");
      }
      productId = quote.product_id;
      agreedPriceCents = quote.amount_cents ?? undefined;
      if (redeemCode === undefined) redeemCode = quote.referral_code || undefined;
    }
    if (!redeemCode) redeemCode = undefined;

    if (!userId) throw Errors.badRequest("user_id is required -- create the customer's account first");
    const customer = db.users.findById(userId);
    if (!customer) throw Errors.notFound("Customer not found");
    if (customer.status !== "active") {
      throw Errors.unprocessable("Customer account is not active", "customer_inactive");
    }
    if (!Number.isInteger(amountReceivedCents) || amountReceivedCents < 0) {
      throw Errors.badRequest("amount_received_cents is required and must be a non-negative integer");
    }
    if (!Array.isArray(cheques)) throw Errors.badRequest("cheques must be an array");

    // Only a root admin may waive the down-payment floor, and only with a
    // reason -- the whole value of the floor is that it cannot be shrugged
    // off by whoever happens to be standing at the counter.
    if (overrideDownPayment) {
      if (staffRoleOf(actor) !== ROOT) {
        throw Errors.forbidden("Only a root admin can override the down-payment requirement", "override_not_permitted");
      }
      if (!note || !note.trim()) {
        throw Errors.badRequest("a note explaining the override is required", "override_reason_required");
      }
    }

    let receipt;
    try {
      receipt = purchaseService.placeOrder({
        userId,
        productId,
        redeemCode,
        discountCents,
        priceCents: agreedPriceCents,
        payment: {
          mode: "offline",
          recordedByAdminId: actor?.id || null,
          amountReceivedCents,
          paymentTerms,
          enforceDownPayment: !overrideDownPayment,
        },
      });
    } catch (err) {
      // The generic message talks about a "discounted price" and raw cents. When
      // the price came from a proforma the real cause is almost always that the
      // device's recorded cost is out of step with what it is being sold for,
      // and the person at the counter needs to be told that, in money.
      if (err instanceof AppError && err.code === "invariant1_violation" && agreedPriceCents != null) {
        const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        throw Errors.unprocessable(
          `The proforma price (${usd(agreedPriceCents)}) leaves too little margin over this device's recorded cost. ` +
            `Check the device's cost on its product page -- if it is a placeholder, set the real figure -- then record the sale again.`,
          "quote_price_below_margin",
          err.details
        );
      }
      throw err;
    }

    // Cheques are registered after the order exists, since they reference it.
    // Deliberately outside the order's transaction: a typo in the third
    // cheque should not silently undo a sale that has already been paid for
    // in the room. The reconciliation check in chequeService still refuses
    // any cheque that would over-commit the order.
    const registered = [];
    const rejected = [];
    for (const cheque of cheques) {
      try {
        registered.push(chequeService.create(receipt.transaction.id, cheque, actor?.id));
      } catch (err) {
        rejected.push({ cheque, error: err.code || "invalid_cheque", message: err.message });
      }
    }

    db.logs.record({
      actorUserId: actor?.id,
      action: "order.manual_recorded",
      entityType: "transaction",
      entityId: receipt.transaction.id,
      meta: {
        customerId: userId,
        productId,
        amountReceivedCents,
        paymentTerms,
        chequesRegistered: registered.length,
        chequesRejected: rejected.length,
        overrideDownPayment,
        note: note || null,
        quoteId: quote?.id ?? null,
        quoteReference: quote?.reference ?? null,
        agreedPriceCents: agreedPriceCents ?? null,
      },
    });

    // The proforma has become a sale. Done after the order so a refused order
    // leaves the proforma open for another attempt, and recorded on the quote
    // so the queue shows what was sold rather than what is merely pending.
    if (quote) {
      db.salesQuotes.update(quote.id, {
        status: "converted",
        transactionId: receipt.transaction.id,
        handledBy: actor?.id,
      });
      db.logs.record({
        actorUserId: actor?.id,
        action: "sales.quote_converted",
        entityType: "sales_quote",
        entityId: quote.id,
        meta: { reference: quote.reference, transactionId: receipt.transaction.id },
      });
    }

    const totals = db.cheques.totalsByTransaction(receipt.transaction.id);
    return {
      ...receipt,
      transaction: db.transactions.get(receipt.transaction.id),
      cheques: registered,
      // Surfaced rather than swallowed: the person at the counter needs to
      // know which cheques did not go in, while they still have the customer
      // in front of them.
      rejected_cheques: rejected,
      balance: {
        order_value_cents: receipt.transaction.y_at_sale_cents,
        amount_received_cents: amountReceivedCents,
        cheques_total_cents: totals.total_cents,
        outstanding_cents: receipt.transaction.y_at_sale_cents - amountReceivedCents - totals.cleared_cents,
      },
    };
  },
};
