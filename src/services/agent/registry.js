import { Errors } from "../../lib/errors.js";

// The tool registry.
//
// One declarative map is the whole design. Every tool states what it does, what
// it takes, who may call it, and whether it is safe to run without asking --
// and the loop reads those flags rather than special-casing anything.
//
// Two invariants hold across every tool, and they are the reason a model can be
// handed a `node_id` at all:
//
//  1. **No handler accepts an identity from the model.** Not a user id, not an
//     "act as", not an owner. Whose data this is comes from `ctx.userId`, which
//     is built in the route from the request's own token.
//
//  2. **Handlers call SERVICES, never `db.*` repos.** The repos have no
//     authorization; the services do. `nodeService.earnings` runs
//     `assertOwnerOrAdmin`, `spaceService.getTree` runs
//     `assertParticipantOrAdmin`. Passing a node id the model guessed is safe
//     precisely because those assertions throw for someone else's node. Reading
//     the repo directly would bypass the only check there is.

const registry = new Map();

/** Registers a tool. Called once per module at import time. */
export function defineTool(name, spec) {
  if (registry.has(name)) throw new Error(`duplicate tool: ${name}`);
  registry.set(name, {
    name,
    auth: "user",
    consequential: false,
    parallelSafe: true,
    timeoutMs: 8000,
    ...spec,
  });
}

export function getTool(name) {
  return registry.get(name) || null;
}

export function allTools() {
  return [...registry.values()];
}

/** Test seam: lets a suite start from an empty registry. */
export function _resetRegistry() {
  registry.clear();
}

/**
 * May this caller use this tool?
 *
 * `public` is available to anyone including anonymous visitors; `user` needs an
 * account; `permission:x` needs a staff permission. Checked twice on purpose --
 * once to build the list the model is shown, and again at dispatch, because a
 * model can name a tool that was never offered to it.
 */
export function isAllowed(tool, ctx) {
  if (!tool) return false;
  if (tool.auth === "public") return true;
  if (!ctx?.userId) return false;
  if (tool.auth === "user") return true;
  if (tool.auth.startsWith("permission:")) {
    return Boolean(ctx.permissions?.includes(tool.auth.slice("permission:".length)));
  }
  return false;
}

/**
 * The `tools` array for the upstream request.
 *
 * Sorted by name so the array is byte-identical for every caller of the same
 * identity class. Some providers key their prompt cache on it, and an array
 * whose order wobbles per request silently forfeits that.
 */
export function schemasFor(ctx) {
  return allTools()
    .filter((t) => isAllowed(t, ctx))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

/* --- argument validation ------------------------------------------------ */

/**
 * A small JSON-schema subset: types, `required`, `enum`, string length, number
 * bounds, and `additionalProperties: false` stripping.
 *
 * Hand-rolled rather than ajv because this repo ships exactly one production
 * dependency and a validator for eleven keywords is not worth becoming the
 * second. Returns `{ ok, value, error }` -- never throws, because a validation
 * failure is fed back to the model as the tool's result so it can correct
 * itself, not raised at the visitor as a 400.
 */
export function validateArgs(schema, args) {
  if (!schema || schema.type !== "object") return { ok: true, value: args ?? {} };
  const props = schema.properties || {};
  const input = args && typeof args === "object" ? args : {};
  const out = {};

  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      return { ok: false, error: `missing required argument "${key}"` };
    }
  }

  for (const [key, raw] of Object.entries(input)) {
    const spec = props[key];
    // Unknown keys are dropped, not rejected: models add stray fields, and
    // failing the call over one costs a whole round trip to learn nothing.
    if (!spec) continue;
    if (raw === undefined || raw === null) continue;

    let value = raw;

    if (spec.type === "string") {
      if (typeof value !== "string") value = String(value);
      if (spec.maxLength) value = value.slice(0, spec.maxLength);
      if (spec.enum && !spec.enum.includes(value)) {
        return { ok: false, error: `"${key}" must be one of: ${spec.enum.join(", ")}` };
      }
    } else if (spec.type === "number" || spec.type === "integer") {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `"${key}" must be a number` };
      value = spec.type === "integer" ? Math.trunc(n) : n;
      if (spec.minimum !== undefined && value < spec.minimum) value = spec.minimum;
      if (spec.maximum !== undefined && value > spec.maximum) value = spec.maximum;
    } else if (spec.type === "boolean") {
      value = value === true || value === "true";
    } else if (spec.type === "array") {
      if (!Array.isArray(value)) value = [value];
      if (spec.maxItems) value = value.slice(0, spec.maxItems);
      if (spec.items?.type === "string") value = value.map((v) => String(v));
    }

    out[key] = value;
  }

  return { ok: true, value: out };
}

/**
 * Runs one tool call.
 *
 * Every failure mode returns a RESULT rather than throwing: an unknown tool, a
 * refused one, bad arguments, a timeout, or an error inside the handler all
 * come back as `{ error: ... }` for the model to read. The alternative — an
 * exception unwinding the stream — turns a recoverable mistake into a dead
 * conversation.
 */
