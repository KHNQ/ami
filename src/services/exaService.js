import { config } from "../config.js";
import { kv } from "../lib/kv.js";
import { Errors } from "../lib/errors.js";

// Web search, via Exa.
//
// This is the first outbound client in the repo with retry and key rotation,
// so the reasoning is worth stating rather than leaving in the shape of the
// code.
//
// **Rotation, not round-robin.** Keys are tried starting from the one that
// last worked, and a key that fails is put in a cooldown proportional to why:
// a revoked key (401) is not worth retrying for an hour, a rate-limited one
// (429) recovers in a minute, a server error (5xx) in seconds. Spreading load
// evenly across keys would instead spread the *failure* evenly.
//
// **A 400 never rotates.** A malformed query is our bug, not the key's.
// Retrying it across five keys turns one bad request into five and can trip
// the rate limit on keys that were perfectly healthy.

/** Index of the key currently believed good. */
let cursor = 0;
/** index -> epoch ms until that key is worth trying again. */
const cooldown = new Map();

/** Test seam: forget which key worked and which are resting. */
export function _resetExaState() {
  cursor = 0;
  cooldown.clear();
}

export function exaConfigured() {
  return config.exaApiKeys.length > 0;
}

async function exaFetch(path, body, { signal, fetchImpl = fetch } = {}) {
  const keys = config.exaApiKeys;
  if (!keys.length) {
    throw Errors.internal("Web search is not configured", "exa_unconfigured");
  }

  let lastStatus = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const i = (cursor + attempt) % keys.length;
    if ((cooldown.get(i) ?? 0) > Date.now()) continue;

    let res;
    try {
      res = await fetchImpl(`${config.exaBaseUrl}${path}`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": keys[i] },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // A transport failure (DNS, socket) is not the key's fault, but trying
      // the next one costs nothing and covers a per-key proxy problem.
      if (err?.name === "AbortError") throw err;
      cooldown.set(i, Date.now() + 10_000);
      lastStatus = "network";
      continue;
    }

    if (res.ok) {
      // Remember what worked, so the next request starts here rather than
      // walking the dead keys again.
      cursor = i;
      return res.json();
    }

    lastStatus = res.status;

    if (res.status === 400 || res.status === 422) {
      const detail = await res.text().catch(() => "");
      console.error(`[exa] rejected our request ${res.status}: ${detail.slice(0, 300)}`);
      throw Errors.internal("Web search could not run that query", "exa_bad_request");
    }
    if (res.status === 401 || res.status === 403) cooldown.set(i, Date.now() + 3_600_000);
    else if (res.status === 429) cooldown.set(i, Date.now() + 60_000);
    else cooldown.set(i, Date.now() + 10_000);
  }

  console.error(`[exa] every key exhausted (last status ${lastStatus})`);
  throw Errors.internal("Web search is temporarily unavailable", "exa_unavailable");
}

/** Collapses whitespace and trims to a budget, so six results stay affordable. */
function excerpt(text, max = 800) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function cacheKey(parts) {
  const data = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `exa:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const exaService = {
  configured: exaConfigured,

  /**
   * One search.
   *
   * `fast` uses Exa's own routing and asks for page text in the SAME call --
   * doing search-then-/contents as two round trips would double the latency
   * of the slowest thing the agent does, for no extra information.
   *
   * Results are cached for six hours. Facts about medical equipment change
   * slowly, and the second person to ask who makes a given laser should get
   * it instantly and for free.
   */
  async search({ query, depth = "fast", numResults = 5, signal, fetchImpl } = {}) {
    const q = String(query || "").trim();
    if (!q) throw Errors.badRequest("A search query is required", "query_required");

    const limit = Math.min(Math.max(Number(numResults) || 5, 1), 8);
    const key = await cacheKey([q.toLowerCase(), depth, String(limit)]);

    const cached = await kv.get(key).catch(() => null);
    if (cached) return { ...cached, cached: true };

    const payload =
      depth === "deep"
        ? {
            query: q,
            type: "neural",
            useAutoprompt: true,
            numResults: limit,
            contents: { text: { maxCharacters: 2000 } },
          }
        : {
            query: q,
            type: "auto",
            numResults: limit,
            contents: { text: { maxCharacters: 1200 } },
          };

    const raw = await exaFetch("/search", payload, { signal, fetchImpl });

    const results = (raw?.results || []).slice(0, limit).map((r) => ({
      title: r.title || domainOf(r.url) || "Untitled",
      url: r.url,
      domain: domainOf(r.url),
      published: r.publishedDate || null,
      author: r.author || null,
      text: excerpt(r.text, depth === "deep" ? 1200 : 800),
    }));

    const shaped = { query: q, depth, count: results.length, results };
    // Best-effort: a cache write failing must not fail the search.
    kv.set(key, shaped, { ttlMs: 6 * 60 * 60 * 1000 }).catch(() => {});
    return { ...shaped, cached: false };
  },

  /** Reads specific pages the model already has URLs for. */
  async contents({ urls, signal, fetchImpl } = {}) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean).slice(0, 3);
    if (!list.length) throw Errors.badRequest("A URL is required", "url_required");

    const raw = await exaFetch(
      "/contents",
      { urls: list, text: { maxCharacters: 4000 } },
      { signal, fetchImpl }
    );

    return {
      count: raw?.results?.length || 0,
      pages: (raw?.results || []).map((r) => ({
        title: r.title || domainOf(r.url),
        url: r.url,
        domain: domainOf(r.url),
        text: excerpt(r.text, 3000),
      })),
    };
  },
};
