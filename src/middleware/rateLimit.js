import { Errors } from "../lib/errors.js";
import { kv } from "../lib/kv.js";
import { config } from "../config.js";

// Fixed-window limiter, keyed by client IP plus a caller-given prefix (so
// /auth/login and /wallet/withdraw get independent budgets).
//
// State lives in the shared KV store rather than a per-limiter Map. With the
// in-memory driver that is exactly the old behaviour; with Redis configured,
// the window is shared across instances, which is the only way the limit
// means anything once more than one process is serving traffic -- N instances
// behind a load balancer previously gave every client N times the allowance.
function clientIp(c) {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return c.req.header("x-real-ip") || "unknown";
}

export function rateLimit({ windowMs, max, keyPrefix, store = kv }) {
  const effectiveMax = max * config.rateLimitMultiplier;
  return async function rateLimitMiddleware(c, next) {
    const key = `rl:${keyPrefix}:${clientIp(c)}`;

    let count;
    try {
      count = await store.incr(key, { ttlMs: windowMs });
    } catch (err) {
      // A KV outage must not take the API down with it. Log and let the
      // request through: temporarily unthrottled is a far better failure
      // mode than a total outage, and the auth endpoints this protects are
      // all still behind password checks.
      console.warn(`[rateLimit] store unavailable for ${keyPrefix}, allowing request: ${err}`);
      return next();
    }

    if (count > effectiveMax) throw Errors.tooManyRequests();
    await next();
  };
}
