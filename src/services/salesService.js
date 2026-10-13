import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { settingsService } from "./settingsService.js";
import { notificationService } from "./notificationService.js";
import { config } from "../config.js";
import { effectiveLeaseRules, instalmentCents, quoteLease } from "../lib/leaseRules.js";

// Everything the public storefront can start, and everything those things
// become.
//
// The storefront asks for a price (a proforma), asks about a machine we do
// not list (an enquiry), or asks for a lease proforma on terms of the
// customer's choosing. Each is a row with a reference, so a lease request and
// a general question are never the same shape and both can be tracked past
// "someone got in touch".
//
// The split is between an ASK (sales_quotes) and a COMMITMENT that runs for
// months (sales_agreements + sales_instalments). See schema.sql.
//
// Money is integer minor units everywhere. Rates and terms are stored on the
// row at the moment of issue rather than recomputed on read: a customer's
// instalment must not change because someone edited the default APR two
// months later.

// What the storefront can still start. Reservations, rent-to-own, consumable
// subscriptions, trade-in valuations and the patient-lead programme were
// removed with the pages that offered them; rows of those kinds written
// earlier remain readable (the table's CHECK still allows them) but no new
// ones are accepted.
const QUOTE_KINDS = ["proforma", "enquiry", "lease", "demo"];
const QUOTE_STATUSES = ["new", "contacted", "quoted", "accepted", "declined", "expired", "converted"];
const AGREEMENT_STATUSES = ["pending", "active", "paused", "completed", "cancelled", "defaulted"];
const INSTALMENT_STATUSES = ["due", "paid", "late", "waived", "cancelled"];

const MAX_TEXT = 4000;
const DEFAULT_LOCK_DAYS = 7;

