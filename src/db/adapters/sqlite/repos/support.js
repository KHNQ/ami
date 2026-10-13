import { newId } from "../../../../lib/id.js";

// Support intake: a name, a way to reach the person, and what they need.
//
// Deliberately NOT a conversation. There is no thread, no live chat and no
// reply box -- a request lands in the admin queue, someone reads it, and
// follows up by phone or email using the contact details left on it. See
// migration 022 for what this replaced.
export function makeSupportRepo(raw) {
  return {
    create({ name, contact, message, userId = null, ip = null }) {
      const id = newId("req");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO support_requests (id, user_id, name, contact, message, status, ip, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?)`
        )
        .run(id, userId, name, contact, message, ip, now, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM support_requests WHERE id = ?`).get(id) || null;
    },
    list({ status, limit = 50, offset = 0 } = {}) {
      const where = status ? "WHERE status = ?" : "";
      const params = status ? [status, limit, offset] : [limit, offset];
      return raw
        .query(`SELECT * FROM support_requests ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(...params);
    },
    update(id, { status, adminNote, handledBy }) {
      const sets = ["updated_at = ?"];
      const params = [new Date().toISOString()];
      if (status !== undefined) {
        sets.push("status = ?");
        params.push(status);
      }
      if (adminNote !== undefined) {
        sets.push("admin_note = ?");
        params.push(adminNote);
      }
      if (handledBy !== undefined) {
        sets.push("handled_by = ?");
        params.push(handledBy);
      }
      params.push(id);
      raw.query(`UPDATE support_requests SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return this.get(id);
    },
    countByStatus() {
      return raw.query(`SELECT status, COUNT(*) AS n FROM support_requests GROUP BY status`).all();
    },
  };
}

export function makeAuditLogRepo(raw) {
  return {
    record({ actorUserId, action, entityType, entityId, meta = {}, ip }) {
      const id = newId("log");
      raw
        .query(
          `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, meta_json, ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, actorUserId || null, action, entityType || null, entityId || null, JSON.stringify(meta), ip || null, new Date().toISOString());
      return id;
    },
    list({ actorUserId, action, entityType, limit = 100, offset = 0 } = {}) {
      const clauses = [];
      const params = [];
      if (actorUserId) {
        clauses.push("actor_user_id = ?");
        params.push(actorUserId);
      }
      if (action) {
        clauses.push("action = ?");
        params.push(action);
      }
      if (entityType) {
        clauses.push("entity_type = ?");
        params.push(entityType);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      return raw.query(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params);
    },
  };
}
