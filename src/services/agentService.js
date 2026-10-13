import { config } from "../config.js";
import { Errors } from "../lib/errors.js";
import { permissionsFor } from "../lib/permissions.js";
import { buildContext, parseReply, aiService } from "./aiService.js";
import { aiSessionService } from "./aiSessionService.js";
import { productService } from "./productService.js";
import { settingsService } from "./settingsService.js";
import { runAgent, httpTransport } from "./agent/loop.js";
import { schemasFor } from "./agent/registry.js";
import { aiConfirmService } from "./aiConfirmService.js";
import { aiAttachmentService } from "./aiAttachmentService.js";

// Registering the tools is a side effect of importing them, so every tool
// module must be imported somewhere that always runs. Here is that place.
import "./agent/tools/catalog.js";
import "./agent/tools/account.js";
import "./agent/tools/network.js";
import "./agent/tools/web.js";
import "./agent/tools/sales.js";
import "./agent/tools/actions.js";
import "./agent/tools/client.js";
import "./agent/tools/consequential.js";
import "./agent/tools/attachments.js";

// The agent's entry point: everything the route needs to answer one turn.
//
// Sits beside aiService rather than inside it. aiService is the retrieval
// assistant and stays exactly what it was -- it is still the whole of the
// anonymous path, and every existing test exercises it unchanged.

const HEARTBEAT_MS = 25_000;

function assertEnabled() {
  if (!settingsService.isEnabled("ai_chat_enabled")) {
    throw Errors.forbidden("The assistant is currently unavailable", "ai_disabled");
  }
}

/**
 * Should this caller get tools?
 *
 * Only signed-in visitors. An anonymous one keeps the retrieval assistant
 * byte-for-byte: same prompt, same array, same code path. That is what makes
 * the teaser trustworthy rather than a second implementation that can drift.
 */
export function agentAvailable(ctx) {
  return Boolean(ctx?.userId) && schemasFor(ctx).length > 0;
}

/** The identity a tool handler is allowed to see. Built from the request, never from the model. */
export function buildToolContext(c, { sessionId = null, emit = () => {}, signal = null } = {}) {
  const staffRole = c.get("staffRole") || null;
  const permissions = permissionsFor(staffRole);
  return {
    userId: c.get("userId") || null,
    role: c.get("role") || null,
    staffRole,
    permissions,
    // `isAdmin` is what the ownership assertions in nodeService and
    // spaceService actually test, and there it means "may read anyone's
    // record" -- a PERMISSION, not a role. src/routes/nodes.js:13 derives it
    // the same way. Deriving it from `role === "admin"` instead would hand a
    // staff member cross-customer reads through the agent that the equivalent
    // HTTP route would refuse them.
    isAdmin: permissions.includes("network.read_all"),
    canReadAllOrders: permissions.includes("orders.read_all"),
    canReadAllSupport: permissions.includes("support.read_all"),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null,
    sessionId,
    signal,
    emit,
  };
}

