import { newId } from "../../../../lib/id.js";

// Working state for the agent (migration 018): conversations, the messages
// inside them, uploaded attachments, the daily meter, and the tool calls the
// agent made or proposed.
//
// Distinct from repos/ai.js, which owns `ai_conversations` -- that is the
// admin audit log and is written once per answered question. These tables are
// what the model actually reads back.

const now = () => new Date().toISOString();

/* --- sessions ---------------------------------------------------------- */

export function makeAiSessionsRepo(raw) {
  return {
    create({ userId = null, title = null, scope = {} } = {}) {
      const id = newId("aisess");
      const ts = now();
      raw
        .query(
          `INSERT INTO ai_sessions (id, user_id, title, scope_json, message_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`
        )
        .run(id, userId, title, JSON.stringify(scope || {}), ts, ts);
      return this.get(id);
    },

    get(id) {
      const row = raw.query(`SELECT * FROM ai_sessions WHERE id = ?`).get(id);
      return row ? hydrateSession(row) : null;
    },

    /**
     * A session, but only if it belongs to this user.
     *
     * Every route that takes a session id from the client goes through this
     * rather than `get`, so "someone else's conversation" is indistinguishable
     * from "no such conversation" -- a plain 404, leaking nothing about
     * whether the id exists.
     */
    getOwned(id, userId) {
      if (!id || !userId) return null;
      const row = raw
        .query(`SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?`)
        .get(id, userId);
      return row ? hydrateSession(row) : null;
    },

    list({ userId, limit = 30, offset = 0, includeArchived = false } = {}) {
      const archived = includeArchived ? "" : "AND archived_at IS NULL";
      return raw
        .query(
          `SELECT * FROM ai_sessions
            WHERE user_id = ? ${archived}
            ORDER BY COALESCE(last_message_at, created_at) DESC
            LIMIT ? OFFSET ?`
        )
        .all(userId, limit, offset)
        .map(hydrateSession);
    },

    update(id, fields = {}) {
      const current = this.get(id);
      if (!current) return null;
      raw
        .query(
          `UPDATE ai_sessions
              SET title = ?, scope_json = ?, archived_at = ?, updated_at = ?
            WHERE id = ?`
        )
        .run(
          fields.title ?? current.title,
          JSON.stringify(fields.scope ?? current.scope ?? {}),
          fields.archivedAt !== undefined ? fields.archivedAt : current.archived_at,
          now(),
          id
        );
      return this.get(id);
    },

    /** Called after each appended message so the list can sort by recency. */
    touch(id, { messageCount } = {}) {
      const ts = now();
      raw
        .query(
          `UPDATE ai_sessions
              SET last_message_at = ?, updated_at = ?,
                  message_count = COALESCE(?, message_count)
            WHERE id = ?`
        )
        .run(ts, ts, messageCount ?? null, id);
    },

    remove(id) {
      // ai_messages / ai_attachments / ai_tool_calls all cascade.
      raw.query(`DELETE FROM ai_sessions WHERE id = ?`).run(id);
      return { ok: true };
    },
  };
}

function hydrateSession(row) {
  let scope = {};
  try {
    scope = JSON.parse(row.scope_json || "{}");
  } catch {
    scope = {};
  }
  return { ...row, scope };
}

/* --- messages ---------------------------------------------------------- */

