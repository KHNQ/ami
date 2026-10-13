import { Hono } from "hono";
import { optionalAuth, requireAuth, requirePermission } from "../middleware/auth.js";
import { requireFeature } from "../middleware/featureFlag.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { aiQuota, dailyLimit, quotaDay } from "../middleware/aiQuota.js";
import { aiService } from "../services/aiService.js";
import { aiSessionService } from "../services/aiSessionService.js";
import { agentService, agentAvailable, buildToolContext } from "../services/agentService.js";
import { aiConfirmService } from "../services/aiConfirmService.js";
import { aiAttachmentService } from "../services/aiAttachmentService.js";
import { Errors } from "../lib/errors.js";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { permissionsFor } from "../lib/permissions.js";

// The storefront assistant.
//
// Anonymous by design: the whole point is answering a visitor's question
// before they have any reason to sign up. optionalAuth is used rather than
// no auth at all so a signed-in user's conversations can be attributed in the
// admin log, without ever requiring a token.
export const aiRoutes = new Hono();

// Every model call costs money, so this is the tightest budget in the app.
// Keyed per IP: 20 questions an hour is far beyond genuine use and far below
// what would make scraping the assistant worthwhile.
// Ordered AFTER optionalAuth on the chat routes, not before. The limiter
// itself is still IP-keyed, but the ordering is what makes a per-user quota
// possible at all -- middleware that runs before auth cannot see who is
// asking, so a whole clinic behind one NAT shared a single allowance.
const chatLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: "ai:chat" });

// The anonymous teaser's budget. Applied only when there is no account to
// meter, so a signed-in visitor is governed by their daily allowance rather
// than by whoever else shares their office IP.
const anonLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.aiAnonHourlyLimit,
  keyPrefix: "ai:anon",
});
const teaserLimit = async (c, next) => (c.get("userId") ? next() : anonLimiter(c, next));
// Retrieval-only, no upstream cost -- so a much looser limit, purely to stop
// a loop hammering the process.
const suggestLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: "ai:suggest" });
// Uploads cost disk rather than tokens, so the limit is about storage and
// bandwidth, not about the model.
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: "ai:upload" });

const gate = requireFeature("ai_chat_enabled", {
  code: "ai_disabled",
  message: "The assistant is currently unavailable",
});

// Hard ceiling on the prompt a visitor can submit. Without it, someone can
// paste a novel and bill the full context window on every request.
const MAX_MESSAGE_CHARS = 1000;

/**
 * Where the visitor is, sanitised.
 *
 * Only a short free-text description is accepted, and it is length-capped:
 * this string goes into the system prompt, so treating it as trusted would
 * be a prompt-injection channel that any client could drive. The client
 * chooses from a fixed list of descriptions (see frontend routeContext.js);
 * the cap here is the server refusing to take its word for it.
 */
function readRouteContext(body) {
  const ctx = body?.route_context;
  if (!ctx || typeof ctx !== "object") return null;
  const description = typeof ctx.description === "string" ? ctx.description.slice(0, 120) : null;
  if (!description) return null;
  // Strip newlines so a description can never open a new "instruction" block
  // in the prompt.
  return { description: description.replace(/[\r\n]+/g, " ") };
}

/**
 * The files this message carries.
 *
 * Ids only. The bytes were uploaded beforehand through /ai/attachments, so a
 * chat turn never waits on a 5MB body -- and ownership is re-checked when
 * they are loaded, so an id belonging to somebody else resolves to nothing
 * rather than to their invoice.
 */
function readAttachmentIds(body) {
  const raw = body?.attachment_ids;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id) => typeof id === "string")
    .map((id) => id.slice(0, 80))
    .slice(0, config.aiMaxAttachmentsPerMessage);
}

function readQuestion(body, { allowEmpty = false } = {}) {
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    // Sending a photograph with no words is a real way to ask a question --
    // it means "what is this". The model is given a plain instruction in
    // place of the missing text rather than the visitor being refused.
    if (allowEmpty) return "Please look at the attached file and tell me what it says.";
    throw Errors.badRequest("A question is required", "message_required");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw Errors.badRequest(
      `Please keep questions under ${MAX_MESSAGE_CHARS} characters`,
      "message_too_long"
    );
  }
  return message;
}

/**
 * Streamed answer as Server-Sent Events.
 *
 * SSE rather than a websocket: this is one-directional, short-lived, and
 * survives proxies that would need extra configuration to carry a socket.
 */
