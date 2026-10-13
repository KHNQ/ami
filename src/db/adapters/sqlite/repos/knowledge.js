import { newId } from "../../../../lib/id.js";

// Assistant knowledge, and the gaps in it (migration 017).

export function makeKnowledgeRepo(raw) {
  const hydrate = (r) => (r ? { ...r, tags: JSON.parse(r.tags_json || "[]") } : null);

  return {
    create(fields) {
      const id = newId("kb");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO ai_knowledge (id, question, answer, tags_json, status, author_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          fields.question,
          fields.answer,
          JSON.stringify(fields.tags || []),
          fields.status || "published",
          fields.authorId || null,
          now,
          now
        );
      return this.get(id);
    },

    get(id) {
      return hydrate(raw.query(`SELECT * FROM ai_knowledge WHERE id = ?`).get(id));
    },

    update(id, fields) {
      const cur = this.get(id);
      if (!cur) return null;
      raw
        .query(
          `UPDATE ai_knowledge SET question = ?, answer = ?, tags_json = ?, status = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          fields.question ?? cur.question,
          fields.answer ?? cur.answer,
          JSON.stringify(fields.tags ?? cur.tags),
          fields.status ?? cur.status,
          new Date().toISOString(),
          id
        );
      return this.get(id);
    },

    remove(id) {
      raw.query(`DELETE FROM ai_knowledge WHERE id = ?`).run(id);
      return raw.query("SELECT changes() AS n").get().n > 0;
    },

    list({ status = null, limit = 200, offset = 0 } = {}) {
      const where = status ? `WHERE status = ?` : "";
      const args = status ? [status, limit, offset] : [limit, offset];
      return raw
        .query(`SELECT * FROM ai_knowledge ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .all(...args)
        .map(hydrate);
    },

    /** Published entries only -- what the assistant is allowed to say. */
    published() {
      return raw
        .query(`SELECT * FROM ai_knowledge WHERE status = 'published' ORDER BY updated_at DESC`)
        .all()
        .map(hydrate);
    },

    recordHits(ids) {
      if (!ids?.length) return;
      // One statement per id rather than an IN clause built by string
      // concatenation -- these ids come from retrieval, and interpolating
      // them would be an injection hole for the sake of one round trip.
      const stmt = raw.query(`UPDATE ai_knowledge SET hit_count = hit_count + 1 WHERE id = ?`);
      for (const id of ids) stmt.run(id);
    },
  };
}

export function makeAnswerGapRepo(raw) {
  return {
    /**
     * Records that a question could not be answered.
     *
     * Upsert on the normalised key, so asking the same thing fifty different
     * ways still produces one row with a count of fifty -- which is the whole
     * point: the count is what tells staff which gap to fill first.
     */
    record({ questionKey, sampleQuestion }) {
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO ai_answer_gaps (id, question_key, sample_question, ask_count, first_asked_at, last_asked_at)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(question_key) DO UPDATE SET
             ask_count = ask_count + 1,
             last_asked_at = excluded.last_asked_at,
             -- Re-opens a gap that was ignored but is clearly still being
             -- asked. An 'answered' one stays answered.
             status = CASE WHEN status = 'ignored' THEN 'open' ELSE status END`
        )
        .run(newId("gap"), questionKey, sampleQuestion, now, now);
    },

    list({ status = "open", limit = 100 } = {}) {
      const where = status ? `WHERE status = ?` : "";
      const args = status ? [status, limit] : [limit];
      return raw
        .query(`SELECT * FROM ai_answer_gaps ${where} ORDER BY ask_count DESC, last_asked_at DESC LIMIT ?`)
        .all(...args);
    },

    setStatus(id, status, knowledgeId = null) {
      raw.query(`UPDATE ai_answer_gaps SET status = ?, knowledge_id = ? WHERE id = ?`).run(status, knowledgeId, id);
      return raw.query(`SELECT * FROM ai_answer_gaps WHERE id = ?`).get(id) || null;
    },

    get(id) {
      return raw.query(`SELECT * FROM ai_answer_gaps WHERE id = ?`).get(id) || null;
    },

    openCount() {
      return raw.query(`SELECT COUNT(*) AS n FROM ai_answer_gaps WHERE status = 'open'`).get().n;
    },
  };
}
