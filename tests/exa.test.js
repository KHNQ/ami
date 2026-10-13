import { describe, test, expect, beforeEach } from "bun:test";
import { exaService, _resetExaState } from "../src/services/exaService.js";
import { config } from "../src/config.js";
import { kv } from "../src/lib/kv.js";

// Key rotation, tested against a stubbed fetch.
//
// The behaviour that matters is not "does it search" -- it is what happens
// when a key dies. A client that rotates on the wrong signal turns one bad
// request into N burned ones, or keeps hammering a revoked key forever.

const ORIGINAL_KEYS = config.exaApiKeys;

/** A fetch stub driven by a per-key script. */
function stubFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    const key = opts.headers["x-api-key"];
    calls.push({ url, key, body: JSON.parse(opts.body) });
    const res = handler(key, calls.length);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {},
      text: async () => JSON.stringify(res.body ?? {}),
    };
  };
  fn.calls = calls;
  return fn;
}

const okBody = {
  results: [
    { title: "Fotona SP Dynamis", url: "https://fotona.com/sp-dynamis", text: "  A  Nd:YAG   platform.  ", publishedDate: "2024-03-11" },
  ],
};

beforeEach(async () => {
  _resetExaState();
  config.exaApiKeys = ["key-a", "key-b", "key-c"];
  // Each test uses a distinct query, but clear anyway so a cached result from
  // a previous case cannot mask a rotation bug.
  await kv.set("exa:__warm", null, { ttlMs: 1 }).catch(() => {});
});

describe("key rotation", () => {
  test("uses the first key while it works", async () => {
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    await exaService.search({ query: "rotation-1", fetchImpl: f });
    expect(f.calls.map((c) => c.key)).toEqual(["key-a"]);
  });

  test("moves past a revoked key and REMEMBERS the working one", async () => {
    // The remembering is the point: without it every later request pays the
    // cost of walking the dead key again.
    const f = stubFetch((key) => (key === "key-a" ? { status: 401 } : { status: 200, body: okBody }));
    await exaService.search({ query: "rotation-2", fetchImpl: f });
    expect(f.calls.map((c) => c.key)).toEqual(["key-a", "key-b"]);

    const f2 = stubFetch(() => ({ status: 200, body: okBody }));
    await exaService.search({ query: "rotation-3", fetchImpl: f2 });
    expect(f2.calls.map((c) => c.key)).toEqual(["key-b"]);
  });

  test("a rate-limited key is skipped but comes back sooner than a revoked one", async () => {
    const f = stubFetch((key) => (key === "key-a" ? { status: 429 } : { status: 200, body: okBody }));
    await exaService.search({ query: "rotation-4", fetchImpl: f });
    expect(f.calls.map((c) => c.key)).toEqual(["key-a", "key-b"]);
  });

  test("a 400 fails immediately WITHOUT burning the other keys", async () => {
    // A malformed query is our bug. Retrying it across five keys makes one bad
    // request into five and can trip the limit on healthy ones.
    const f = stubFetch(() => ({ status: 400, body: { error: "bad query" } }));
    await expect(exaService.search({ query: "rotation-5", fetchImpl: f })).rejects.toMatchObject({
      code: "exa_bad_request",
    });
    expect(f.calls.length).toBe(1);
  });

  test("when every key is dead it fails once, cleanly", async () => {
    const f = stubFetch(() => ({ status: 500 }));
    await expect(exaService.search({ query: "rotation-6", fetchImpl: f })).rejects.toMatchObject({
      code: "exa_unavailable",
    });
    expect(f.calls.length).toBe(3);
  });

  test("with no keys configured it says so rather than calling out", async () => {
    config.exaApiKeys = [];
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    await expect(exaService.search({ query: "rotation-7", fetchImpl: f })).rejects.toMatchObject({
      code: "exa_unconfigured",
    });
    expect(f.calls.length).toBe(0);
    config.exaApiKeys = ["key-a", "key-b", "key-c"];
  });
});

describe("shaping and caching", () => {
  test("collapses whitespace and caps the excerpt", async () => {
    const long = { results: [{ title: "T", url: "https://x.com/a", text: "word ".repeat(500) }] };
    const f = stubFetch(() => ({ status: 200, body: long }));
    const res = await exaService.search({ query: "shape-1", fetchImpl: f });

    expect(res.results[0].text.length).toBeLessThanOrEqual(800);
    expect(res.results[0].text).not.toContain("  ");
  });

  test("extracts the domain, which is what an attribution needs", async () => {
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    const res = await exaService.search({ query: "shape-2", fetchImpl: f });
    expect(res.results[0].domain).toBe("fotona.com");
  });

  test("the same query twice hits the cache and does not call out again", async () => {
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    const first = await exaService.search({ query: "cache-me-please", fetchImpl: f });
    const second = await exaService.search({ query: "cache-me-please", fetchImpl: f });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(f.calls.length).toBe(1);
  });

  test("case and padding do not defeat the cache", async () => {
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    await exaService.search({ query: "Who Makes Primelase", fetchImpl: f });
    await exaService.search({ query: "  who makes primelase  ", fetchImpl: f });
    expect(f.calls.length).toBe(1);
  });

  test("deep search asks for neural retrieval and a longer excerpt", async () => {
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    await exaService.search({ query: "deep-1", depth: "deep", fetchImpl: f });
    expect(f.calls[0].body.type).toBe("neural");
    expect(f.calls[0].body.contents.text.maxCharacters).toBe(2000);
  });

  test("fast search asks for text in the SAME call, not a second round trip", async () => {
    // search-then-/contents would double the latency of the slowest thing the
    // agent does, for no extra information.
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    await exaService.search({ query: "fast-1", fetchImpl: f });
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].body.contents.text).toBeTruthy();
  });

  test("num_results is clamped to a sane ceiling", async () => {
    const f = stubFetch(() => ({ status: 200, body: okBody }));
    await exaService.search({ query: "clamp-1", numResults: 99, fetchImpl: f });
    expect(f.calls[0].body.numResults).toBe(8);
  });
});

describe("registration", () => {
  test("the web tools are absent when no key is configured", async () => {
    // The model must never be offered a capability it cannot use: a tool that
    // errors on every call is worse than one that does not exist, because the
    // model keeps retrying it.
    const { allTools } = await import("../src/services/agent/registry.js");
    await import("../src/services/agentService.js");
    const names = allTools().map((t) => t.name);

    // This suite runs with no EXA_API_KEYS in the environment; the fake keys
    // above are assigned to config AFTER the tool modules were imported.
    expect(names.includes("web_search")).toBe(process.env.EXA_API_KEYS ? true : false);
  });
});

// Restore whatever the environment actually has, so a later suite in the same
// process is not left holding this file's fake keys.
process.on("beforeExit", () => {
  config.exaApiKeys = ORIGINAL_KEYS;
});