aiRoutes.post("/chat", gate, optionalAuth, chatLimiter, teaserLimit, aiQuota(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Only a signed-in visitor can own a file, so only they can send a message
  // that is nothing but one.
  const attachmentIds = c.get("userId") ? readAttachmentIds(body) : [];
  const message = readQuestion(body, { allowEmpty: attachmentIds.length > 0 });

  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null;
  const productId = typeof body.product_id === "string" ? body.product_id : null;
  const routeContext = readRouteContext(body);
  // Abort the upstream generation if the visitor navigates away, rather than
  // paying for tokens that will never be displayed.
  const signal = c.req.raw.signal;

  // Signed-in visitors get the agent; anonymous ones get the retrieval
  // assistant they get today, on the same code path as before. The teaser is
  // deliberately not a second implementation.
  const toolCtx = buildToolContext(c, { sessionId, signal });

  const stream = agentAvailable(toolCtx)
    ? await agentService.stream({
        message,
        sessionId,
        productId,
        attachmentIds,
        ctx: toolCtx,
        signal,
        routeContext,
      })
    : await aiService.streamAsk({
        message,
        sessionId,
        productId,
        userId: c.get("userId") || null,
        routeContext,
        signal,
      });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which holds an SSE
      // stream until it completes -- defeating the entire point.
      "X-Accel-Buffering": "no",
    },
  });
});

/** Non-streaming equivalent, for clients that would rather have one JSON blob. */
aiRoutes.post("/ask", gate, optionalAuth, chatLimiter, teaserLimit, aiQuota(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const message = readQuestion(body);
  const answer = await aiService.ask({
    message,
    sessionId: typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null,
    productId: typeof body.product_id === "string" ? body.product_id : null,
    userId: c.get("userId") || null,
    routeContext: readRouteContext(body),
  });
  return c.json(answer);
});

/**
 * Retrieval-only product suggestions. No model call, so this is fast, free
 * and safe to fire on page load for the "related devices" strip.
 */
aiRoutes.post("/suggest", gate, suggestLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.slice(0, MAX_MESSAGE_CHARS) : "";
  return c.json({
    suggestions: aiService.suggest({
      query,
      limit: Math.min(Number(body.limit) || 4, 8),
      excludeProductId: typeof body.exclude_product_id === "string" ? body.exclude_product_id : null,
    }),
  });
});

/**
 * The visitor answering a confirmation card.
 *
 * Quota-exempt on purpose: they already spent a prompt getting here, and
 * charging them again to say yes to something the assistant proposed would be
 * charging twice for one intention.
 */
aiRoutes.post("/confirm", gate, requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const proposalId = typeof body.proposal_id === "string" ? body.proposal_id.slice(0, 80) : null;
  if (!proposalId) throw Errors.badRequest("A proposal id is required", "proposal_id_required");

  if (body.decision === "reject") {
    return c.json(aiConfirmService.reject({ proposalId, userId: c.get("userId") }));
  }

  // Built from THIS request's auth, never restored from the proposal -- the
  // token may have been revoked since the card appeared.
  const ctx = buildToolContext(c, { signal: c.req.raw.signal });
  return c.json(await aiConfirmService.confirm({ proposalId, ctx }));
});

// What the composer chip reads. Cheap enough to call on open: one indexed
// primary-key lookup, no model involvement.
aiRoutes.get("/quota", gate, requireAuth, (c) => {
  const day = quotaDay();
  const limit = dailyLimit();
  const used = db.aiUsage.get(c.get("userId"), day).prompts;
  return c.json({ used, limit, remaining: Math.max(0, limit - used), day });
});

// --- attachments ---------------------------------------------------------
//
// requireAuth, not optionalAuth: an anonymous visitor has no durable place to
// hang a file and no quota to meter it against, so the teaser shows the
// attach button and the sign-in prompt behind it rather than accepting bytes
// it cannot account for.

aiRoutes.post("/attachments", gate, requireAuth, uploadLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const attachment = await aiAttachmentService.upload({
    userId: c.get("userId"),
    sessionId: typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null,
    dataUrl: body.data_url,
    filename: body.filename,
  });
  return c.json(attachment, 201);
});

/**
 * The bytes back, for the thumbnail in the composer and the bubble.
 *
 * Served through a handler rather than by pointing a static mount at
 * `uploadDir`, which is the important part: that directory also holds every
 * job applicant's résumé, and a static mount would publish all of it.
 */
