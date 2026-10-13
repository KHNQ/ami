import { newId } from "../../../../lib/id.js";

export function makeNotificationsRepo(raw) {
  return {
    /**
     * Queues a notification. Returns null when `dedupeKey` has already been
     * used -- the UNIQUE index refuses the write and we treat that as
     * "already queued", which is exactly what makes reminder jobs safe to
     * re-run. Callers should branch on null, not catch.
     */
    enqueue({ userId, channel, recipient, template, payload = {}, dedupeKey = null, scheduledFor = null }) {
      const id = newId("ntf");
      try {
        raw
          .query(
            `INSERT INTO notifications
               (id, user_id, channel, recipient, template, payload_json, dedupe_key, status, attempts, scheduled_for, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
          )
          .run(
            id,
            userId || null,
            channel,
            recipient,
            template,
            JSON.stringify(payload),
            dedupeKey,
            scheduledFor,
            new Date().toISOString()
          );
      } catch (err) {
        // Only swallow the dedupe collision; anything else is a real fault
        // and must surface rather than silently dropping a message.
        if (String(err).includes("UNIQUE") && dedupeKey) return null;
        throw err;
      }
      return this.get(id);
    },

    get(id) {
      return raw.query(`SELECT * FROM notifications WHERE id = ?`).get(id) || null;
    },

    findByDedupeKey(key) {
      return raw.query(`SELECT * FROM notifications WHERE dedupe_key = ?`).get(key) || null;
    },

    /** Pending and either unscheduled or already due. */
    listDue({ now = new Date().toISOString(), limit = 100 } = {}) {
      return raw
        .query(
          `SELECT * FROM notifications
           WHERE status = 'pending' AND (scheduled_for IS NULL OR scheduled_for <= ?)
           ORDER BY created_at ASC, rowid ASC
           LIMIT ?`
        )
        .all(now, limit);
    },

    markSent(id) {
      raw
        .query(`UPDATE notifications SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?`)
        .run(new Date().toISOString(), id);
      return this.get(id);
    },

    markFailed(id, error) {
      raw
        .query(`UPDATE notifications SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?`)
        .run(String(error).slice(0, 500), id);
      return this.get(id);
    },

    /** Puts a failed notification back in the queue for another attempt. */
    retry(id) {
      raw.query(`UPDATE notifications SET status = 'pending', error = NULL WHERE id = ?`).run(id);
      return this.get(id);
    },

    list({ status, channel, userId, limit = 100, offset = 0 } = {}) {
      const clauses = [];
      const params = [];
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (channel) {
        clauses.push("channel = ?");
        params.push(channel);
      }
      if (userId) {
        clauses.push("user_id = ?");
        params.push(userId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      return raw
        .query(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(...params);
    },
  };
}