/** Reference a human can read down a phone line. */
function makeReference(prefix) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 -- misread aloud
  let body = "";
  for (let i = 0; i < 6; i++) body += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${body}`;
}

function addDays(days, from = new Date()) {
  return new Date(from.getTime() + days * 86400000).toISOString();
}

function addMonths(months, from = new Date()) {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function requireText(value, field, { max = 200, required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw Errors.badRequest(`${field} is required`);
    return null;
  }
  return String(value).trim().slice(0, max);
}

function requireCents(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw Errors.badRequest(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw Errors.badRequest(`${field} must be a whole number of minor units`);
  }
  return n;
}

export { instalmentCents };

function notifyIfPossible(row, template, payload) {
  if (!row.contact_email) return;
  try {
    notificationService.enqueue({
      channel: "email",
      recipient: row.contact_email,
      template,
      payload,
      dedupeKey: `${template}:${row.id}`,
    });
  } catch (err) {
    // Never lose the sale because the mailer is unhappy -- the row is the
    // thing that matters and it is already committed.
    db.logs.record({
      action: "sales.notify_failed",
      entityType: "sales_quote",
      entityId: row.id,
      meta: { template, error: String(err) },
    });
  }
}

/**
 * The member a referral code belongs to, if it can be honoured for this
 * product.
 *
 * Codes are per product (a code for one device never attaches a buyer to
 * another device's tree), so a code that does not match the quoted product is
 * dropped rather than stored: it would only mislead the desk into attaching a
 * buyer under someone for a device that member does not hold.
 *
 * Returns null instead of throwing -- a stale or mistyped link must never cost
 * the visitor their proforma.
 */
function resolveReferral(code, productId) {
  const raw = typeof code === "string" ? code.trim().slice(0, 64) : "";
  if (!raw || !productId) return null;
  const row = db.redeemCodes.getByCode(raw) || db.redeemCodes.getByCode(raw.toUpperCase());
  if (!row || row.status !== "active" || row.product_id !== productId) return null;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
  return row;
}

/**
 * A quote as the sales desk reads it: the stored row plus who referred the
 * buyer and which account (if any) the contact details already belong to.
 *
 * Done at read time rather than stored, so a member who is renamed or
 * suspended after the proforma was issued shows up correctly.
 */
function describeQuote(quote) {
  if (!quote) return quote;
  let referrer = null;
  if (quote.referral_code) {
    const row = db.redeemCodes.getByCode(quote.referral_code);
    const node = row ? db.nodes.get(row.owner_node_id) : null;
    const owner = node ? db.users.findById(node.user_id) : null;
    referrer = {
      code: quote.referral_code,
      user_id: owner?.id ?? null,
      name: owner?.name ?? null,
      node_id: node?.id ?? null,
      usable: Boolean(row && row.status === "active"),
    };
  }
  const account =
    (quote.user_id && db.users.findById(quote.user_id)) ||
    (quote.contact_email && db.users.findByEmail(quote.contact_email)) ||
    null;
  return {
    ...quote,
    referrer,
    customer_account: account
      ? { id: account.id, name: account.name, email: account.email, phone: account.phone ?? null }
      : null,
  };
}

export const salesService = {
  /* --- Quotes --------------------------------------------------------- */

  /**
   * Anything the storefront can start. Public and unauthenticated by design:
   * the overwhelming majority of people asking for a proforma do not have an
   * account, and requiring one would lose the enquiry.
   */
  createQuote({
    kind = "proforma",
    productId,
    subject,
    userId,
    contactName,
    contactPhone,
    contactEmail,
    clinicCity,
    specialty,
    timeline,
    financing,
    // USD, because that is what the catalogue quotes in (see
    // frontend/src/lib/format.js) and the storefront sends the catalogue
    // price straight through as `amount_cents`. Defaulting to EUR stamped
    // every downloadable proforma with a currency the customer had never
    // seen -- they browse "$38,000" and walk in holding a document that
    // says "EUR 38,000". The EUR->IRR rate lock is a separate, labelled
    // line and is unaffected.
    currency = "USD",
    amountCents,
    depositCents,
    bundle,
    lockDays = DEFAULT_LOCK_DAYS,
    notes,
    source = "storefront",
    ip,
    // Lease request: the duration and down payment the visitor chose. Both
    // are validated against the product's lease rules and the instalment is
    // recomputed here -- the browser's figures are never trusted.
    termMonths,
    upfrontPct,
    // The code from a member's referral link (?ref=...), if the visitor
    // arrived through one. Validated against the quoted product below.
    referralCode,
  }) {
    if (!QUOTE_KINDS.includes(kind)) {
      throw Errors.badRequest(`kind must be one of: ${QUOTE_KINDS.join(", ")}`);
    }
    const name = requireText(contactName, "contact_name");
    const phone = requireText(contactPhone, "contact_phone", { max: 40, required: false });
    const email = contactEmail ? String(contactEmail).trim().toLowerCase().slice(0, 200) : null;
    // A quote nobody can be reached about is not a quote.
    if (!phone && !email) {
      throw Errors.badRequest("a phone number or email address is required", "no_contact_method");
    }
    if (notes && notes.length > MAX_TEXT) {
      throw Errors.badRequest(`notes must be under ${MAX_TEXT} characters`);
    }
    if (productId && !db.products.get(productId)) throw Errors.notFound("Product not found");

    // The subject is what the customer actually asked about. A product row
    // names itself; an enquiry for a machine we do not list carries its name
    // in the text, which is the entire reason `subject` is separate from
    // `product_id`.
    const resolvedSubject =
      requireText(subject, "subject", { required: false }) ||
      (productId ? db.products.get(productId).name : null);
    if (kind === "lease" && !productId) {
      throw Errors.badRequest("product_id is required for a lease request", "lease_product_required");
    }
    if (!resolvedSubject) throw Errors.badRequest("subject or product_id is required");

    // The CBI reference rate is an operator setting, so the lock recorded on
    // the quote is the rate at the moment of issue -- reproducing the printed
    // proforma later must not depend on today's rate.
    const rate = Number(settingsService.get("cbi_eur_irr")) || null;

    // --- lease terms ---------------------------------------------------
    // A lease request must name a term and an upfront percentage; anything
    // else that arrives with one is treated as a lease too, so the terms are
    // never stored without having been checked.
    let lease = null;
    let leaseFinancing = null;
    if (kind === "lease" || termMonths !== undefined) {
      if (termMonths === undefined || upfrontPct === undefined) {
        throw Errors.badRequest("term_months and upfront_pct are required for a lease request", "lease_terms_required");
      }
      const product = productId ? db.products.get(productId) : null;
      const rules = effectiveLeaseRules(product ? JSON.parse(product.specs_json) : null, Number(settingsService.get("lease_apr_bp")) || 1800);
      // The price to lease against: the admin's lease base price, else the
      // product's real list price, else the figure the storefront quoted --
      // devices that are still on indicative pricing have no real list price
      // to read.
      const specs = product ? JSON.parse(product.specs_json) : {};
      const listPrice = product && !specs.placeholder_pricing ? product.list_price_y_cents : null;
      lease = quoteLease(rules, listPrice ?? requireCents(amountCents, "amount_cents"), {
        months: termMonths,
        upfrontPct,
      });
      leaseFinancing = `${lease.months}-month lease`;
    }

    const locked = (lease ? lease.price_cents : amountCents) != null && lockDays > 0;

    const quote = db.salesQuotes.create({
      reference: makeReference("PRO"),
      kind,
      productId: productId || null,
      subject: resolvedSubject,
      userId: userId || null,
      contactName: name,
      contactPhone: phone,
      contactEmail: email,
      clinicCity: requireText(clinicCity, "clinic_city", { required: false }),
      specialty: requireText(specialty, "specialty", { required: false }),
      timeline: requireText(timeline, "timeline", { required: false }),
      financing: leaseFinancing || requireText(financing, "financing", { required: false }),
      currency,
      amountCents: lease ? lease.price_cents : requireCents(amountCents, "amount_cents"),
      depositCents: lease ? lease.upfront_cents : requireCents(depositCents, "deposit_cents"),
      termMonths: lease?.months ?? null,
      aprBp: lease?.apr_bp ?? null,
      instalmentCents: lease?.instalment_cents ?? null,
      upfrontPct: lease?.upfront_pct ?? null,
      bundle: requireText(bundle, "bundle", { required: false }),
      lockedRate: locked ? rate : null,
      lockedUntil: locked ? addDays(lockDays) : null,
      referralCode: resolveReferral(referralCode, productId)?.code ?? null,
      source,
      notes: notes ? String(notes).trim() : null,
      ip,
    });

    // The document link, absolute: this goes in an email, where a relative
    // path means nothing. The id and the reference together are what
    // authorise the download -- the customer has no account yet.
    const downloadLink = `${config.apiBaseUrl}/sales/quotes/${quote.id}/proforma.pdf?ref=${quote.reference}`;

    notifyIfPossible(quote, "quote_received", {
      name: quote.contact_name,
      reference: quote.reference,
      subject: quote.subject,
      link: downloadLink,
    });

    // And the other half of "send one to our admin": the Proformas queue is the
    // system of record, this is so nobody has to sit watching it. Best
    // effort and never in the customer's way -- a sales inbox that bounces
    // must not fail the enquiry that was already saved.
    if (config.salesInboxEmail) {
      try {
        notificationService.enqueue({
          channel: "email",
          recipient: config.salesInboxEmail,
          template: "quote_received_staff",
          payload: {
            name: quote.contact_name,
            reference: quote.reference,
            subject: quote.subject,
            clinic: quote.clinic_city,
            contact: [quote.contact_email, quote.contact_phone].filter(Boolean).join(" · "),
            link: downloadLink,
          },
          dedupeKey: `quote_received_staff:${quote.id}`,
        });
      } catch (err) {
        db.logs.record({
          action: "sales.notify_failed",
          entityType: "sales_quote",
          entityId: quote.id,
          meta: { template: "quote_received_staff", error: String(err) },
        });
      }
    }

    db.logs.record({
      action: "sales.quote_created",
      entityType: "sales_quote",
      entityId: quote.id,
      meta: { kind, reference: quote.reference, source, referralCode: quote.referral_code },
      ip,
    });
    return quote;
  },

  /**
   * What the storefront's "live activity" pop-up shows: real, recent proforma and
   * lease requests, reduced to the device and the time.
   *
   * Deliberately NOT the quote row. The endpoint is public, and a quote carries a
   * name, a phone, an email and free-text fields a visitor typed -- all of which
   * would otherwise be one query away from every stranger on the internet, and
   * anyone could plant text of their choosing on other visitors' screens. The
   * device name comes from the catalogue row, not from anything typed, and the
   * only thing taken from the request itself is when it arrived.
   *
   * Switched off, it returns nothing at all (not merely "hidden by the UI"): the
   * flag is enforced here so curl sees exactly what the browser would.
   *
   * A declined request is left out, which doubles as the moderation lever -- junk
   * submitted to the public form is declined in the queue and vanishes from here.
   */
  recentActivity({ limit = 8, withinDays = 14 } = {}) {
    if (!settingsService.isEnabled("show_live_activity")) return { enabled: false, events: [] };
    const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString();
    const events = [];
    for (const q of db.salesQuotes.list({ limit: 200 })) {
      if (!["proforma", "lease"].includes(q.kind)) continue;
      if (!q.product_id || ["declined", "expired"].includes(q.status)) continue;
      if (q.created_at < cutoff) continue;
      const product = db.products.get(q.product_id);
      if (!product) continue;
      events.push({ kind: q.kind, device: product.name, at: q.created_at });
    }
    events.sort((a, b) => (a.at < b.at ? 1 : -1));
    return { enabled: true, events: events.slice(0, limit) };
  },

  getQuote(id) {
    return describeQuote(this.getQuoteRow(id));
  },

  /** The bare row, for callers that write to it and do not need the extras. */
  getQuoteRow(id) {
    const quote = db.salesQuotes.get(id) || db.salesQuotes.getByReference(id);
    if (!quote) throw Errors.notFound("Quote not found");
    return quote;
  },

  listQuotes(opts) {
    return db.salesQuotes.list(opts);
  },

  /**
   * The queue as staff see it. Kept apart from listQuotes because that one
   * also serves a customer reading their own quotes, who must not be shown
   * the name of the member who referred them or what accounts share their
   * contact details.
   */
  listQuotesForStaff(opts) {
    return db.salesQuotes.list(opts).map(describeQuote);
  },

  updateQuote(id, { status, admin_note: adminNote, amount_cents: amountCents }, actorUserId) {
    const quote = this.getQuoteRow(id);
    if (status !== undefined && !QUOTE_STATUSES.includes(status)) {
      throw Errors.badRequest(`status must be one of: ${QUOTE_STATUSES.join(", ")}`);
    }
    const updated = db.salesQuotes.update(quote.id, {
      status,
      adminNote,
      amountCents: amountCents === undefined ? undefined : requireCents(amountCents, "amount_cents"),
      handledBy: actorUserId,
    });
    db.logs.record({
      actorUserId,
      action: "sales.quote_updated",
      entityType: "sales_quote",
      entityId: quote.id,
      meta: { status },
    });
    return updated;
  },

  /**
   * Close out quotes whose Rial lock has run out.
   *
   * Run from the jobs loop. Without it an "open" pipeline slowly fills with
   * quotes priced at an exchange rate that no longer exists, and the sales
   * desk cannot tell which of them are still honourable.
   */
  expireStaleQuotes() {
    const now = new Date().toISOString();
    const stale = db.salesQuotes.expired(now);
    for (const quote of stale) {
      db.salesQuotes.update(quote.id, { status: "expired" });
      db.logs.record({
        action: "sales.quote_expired",
        entityType: "sales_quote",
        entityId: quote.id,
        meta: { reference: quote.reference, lockedUntil: quote.locked_until },
      });
    }
    return { expired: stale.length };
  },

  /* --- Agreements ----------------------------------------------------- */

  /**
   * Turn an accepted quote (or a direct request) into a running commitment,
   * and lay down its whole schedule at once.
   *
   * Written in a transaction: an agreement with a half-written schedule
   * would show a customer owing an arbitrary subset of their instalments.
   */
  createAgreement({
    kind,
    quoteId,
    productId,
    subject,
    userId,
    contactName,
    contactPhone,
    contactEmail,
    // Matches the quote this agreement is written from; see createQuote.
    currency = "USD",
    principalCents,
    depositCents = 0,
    termMonths,
    aprBp,
    intervalDays,
    item,
    transfersOwnership = false,
    instalmentOverrideCents,
    startsOn,
  }) {
    if (!["lease", "rental", "subscription"].includes(kind)) {
      throw Errors.badRequest("kind must be one of: lease, rental, subscription");
    }
    const name = requireText(contactName, "contact_name");
    const quote = quoteId ? this.getQuoteRow(quoteId) : null;
    if (productId && !db.products.get(productId)) throw Errors.notFound("Product not found");

    const resolvedSubject =
      requireText(subject, "subject", { required: false }) || quote?.subject || null;
    if (!resolvedSubject) throw Errors.badRequest("subject is required");

    const start = startsOn ? new Date(startsOn) : new Date();
    const defaultApr = Number(settingsService.get("lease_apr_bp")) || 1800;

    let instalment = null;
    let months = termMonths ? Number(termMonths) : null;
    let schedule = [];

    if (kind === "subscription") {
      const every = Number(intervalDays) || 45;
      instalment = requireCents(instalmentOverrideCents, "instalment_cents", { required: true });
      // Twelve deliveries laid down up front: enough for the office to plan
      // against, and renewed rather than assumed to run forever.
      schedule = Array.from({ length: 12 }, (_, i) => ({
        sequence: i + 1,
        dueOn: addDays(every * i, start),
        amountCents: instalment,
      }));
      months = null;
      return this.persistAgreement({
        kind,
        quote,
        productId,
        subject: resolvedSubject,
        userId,
        name,
        contactPhone,
        contactEmail,
        currency,
        principalCents: null,
        depositCents: null,
        instalment,
        months,
        aprBp: null,
        intervalDays: every,
        item,
        transfersOwnership: false,
        start,
        endsOn: null,
        schedule,
      });
    }

    // lease | rental
    if (!months || months <= 0) throw Errors.badRequest("term_months must be positive");
    const principal = requireCents(principalCents, "principal_cents", { required: true });
    const deposit = requireCents(depositCents, "deposit_cents") || 0;
    if (deposit > principal) throw Errors.badRequest("deposit cannot exceed the principal");

    const apr = aprBp === undefined || aprBp === null ? defaultApr : Number(aprBp);
    instalment =
      instalmentOverrideCents != null
        ? requireCents(instalmentOverrideCents, "instalment_cents", { required: true })
        : instalmentCents({ principalCents: principal - deposit, months, aprBp: apr });

    schedule = Array.from({ length: months }, (_, i) => ({
      sequence: i + 1,
      dueOn: addMonths(i + 1, start),
      amountCents: instalment,
    }));

    return this.persistAgreement({
      kind,
      quote,
      productId,
      subject: resolvedSubject,
      userId,
      name,
      contactPhone,
      contactEmail,
      currency,
      principalCents: principal,
      depositCents: deposit,
      instalment,
      months,
      aprBp: apr,
      intervalDays: null,
      item: null,
      // Rent-to-own is the storefront's offer; a plain rental is not. Stored
      // rather than inferred so changing the product rule later cannot
      // rewrite what an existing customer was sold.
      transfersOwnership: kind === "rental" ? Boolean(transfersOwnership) : false,
      start,
      endsOn: addMonths(months, start),
      schedule,
    });
  },

  /** Shared tail of createAgreement -- the write itself. */
  persistAgreement(a) {
    return db.transaction(() => {
      const agreement = db.salesAgreements.create({
        reference: makeReference(a.kind === "lease" ? "LSE" : a.kind === "rental" ? "RNT" : "SUB"),
        quoteId: a.quote?.id || null,
        kind: a.kind,
        productId: a.productId || a.quote?.product_id || null,
        subject: a.subject,
        userId: a.userId || a.quote?.user_id || null,
        contactName: a.name,
        contactPhone: a.contactPhone || a.quote?.contact_phone || null,
        contactEmail: a.contactEmail || a.quote?.contact_email || null,
        currency: a.currency,
        principalCents: a.principalCents,
        depositCents: a.depositCents,
        instalmentCents: a.instalment,
        termMonths: a.months,
        aprBp: a.aprBp,
        intervalDays: a.intervalDays,
        item: a.item,
        transfersOwnership: a.transfersOwnership,
        startsOn: a.start.toISOString(),
        endsOn: a.endsOn,
        nextDueOn: a.schedule[0]?.dueOn || null,
        status: "pending",
      });

      db.salesInstalments.createMany(agreement.id, a.schedule, a.currency);

      // An agreement supersedes the quote that produced it.
      if (a.quote) db.salesQuotes.update(a.quote.id, { status: "converted" });

      db.logs.record({
        action: "sales.agreement_created",
        entityType: "sales_agreement",
        entityId: agreement.id,
        meta: {
          kind: a.kind,
          reference: agreement.reference,
          instalmentCents: a.instalment,
          termMonths: a.months,
        },
      });
      return { ...agreement, instalments: db.salesInstalments.forAgreement(agreement.id) };
    });
  },

  getAgreement(id) {
    const agreement = db.salesAgreements.get(id);
    if (!agreement) throw Errors.notFound("Agreement not found");
    return { ...agreement, instalments: db.salesInstalments.forAgreement(agreement.id) };
  },

  listAgreements(opts) {
    return db.salesAgreements.list(opts);
  },

  updateAgreement(id, { status, admin_note: adminNote }, actorUserId) {
    const agreement = this.getAgreement(id);
    if (status !== undefined && !AGREEMENT_STATUSES.includes(status)) {
      throw Errors.badRequest(`status must be one of: ${AGREEMENT_STATUSES.join(", ")}`);
    }
    const updated = db.salesAgreements.update(agreement.id, { status, adminNote });
    db.logs.record({
      actorUserId,
      action: "sales.agreement_updated",
      entityType: "sales_agreement",
      entityId: agreement.id,
      meta: { status },
    });
    return updated;
  },

  /* --- Instalments ---------------------------------------------------- */

  markInstalment(instalmentId, { status, note }, actorUserId) {
    const instalment = db.salesInstalments.get(instalmentId);
    if (!instalment) throw Errors.notFound("Instalment not found");
    if (!INSTALMENT_STATUSES.includes(status)) {
      throw Errors.badRequest(`status must be one of: ${INSTALMENT_STATUSES.join(", ")}`);
    }

    return db.transaction(() => {
      const updated = db.salesInstalments.update(instalmentId, { status, note });
      const rows = db.salesInstalments.forAgreement(instalment.agreement_id);
      const outstanding = rows.filter((r) => r.status === "due" || r.status === "late");

      // The agreement's own state follows its schedule rather than being set
      // by hand: nothing left to pay means completed, and the next due date
      // is always the earliest outstanding row.
      //
      // But only an agreement that is still running can complete. One that was
      // cancelled or defaulted stays that way when the housekeeping that follows
      // (writing off or waiving what is left) empties its schedule -- otherwise a
      // customer who walked away reads as one who paid in full.
      const agreement = db.salesAgreements.get(instalment.agreement_id);
      const finished = ["cancelled", "defaulted", "completed"].includes(agreement.status);
      db.salesAgreements.update(instalment.agreement_id, {
        nextDueOn: outstanding[0]?.due_on || null,
        status: outstanding.length === 0 && !finished ? "completed" : undefined,
      });

      db.logs.record({
        actorUserId,
        action: "sales.instalment_marked",
        entityType: "sales_instalment",
        entityId: instalmentId,
        meta: { status, agreementId: instalment.agreement_id },
      });
      return updated;
    });
  },

  /**
   * Flag everything overdue as late. Run from the jobs loop; idempotent, so
   * running it twice in a day changes nothing the second time.
   */
  flagLateInstalments() {
    const now = new Date().toISOString();
    const due = db.salesInstalments.dueBy(now);
    let flagged = 0;
    for (const row of due) {
      if (row.status !== "due") continue;
      db.salesInstalments.update(row.id, { status: "late" });
      flagged++;
    }
    if (flagged) {
      db.logs.record({ action: "sales.instalments_late", entityType: "sales_instalment", meta: { flagged } });
    }
    return { flagged };
  },

  summary() {
    const now = new Date().toISOString();
    const overdue = db.salesInstalments.dueBy(now, 500);
    return {
      quotes: {
        byStatus: db.salesQuotes.countByStatus(),
        byKind: db.salesQuotes.countByKind(),
      },
      agreements: { byStatus: db.salesAgreements.countByStatus() },
      instalments: {
        overdue: overdue.length,
        overdueCents: overdue.reduce((sum, r) => sum + r.amount_cents, 0),
      },
    };
  },
};