export const agentService = {
  /**
   * Streams one agent turn as SSE.
   *
   * Same event vocabulary as the retrieval path (`sources`, `delta`,
   * `suggestions`, `done`, `error`) plus the agent's own: `session`, `step`,
   * `thinking`, `tool_call`, `tool_result`, `retract`. A client that does not
   * understand the new ones ignores them and still renders a correct answer,
   * which is why the client was made tolerant in checkpoint 0.
   */
  async stream({ message, sessionId = null, productId = null, attachmentIds = [], ctx, signal = null, routeContext = null, transport = httpTransport }) {
    assertEnabled();
    if (!config.deepseekApiKey) throw Errors.internal("The assistant is not configured", "ai_unconfigured");
    if (!message || !message.trim()) throw Errors.badRequest("A question is required", "message_required");

    let productName = null;
    if (productId) {
      try {
        productName = productService.get(productId)?.name || null;
      } catch {
        productName = null;
      }
    }

    // Retrieval runs first and unconditionally, exactly as it does today. It
    // is in-process, about a millisecond, and it answers most questions
    // outright -- which is what keeps the common case as fast as it was
    // before tools existed. It is not a tool; it is a precondition.
    const retrievalQuery = productName ? `${productName} ${message}` : message;
    const { context, hits } = buildContext(retrievalQuery);

    const session = aiSessionService.resolve({
      sessionId,
      userId: ctx.userId,
      message,
      scope: { product_id: productId },
    });
    const history = await aiSessionService.loadHistory(session);

    // Files were uploaded before this message was sent, so by now they are on
    // disk and any PDF is already extracted. Claiming them for the session
    // here -- rather than at upload -- is what lets a visitor attach something
    // and then start a brand new conversation with it.
    const attached = aiAttachmentService.attachToSession(
      attachmentIds,
      session.persistent ? session.id : null,
      ctx.userId
    );
    const attachmentParts = await aiAttachmentService.buildParts(attached);

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const write = (chunk) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        const send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

        const revived = [];

        // The loop emits through this, so it never touches HTTP itself.
        const runCtx = {
          ...ctx,
          sessionId: session.id,
          signal,
          emit: send,
          // How a consequential tool turns into a card instead of an action.
          // Passed in rather than imported by the registry so the loop stays
          // free of both HTTP and persistence.
          proposeTool: ({ tool, args, preview }) => {
            const proposal = aiConfirmService.propose({
              sessionId: session.id,
              userId: ctx.userId,
              tool,
              args,
              preview,
            });
            send("confirm_required", proposal);
            return proposal;
          },
          // How `view_attachment` puts an image back in front of the model.
          // The tool cannot return one itself -- a tool result is text -- so
          // it queues the part here and the loop appends it as a user message
          // on the next pass.
          reviveAttachment: async (row) => {
            revived.push(...(await aiAttachmentService.buildParts([row])));
          },
          takeRevivedParts: () => revived.splice(0, revived.length),
          onToolResults: (turn, results) => {
            // Persisted as they happen rather than at the end: a visitor who
            // reloads mid-turn should still see what the agent already did.
            aiSessionService.appendToolExchange(session, {
              assistantContent: turn.content,
              toolCalls: turn.toolCalls.map((cc) => ({
                id: cc.id,
                type: "function",
                function: { name: cc.name, arguments: JSON.stringify(cc.args ?? {}) },
              })),
              results: results.map((r) => ({
                tool_call_id: r.tool_call_id,
                name: r.name,
                content: JSON.stringify(r.ok ? r.result : { error: r.error }),
              })),
            });
          },
        };

        try {
          if (session.persistent) {
            send("session", { id: session.id, created: session.created, title: session.row?.title ?? null });
          }
          send("sources", hits.map((h) => ({ kind: h.kind, slug: h.slug, name: h.name })));

          const run = await runAgent({
            message,
            context,
            history,
            productName,
            routeContext,
            ctx: runCtx,
            transport,
            signal,
            attachmentParts,
          });

          // `parseReply` runs over the FINAL turn only. A `SUGGEST:` marker
          // appearing in an intermediate thinking turn must not swallow the
          // answer that follows it.
          const { text, suggestions } = parseReply(run.text || "");
          send("suggestions", suggestions);
          send("done", { ok: true, steps: run.steps });

          await aiSessionService.appendTurn(session, {
            message,
            reply: text,
            sources: hits.map((h) => ({ kind: h.kind, slug: h.slug, name: h.name })),
            suggestions,
            attachments: attached.map((a) => ({
              id: a.id,
              kind: a.kind,
              mime: a.mime,
              filename: a.original_name || a.filename,
            })),
            usage: run.usage,
          });
          aiService.noteOutcome({ message, reply: text, hits, suggestions });
          aiService.log({
            userId: ctx.userId,
            sessionId: session.id,
            message,
            reply: text,
            sources: hits.map((h) => h.id),
            usage: run.usage,
          });
        } catch (err) {
          console.error(`[agent] run failed: ${err}`);
          send("error", {
            message:
              err?.name === "AbortError"
                ? "That took too long, so it was stopped."
                : "The assistant stopped unexpectedly",
          });
        } finally {
          clearInterval(heartbeat);
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by a cancel() that raced us */
          }
        }
      },
    });
  },
};
