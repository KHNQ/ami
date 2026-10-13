import { config } from "../config.js";

// A tiny key/value store with a swappable backend, in the same spirit as
// src/db/: consumers talk to one interface and never learn which driver is
// underneath.
//
// This exists because several things in this app are process-local state that
// silently becomes wrong the moment a second instance runs -- the rate
// limiter most obviously (its per-process Map means N instances give every
// client N times the allowance) and, later, AI chat sessions.
//
// Interface is async throughout because Redis is, even though the memory
// driver could answer synchronously. One shape, no branching at call sites.
//
// --- On Redis availability -------------------------------------------------
// Uses Bun's built-in Redis client, so this adds no dependency. That client
// landed in Bun 1.2.9; on older runtimes it is absent and `createKv` falls
// back to memory with a loud warning.
//
// The client connects LAZILY: `new RedisClient(url)` succeeds even when
// nothing is listening, and the failure only surfaces on the first command.
// So construction alone cannot tell us Redis is usable, and the driver below
// is written to survive discovering that later -- see makeResilientRedis.

const MEMORY = "memory";
const REDIS = "redis";

function makeMemoryDriver() {
  const store = new Map(); // key -> { value, expiresAt | null }

  // Long-lived processes shouldn't accumulate one entry per distinct key
  // forever. Expired entries are also checked lazily on read, so this sweep
  // is about memory, not correctness.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) store.delete(key);
    }
  }, 60_000);
  sweeper.unref?.();

  function live(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  }

  return {
    name: MEMORY,
    async get(key) {
      const entry = live(key);
      return entry ? entry.value : null;
    },
    async set(key, value, { ttlMs } = {}) {
      store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
    },
    async del(key) {
      store.delete(key);
    },
    // Atomic by virtue of the single-threaded event loop: nothing can
    // interleave between the read and the write here. That matters -- a
    // get-then-set rate limiter races and undercounts under load.
    async incr(key, { ttlMs } = {}) {
      const entry = live(key);
      if (!entry) {
        store.set(key, { value: 1, expiresAt: ttlMs ? Date.now() + ttlMs : null });
        return 1;
      }
      entry.value += 1;
      return entry.value;
    },
    async close() {
      clearInterval(sweeper);
      store.clear();
    },
    _size: () => store.size,
  };
}

function makeRedisDriver(client) {
  const enc = (v) => JSON.stringify(v);
  const dec = (raw) => {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  return {
    name: REDIS,
    async get(key) {
      return dec(await client.get(key));
    },
    async set(key, value, { ttlMs } = {}) {
      if (ttlMs) await client.set(key, enc(value), "PX", ttlMs);
      else await client.set(key, enc(value));
    },
    async del(key) {
      await client.del(key);
    },
    // INCR is atomic server-side. The expiry is only set on the first
    // increment so a busy key keeps its original window rather than having
    // its deadline pushed out by every request -- that difference is what
    // separates a fixed window from an accidental sliding one that never
    // resets under sustained load.
    async incr(key, { ttlMs } = {}) {
      const count = await client.incr(key);
      if (count === 1 && ttlMs) await client.expire(key, Math.ceil(ttlMs / 1000));
      return count;
    },
    async close() {
      await client.close?.();
    },
  };
}

/**
 * Wraps a Redis driver so an unreachable server degrades instead of throwing.
 *
 * This is not defensive padding -- it is the only place the failure CAN be
 * handled. Bun's client connects lazily, so `new RedisClient(url)` happily
 * returns an object pointed at a dead port and the first actual command is
 * what fails. A boot-time try/catch therefore catches nothing, and every
 * consumer (rate limiter, chat socket tickets, AI sessions) would start
 * throwing at runtime instead.
 *
 * On the first failure this flips permanently to the in-memory driver and
 * says so once. Permanently rather than per-call because flapping between
 * two stores gives incoherent state -- a rate-limit counter that alternates
 * backends counts neither correctly. Degraded and consistent beats an outage.
 */
function makeResilientRedis(client, url, { timeoutMs = 1000 } = {}) {
  const redis = makeRedisDriver(client);
  const memory = makeMemoryDriver();
  let degraded = false;

  // A dead Redis does not necessarily *reject* -- pointing at a closed port
  // leaves the command pending while the client retries, so without a
  // deadline the first request to touch the KV store hangs instead of
  // failing. Since every consumer here is on a request path, a slow answer
  // is as bad as a wrong one: bound it and treat the timeout as a failure.
  const deadline = (promise) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        t.unref?.();
      }),
    ]);

  const fallback = (err) => {
    if (!degraded) {
      degraded = true;
      console.warn(
        `[kv] Redis at ${url} is unreachable (${err}). Falling back to the in-memory driver for the rest of this process. ` +
          `Rate limits and cached state will NOT be shared across instances.`
      );
    }
  };

  const wrap =
    (name) =>
    async (...args) => {
      if (degraded) return memory[name](...args);
      try {
        return await deadline(redis[name](...args));
      } catch (err) {
        fallback(err);
        return memory[name](...args);
      }
    };

  return {
    get name() {
      // Reports what is actually serving requests, not what was configured --
      // this is what an operator needs to see on a health endpoint.
      return degraded ? MEMORY : REDIS;
    },
    get: wrap("get"),
    set: wrap("set"),
    del: wrap("del"),
    incr: wrap("incr"),
    async close() {
      await redis.close().catch(() => {});
      await memory.close();
    },
  };
}

function tryCreateRedis(url) {
  // Bun's built-in Redis client, when the runtime has one. Deliberately not
  // a package dependency -- see the note at the top of this file.
  const RedisClient = globalThis.Bun?.RedisClient;
  if (!RedisClient) {
    console.warn(
      `[kv] REDIS_URL is set but this Bun runtime (${globalThis.Bun?.version || "unknown"}) has no built-in Redis client ` +
        `(added in Bun 1.2.9). Falling back to the in-memory driver. ` +
        `Rate limits and cached state will NOT be shared across instances.`
    );
    return null;
  }
  try {
    return makeResilientRedis(new RedisClient(url), url);
  } catch (err) {
    // A malformed URL still throws synchronously here.
    console.warn(`[kv] could not create a Redis client for ${url}: ${err}. Falling back to the in-memory driver.`);
    return null;
  }
}

export function createKv({ url = config.redisUrl } = {}) {
  if (!url) return makeMemoryDriver();
  return tryCreateRedis(url) || makeMemoryDriver();
}

// Process-wide default. Tests that need isolation build their own with
// createKv({ url: null }).
export const kv = createKv();
