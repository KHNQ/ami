import { describe, test, expect } from "bun:test";
import { createKv } from "../src/lib/kv.js";

// These run against the memory driver, which is what this deployment
// actually uses (see the note in src/lib/kv.js about Bun 1.1.0 having no
// built-in Redis client). The contract asserted here is the one the Redis
// driver has to match, so it doubles as that driver's specification.
function freshKv() {
  return createKv({ url: null });
}

describe("kv -- basic value semantics", () => {
  test("round-trips values and distinguishes missing from falsy", async () => {
    const kv = freshKv();
    expect(await kv.get("nope")).toBe(null);

    await kv.set("a", { hello: "world" });
    expect(await kv.get("a")).toEqual({ hello: "world" });

    // A stored `false` or `0` must not read back as "missing" -- callers
    // branch on null, and conflating the two silently loses data.
    await kv.set("b", false);
    expect(await kv.get("b")).toBe(false);
    await kv.set("c", 0);
    expect(await kv.get("c")).toBe(0);

    await kv.del("a");
    expect(await kv.get("a")).toBe(null);
    await kv.close();
  });

  test("entries expire after their ttl", async () => {
    const kv = freshKv();
    await kv.set("short", "value", { ttlMs: 30 });
    expect(await kv.get("short")).toBe("value");
    await new Promise((r) => setTimeout(r, 45));
    expect(await kv.get("short")).toBe(null);
    await kv.close();
  });

  test("a value with no ttl persists", async () => {
    const kv = freshKv();
    await kv.set("forever", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await kv.get("forever")).toBe(1);
    await kv.close();
  });
});

describe("kv -- incr, the operation the rate limiter depends on", () => {
  test("counts up from zero and returns the new value", async () => {
    const kv = freshKv();
    expect(await kv.incr("hits")).toBe(1);
    expect(await kv.incr("hits")).toBe(2);
    expect(await kv.incr("hits")).toBe(3);
    await kv.close();
  });

  test("concurrent increments do not lose counts", async () => {
    // The whole point of incr existing as its own operation: a
    // get-then-set implementation races and undercounts, which on a rate
    // limiter means the limit silently doesn't hold under load.
    const kv = freshKv();
    await Promise.all(Array.from({ length: 200 }, () => kv.incr("race")));
    expect(await kv.get("race")).toBe(200);
    await kv.close();
  });

  test("the window resets once the ttl lapses", async () => {
    const kv = freshKv();
    expect(await kv.incr("window", { ttlMs: 30 })).toBe(1);
    expect(await kv.incr("window", { ttlMs: 30 })).toBe(2);
    await new Promise((r) => setTimeout(r, 45));
    expect(await kv.incr("window", { ttlMs: 30 })).toBe(1);
    await kv.close();
  });

  test("continuous traffic still lets the window reset", async () => {
    // If every increment refreshed the expiry, a client hammering an
    // endpoint would keep pushing the deadline out and the window would
    // never roll over -- a fixed window would quietly become a permanent
    // ban for exactly the busiest callers. So: hold up a steady stream
    // across more than one window and assert the counter went back to 1
    // at some point, rather than climbing forever.
    const kv = freshKv();
    const counts = [];
    for (let i = 0; i < 12; i++) {
      counts.push(await kv.incr("busy", { ttlMs: 50 }));
      await new Promise((r) => setTimeout(r, 12));
    }
    expect(counts[0]).toBe(1);
    // A reset is a count that is not one more than its predecessor.
    const resets = counts.filter((n, i) => i > 0 && n === 1);
    expect(resets.length).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeLessThan(counts.length);
    await kv.close();
  });
});

describe("kv -- driver selection", () => {
  test("no url gives the memory driver", () => {
    expect(createKv({ url: null }).name).toBe("memory");
  });

  test("an unreachable redis degrades to memory rather than throwing", async () => {
    // Bun's Redis client connects lazily, so pointing at a dead port yields a
    // perfectly happy object and the failure only appears on the first
    // command. This asserts the behaviour that matters -- operations keep
    // working -- rather than the driver's label at construction time, which
    // cannot know anything yet.
    const kv = createKv({ url: "redis://127.0.0.1:1/" });

    await kv.set("probe", 42);
    expect(await kv.get("probe")).toBe(42);
    expect(await kv.incr("counter")).toBe(1);

    // Having discovered Redis is unusable, it reports what is really serving
    // requests -- an operator reading a health check must not be told "redis"
    // by a process that has silently been in memory for an hour.
    expect(kv.name).toBe("memory");
    await kv.close();
  });
});
