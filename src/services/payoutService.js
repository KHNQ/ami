import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { settingsService } from "./settingsService.js";

// What the company owes the network, and recording that it was handed over.
//
// The business this serves pays its network the same way it takes payment for
// a device: in person, in cash or by transfer, outside this system. So the
// system's job is not to move the money -- it is to be the authority on WHO
// is owed WHAT and WHY, and to hold an honest record of each settlement.
//
// That is why nothing here credits a wallet. A wallet balance is a promise
// the company can be asked to honour again later; if the cash has already
// crossed the counter, writing it into a wallet too is how the same
// commission gets paid twice.

const money = (cents) => ({
  cents,
  display: `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
});

export const payoutService = {
  /**
   * The payout sheet: one line per person, newest sale to oldest.
   *
   * This is the screen someone works from on payday, so it answers the two
   * questions that matter in that moment -- how much, and how to reach them.
   */
  sheet({ productId = null } = {}) {
    const rows = db.ledger.outstandingByUser({ productId });
    const totalCents = rows.reduce((sum, r) => sum + r.owed_cents, 0);
    return {
      auto_payout: settingsService.isEnabled("network_auto_payout"),
      people: rows.map((r) => ({
        user_id: r.user_id,
        name: r.user_name,
        email: r.user_email,
        phone: r.user_phone,
        owed: money(r.owed_cents),
        entry_count: r.entry_count,
        earliest_sale_at: r.oldest_at,
        latest_sale_at: r.newest_at,
      })),
      total: money(totalCents),
      people_count: rows.length,
    };
  },

  /** The sales behind one person's total, so a payment can be justified line by line. */
  detail(userId, { productId = null } = {}) {
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    const lines = db.ledger.outstandingForUser(userId, { productId });
    return {
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone ?? null },
      lines: lines.map((l) => ({
        entry_id: l.id,
        level: l.level_depth,
        rate_bp: l.rate_applied_bp,
        amount: money(l.amount_cents - l.clawed_back_cents),
        clawed_back: money(l.clawed_back_cents),
        from_buyer: l.buyer_name,
        product: l.product_name,
        sale_value: money(l.y_at_sale_cents),
        sale_at: l.sale_at,
      })),
      total: money(lines.reduce((s, l) => s + l.amount_cents - l.clawed_back_cents, 0)),
    };
  },

  /**
   * Records that someone has been paid.
   *
   * `expectedCents` is required and is the amount the admin saw on screen
   * when they counted out the money. If the real total has moved since --
   * another sale landed, a refund clawed some back, a colleague settled it
   * thirty seconds ago -- this refuses rather than silently settling a
   * different number than the one that was paid.
   */
  settle({ userId, expectedCents, method, reference = null, note = null, actorUserId, productId = null }) {
    if (!userId) throw Errors.badRequest("user_id is required", "user_required");
    if (!Number.isInteger(expectedCents) || expectedCents <= 0) {
      throw Errors.badRequest("expected_cents must be a positive integer", "expected_required");
    }
    if (!["cash", "bank_transfer", "cheque", "offset", "other"].includes(method)) {
      throw Errors.badRequest("method must be cash, bank_transfer, cheque, offset or other", "invalid_method");
    }

    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");

    const owedNow = db.ledger
      .outstandingForUser(userId, { productId })
      .reduce((s, l) => s + l.amount_cents - l.clawed_back_cents, 0);

    if (owedNow === 0) throw Errors.conflict("Nothing is outstanding for this person", "nothing_outstanding");
    if (owedNow !== expectedCents) {
      throw Errors.conflict(
        `The outstanding total is now ${money(owedNow).display}, not ${money(expectedCents).display}. ` +
          `Refresh the payout sheet and check the amount before paying.`,
        "amount_moved",
        { owed_cents: owedNow, expected_cents: expectedCents }
      );
    }

    const settledCount = db.ledger.settleForUser(userId, { productId });
    if (settledCount === 0) {
      // Another admin claimed the same lines between the read above and this
      // UPDATE. The guarded statement is what makes that safe; this is what
      // makes it visible to the person standing there with the cash.
      throw Errors.conflict("Someone else just settled this payout", "already_settled");
    }

    db.logs.record({
      actorUserId,
      action: "network.commission_paid",
      entityType: "user",
      entityId: userId,
      meta: {
        amountCents: owedNow,
        entriesSettled: settledCount,
        method,
        reference,
        note,
        productId,
      },
    });

    return {
      ok: true,
      user: { id: user.id, name: user.name, email: user.email },
      paid: money(owedNow),
      entries_settled: settledCount,
      method,
      reference,
      // Said plainly, because it is the one thing that could be misread: the
      // system has recorded a payment, it has not made one.
      note: "Recorded as paid by hand. No money was moved by the system.",
    };
  },

  /**
   * Everything settled so far, for reconciliation.
   *
   * Read back out of the audit log rather than from a payouts table of its
   * own. A settlement is not a new kind of record -- it is a privileged thing
   * a named person did at a known time, which is exactly what audit_logs is,
   * and a second table would be a second version of that truth to keep in
   * step.
   */
  history({ limit = 100, offset = 0 } = {}) {
    return db.logs.list({ action: "network.commission_paid", limit, offset }).map((row) => {
      let meta = {};
      try {
        meta = JSON.parse(row.meta_json || "{}");
      } catch {
        meta = {};
      }
      return {
        at: row.created_at,
        by_admin_id: row.actor_user_id,
        user_id: row.entity_id,
        paid: money(meta.amountCents || 0),
        entries_settled: meta.entriesSettled ?? null,
        method: meta.method ?? null,
        reference: meta.reference ?? null,
        note: meta.note ?? null,
      };
    });
  },
};
