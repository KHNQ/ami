import { describe, test, expect } from "bun:test";
import { readFrames, createToolCallAccumulator, consumeTurn } from "../src/services/agent/stream.js";

// The accumulator is the part of the agent most likely to be subtly wrong and
// least likely to fail loudly: a clobbered tool name or a dropped argument
// fragment produces a plausible-looking call that does the wrong thing. These
// are pure functions, so they are tested exhaustively and without a network.

/** Builds a fake upstream response from a list of SSE frame bodies. */
function upstreamOf(chunks) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
  };
}
const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const textDelta = (t) => frame({ choices: [{ delta: { content: t } }] });
const toolDelta = (calls) => frame({ choices: [{ delta: { tool_calls: calls } }] });

describe("readFrames", () => {
  test("returns complete frames and keeps the partial remainder", () => {
    const { frames, rest } = readFrames('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(frames.map((f) => f.data)).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  test("ignores heartbeat comment frames", () => {
    // The heartbeat added in checkpoint 0 shares this stream. If it parsed as
    // an event the client would see phantom turns.
    const { frames } = readFrames(': ping\n\ndata: {"a":1}\n\n: ping\n\n');
    expect(frames.length).toBe(1);
  });

  test("concatenates multiple data lines in one frame", () => {
    const { frames } = readFrames('data: {"a":\ndata: 1}\n\n');
    expect(frames[0].data).toBe('{"a":1}');
  });
});

describe("the tool-call accumulator", () => {
  test("reassembles arguments split across many fragments", () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: "call_a", function: { name: "search_catalogue", arguments: "" } }]);
    for (const piece of ['{"qu', 'ery":"CO', "2 la", 'ser"', "}"]) {
      acc.push([{ index: 0, function: { arguments: piece } }]);
    }
    expect(acc.calls()).toEqual([
      { id: "call_a", name: "search_catalogue", args: { query: "CO2 laser" }, valid: true },
    ]);
  });

  test("keeps two interleaved calls separate by index", () => {
    // Providers do not guarantee that one call finishes before the next
    // starts; `index` is the only thing tying fragments together.
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: "a", function: { name: "one", arguments: '{"x":' } }]);
    acc.push([{ index: 1, id: "b", function: { name: "two", arguments: '{"y":' } }]);
    acc.push([{ index: 1, function: { arguments: "2}" } }]);
    acc.push([{ index: 0, function: { arguments: "1}" } }]);

    expect(acc.calls()).toEqual([
      { id: "a", name: "one", args: { x: 1 }, valid: true },
      { id: "b", name: "two", args: { y: 2 }, valid: true },
    ]);
  });

  test("a later fragment without id or name does not clobber the first one", () => {
    // The bug this guards: `slot.id = d.id` on every fragment overwrites a
    // good id with undefined, and the tool result can never be matched back
    // to its request.
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: "call_keep", function: { name: "keep_me", arguments: "{}" } }]);
    acc.push([{ index: 0, function: { arguments: "" } }]);
    acc.push([{ index: 0 }]);

    const [call] = acc.calls();
    expect(call.id).toBe("call_keep");
    expect(call.name).toBe("keep_me");
  });

  test("malformed arguments produce an invalid call rather than throwing", () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: "c", function: { name: "t", arguments: '{"broken": ' } }]);

    const [call] = acc.calls();
    expect(call.valid).toBe(false);
    expect(call.raw).toBe('{"broken":');
    // The caller feeds this back as the tool result so the model retries.
    expect(() => acc.calls()).not.toThrow();
  });

  test("arguments that parse to a non-object are normalised to {}", () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: "c", function: { name: "t", arguments: '"just a string"' } }]);
    expect(acc.calls()[0].args).toEqual({});
  });

  test("a call with no arguments at all is valid and empty", () => {
    const acc = createToolCallAccumulator();
    acc.push([{ index: 0, id: "c", function: { name: "get_my_profile" } }]);
    expect(acc.calls()[0]).toMatchObject({ args: {}, valid: true });
  });

  test("a missing index defaults to slot zero rather than dropping the fragment", () => {
    const acc = createToolCallAccumulator();
    acc.push([{ id: "c", function: { name: "t", arguments: '{"a":1}' } }]);
    expect(acc.calls()[0].args).toEqual({ a: 1 });
  });
});

describe("consumeTurn", () => {
  test("streams plain prose straight through, with no tool calls", async () => {
    const seen = [];
    const turn = await consumeTurn(
      upstreamOf([textDelta("We sell "), textDelta("thirteen platforms."), "data: [DONE]\n\n"]),
      { onDelta: (t) => seen.push(t) }
    );
    expect(seen.join("")).toBe("We sell thirteen platforms.");
    expect(turn.toolCalls).toEqual([]);
    expect(turn.content).toBe("We sell thirteen platforms.");
  });

  test("survives a frame split across two network chunks", async () => {
    // The single most common real-world failure: a chunk boundary lands in
    // the middle of a JSON payload.
    const whole = textDelta("hello");
    const turn = await consumeTurn(upstreamOf([whole.slice(0, 12), whole.slice(12)]), {});
    expect(turn.content).toBe("hello");
  });

  test("routes content to thinking once the turn reveals a tool call", async () => {
    const visible = [];
    const thinking = [];
    const turn = await consumeTurn(
      upstreamOf([
        toolDelta([{ index: 0, id: "c1", function: { name: "search_catalogue", arguments: "{}" } }]),
        textDelta("Let me check that."),
        "data: [DONE]\n\n",
      ]),
      { onDelta: (t) => visible.push(t), onThinking: (t) => thinking.push(t) }
    );

    expect(visible).toEqual([]);
    expect(thinking.join("")).toBe("Let me check that.");
    expect(turn.toolCalls[0].name).toBe("search_catalogue");
  });

  test("retracts prose already shown when a tool call arrives afterwards", async () => {
    // Rare, but if it happens without a retract the visitor is left with an
    // orphan sentence sitting above the real answer.
    let retracted = 0;
    const turn = await consumeTurn(
      upstreamOf([
        textDelta("Sure!"),
        toolDelta([{ index: 0, id: "c1", function: { name: "t", arguments: "{}" } }]),
        "data: [DONE]\n\n",
      ]),
      { onDelta: () => {}, onRetract: (n) => (retracted = n) }
    );
    expect(retracted).toBe(5);
    expect(turn.retracted).toBe(true);
  });

  test("detects tool calls even when finish_reason says 'stop'", async () => {
    // Several OpenAI-compatible providers do exactly this.
    const turn = await consumeTurn(
      upstreamOf([
        toolDelta([{ index: 0, id: "c1", function: { name: "t", arguments: "{}" } }]),
        frame({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]),
      {}
    );
    expect(turn.finishReason).toBe("stop");
    expect(turn.toolCalls.length).toBe(1);
  });

  test("captures usage when the provider reports it", async () => {
    const turn = await consumeTurn(
      upstreamOf([textDelta("hi"), frame({ choices: [], usage: { total_tokens: 42 } }), "data: [DONE]\n\n"]),
      {}
    );
    expect(turn.usage.total_tokens).toBe(42);
  });

  test("ignores unparseable frames instead of aborting the turn", async () => {
    const turn = await consumeTurn(
      upstreamOf(["data: {not json}\n\n", textDelta("still here"), "data: [DONE]\n\n"]),
      {}
    );
    expect(turn.content).toBe("still here");
  });
});
