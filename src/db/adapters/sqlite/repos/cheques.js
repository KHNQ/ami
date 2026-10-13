import { newId } from "../../../../lib/id.js";

// Columns listed explicitly on every read so the image BLOB is never dragged
// into a listing by accident -- a page of 20 cheques would otherwise carry
// several megabytes of scan data nobody asked for. `image()` is the one place
// that fetches bytes.
const FIELDS = `id, transaction_id, user_id, sequence_no, cheque_number, bank_name,
                amount_cents, due_date, status, note, recorded_by_admin_id,
                cleared_at, created_at, updated_at,
                image_mime, (image_bytes IS NOT NULL) AS has_image`;

export function makeChequesRepo(raw) {
  return {
    create({ transactionId, userId, sequenceNo, chequeNumber, bankName, amountCents, dueDate, note, recordedByAdminId, imageMime, imageBytes }) {
      const id = newId("chq");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO lease_cheques
             (id, transaction_id, user_id, sequence_no, cheque_number, bank_name, amount_cents,
              due_date, status, image_mime, image_bytes, note, recorded_by_admin_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          transactionId,
          userId,
          sequenceNo,
          chequeNumber || null,
          bankName || null,
          amountCents,
          dueDate,
          imageMime || null,
          imageBytes || null,
          note || null,
          recordedByAdminId || null,
          now,
          now
        );
      return this.get(id);
    },

    get(id) {
      return raw.query(`SELECT ${FIELDS} FROM lease_cheques WHERE id = ?`).get(id) || null;
    },

    /** Bytes only -- the single place the BLOB is read. */
    image(id) {
      return raw.query(`SELECT image_mime, image_bytes FROM lease_cheques WHERE id = ?`).get(id) || null;
    },

    listByTransaction(transactionId) {
      return raw
        .query(`SELECT ${FIELDS} FROM lease_cheques WHERE transaction_id = ? ORDER BY sequence_no ASC`)
        .all(transactionId);
    },

    listByUser(userId, { limit = 100, offset = 0 } = {}) {
      return raw
        .query(`SELECT ${FIELDS} FROM lease_cheques WHERE user_id = ? ORDER BY due_date ASC, rowid ASC LIMIT ? OFFSET ?`)
        .all(userId, limit, offset);
    },

    list({ status, dueBefore, dueAfter, limit = 100, offset = 0 } = {}) {
      const clauses = [];
      const params = [];
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (dueBefore) {
        clauses.push("due_date <= ?");
        params.push(dueBefore);
      }
      if (dueAfter) {
        clauses.push("due_date >= ?");
        params.push(dueAfter);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      return raw
        .query(`SELECT ${FIELDS} FROM lease_cheques ${where} ORDER BY due_date ASC, rowid ASC LIMIT ? OFFSET ?`)
        .all(...params);
    },

    /** Pending cheques falling due on or before `date` -- drives reminders. */
    listPendingDueBy(date, { limit = 500 } = {}) {
      return raw
        .query(
          `SELECT ${FIELDS} FROM lease_cheques
           WHERE status = 'pending' AND due_date <= ?
           ORDER BY due_date ASC, rowid ASC LIMIT ?`
        )
        .all(date, limit);
    },

    nextSequenceNo(transactionId) {
      const row = raw
        .query(`SELECT COALESCE(MAX(sequence_no), 0) AS n FROM lease_cheques WHERE transaction_id = ?`)
        .get(transactionId);
      return (row ? row.n : 0) + 1;
    },

    update(id, { chequeNumber, bankName, amountCents, dueDate, note, imageMime, imageBytes }) {
      const sets = ["updated_at = ?"];
      const params = [new Date().toISOString()];
      const maybe = (column, value) => {
        if (value !== undefined) {
          sets.push(`${column} = ?`);
          params.push(value);
        }
      };
      maybe("cheque_number", chequeNumber);
      maybe("bank_name", bankName);
      maybe("amount_cents", amountCents);
      maybe("due_date", dueDate);
      maybe("note", note);
      maybe("image_mime", imageMime);
      maybe("image_bytes", imageBytes);
      params.push(id);
      raw.query(`UPDATE lease_cheques SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return this.get(id);
    },

    setStatus(id, status) {
      raw
        .query(`UPDATE lease_cheques SET status = ?, cleared_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, status === "cleared" ? new Date().toISOString() : null, new Date().toISOString(), id);
      return this.get(id);
    },

    /** Totals per transaction, used for reconciliation and the admin board. */
    totalsByTransaction(transactionId) {
      return raw
        .query(
          `SELECT
             COALESCE(SUM(amount_cents), 0) AS total_cents,
             COALESCE(SUM(CASE WHEN status = 'cleared' THEN amount_cents ELSE 0 END), 0) AS cleared_cents,
             COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END), 0) AS pending_cents,
             COALESCE(SUM(CASE WHEN status = 'bounced' THEN amount_cents ELSE 0 END), 0) AS bounced_cents,
             COUNT(*) AS count
           FROM lease_cheques WHERE transaction_id = ? AND status != 'cancelled'`
        )
        .get(transactionId);
    },
  };
}
