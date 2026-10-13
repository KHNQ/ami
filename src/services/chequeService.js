import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { settingsService } from "./settingsService.js";
import { notificationService } from "./notificationService.js";

// The cheque register for instalment ("leasing") orders.
//
// Record-keeping, not accounting. Marking a cheque 'cleared' records that the
// bank honoured it; it does not move money, credit a wallet, or release
// commission -- the order booked its full margin at signing and collection is
// handled admin-to-customer. Keeping that boundary sharp is deliberate: the
// moment a cheque status starts triggering payouts, every financial invariant
// has to be re-derived against a payment history instead of a single row.

const STATUSES = ["pending", "cleared", "bounced", "cancelled"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function decodeImage(dataUrl) {
  if (!dataUrl) return { imageMime: undefined, imageBytes: undefined };
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw Errors.badRequest("image must be a base64 data URL", "invalid_image");
  const [, mime, base64] = match;
  if (!ALLOWED_IMAGE_MIME.includes(mime)) {
    throw Errors.badRequest(`image type ${mime} is not allowed`, "invalid_image_type");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw Errors.badRequest(`image must be under ${MAX_IMAGE_BYTES / 1024 / 1024}MB`, "image_too_large");
  }
  return { imageMime: mime, imageBytes: bytes };
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export const chequeService = {
  /** Registers a cheque against an order. */
  create(transactionId, body, actorUserId) {
    const tx = db.transactions.get(transactionId);
    if (!tx) throw Errors.notFound("Order not found");

    const amountCents = body.amount_cents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw Errors.badRequest("amount_cents must be a positive integer");
    }
    if (!body.due_date || !DATE_RE.test(body.due_date)) {
      throw Errors.badRequest("due_date is required, as YYYY-MM-DD", "invalid_due_date");
    }

    // Cheques plus the down payment must not promise more than the order is
    // worth. This catches a misplaced decimal at entry time, which is a far
    // likelier failure than anything adversarial.
    const existing = db.cheques.totalsByTransaction(transactionId);
    const committed = tx.amount_received_cents + existing.total_cents + amountCents;
    if (committed > tx.y_at_sale_cents) {
      throw Errors.unprocessable(
        `Cheques and down payment would total ${money(committed)}, more than the order value ${money(tx.y_at_sale_cents)}`,
        "cheques_exceed_order_value",
        { committedCents: committed, orderValueCents: tx.y_at_sale_cents }
      );
    }

    const { imageMime, imageBytes } = decodeImage(body.image_data_url);

    const cheque = db.cheques.create({
      transactionId,
      userId: tx.buyer_user_id,
      sequenceNo: db.cheques.nextSequenceNo(transactionId),
      chequeNumber: body.cheque_number,
      bankName: body.bank_name,
      amountCents,
      dueDate: body.due_date,
      note: body.note,
      recordedByAdminId: actorUserId,
      imageMime,
      imageBytes,
    });

    db.logs.record({
      actorUserId,
      action: "cheque.registered",
      entityType: "lease_cheque",
      entityId: cheque.id,
      meta: { transactionId, amountCents, dueDate: body.due_date },
    });
    return cheque;
  },

  get(id) {
    const cheque = db.cheques.get(id);
    if (!cheque) throw Errors.notFound("Cheque not found");
    return cheque;
  },

  /**
   * The cheque image. A cheque carries a bank account number, so this is
   * readable only by the customer it belongs to and by staff holding
   * cheques.read -- never public, never cached.
   */
  image(id, { requesterUserId, canReadAll }) {
    const cheque = this.get(id);
    if (!canReadAll && cheque.user_id !== requesterUserId) {
      throw Errors.forbidden("You do not have access to this cheque");
    }
    const row = db.cheques.image(id);
    if (!row || !row.image_bytes) throw Errors.notFound("This cheque has no image", "no_image");
    return { mime: row.image_mime || "application/octet-stream", bytes: Buffer.from(row.image_bytes) };
  },

  listForOrder(transactionId, { requesterUserId, canReadAll }) {
    const tx = db.transactions.get(transactionId);
    if (!tx) throw Errors.notFound("Order not found");
    if (!canReadAll && tx.buyer_user_id !== requesterUserId) {
      throw Errors.forbidden("You do not have access to this order");
    }
    const cheques = db.cheques.listByTransaction(transactionId);
    const totals = db.cheques.totalsByTransaction(transactionId);
    return {
      cheques,
      totals: {
        ...totals,
        // What the order still expects to collect, cheques aside.
        outstanding_cents: tx.y_at_sale_cents - tx.amount_received_cents - totals.cleared_cents,
        order_value_cents: tx.y_at_sale_cents,
        amount_received_cents: tx.amount_received_cents,
      },
    };
  },

  listMine(userId, opts) {
    return db.cheques.listByUser(userId, opts);
  },

  list(opts) {
    return db.cheques.list(opts);
  },

  update(id, body, actorUserId) {
    const cheque = this.get(id);
    if (cheque.status !== "pending") {
      throw Errors.unprocessable("Only a pending cheque can be edited", "cheque_not_pending");
    }
    if (body.due_date !== undefined && !DATE_RE.test(body.due_date)) {
      throw Errors.badRequest("due_date must be YYYY-MM-DD", "invalid_due_date");
    }
    if (body.amount_cents !== undefined && (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0)) {
      throw Errors.badRequest("amount_cents must be a positive integer");
    }
    const { imageMime, imageBytes } = decodeImage(body.image_data_url);

    const updated = db.cheques.update(id, {
      chequeNumber: body.cheque_number,
      bankName: body.bank_name,
      amountCents: body.amount_cents,
      dueDate: body.due_date,
      note: body.note,
      imageMime,
      imageBytes,
    });
    db.logs.record({ actorUserId, action: "cheque.updated", entityType: "lease_cheque", entityId: id, meta: body.amount_cents ? { amountCents: body.amount_cents } : {} });
    return updated;
  },

  /**
   * Records what the bank did.
   *
   * Clearing a cheque adds it to the order's collected total -- bookkeeping,
   * so the outstanding balance is right. It does not credit a wallet or
   * release commission.
   *
   * Bouncing one raises a notification to the customer and leaves the order
   * alone: chasing a default is a conversation, not an automatic refund. An
   * admin who decides to unwind the sale uses the existing refund path.
   */
  setStatus(id, status, actorUserId) {
    const cheque = this.get(id);
    if (!STATUSES.includes(status)) throw Errors.badRequest(`status must be one of: ${STATUSES.join(", ")}`);
    if (cheque.status === status) return cheque;
    if (cheque.status !== "pending") {
      throw Errors.unprocessable(
        `This cheque is already ${cheque.status} and cannot be changed`,
        "cheque_already_settled"
      );
    }

    const updated = db.transaction(() => {
      const next = db.cheques.setStatus(id, status);
      if (status === "cleared") db.transactions.addAmountReceived(cheque.transaction_id, cheque.amount_cents);

      if (status === "bounced") {
        const user = db.users.findById(cheque.user_id);
        if (user) {
          notificationService.enqueueForUser({
            user,
            template: "cheque_bounced",
            payload: {
              cheque_number: cheque.cheque_number,
              amount: money(cheque.amount_cents),
              company: settingsService.get("contact").company_name || "Ashkan Medical Idea",
            },
            dedupeKey: `cheque_bounced:${cheque.id}`,
          });
        }
      }
      return next;
    });

    db.logs.record({
      actorUserId,
      action: `cheque.${status}`,
      entityType: "lease_cheque",
      entityId: id,
      meta: { transactionId: cheque.transaction_id, amountCents: cheque.amount_cents },
    });
    return updated;
  },

  /**
   * Queues reminders for cheques coming due.
   *
   * Idempotent by construction: the dedupe key pins the cheque AND the lead
   * bucket, so re-running this -- by cron, by hand, after a deploy -- can
   * never text a customer twice about the same cheque at the same stage.
   * That property matters more than it looks: a customer who gets three
   * identical reminders stops reading the fourth.
   */
  queueDueReminders({ asOf = new Date(), leadDays } = {}) {
    // Ascending, so `find` below returns the TIGHTEST bucket a cheque has
    // reached rather than the widest. Sorted the other way, a cheque one day
    // out would still match the 7-day bucket first, reuse that dedupe key,
    // and be silently skipped -- the customer would get exactly one reminder
    // a week ahead and then nothing as the date actually arrived.
    const buckets = (leadDays || settingsService.get("cheque_reminder_lead_days"))
      .filter((d) => Number.isInteger(d) && d >= 0)
      .sort((a, b) => a - b);
    if (buckets.length === 0) return { considered: 0, queued: 0, skipped: 0 };

    const horizon = new Date(asOf.getTime() + Math.max(...buckets) * 86400_000).toISOString().slice(0, 10);
    const due = db.cheques.listPendingDueBy(horizon);
    const company = settingsService.get("contact").company_name || "Ashkan Medical Idea";
    const today = asOf.toISOString().slice(0, 10);

    let queued = 0;
    let skipped = 0;

    for (const cheque of due) {
      const daysUntil = Math.round((Date.parse(`${cheque.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
      // The tightest bucket this cheque has reached. One bucket per run --
      // rather than every bucket it has passed -- so a cheque registered
      // late doesn't fire a burst of backdated reminders all at once.
      const bucket = buckets.find((d) => daysUntil <= d);
      if (bucket === undefined) continue;

      const user = db.users.findById(cheque.user_id);
      if (!user) {
        skipped += 1;
        continue;
      }

      const result = notificationService.enqueueForUser({
        user,
        phone: user.phone,
        template: "cheque_due",
        payload: {
          cheque_number: cheque.cheque_number,
          amount: money(cheque.amount_cents),
          due_date: cheque.due_date,
          days_until: Math.max(0, daysUntil),
          company,
        },
        dedupeKey: `cheque_due:${cheque.id}:${bucket}`,
      });
      if (result) queued += 1;
      else skipped += 1;
    }

    return { considered: due.length, queued, skipped };
  },
};
