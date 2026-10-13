// Reading one streamed turn from an OpenAI-compatible endpoint.
//
// Split out of aiService.streamAsk so the retrieval path and the agent path
// share exactly one SSE parser. The new part is `tool_calls`, which arrive
// fragmented in a way that is easy to get subtly wrong -- see the accumulator
// below for the four separate ways a naive implementation loses data.

/**
 * Splits a raw buffer into complete SSE frames.
 *
 * Returns the frames it could parse and whatever remains, because a network
 * chunk routinely cuts a frame in half. The caller keeps `rest` and prepends
 * it to the next read.
 *
 * Comment frames (`: ping`) carry no `data:` line and fall out naturally --
 * which is what lets the heartbeat coexist with this parser.
 */
export function readFrames(buffer) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  const frames = [];

  for (const raw of parts) {
    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      // Multiple `data:` lines in one frame concatenate. Providers we talk to
      // send one, but the spec allows several and joining is free.
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) frames.push({ event, data });
  }
  return { frames, rest };
}

/**
 * Reassembles `tool_calls` from streamed deltas.
 *
 * A fragment looks like:
 *   {"index":0,"id":"call_a","type":"function",
 *    "function":{"name":"search_catalogue","arguments":""}}
 *   {"index":0,"function":{"arguments":"{\"que"}}
 *   {"index":0,"function":{"arguments":"ry\":\"laser\"}"}}
 *
 * Four rules, each of which is a real bug if missed:
 *
 *  1. `index` is a SLOT, not arrival order. Two calls in one turn interleave
 *     their fragments, so accumulate into a sparse array keyed by index.
 *  2. `id` and `function.name` appear only on the FIRST fragment for a slot.
 *     `acc[i].id = d.id` clobbers it with undefined on fragment two -- assign
 *     only when the field is actually present and non-empty.
 *  3. `function.arguments` is a string fragment, concatenated and parsed once
 *     at the end. Parsing per fragment would fail on every partial object.
 *  4. Never depend on `finish_reason === "tool_calls"`. Several
 *     OpenAI-compatible providers send "stop" even when they requested tools.
 *     Whether tools were called is `calls().length > 0`, nothing else.
 */
export function createToolCallAccumulator() {
  const slots = [];

  return {
    push(deltas) {
      if (!Array.isArray(deltas)) return;
      for (const d of deltas) {
        const i = Number.isInteger(d?.index) ? d.index : 0;
        const slot = (slots[i] ??= { id: "", name: "", args: "" });

        if (d.id) slot.id = d.id;
        if (d.function?.name) slot.name = d.function.name;
        // `?? ""` and not `|| ""`: an empty-string fragment is legitimate and
        // appending it is harmless, but `undefined` would append "undefined".
        if (typeof d.function?.arguments === "string") slot.args += d.function.arguments;
      }
    },

    /** True as soon as any fragment has arrived, before arguments complete. */
    get started() {
      return slots.length > 0;
    },

    /**
     * The finished calls.
     *
     * A slot whose arguments will not parse is returned with `valid: false`
     * rather than thrown away or thrown on. The caller feeds the error back
     * as that call's result and the model corrects itself on the next step,
     * which is a far better outcome than a 500 in the visitor's face.
     */
    calls() {
      return slots.filter(Boolean).map((slot, i) => {
        const raw = slot.args.trim();
        if (!raw) return { id: slot.id || `call_${i}`, name: slot.name, args: {}, valid: true };
        try {
          const parsed = JSON.parse(raw);
          return {
            id: slot.id || `call_${i}`,
            name: slot.name,
            args: parsed && typeof parsed === "object" ? parsed : {},
            valid: true,
          };
        } catch {
          return {
            id: slot.id || `call_${i}`,
            name: slot.name,
            args: {},
            valid: false,
            raw,
          };
        }
      });
    },
  };
}

/**
 * Consumes one streamed completion.
 *
 * Text routing is optimistic: content is emitted as visible prose until the
 * turn reveals itself to be a tool-calling turn, at which point the caller is
 * told (via `onRetract`) how much to take back and everything after is
 * `onThinking`. Holding all content until the turn ends would be simpler, but
 * it would destroy time-to-first-token on the common no-tool case -- which is
 * most requests, and the one users feel.
 *
 * In practice models emit tool calls with empty content and `onRetract` never
 * fires. It exists for the turn where that is not true.
 */
export async function consumeTurn(upstream, { onDelta, onThinking, onRetract, onUsage } = {}) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const acc = createToolCallAccumulator();

  let buffer = "";
  let content = "";
  let emitted = 0; // characters already sent as visible prose
  let toolTurn = false;
  let finishReason = null;
  let usage = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { frames, rest } = readFrames(buffer);
      buffer = rest;

      for (const { data } of frames) {
        if (data === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed.usage) usage = parsed.usage;
        const choice = parsed?.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const toolDeltas = choice.delta?.tool_calls;
        if (toolDeltas) {
          // The moment this turn is known to be a tool turn. Anything already
          // shown as an answer has to be taken back, or it lands above the
          // real answer as an orphaned sentence.
          if (!toolTurn) {
            toolTurn = true;
            if (emitted > 0) onRetract?.(emitted);
          }
          acc.push(toolDeltas);
        }

        const text = choice.delta?.content;
        if (typeof text === "string" && text) {
          content += text;
          if (toolTurn) {
            onThinking?.(text);
          } else {
            onDelta?.(text);
            emitted += text.length;
          }
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  return { content, toolCalls: acc.calls(), finishReason, usage, retracted: toolTurn && emitted > 0 };
}

/**
 * How much of a partial reply is safe to show.
 *
 * The model ends an answer with a `SUGGEST: slug-one, slug-two` trailer that
 * is bookkeeping for the client, not prose. Streaming it verbatim flashes it
 * on screen before it can be stripped -- and worse, the tail may still be
 * arriving one token at a time, so anything that could be a PREFIX of the
 * marker has to be held back too.
 *
 * Lifted from the same logic in aiService.streamAsk so both paths agree; a
 * divergence here shows up as a marker leaking into one path only, which is
 * exactly what happened when the agent first shipped without it.
 */
export function visibleLength(s, { final = false } = {}) {
  const idx = s.search(/\n?\s*SUGGEST:/i);
  if (idx !== -1) return idx;
  // Once the turn is over there is nothing left to arrive, so a lone
  // trailing "s" is just a word ending in s -- not the start of a marker.
  // Without this the guard never releases it and every answer ending in
  // "...ask us" silently loses its last character.
  if (final) return s.length;
  const tail = /\n?\s*S(U(G(G(E(S(T(:)?)?)?)?)?)?)?$/i.exec(s);
  return tail ? tail.index : s.length;
}