export function makeAiMessagesRepo(raw) {
  return {
    /**
     * Appends a message and returns it.
     *
     * `seq` is derived here rather than passed in, from MAX(seq)+1 within the
     * session. The unique index on (session_id, seq) is the backstop: if two
     * writes ever raced, the second fails loudly instead of silently
     * reordering someone's conversation.
     */
    append(sessionId, msg) {
      const id = newId("aimsg");
      const seq =
        (raw.query(`SELECT MAX(seq) AS m FROM ai_messages WHERE session_id = ?`).get(sessionId)
          ?.m ?? 0) + 1;
      raw
        .query(
          `INSERT INTO ai_messages
             (id, session_id, seq, role, content, tool_calls_json, tool_call_id, tool_name,
              attachments_json, sources_json, suggestions_json, tokens_prompt, tokens_completion, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          sessionId,
          seq,
          msg.role,
          msg.content ?? null,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.toolCallId ?? null,
          msg.toolName ?? null,
          JSON.stringify(msg.attachments ?? []),
          JSON.stringify(msg.sources ?? []),
          JSON.stringify(msg.suggestions ?? []),
          msg.tokensPrompt ?? null,
          msg.tokensCompletion ?? null,
          now()
        );
      return this.get(id);
    },

    get(id) {
      const row = raw.query(`SELECT * FROM ai_messages WHERE id = ?`).get(id);
      return row ? hydrateMessage(row) : null;
    },

    /**
     * The last `limit` messages, oldest first.
     *
     * Fetched newest-first then reversed so the LIMIT keeps the RECENT tail
     * rather than the opening of a long conversation.
     */
    recent(sessionId, { limit = 16 } = {}) {
      return raw
        .query(`SELECT * FROM ai_messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?`)
        .all(sessionId, limit)
        .map(hydrateMessage)
        .reverse();
    },

    /** The whole conversation, oldest first -- for rendering, not for prompting. */
    all(sessionId) {
      return raw
        .query(`SELECT * FROM ai_messages WHERE session_id = ? ORDER BY seq ASC`)
        .all(sessionId)
        .map(hydrateMessage);
    },

    count(sessionId) {
      return raw.query(`SELECT COUNT(*) AS n FROM ai_messages WHERE session_id = ?`).get(sessionId)
        .n;
    },
  };
}

function hydrateMessage(row) {
  const parse = (s, fallback) => {
    if (s == null) return fallback;
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  };
  return {
    ...row,
    tool_calls: parse(row.tool_calls_json, null),
    attachments: parse(row.attachments_json, []),
    sources: parse(row.sources_json, []),
    suggestions: parse(row.suggestions_json, []),
  };
}

/* --- attachments ------------------------------------------------------- */

export function makeAiAttachmentsRepo(raw) {
  return {
    create(f) {
      const id = newId("aiatt");
      raw
        .query(
          `INSERT INTO ai_attachments
             (id, user_id, session_id, kind, mime, byte_size, filename, original_name,
              storage_path, sha256, extracted_text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          f.userId,
          f.sessionId ?? null,
          f.kind,
          f.mime,
          f.byteSize,
          f.filename,
          f.originalName ?? null,
          f.storagePath,
          f.sha256 ?? null,
          f.extractedText ?? null,
          now()
        );
      return this.get(id);
    },

    get(id) {
      return raw.query(`SELECT * FROM ai_attachments WHERE id = ?`).get(id) || null;
    },

    /** Ownership-scoped read, for the same reason as sessions.getOwned. */
    getOwned(id, userId) {
      if (!id || !userId) return null;
      return (
        raw.query(`SELECT * FROM ai_attachments WHERE id = ? AND user_id = ?`).get(id, userId) ||
        null
      );
    },

    byIds(ids = []) {
      if (!ids.length) return [];
      const marks = ids.map(() => "?").join(",");
      return raw.query(`SELECT * FROM ai_attachments WHERE id IN (${marks})`).all(...ids);
    },

    /** What this visitor has sent in one conversation, newest first. */
    listForSession(sessionId, userId, limit = 20) {
      if (!sessionId || !userId) return [];
      return raw
        .query(
          `SELECT * FROM ai_attachments
            WHERE session_id = ? AND user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`
        )
        .all(sessionId, userId, limit);
    },

    attachToSession(id, sessionId) {
      raw.query(`UPDATE ai_attachments SET session_id = ? WHERE id = ?`).run(sessionId, id);
      return this.get(id);
    },
  };
}

/* --- daily usage ------------------------------------------------------- */

export function makeAiUsageRepo(raw) {
  // One statement per counter: increment and read in the same round trip, so
  // two concurrent requests can never both observe the pre-increment value.
  // Check-then-increment would let a user at 19 send two more.
  const bump = (column) =>
    raw.query(
      `INSERT INTO ai_usage_daily (user_id, day, ${column})
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET ${column} = ${column} + excluded.${column}
       RETURNING prompts, tool_calls, web_searches, tokens`
    );

  return {
    incrementPrompts(userId, day, by = 1) {
      return bump("prompts").get(userId, day, by);
    },
    incrementToolCalls(userId, day, by = 1) {
      return bump("tool_calls").get(userId, day, by);
    },
    incrementWebSearches(userId, day, by = 1) {
      return bump("web_searches").get(userId, day, by);
    },
    addTokens(userId, day, by = 0) {
      if (!by) return this.get(userId, day);
      return bump("tokens").get(userId, day, by);
    },

    get(userId, day) {
      return (
        raw.query(`SELECT * FROM ai_usage_daily WHERE user_id = ? AND day = ?`).get(userId, day) || {
          user_id: userId,
          day,
          prompts: 0,
          tool_calls: 0,
          web_searches: 0,
          tokens: 0,
        }
      );
    },

    history(userId, { limit = 30 } = {}) {
      return raw
        .query(`SELECT * FROM ai_usage_daily WHERE user_id = ? ORDER BY day DESC LIMIT ?`)
        .all(userId, limit);
    },
  };
}

/* --- tool calls and proposals ------------------------------------------ */

export function makeAiToolCallsRepo(raw) {
  return {
    record({
      sessionId,
      messageId = null,
      userId = null,
      toolName,
      args,
      status,
      consequential = false,
      result = null,
      errorCode = null,
      durationMs = null,
      expiresAt = null,
    }) {
      const id = newId("aitool");
      raw
        .query(
          `INSERT INTO ai_tool_calls
             (id, session_id, message_id, user_id, tool_name, args_json, status, consequential,
              result_json, error_code, duration_ms, expires_at, created_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          sessionId,
          messageId,
          userId,
          toolName,
          JSON.stringify(args ?? {}),
          status,
          consequential ? 1 : 0,
          result == null ? null : JSON.stringify(result),
          errorCode,
          durationMs,
          expiresAt,
          now(),
          status === "proposed" ? null : now()
        );
      return this.get(id);
    },

    get(id) {
      const row = raw.query(`SELECT * FROM ai_tool_calls WHERE id = ?`).get(id);
      return row ? hydrateToolCall(row) : null;
    },

    /**
     * Claims a proposal for execution. THIS is the double-spend defence.
     *
     * The guard is the WHERE clause, not a prior read: two taps on the same
     * confirmation card race into this statement and SQLite serialises them,
     * so exactly one sees `changes === 1`. Checking status in JavaScript first
     * and updating second would leave a window between them.
     *
     * Returns the row when this caller won the claim, otherwise null.
     */
    claim(id, userId, nowIso = now()) {
      const res = raw
        .query(
          `UPDATE ai_tool_calls
              SET status = 'confirmed', resolved_at = ?
            WHERE id = ? AND user_id = ? AND status = 'proposed' AND expires_at > ?`
        )
        .run(nowIso, id, userId, nowIso);
      return res.changes === 1 ? this.get(id) : null;
    },

    settle(id, { status, result = null, errorCode = null, durationMs = null }) {
      raw
        .query(
          `UPDATE ai_tool_calls
              SET status = ?, result_json = ?, error_code = ?, duration_ms = ?, resolved_at = ?
            WHERE id = ?`
        )
        .run(
          status,
          result == null ? null : JSON.stringify(result),
          errorCode,
          durationMs,
          now(),
          id
        );
      return this.get(id);
    },

    reject(id, userId) {
      const res = raw
        .query(
          `UPDATE ai_tool_calls SET status = 'rejected', resolved_at = ?
            WHERE id = ? AND user_id = ? AND status = 'proposed'`
        )
        .run(now(), id, userId);
      return res.changes === 1 ? this.get(id) : null;
    },

    /** Sweeps proposals nobody answered, so the admin log stops implying they are live. */
    expireStale(nowIso = now(), limit = 500) {
      const res = raw
        .query(
          `UPDATE ai_tool_calls SET status = 'expired', resolved_at = ?
            WHERE id IN (
              SELECT id FROM ai_tool_calls
               WHERE status = 'proposed' AND expires_at IS NOT NULL AND expires_at <= ?
               LIMIT ?
            )`
        )
        .run(nowIso, nowIso, limit);
      return res.changes;
    },

    listBySession(sessionId, { limit = 100 } = {}) {
      return raw
        .query(
          `SELECT * FROM ai_tool_calls WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(sessionId, limit)
        .map(hydrateToolCall);
    },

    list({ userId = null, status = null, limit = 100, offset = 0 } = {}) {
      const where = [];
      const args = [];
      if (userId) {
        where.push("user_id = ?");
        args.push(userId);
      }
      if (status) {
        where.push("status = ?");
        args.push(status);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      return raw
        .query(`SELECT * FROM ai_tool_calls ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...args, limit, offset)
        .map(hydrateToolCall);
    },
  };
}

function hydrateToolCall(row) {
  const parse = (s, fallback) => {
    if (s == null) return fallback;
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  };
  return {
    ...row,
    args: parse(row.args_json, {}),
    result: parse(row.result_json, null),
    consequential: Boolean(row.consequential),
  };
}
