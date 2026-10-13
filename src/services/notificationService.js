import { db } from "../db/index.js";
import { config } from "../config.js";
import { Errors } from "../lib/errors.js";
import { emailService } from "./emailService.js";
import { smsService } from "./smsService.js";

// Queue-and-drain notifications.
//
// Enqueueing is synchronous (a single INSERT), which is what lets it be
// called from inside db.transaction() -- bun:sqlite transactions cannot await,
// so an inline provider call is simply not possible there. Sending happens
// later, in a job. The upside beyond mechanics: a message that fails to send
// is still a durable row with an error on it, rather than a lost side effect
// and a stack trace in a log nobody reads.

// Templates render to { subject, body } from their payload. Kept in code
// rather than the database: they ship with the code that enqueues them, and
// a template whose variables don't match its caller is a deploy-time bug,
// not something an operator should be able to create at runtime.
const TEMPLATES = {
  cheque_due: {
    channels: ["sms", "email"],
    render({ cheque_number, amount, due_date, days_until, company }) {
      const when =
        days_until > 1 ? `in ${days_until} days` : days_until === 1 ? "tomorrow" : "today";
      const ref = cheque_number ? ` (no. ${cheque_number})` : "";
      return {
        subject: `Cheque due ${when}`,
        body:
          `Reminder from ${company}: your cheque${ref} for ${amount} is due ${when}, on ${due_date}. ` +
          `Please make sure the account is funded so it clears. Questions? Just reply or call us.`,
      };
    },
  },
  cheque_bounced: {
    channels: ["email"],
    render({ cheque_number, amount, company }) {
      const ref = cheque_number ? ` no. ${cheque_number}` : "";
      return {
        subject: "A cheque did not clear",
        body: `${company}: your cheque${ref} for ${amount} was returned unpaid. Please get in touch so we can arrange settlement.`,
      };
    },
  },
  request_received: {
    channels: ["email"],
    render({ name, company }) {
      return {
        subject: `Thanks for contacting ${company}`,
        body: `Hi ${name}, we've received your message and one of our team will be in touch shortly.`,
      };
    },
  },
  // Customer-facing: the proforma they just asked for, with the link to
  // download it again. This is the one piece of paper the whole in-person
  // flow turns on -- they walk into the office holding it, or quoting the
  // reference from it -- so losing the email costs a visit.
  quote_received: {
    channels: ["email"],
    render({ name, reference, subject, link, company }) {
      return {
        subject: `Your proforma ${reference} from ${company}`,
        body:
          `Hi ${name}, thank you for your enquiry about ${subject}.\n\n` +
          `Your proforma reference is ${reference}.\n\n` +
          (link ? `Download it here:\n${link}\n\n` : "") +
          `One of our advisors will be in touch to answer questions and arrange a ` +
          `demonstration. You are welcome to visit our office to see the device and ` +
          `complete the purchase in person -- bring this proforma, or just quote the ` +
          `reference above.\n\n` +
          `This is a quotation, not a bill: nothing is owed and nothing is reserved by it.`,
      };
    },
  },
  // Staff-facing: somebody has asked for a price. This is the "someone wants
  // to buy something" ping -- the admin panel's Proformas queue is the system of
  // record, and this exists so nobody has to sit watching it.
  quote_received_staff: {
    channels: ["email"],
    render({ name, reference, subject, clinic, contact, link, company }) {
      return {
        subject: `New proforma request — ${name} (${reference})`,
        body:
          `${name} has requested a proforma from ${company}.\n\n` +
          `Reference: ${reference}\n` +
          `Device:    ${subject}\n` +
          (clinic ? `Clinic:    ${clinic}\n` : "") +
          (contact ? `Contact:   ${contact}\n` : "") +
          (link ? `\nThe document they received:\n${link}\n` : "") +
          `\nOpen the admin console to call them back and move this through the pipeline.`,
      };
    },
  },
  // Customer-facing: verify the address they signed up with.
  email_verification: {
    channels: ["email"],
    render({ name, link, company }) {
      return {
        subject: `Confirm your email for ${company}`,
        body:
          `Hi ${name}, please confirm your email address by opening this link:\n\n${link}\n\n` +
          `If you did not create an account, you can ignore this message.`,
      };
    },
  },
};

export const notificationService = {
  templates: TEMPLATES,

  /**
   * Queue a message. Synchronous and transaction-safe.
   *
   * Returns null when `dedupeKey` has already been used. Callers should read
   * that as "already queued" and carry on -- it is the normal outcome of
   * re-running a reminder job, not an error.
   */
  enqueue({ userId, channel, recipient, template, payload = {}, dedupeKey = null, scheduledFor = null }) {
    if (!TEMPLATES[template]) throw Errors.badRequest(`Unknown notification template '${template}'`, "unknown_template");
    if (!["email", "sms"].includes(channel)) throw Errors.badRequest("channel must be 'email' or 'sms'");
    if (!recipient) throw Errors.badRequest("recipient is required");
    return db.notifications.enqueue({ userId, channel, recipient, template, payload, dedupeKey, scheduledFor });
  },

  /**
   * Picks the best available channel for a user: SMS when we have a phone
   * number and the template supports it, email otherwise. Returns null if
   * there is no usable address at all, which the caller should treat as
   * "nothing to send" rather than as a failure.
   */
  enqueueForUser({ user, template, payload, dedupeKey, scheduledFor, phone }) {
    const spec = TEMPLATES[template];
    if (!spec) throw Errors.badRequest(`Unknown notification template '${template}'`, "unknown_template");

    const preferSms = spec.channels.includes("sms") && phone;
    const channel = preferSms ? "sms" : "email";
    const recipient = preferSms ? phone : user?.email;
    if (!recipient) return null;

    return this.enqueue({
      userId: user?.id,
      channel,
      recipient,
      template,
      payload,
      dedupeKey,
      scheduledFor,
    });
  },

  /**
   * Drains the queue. Called by POST /admin/jobs/send-due-notifications.
   *
   * Each message is sent and marked independently: one bad address must not
   * stop the rest of the batch, so failures are recorded on their own row
   * and the loop continues.
   */
  async sendDue({ limit = 100, now } = {}) {
    const due = db.notifications.listDue({ limit, ...(now ? { now } : {}) });
    let sent = 0;
    let failed = 0;

    for (const row of due) {
      const spec = TEMPLATES[row.template];
      if (!spec) {
        db.notifications.markFailed(row.id, `unknown template '${row.template}'`);
        failed += 1;
        continue;
      }
      try {
        const payload = JSON.parse(row.payload_json);
        const { subject, body } = spec.render(payload);
        if (row.channel === "sms") {
          await smsService.send(row.recipient, body);
        } else {
          await emailService.send({ to: row.recipient, subject, text: body });
        }
        db.notifications.markSent(row.id);
        sent += 1;
      } catch (err) {
        db.notifications.markFailed(row.id, err);
        failed += 1;
      }
    }

    return { considered: due.length, sent, failed };
  },

  list(opts) {
    return db.notifications.list(opts);
  },

  retry(id) {
    const row = db.notifications.get(id);
    if (!row) throw Errors.notFound("Notification not found");
    if (row.status !== "failed") throw Errors.unprocessable("Only failed notifications can be retried", "not_failed");
    return db.notifications.retry(id);
  },

  companyName() {
    return config.companyName;
  },
};
