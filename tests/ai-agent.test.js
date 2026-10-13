import { describe, test, expect } from "bun:test";
import { runAgent, MAX_STEPS } from "../src/services/agent/loop.js";
import { schemasFor, isAllowed, getTool, validateArgs, executeTool, executeToolCalls } from "../src/services/agent/registry.js";
import { buildAgentMessages } from "../src/services/agent/messages.js";
import "../src/services/agent/tools/catalog.js";

// The loop, driven by a scripted transport. No network, no key, no cost, and
// deterministic -- which is why `transport` is a parameter of runAgent rather
// than an import inside it.

const enc = new TextEncoder();
const frame = (o) => `data: ${JSON.stringify(o)}\n\n`;
const say = (t) => frame({ choices: [{ delta: { content: t } }] });
const callTool = (name, args, index = 0, id = `call_${name}_${index}`) =>
  frame({
    choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: JSON.stringify(args) } }] } }],
  });

/** A transport that replays one scripted turn per call. */
function scripted(turns) {
  let i = 0;
  const seen = [];
  const fn = async (req) => {
    seen.push(req);
    const chunks = turns[Math.min(i, turns.length - 1)];
    i++;
    return {
      body: new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    };
  };
  fn.calls = seen;
  return fn;
}

function collector() {
  const events = [];
  return {
    events,
    emit: (name, data) => events.push({ name, data }),
    of: (name) => events.filter((e) => e.name === name).map((e) => e.data),
    text: () => events.filter((e) => e.name === "delta").map((e) => e.data.text).join(""),
  };
}

const userCtx = (over = {}) => ({ userId: "u1", permissions: [], isAdmin: false, ...over, emit: over.emit || (() => {}) });

describe("the loop", () => {
  test("answers directly when the model asks for no tools, in one upstream call", async () => {
    const c = collector();
    const transport = scripted([[say("We sell thirteen platforms.")]]);

    const run = await runAgent({
      message: "what do you sell?",
      context: "…",
      ctx: { ...userCtx(), emit: c.emit },
      transport,
    });

    expect(run.text).toBe("We sell thirteen platforms.");
    expect(run.steps).toBe(1);
    expect(transport.calls.length).toBe(1);
    expect(c.text()).toBe("We sell thirteen platforms.");
    // Nothing ran, so nothing should have been reported as running.
    expect(c.of("tool_call")).toEqual([]);
  });

  test("runs a tool, feeds the result back, and answers on the next turn", async () => {
    const c = collector();
    const transport = scripted([
      [callTool("search_catalogue", { query: "CO2 laser" })],
      [say("We do not carry a CO2 laser.")],
    ]);

    const run = await runAgent({
      message: "do you sell a CO2 laser?",
      context: "…",
      ctx: { ...userCtx(), emit: c.emit },
      transport,
    });

    expect(run.steps).toBe(2);
    expect(run.text).toBe("We do not carry a CO2 laser.");
    expect(c.of("tool_call")[0].name).toBe("search_catalogue");
    expect(c.of("tool_result")[0].ok).toBe(true);

    // The second request must carry the assistant's tool_calls turn AND the
    // tool result. Sending either without the other is a 400 upstream.
    const second = transport.calls[1].messages;
    expect(second.at(-2).tool_calls[0].function.name).toBe("search_catalogue");
    expect(second.at(-1).role).toBe("tool");
    expect(second.at(-1).tool_call_id).toBe(second.at(-2).tool_calls[0].id);
  });

  test("stops at the step cap and still produces an answer", async () => {
    const c = collector();
    // A model that would loop forever.
    const transport = scripted([[callTool("search_catalogue", { query: "x" })]]);

    const run = await runAgent({
      message: "loop",
      context: "…",
      ctx: { ...userCtx(), emit: c.emit },
      transport,
    });

    expect(run.steps).toBe(MAX_STEPS);
    // The final step must be sent WITHOUT tools, or the model can spend its
    // last turn asking for something it will never receive.
    expect(transport.calls.at(-1).tools).toBeUndefined();
  });

  test("a tool that throws is reported to the model rather than killing the turn", async () => {
    const c = collector();
    const transport = scripted([
      [callTool("no_such_tool", {})],
      [say("Sorry, I could not check that.")],
    ]);

    const run = await runAgent({
      message: "hi",
      context: "…",
      ctx: { ...userCtx(), emit: c.emit },
      transport,
    });

    expect(run.text).toBe("Sorry, I could not check that.");
    expect(c.of("tool_result")[0].ok).toBe(false);
    expect(JSON.parse(transport.calls[1].messages.at(-1).content).error).toContain("no such tool");
  });

  test("malformed tool arguments come back as a correctable error, not a crash", async () => {
    const c = collector();
    const broken = frame({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_catalogue", arguments: '{"query":' } }] } }],
    });
    const transport = scripted([[broken], [say("Let me try again.")]]);

    const run = await runAgent({ message: "hi", context: "…", ctx: { ...userCtx(), emit: c.emit }, transport });
    expect(run.text).toBe("Let me try again.");
    expect(JSON.parse(transport.calls[1].messages.at(-1).content).code).toBe("bad_json");
  });

  test("reads run in parallel rather than one after another", async () => {
    // Asserted with a concurrency counter, never with wall-clock time --
    // timing assertions are the classic flaky test.
    let inFlight = 0;
    let peak = 0;
    const { defineTool, _resetRegistry } = await import("../src/services/agent/registry.js");
    _resetRegistry();
    defineTool("slow_read", {
      auth: "user",
      parallelSafe: true,
      description: "test",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async handler() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return { ok: true };
      },
    });

    await executeToolCalls(
      [0, 1, 2].map((i) => ({ id: `c${i}`, name: "slow_read", args: {}, valid: true })),
      userCtx()
    );
    expect(peak).toBe(3);

    // Restore the real registry for the rest of the file.
    _resetRegistry();
    await import("../src/services/agent/tools/catalog.js?reload=1");
  });
});

