import { newId } from "../../../../lib/id.js";

// Storefront sales: quotes, the agreements they turn into, the schedule
// behind each agreement, and single-tier referrals. See the block comment
// above `sales_quotes` in schema.sql for why this is two levels rather than
// one table with a `type` column.

/** Shared list-with-filters helper. Keeps the four repos below from each
 *  hand-rolling the same WHERE/LIMIT assembly and drifting apart. */
function listWhere(raw, table, { where = {}, limit = 50, offset = 0, order = "created_at DESC" }) {
  const clauses = [];
  const args = [];
  for (const [column, value] of Object.entries(where)) {
    if (value === undefined || value === null || value === "") continue;
    clauses.push(`${column} = ?`);
    args.push(value);
  }
  const sql =
    `SELECT * FROM ${table}` +
    (clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "") +
    ` ORDER BY ${order} LIMIT ? OFFSET ?`;
  return raw.query(sql).all(...args, Number(limit), Number(offset));
}

export function makeSalesQuotesRepo(raw) {
  return {
    create(f) {
      const id = newId("quote");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO sales_quotes
             (id, reference, kind, product_id, subject, user_id, contact_name, contact_phone,
              contact_email, clinic_city, specialty, timeline, financing, currency, amount_cents,
              deposit_cents, bundle, locked_rate, locked_until, status, source, notes, ip,
              term_months, apr_bp, instalment_cents, upfront_pct, referral_code, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          f.reference,
          f.kind,
          f.productId || null,
          f.subject,
          f.userId || null,
          f.contactName,
          f.contactPhone || null,
          f.contactEmail || null,
          f.clinicCity || null,
          f.specialty || null,
          f.timeline || null,
          f.financing || null,
          f.currency || "EUR",
          f.amountCents ?? null,
          f.depositCents ?? null,
          f.bundle || null,
          f.lockedRate ?? null,
          f.lockedUntil || null,
          f.status || "new",
          f.source || "storefront",
          f.notes || null,
          f.ip || null,
          f.termMonths ?? null,
          f.aprBp ?? null,
          f.instalmentCents ?? null,
          f.upfrontPct ?? null,
          f.referralCode || null,
          now,
          now
        );
      return this.get(id);
    },

    get(id) {
      return raw.query(`SELECT * FROM sales_quotes WHERE id = ?`).get(id) || null;
    },

    getByReference(reference) {
      return raw.query(`SELECT * FROM sales_quotes WHERE reference = ?`).get(reference) || null;
    },

    list(opts = {}) {
      return listWhere(raw, "sales_quotes", {
        where: { status: opts.status, kind: opts.kind, user_id: opts.userId },
        limit: opts.limit,
        offset: opts.offset,
      });
    },

    update(id, fields) {
      const current = this.get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      raw
        .query(
          `UPDATE sales_quotes
              SET status = ?, admin_note = ?, handled_by = ?, amount_cents = ?, transaction_id = ?, updated_at = ?
            WHERE id = ?`
        )
        .run(
          fields.status ?? current.status,
          fields.adminNote ?? current.admin_note,
          fields.handledBy ?? current.handled_by,
          fields.amountCents ?? current.amount_cents,
          fields.transactionId ?? current.transaction_id,
          now,
          id
        );
      return this.get(id);
    },

    countByStatus() {
      const rows = raw.query(`SELECT status, COUNT(*) AS n FROM sales_quotes GROUP BY status`).all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },

    countByKind() {
      const rows = raw.query(`SELECT kind, COUNT(*) AS n FROM sales_quotes GROUP BY kind`).all();
      return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
    },

    /** Quotes whose Rial lock has run out but which nobody has closed. */
    expired(nowIso) {
      return raw
        .query(
          `SELECT * FROM sales_quotes
            WHERE locked_until IS NOT NULL AND locked_until < ?
              AND status IN ('new','contacted','quoted')`
        )
        .all(nowIso);
    },
  };
}

