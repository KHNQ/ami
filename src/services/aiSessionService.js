import { config } from "../config.js";
import { db } from "../db/index.js";
import { kv } from "../lib/kv.js";
import { Errors } from "../lib/errors.js";
import { aiAttachmentService } from "./aiAttachmentService.js";

// Where a conversation lives.
//
// Two stores, deliberately:
//
//  - **Signed in → SQLite.** The visitor expects to close the tab, come back
//    tomorrow and find the thread. KV cannot promise that: the default driver
//    is an in-process Map that dies with the process, and the Redis driver
//    carries a TTL. A conversation the agent took actions inside is a record,
//    not a cache.
//
//  - **Anonymous → KV, exactly as before.** A visitor with no account has
//    nowhere to hang a durable row, and writing one keyed on a
//    browser-generated id would fill the table with garbage that no user can
//    ever be shown or delete. They keep the 2-hour ephemeral thread they have
//    today, byte for byte.
//
// The point of the seam is that callers do not branch: they resolve a session
// and get back something that answers `loadHistory` and `appendTurn` the same
// way either side.

const kvKey = (id) => `ai:session:${id}`;

/** First line of the opening question, as the conversation's name. */
function titleFrom(message) {
  const oneLine = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!oneLine) return "New conversation";
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

export const aiSessionService = {
  titleFrom,

  /**
   * Finds or creates the conversation this turn belongs to.
   *
   * A signed-in caller may pass a session id they own; anything else (another
   * user's id, a stale id, a browser-generated one from before they signed in)
   * is treated as "start a new conversation" rather than an error. The client
   * cannot always know which of those it is holding, and refusing the message
   * would lose it.
   */
  resolve({ sessionId = null, userId = null, message = "", scope = {} } = {}) {
    if (!userId) {
      // Anonymous: the id is whatever the browser generated, and nothing is
      // written to the database.
      return { id: sessionId || null, userId: null, persistent: false, created: false };
    }

    const existing = sessionId ? db.aiSessions.getOwned(sessionId, userId) : null;
    if (existing) {
      return { id: existing.id, userId, persistent: true, created: false, row: existing };
    }

    const row = db.aiSessions.create({ userId, title: titleFrom(message), scope });
    return { id: row.id, userId, persistent: true, created: true, row };
  },

  /**
   * The recent turns, shaped for the model.
   *
   * Tool-call and tool-result rows are included verbatim, because an
   * assistant turn that requested tools is only valid in the array if the
   * results that answered it follow. Dropping either half leaves the provider
   * with a dangling `tool_calls` and a 400.
   */
  async loadHistory(session) {
    if (!session?.id) return [];

    if (!session.persistent) {
      const stored = await kv.get(kvKey(session.id));
      return Array.isArray(stored) ? stored : [];
    }

    const rows = db.aiMessages.recent(session.id, { limit: config.aiHistoryTurns });

    // Which earlier turns keep their pictures. An image costs 1-2k tokens on
    // every turn it stays in the array, so carrying five of them through a
    // long conversation is where the bill quietly comes from. The recent ones
    // stay -- "and the one before that?" has to work -- and older ones leave a
    // mention carrying their id, which `view_attachment` can reopen.
    const userRows = rows.filter((r) => r.role === "user");
    const keepFrom = userRows.length > config.aiAttachmentHistoryTurns
      ? userRows[userRows.length - config.aiAttachmentHistoryTurns].seq
      : -Infinity;

    const out = [];
    for (const r of rows) {
      if (r.role === "assistant" && r.tool_calls) {
        out.push({ role: "assistant", content: r.content ?? "", tool_calls: r.tool_calls });
      } else if (r.role === "tool") {
        out.push({ role: "tool", tool_call_id: r.tool_call_id, content: r.content ?? "" });
      } else if (r.role === "user" && r.attachments?.length) {
        out.push({
          role: "user",
          content: await replayAttachments(r, r.seq >= keepFrom),
        });
      } else if (r.content != null) {
        out.push({ role: r.role, content: r.content });
      }
    }
    return trimDangling(out);
  },

  /** Persists one completed exchange. */
  async appendTurn(session, { message, reply, sources = [], suggestions = [], attachments = [], usage = null }) {
    if (!session?.id) return;

    if (!session.persistent) {
      const prior = await this.loadHistory(session);
      const next = [
        ...prior,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ].slice(-config.aiHistoryTurns);
      await kv.set(kvKey(session.id), next, { ttlMs: config.aiSessionTtlMs });
      return;
    }

    db.aiMessages.append(session.id, { role: "user", content: message, attachments });
    db.aiMessages.append(session.id, {
      role: "assistant",
      content: reply,
      sources,
      suggestions,
      tokensPrompt: usage?.prompt_tokens ?? null,
      tokensCompletion: usage?.completion_tokens ?? null,
    });
    db.aiSessions.touch(session.id, { messageCount: db.aiMessages.count(session.id) });
  },

  /** Persists an intermediate agent step (tool request + its result). */
  appendToolExchange(session, { assistantContent = "", toolCalls, results }) {
    if (!session?.persistent || !session.id) return;
    db.aiMessages.append(session.id, {
      role: "assistant",
      content: assistantContent,
      toolCalls,
    });
    for (const r of results) {
      db.aiMessages.append(session.id, {
        role: "tool",
        toolCallId: r.tool_call_id,
        toolName: r.name,
        content: r.content,
      });
    }
  },

  /* --- the routes behind /ai/sessions --------------------------------- */

  list(userId, { limit = 30, offset = 0 } = {}) {
    return db.aiSessions.list({ userId, limit, offset }).map(publicSession);
  },

  detail(id, userId) {
    const row = db.aiSessions.getOwned(id, userId);
    if (!row) throw Errors.notFound("Conversation not found");
    return {
      ...publicSession(row),
      messages: db.aiMessages
        .all(id)
        // Tool plumbing is not a chat bubble. The timeline renders from live
        // SSE events; a replayed conversation shows what was said.
        .filter(
          (m) =>
            m.role !== "tool" &&
            // A message can be nothing but a photograph -- "what's the total
            // on this?" is often sent as the file alone.
            (m.content || m.suggestions?.length || m.attachments?.length)
        )
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: m.sources,
          suggestions: m.suggestions,
          attachments: m.attachments,
          created_at: m.created_at,
        })),
    };
  },

  rename(id, userId, title) {
    if (!db.aiSessions.getOwned(id, userId)) throw Errors.notFound("Conversation not found");
    const clean = String(title || "").trim().slice(0, 120);
    if (!clean) throw Errors.badRequest("A title is required", "title_required");
    return publicSession(db.aiSessions.update(id, { title: clean }));
  },

  remove(id, userId) {
    if (!db.aiSessions.getOwned(id, userId)) throw Errors.notFound("Conversation not found");
    // Read the files BEFORE the delete: the rows cascade away with the
    // session and there would be nothing left to say what to unlink.
    const files = db.aiAttachments.listForSession(id, userId, 200);
    db.aiSessions.remove(id);
    // Not awaited: the visitor's delete should not wait on the filesystem,
    // and a file that cannot be removed is a housekeeping problem rather
    // than a failed request.
    aiAttachmentService.removeFiles(files);
    return { ok: true };
  },
};

