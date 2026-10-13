import { config } from "../../config.js";
import { consumeTurn, visibleLength } from "./stream.js";
import { schemasFor, executeToolCalls, toToolMessage, getTool } from "./registry.js";
import { buildAgentMessages, toAssistantToolMessage } from "./messages.js";

// The multi-step runner.
//
// model → tool calls → results → model → … → answer, capped. Everything it
// emits goes through `ctx.emit(event, data)`, which the route turns into SSE
// frames; the loop itself knows nothing about HTTP.
//
// `transport` is a parameter, not an import. That is the single most useful
// decision in this file: a test can hand it a function returning scripted SSE
// frames and drive the entire loop deterministically, offline and for free.

export const MAX_STEPS = Number(process.env.AI_AGENT_MAX_STEPS || 5);
export const AGENT_TIMEOUT_MS = Number(process.env.AI_AGENT_TIMEOUT_MS || 60_000);

/**
 * Runs one visitor turn to completion.
 *
 * Returns `{ text, steps, toolResults, usage }`. Prose reaches the client as
 * it streams, via `emit("delta")`; the return value is for persistence and
 * for the caller's own bookkeeping.
 */
export async function runAgent({
  message,
  context,
  history = [],
  productName = null,
  routeContext = null,
  ctx,
  transport,
  signal = null,
  attachmentParts = [],
}) {
  const tools = schemasFor(ctx);
  const toolNames = tools.map((t) => t.function.name);

  const messages = buildAgentMessages({
    message,
    context,
    history,
    productName,
    routeContext,
    toolNames,
    attachmentParts,
  });

  // One controller for the whole run: the caller's abort (visitor navigated
  // away) and our own wall clock both land here, so a runaway loop cannot
  // outlive the request that started it.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort);
  const deadline = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  const collectedResults = [];
  let text = "";
  let usage = null;

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      // The last step is forced to answer. Without this the loop can spend
      // its final iteration requesting tools it will never get results for,
      // and the visitor gets silence.
      const isFinal = step === MAX_STEPS;
      const stepTools = isFinal || !tools.length ? undefined : tools;

      if (tools.length) ctx.emit("step", { n: step, of: MAX_STEPS, final: isFinal });

      const upstream = await transport({
        messages,
        tools: stepTools,
        toolChoice: stepTools ? "auto" : undefined,
        signal: controller.signal,
      });

      // Prose is buffered just far enough to withhold a `SUGGEST:` trailer
      // (and any partial prefix of one) rather than emitted verbatim --
      // otherwise the marker flashes on screen before parseReply strips it.
      let shown = "";
      let sent = 0;
      const flush = ({ final = false } = {}) => {
        const safe = visibleLength(shown, { final });
        if (safe > sent) {
          ctx.emit("delta", { text: shown.slice(sent, safe) });
          sent = safe;
        }
      };

      const turn = await consumeTurn(upstream, {
        onDelta: (t) => {
          shown += t;
          flush();
        },
        onThinking: (t) => ctx.emit("thinking", { text: t }),
        // Prose already shown turned out to belong to a tool-calling turn.
        // The client trims that many characters and re-renders them in the
        // timeline instead.
        onRetract: (chars) => {
          // Only what actually reached the client is retractable; the tail
          // held back by the SUGGEST guard was never shown.
          const visible = Math.min(chars, sent);
          shown = "";
          sent = 0;
          if (visible > 0) ctx.emit("retract", { chars: visible });
        },
        onUsage: (u) => (usage = u),
      });
      if (turn.usage) usage = turn.usage;

      if (!turn.toolCalls.length) {
        // End of the answering turn: whatever the SUGGEST guard was holding
        // back is either the real marker (which stays withheld and is
        // stripped by parseReply) or a false alarm that belongs on screen.
        flush({ final: true });
        text = turn.content;
        return { text, steps: step, toolResults: collectedResults, usage };
      }

      messages.push(toAssistantToolMessage(turn));

      for (const call of turn.toolCalls) {
        ctx.emit("tool_call", {
          id: call.id,
          name: call.name,
          args: redactArgs(call.args),
          consequential: Boolean(getTool(call.name)?.consequential),
        });
      }

      const results = await executeToolCalls(turn.toolCalls, ctx);
      for (const r of results) {
        collectedResults.push(r);
        ctx.emit("tool_result", {
          id: r.tool_call_id,
          name: r.name,
          ok: r.ok,
          error: r.ok ? undefined : r.error,
          summary: r.ok ? summarise(r) : undefined,
          duration_ms: r.durationMs,
        });
        messages.push(toToolMessage(r));
      }

      ctx.onToolResults?.(turn, results);

      // A tool may have pulled an earlier file back into view. It re-enters as
      // a user message rather than as the tool's result, because tool content
      // is text by definition and an image cannot be expressed in it.
      const revived = ctx.takeRevivedParts?.();
      if (revived?.length) messages.push({ role: "user", content: revived });

      // A proposal ends the run. The model takes one more turn WITHOUT tools
      // so it can say what will happen, and then stops -- leaving the decision
      // with the visitor rather than narrating past it.
      const awaiting = results.filter((r) => r.awaitingConfirmation);
      if (awaiting.length) {
        const closing = await transport({
          messages,
          tools: undefined,
          toolChoice: undefined,
          signal: controller.signal,
        });

        let shown = "";
        let sent = 0;
        const closingFlush = ({ final = false } = {}) => {
          const safe = visibleLength(shown, { final });
          if (safe > sent) {
            ctx.emit("delta", { text: shown.slice(sent, safe) });
            sent = safe;
          }
        };
        const closingTurn = await consumeTurn(closing, {
          onDelta: (t) => {
            shown += t;
            closingFlush();
          },
        });
        closingFlush({ final: true });

        return {
          text: closingTurn.content,
          steps: step,
          toolResults: collectedResults,
          usage,
          awaiting: awaiting.map((r) => r.proposalId),
        };
      }
    }

    // Falling out of the loop means MAX_STEPS turns each asked for tools --
    // impossible while the final step forces `tool_choice` off, but if the
    // provider ignores that, an empty answer is still better than a hang.
    return { text, steps: MAX_STEPS, toolResults: collectedResults, usage };
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/**
 * A one-line description of what a tool returned, for the timeline.
 *
 * Comes from the tool's own `summarise`, because only the tool knows which
 * field of its result is the interesting one. Anything that throws falls back
 * to silence rather than taking the turn down over a status line.
 */