aiRoutes.get("/attachments/:id", gate, requireAuth, async (c) => {
  const file = await aiAttachmentService.read(c.req.param("id"), {
    userId: c.get("userId"),
    canReadAll: c.get("staffRole") ? permissionsFor(c.get("staffRole")).includes("logs.read") : false,
  });
  return new Response(file.bytes, {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=3600",
      // Never inline: a stored SVG or HTML would otherwise execute on our own
      // origin with the visitor's session.
      "Content-Disposition": `attachment; filename="${file.filename.replace(/[^\w.\-]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// --- conversations (the visitor's own) -----------------------------------
//
// Behind `gate` like everything else here, and behind requireAuth because
// there is nothing to list for an anonymous visitor: their thread lives in KV
// for two hours and belongs to a browser, not an account.

aiRoutes.get("/sessions", gate, requireAuth, (c) => {
  return c.json({
    sessions: aiSessionService.list(c.get("userId"), {
      limit: Math.min(Number(c.req.query("limit")) || 30, 100),
      offset: Number(c.req.query("offset")) || 0,
    }),
  });
});

aiRoutes.get("/sessions/:id", gate, requireAuth, (c) => {
  return c.json(aiSessionService.detail(c.req.param("id"), c.get("userId")));
});

aiRoutes.patch("/sessions/:id", gate, requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(aiSessionService.rename(c.req.param("id"), c.get("userId"), body.title));
});

aiRoutes.delete("/sessions/:id", gate, requireAuth, (c) => {
  return c.json(aiSessionService.remove(c.req.param("id"), c.get("userId")));
});

// --- knowledge base (admin) ----------------------------------------------
// Gated on content.write, the same permission as the blog: both are "things
// this company publishes in its own voice".

aiRoutes.get("/knowledge", requireAuth, requirePermission("content.write"), (c) => {
  return c.json({
    entries: db.knowledge.list({ status: c.req.query("status") || null, limit: 200 }),
    gaps_open: db.answerGaps.openCount(),
  });
});

aiRoutes.post("/knowledge", requireAuth, requirePermission("content.write"), async (c) => {
  const body = await c.req.json();
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!question || !answer) throw Errors.badRequest("A question and an answer are both required", "fields_required");

  const entry = db.knowledge.create({
    question: question.slice(0, 400),
    answer: answer.slice(0, 4000),
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 12) : [],
    status: body.status === "draft" ? "draft" : "published",
    authorId: c.get("userId"),
  });

  // A new entry must be reachable immediately -- an operator who adds an
  // answer and then tests it expects the assistant to know it, not to keep
  // saying "I don't have that" for another minute.
  aiService.invalidateIndex();

  // Answering the gap that prompted this closes it in the same action, so
  // the worklist stays honest without anyone remembering to tick it off.
  if (typeof body.gap_id === "string") {
    try {
      db.answerGaps.setStatus(body.gap_id, "answered", entry.id);
    } catch {
      /* the gap was already resolved or removed */
    }
  }
  return c.json(entry, 201);
});

aiRoutes.patch("/knowledge/:id", requireAuth, requirePermission("content.write"), async (c) => {
  const body = await c.req.json();
  const updated = db.knowledge.update(c.req.param("id"), body);
  if (!updated) throw Errors.notFound("Entry not found");
  aiService.invalidateIndex();
  return c.json(updated);
});

aiRoutes.delete("/knowledge/:id", requireAuth, requirePermission("content.write"), (c) => {
  if (!db.knowledge.remove(c.req.param("id"))) throw Errors.notFound("Entry not found");
  aiService.invalidateIndex();
  return c.json({ ok: true });
});

/** The worklist: what visitors asked that the assistant could not answer. */
aiRoutes.get("/gaps", requireAuth, requirePermission("content.write"), (c) => {
  return c.json({ gaps: db.answerGaps.list({ status: c.req.query("status") || "open", limit: 100 }) });
});

aiRoutes.patch("/gaps/:id", requireAuth, requirePermission("content.write"), async (c) => {
  const body = await c.req.json();
  const status = ["open", "answered", "ignored"].includes(body.status) ? body.status : null;
  if (!status) throw Errors.badRequest("status must be open, answered or ignored", "invalid_status");
  const gap = db.answerGaps.setStatus(c.req.param("id"), status);
  if (!gap) throw Errors.notFound("Gap not found");
  return c.json(gap);
});

/**
 * Admin: what the agent actually did.
 *
 * `ai_conversations` records what was said; this records what was DONE --
 * every tool the agent ran or proposed, with its arguments, its outcome and
 * whose account it ran against. For consequential ones it is also the record
 * of who approved them and when, which is the thing an operator needs when a
 * customer asks why their wallet was debited.
 */
aiRoutes.get("/tool-calls", requireAuth, requirePermission("logs.read"), (c) => {
  // Swept first so a proposal nobody answered reads as `expired` rather than
  // sitting in the list looking like it is still awaiting a decision.
  aiConfirmService.expireStale();
  return c.json({
    tool_calls: db.aiToolCalls.list({
      userId: c.req.query("user_id") || null,
      status: c.req.query("status") || null,
      limit: Math.min(Number(c.req.query("limit") || 100), 500),
      offset: Number(c.req.query("offset") || 0),
    }),
  });
});

/** Admin: the conversation log. */
aiRoutes.get("/conversations", requireAuth, requirePermission("logs.read"), (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 100), 500);
  const offset = Number(c.req.query("offset") || 0);
  const sessionId = c.req.query("session_id") || null;
  return c.json({
    conversations: aiService.list({ sessionId, limit, offset }),
  });
});
