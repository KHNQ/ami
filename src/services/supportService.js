import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { settingsService } from "./settingsService.js";
import { notificationService } from "./notificationService.js";

// Support intake.
//
// Someone leaves a name, a way to reach them and what they need; an admin
// reads it and follows up directly. There is deliberately no thread, no
// reply box and no live chat -- the queue is the whole feature.

const STATUSES = ["new", "in_progress", "resolved", "closed"];
const MAX_NAME = 200;
const MAX_CONTACT = 200;
const MAX_MESSAGE = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, field, max) {
  if (typeof value !== "string" || !value.trim()) throw Errors.badRequest(`${field} is required`);
  if (value.trim().length > max) throw Errors.badRequest(`${field} must be under ${max} characters`);
  return value.trim();
}

export const supportService = {
  /**
   * Public: anyone may ask for help, signed in or not -- the person who most
   * needs support is often the one who cannot log in.
   */
  create({ name, contact, message, userId = null, ip = null }) {
    if (!settingsService.isEnabled("support_tickets_enabled")) {
      throw Errors.forbidden(
        "Support requests are temporarily closed. Please contact us by phone or email.",
        "support_disabled"
      );
    }
    const request = db.support.create({
      name: clean(name, "name", MAX_NAME),
      contact: clean(contact, "contact", MAX_CONTACT),
      message: clean(message, "message", MAX_MESSAGE),
      userId,
      ip,
    });
    // Acknowledge when the contact is an email address. Queued, never sent
    // inline, and a failure to enqueue must not lose the request itself.
    if (EMAIL_RE.test(request.contact)) {
      try {
        notificationService.enqueue({
          channel: "email",
          recipient: request.contact.toLowerCase(),
          template: "request_received",
          payload: { name: request.name, company: settingsService.get("contact").company_name || notificationService.companyName() },
          dedupeKey: `support_ack:${request.id}`,
        });
      } catch (err) {
        db.logs.record({ action: "support.ack_enqueue_failed", entityType: "support_request", entityId: request.id, meta: { error: String(err) } });
      }
    }
    db.logs.record({ actorUserId: userId, action: "support.request_created", entityType: "support_request", entityId: request.id, ip });
    return request;
  },

  list(opts = {}) {
    if (opts.status && !STATUSES.includes(opts.status)) {
      throw Errors.badRequest(`status must be one of: ${STATUSES.join(", ")}`);
    }
    return db.support.list(opts);
  },

  get(id) {
    const request = db.support.get(id);
    if (!request) throw Errors.notFound("Support request not found");
    return request;
  },

  update(id, { status, admin_note: adminNote }, actorUserId) {
    this.get(id);
    if (status !== undefined && !STATUSES.includes(status)) {
      throw Errors.badRequest(`status must be one of: ${STATUSES.join(", ")}`);
    }
    if (adminNote !== undefined && adminNote !== null && typeof adminNote !== "string") {
      throw Errors.badRequest("admin_note must be a string");
    }
    const updated = db.support.update(id, { status, adminNote: adminNote ?? undefined, handledBy: actorUserId });
    db.logs.record({ actorUserId, action: "support.request_updated", entityType: "support_request", entityId: id, meta: { status } });
    return updated;
  },

  summary() {
    return db.support.countByStatus();
  },
};
