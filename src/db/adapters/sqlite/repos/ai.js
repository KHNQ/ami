// Assistant conversation log (migration 013).
//
// Write-mostly: one row per answered question, read only by the admin
// console. Nothing in the money path touches this table.
export function makeAiConversationsRepo(raw) {
  return {
    insert(row) {
      raw
        .query(
          `INSERT INTO ai_conversations
             (id, user_id, session_id, message, reply, sources_json, tokens, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.user_id ?? null,
          row.session_id ?? null,
          row.message,
          row.reply ?? null,
          row.sources_json ?? "[]",
          row.tokens ?? null,
          row.created_at
        );
      return this.get(row.id);
    },

    get(id) {
      return raw.query(`SELECT * FROM ai_conversations WHERE id = ?`).get(id) || null;
    },

    list({ sessionId = null, limit = 100, offset = 0 } = {}) {
      const where = sessionId ? `WHERE session_id = ?` : "";
      const args = sessionId ? [sessionId, limit, offset] : [limit, offset];
      return raw
        .query(`SELECT * FROM ai_conversations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...args);
    },

    count() {
      return raw.query(`SELECT COUNT(*) AS n FROM ai_conversations`).get().n;
    },
  };
}