export async function executeTool(call, ctx) {
  const started = Date.now();
  const tool = getTool(call.name);

  const fail = (error, code) => ({
    tool_call_id: call.id,
    name: call.name,
    ok: false,
    error,
    code,
    durationMs: Date.now() - started,
  });

  if (!tool) return fail(`no such tool: ${call.name}`, "unknown_tool");
  // Re-checked at dispatch, not just when building the list: the model can
  // name a tool it was never offered.
  if (!isAllowed(tool, ctx)) {
    return fail(
      ctx?.userId
        ? "you do not have permission to use this tool"
        : "this action needs the visitor to be signed in",
      "forbidden"
    );
  }
  if (!call.valid) {
    return fail("the arguments were not valid JSON; call the tool again with valid JSON", "bad_json");
  }

  const validated = validateArgs(tool.parameters, call.args);
  if (!validated.ok) return fail(validated.error, "bad_arguments");

  // A consequential tool does NOT run here. It is previewed, recorded as a
  // proposal, and handed to the visitor to approve -- the handler runs later,
  // from POST /ai/confirm, on a request with its own freshly-checked auth.
  // Nothing that debits a wallet should be reachable by a model deciding on
  // its own that the sentence warranted it.
  if (tool.consequential && !ctx.executingProposal) {
    if (!ctx.proposeTool) {
      return fail("this action cannot be completed here", "no_proposal_channel");
    }
    let preview;
    try {
      preview = await tool.preview(validated.value, ctx);
    } catch (err) {
      const isAppError = err && typeof err === "object" && "code" in err;
      return fail(isAppError ? err.message : "could not prepare that action", isAppError ? err.code : "preview_failed");
    }
    if (!preview?.ok) {
      // A refused preview is an ordinary tool result: the model explains why
      // rather than the visitor seeing a card they cannot use.
      return fail(preview?.error || "that action is not possible right now", "not_possible");
    }

    const proposal = await ctx.proposeTool({ tool, args: validated.value, preview });
    return {
      tool_call_id: call.id,
      name: call.name,
      ok: true,
      args: validated.value,
      durationMs: Date.now() - started,
      awaitingConfirmation: true,
      proposalId: proposal.id,
      result: {
        status: "awaiting_confirmation",
        shown_to_visitor: preview.title,
        note: "A confirmation card is now in front of the visitor. Describe what will happen if they approve it. Do NOT say it is done, and do not call this tool again.",
      },
    };
  }

  try {
    // A tool that hangs must not hang the turn. Losing one result and
    // answering without it beats a stream that never closes.
    const result = await withTimeout(
      Promise.resolve(tool.handler(validated.value, ctx)),
      tool.timeoutMs,
      call.name
    );
    return {
      tool_call_id: call.id,
      name: call.name,
      ok: true,
      result,
      args: validated.value,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    // AppErrors carry a message written for a human and are safe to pass on;
    // anything else could be an internal detail, so it is logged and replaced.
    const isAppError = err && typeof err === "object" && "status" in err && "code" in err;
    if (!isAppError) console.error(`[agent] tool ${call.name} failed:`, err);
    return fail(
      isAppError ? err.message : "that step failed unexpectedly",
      isAppError ? err.code : "tool_failed"
    );
  }
}

function withTimeout(promise, ms, label) {
  if (!ms) return promise;
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Errors.internal(`${label} timed out`, "tool_timeout")),
        ms
      );
    }),
  ]);
}

/**
 * Runs a turn's worth of calls.
 *
 * Reads go in parallel; writes go one at a time in the order the model asked
 * for them. Two `createQuote`s racing would contend on reference generation,
 * and the visitor's own sense of order ("book it, then tell me the price")
 * is part of the result.
 */
export async function executeToolCalls(calls, ctx) {
  const parallel = [];
  const serial = [];
  for (const call of calls) {
    const tool = getTool(call.name);
    (tool?.parallelSafe && !tool?.consequential ? parallel : serial).push(call);
  }

  const results = await Promise.all(parallel.map((c) => executeTool(c, ctx)));
  for (const call of serial) results.push(await executeTool(call, ctx));

  // Restored to the order the model requested, so the tool results line up
  // with the tool_calls array it sent.
  const byId = new Map(results.map((r) => [r.tool_call_id, r]));
  return calls.map((c) => byId.get(c.id)).filter(Boolean);
}

/** The `{role:"tool"}` message a result becomes in the next request. */
export function toToolMessage(result) {
  const payload = result.ok
    ? result.result
    : { error: result.error, ...(result.code ? { code: result.code } : null) };
  return {
    role: "tool",
    tool_call_id: result.tool_call_id,
    content: typeof payload === "string" ? payload : JSON.stringify(payload ?? null),
  };
}