function summarise(result) {
  const tool = getTool(result.name);
  if (!tool?.summarise) return undefined;
  try {
    return tool.summarise(result.result, result.args);
  } catch {
    return undefined;
  }
}

/**
 * Arguments, safe to put on the wire.
 *
 * The timeline shows the visitor what the agent is doing, and "doing" includes
 * the arguments. Long strings are truncated so a pasted paragraph does not
 * become a wall of text in a status row.
 */
function redactArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v === "string") out[k] = v.length > 120 ? `${v.slice(0, 117)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 6);
  }
  return out;
}

/**
 * The default transport: a real streamed call to the configured endpoint.
 *
 * Mirrors `callModel` in aiService.js rather than importing it, because that
 * one does not take `tools` and adding a parameter there would change the
 * signature the retrieval path depends on.
 */
export async function httpTransport({ messages, tools, toolChoice, signal }) {
  const body = {
    model: config.deepseekModel,
    messages,
    stream: true,
    max_tokens: config.aiMaxTokens,
    temperature: 0.3,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || "auto";
  }

  const res = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error(`[agent] upstream ${res.status}: ${detail.slice(0, 500)}`);
    const err = new Error("The assistant is temporarily unavailable");
    err.code = "ai_upstream_error";
    throw err;
  }
  return res;
}