/**
 * One past user message, with its files either present or merely named.
 *
 * `inline` turns them back into real content parts; otherwise they become a
 * line of text that tells the model what was sent and how to get it back. The
 * difference between those two is roughly a thousandfold in tokens, which is
 * why it is a decision rather than always doing the generous thing.
 */
async function replayAttachments(row, inline) {
  const text = row.content ?? "";
  if (inline) {
    const rows = db.aiAttachments.byIds(row.attachments.map((a) => a.id).filter(Boolean));
    const parts = await aiAttachmentService.buildParts(rows);
    if (parts.length) return [{ type: "text", text }, ...parts];
  }
  const mentions = row.attachments
    .map(
      (a) =>
        `[${a.kind === "image" ? "image" : "file"}: ${a.filename}, sent earlier in this ` +
        `conversation. attachment_id ${a.id} — call view_attachment to look at it again]`
    )
    .join("\n");
  return `${text}\n${mentions}`.trim();
}

function publicSession(row) {
  return {
    id: row.id,
    title: row.title,
    message_count: row.message_count,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
  };
}

/**
 * Drops a leading orphan.
 *
 * `recent()` takes the last N rows, and that window can open in the middle of
 * a tool exchange — leaving a `tool` result whose requesting assistant turn
 * fell off the top. Providers reject that array outright, so the orphans come
 * off the front until the history starts somewhere valid.
 */
function trimDangling(messages) {
  let start = 0;
  while (start < messages.length && messages[start].role === "tool") start++;
  return messages.slice(start);
}