export function makeSalesAgreementsRepo(raw) {
  return {
    create(f) {
      const id = newId("agr");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO sales_agreements
             (id, reference, quote_id, kind, product_id, subject, user_id, contact_name,
              contact_phone, contact_email, currency, principal_cents, deposit_cents,
              instalment_cents, term_months, apr_bp, interval_days, item, transfers_ownership,
              starts_on, ends_on, next_due_on, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          f.reference,
          f.quoteId || null,
          f.kind,
          f.productId || null,
          f.subject,
          f.userId || null,
          f.contactName,
          f.contactPhone || null,
          f.contactEmail || null,
          f.currency || "EUR",
          f.principalCents ?? null,
          f.depositCents ?? null,
          f.instalmentCents ?? null,
          f.termMonths ?? null,
          f.aprBp ?? null,
          f.intervalDays ?? null,
          f.item || null,
          f.transfersOwnership ? 1 : 0,
          f.startsOn || null,
          f.endsOn || null,
          f.nextDueOn || null,
          f.status || "pending",
          now,
          now
        );
      return this.get(id);
    },

    get(id) {
      return raw.query(`SELECT * FROM sales_agreements WHERE id = ?`).get(id) || null;
    },

    list(opts = {}) {
      return listWhere(raw, "sales_agreements", {
        where: { status: opts.status, kind: opts.kind, user_id: opts.userId },
        limit: opts.limit,
        offset: opts.offset,
      });
    },

    update(id, fields) {
      const current = this.get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      raw
        .query(
          `UPDATE sales_agreements
              SET status = ?, admin_note = ?, next_due_on = ?, starts_on = ?, ends_on = ?, updated_at = ?
            WHERE id = ?`
        )
        .run(
          fields.status ?? current.status,
          fields.adminNote ?? current.admin_note,
          // `null` here is a real value -- "nothing is due any more" -- and `??`
          // would silently turn it back into the old date. A completed agreement
          // kept advertising a next payment that no longer existed.
          fields.nextDueOn !== undefined ? fields.nextDueOn : current.next_due_on,
          fields.startsOn ?? current.starts_on,
          fields.endsOn ?? current.ends_on,
          now,
          id
        );
      return this.get(id);
    },

    countByStatus() {
      const rows = raw.query(`SELECT status, COUNT(*) AS n FROM sales_agreements GROUP BY status`).all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },
  };
}

export function makeSalesInstalmentsRepo(raw) {
  return {
    /** Written in one transaction: a half-created schedule is worse than none. */
    createMany(agreementId, rows, currency = "EUR") {
      const now = new Date().toISOString();
      const stmt = raw.query(
        `INSERT INTO sales_instalments
           (id, agreement_id, sequence, due_on, amount_cents, currency, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'due',?,?)`
      );
      for (const row of rows) {
        stmt.run(newId("inst"), agreementId, row.sequence, row.dueOn, row.amountCents, currency, now, now);
      }
      return this.forAgreement(agreementId);
    },

    forAgreement(agreementId) {
      return raw
        .query(`SELECT * FROM sales_instalments WHERE agreement_id = ? ORDER BY sequence ASC`)
        .all(agreementId);
    },

    get(id) {
      return raw.query(`SELECT * FROM sales_instalments WHERE id = ?`).get(id) || null;
    },

    update(id, fields) {
      const current = this.get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      raw
        .query(
          `UPDATE sales_instalments SET status = ?, paid_at = ?, note = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          fields.status ?? current.status,
          fields.status === "paid" ? fields.paidAt || now : current.paid_at,
          fields.note ?? current.note,
          now,
          id
        );
      return this.get(id);
    },

    /** Everything owed on or before `onIso` that is still outstanding. */
    dueBy(onIso, limit = 200) {
      return raw
        .query(
          `SELECT * FROM sales_instalments
            WHERE status IN ('due','late') AND due_on <= ?
            ORDER BY due_on ASC LIMIT ?`
        )
        .all(onIso, Number(limit));
    },
  };
}