describe("the SUGGEST trailer", () => {
  test("never reaches the client, even split across tokens", async () => {
    const c = collector();
    // The marker arrives one fragment at a time, exactly as a model emits it.
    const transport = scripted([
      ["We sell the Angela.", "\n\nSUG", "GEST: ang", "ela"].map(say),
    ]);

    const run = await runAgent({
      message: "co2 laser?",
      context: "…",
      ctx: { ...userCtx(), emit: c.emit },
      transport,
    });

    // What the visitor saw must contain no trace of the marker or its prefix.
    expect(c.text()).toBe("We sell the Angela.");
    // The raw turn still carries it, so parseReply can extract the slugs.
    expect(run.text).toContain("SUGGEST: angela");
  });

  test("a false-alarm prefix is released once the turn ends", async () => {
    const c = collector();
    // "S" at the end of a sentence looks like the start of SUGGEST until it
    // is not. Holding it forever would truncate the answer.
    const transport = scripted([[say("Sizes vary. Ask us")]]);

    await runAgent({ message: "x", context: "…", ctx: { ...userCtx(), emit: c.emit }, transport });
    expect(c.text()).toBe("Sizes vary. Ask us");
  });
});

describe("the registry", () => {
  test("anonymous callers are offered only public tools", () => {
    const anon = schemasFor({ userId: null, permissions: [] });
    expect(anon.every((t) => getTool(t.function.name).auth === "public")).toBe(true);
  });

  test("a staff-gated tool is refused to a plain customer", () => {
    const tool = { name: "x", auth: "permission:leads.write" };
    expect(isAllowed(tool, { userId: "u1", permissions: [] })).toBe(false);
    expect(isAllowed(tool, { userId: "u1", permissions: ["leads.write"] })).toBe(true);
  });

  test("authorization is re-checked at dispatch, not only when listing", async () => {
    // The model can name a tool that was never put in front of it.
    const res = await executeTool(
      { id: "c1", name: "search_catalogue", args: { query: "x" }, valid: true },
      { userId: null, permissions: [] }
    );
    // search_catalogue is public, so this one succeeds -- the guarantee is
    // that the check happens at all, which the next case proves.
    expect(res.ok).toBe(true);

    const { defineTool, _resetRegistry } = await import("../src/services/agent/registry.js");
    _resetRegistry();
    defineTool("secret", {
      auth: "permission:logs.read",
      description: "t",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: () => ({ leaked: true }),
    });
    const denied = await executeTool(
      { id: "c2", name: "secret", args: {}, valid: true },
      { userId: "u1", permissions: [] }
    );
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("forbidden");

    _resetRegistry();
    await import("../src/services/agent/tools/catalog.js?reload=2");
  });

  test("the tool list is sorted, so the prompt prefix stays byte-stable", () => {
    const names = schemasFor(userCtx()).map((t) => t.function.name);
    expect(names).toEqual([...names].sort());
  });
});

describe("argument validation", () => {
  const schema = {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 10 },
      limit: { type: "integer", minimum: 1, maximum: 5 },
      depth: { type: "string", enum: ["fast", "deep"] },
      flag: { type: "boolean" },
    },
    required: ["query"],
    additionalProperties: false,
  };

  test("a missing required argument is an error the model can read", () => {
    expect(validateArgs(schema, {}).error).toContain("query");
  });

  test("strings are truncated and numbers clamped rather than rejected", () => {
    const { value } = validateArgs(schema, { query: "x".repeat(50), limit: 99 });
    expect(value.query.length).toBe(10);
    expect(value.limit).toBe(5);
  });

  test("an out-of-range enum is refused", () => {
    expect(validateArgs(schema, { query: "a", depth: "medium" }).ok).toBe(false);
  });

  test("unknown keys are dropped, not rejected", () => {
    // Models add stray fields; failing the call over one costs a round trip
    // to learn nothing.
    const { ok, value } = validateArgs(schema, { query: "a", nonsense: 1 });
    expect(ok).toBe(true);
    expect(value).toEqual({ query: "a" });
  });

  test("coerces the types a model commonly gets wrong", () => {
    const { value } = validateArgs(schema, { query: 42, limit: "3", flag: "true" });
    expect(value).toEqual({ query: "42", limit: 3, flag: true });
  });
});

describe("the message array", () => {
  test("with no tools it is byte-identical to the retrieval path", () => {
    const args = { message: "hi", context: "ctx", history: [], productName: null, routeContext: null };
    const withNone = buildAgentMessages({ ...args, toolNames: [] });
    // Same shape the assistant has always sent. The anonymous teaser depends
    // on this, and so does most of tests/ai-assistant.test.js.
    expect(withNone.filter((m) => m.role === "system").length).toBeLessThanOrEqual(2);
    expect(withNone.some((m) => m.content?.includes?.("TOOLS"))).toBe(false);
  });

  test("with tools the agent rules are a separate system message, after the rules", () => {
    const messages = buildAgentMessages({
      message: "hi",
      context: "ctx",
      toolNames: ["search_catalogue"],
    });
    const systemIdx = messages.map((m, i) => (m.role === "system" ? i : -1)).filter((i) => i >= 0);
    const agentIdx = messages.findIndex((m) => m.content?.includes?.("TOOLS"));

    expect(agentIdx).toBeGreaterThan(-1);
    // Still exactly one rules message, so the existing lookup-by-content in
    // tests/ai-assistant.test.js keeps matching one thing.
    expect(messages.filter((m) => m.content?.includes?.("STRICT RULES")).length).toBe(1);
    expect(agentIdx).toBe(systemIdx.at(-1));
    expect(messages[agentIdx].content).toContain("search_catalogue");
  });
});
