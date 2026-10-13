import { defineTool } from "../registry.js";
import { config } from "../../../config.js";
import { db } from "../../../db/index.js";
import { exaService, exaConfigured } from "../../exaService.js";
import { quotaDay } from "../../../middleware/aiQuota.js";

// Web search.
//
// Registered only when Exa is actually configured. With no key the tool
// simply does not exist: the model is never told about a capability it cannot
// use, which is a far better failure than offering it and returning an error
// on every call.

if (exaConfigured()) {
  defineTool("web_search", {
    auth: "user",
    // The slowest tool by an order of magnitude, so it gets its own budget
    // rather than the 8s default.
    timeoutMs: 15_000,
    parallelSafe: true,
    description:
      "Search the public web. Use for things our own catalogue cannot answer: a manufacturer we " +
      "do not represent, a device we do not carry, a clinical study, a regulatory question. " +
      "Never use it for our own prices, stock or policies -- those come from the catalogue and " +
      "the web would only be a worse copy. Always attribute what you quote to its domain.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200 },
        depth: {
          type: "string",
          enum: ["fast", "deep"],
          description: "fast for a factual lookup; deep for research across several sources.",
        },
        num_results: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },

    summarise(r) {
      if (!r.results?.length) return "No web results";
      const domains = [...new Set(r.results.map((x) => x.domain).filter(Boolean))].slice(0, 3);
      return `${r.results.length} result${r.results.length === 1 ? "" : "s"} from ${domains.join(", ")}`;
    },

    async handler({ query, depth = "fast", num_results = 5 }, ctx) {
      // Metered per customer per day, separately from the prompt allowance:
      // one question can trigger several searches, and Exa bills per call.
      if (ctx.userId) {
        const day = quotaDay();
        const { web_searches } = db.aiUsage.incrementWebSearches(ctx.userId, day);
        if (web_searches > config.aiWebSearchDailyMax) {
          return {
            error: `Daily web-search allowance (${config.aiWebSearchDailyMax}) is used up. Answer from the catalogue and what you already know, and say you could not search the web.`,
            code: "web_search_quota",
          };
        }
      }

      const res = await exaService.search({
        query,
        depth,
        numResults: num_results,
        signal: ctx.signal,
      });

      // The sources list in the UI gets the web hits too, so a visitor can see
      // (and click) what the answer leaned on. `kind: "web"` distinguishes
      // them from catalogue hits, which link internally.
      if (res.results.length) {
        ctx.emit?.(
          "sources",
          res.results.map((r) => ({ kind: "web", slug: r.url, name: r.title, url: r.url, domain: r.domain }))
        );
      }

      return {
        query: res.query,
        cached: res.cached,
        count: res.count,
        // Restated on every result rather than trusted to the system prompt.
        // The model reads the thing next to the data more reliably than a
        // rule it was given several thousand tokens ago.
        note: "Third-party sources. They may be wrong or out of date, and must never override our own catalogue for our prices, stock or policies. Attribute anything you quote to its domain.",
        results: res.results,
      };
    },
  });

  defineTool("read_web_page", {
    auth: "user",
    timeoutMs: 15_000,
    parallelSafe: true,
    description:
      "Fetch the readable text of specific web pages you already have URLs for -- typically from " +
      "web_search. Use when a snippet is not enough to answer properly.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
          description: "Up to three full URLs.",
        },
      },
      required: ["urls"],
      additionalProperties: false,
    },

    summarise: (r) => `Read ${r.count} page${r.count === 1 ? "" : "s"}`,

    async handler({ urls }, ctx) {
      if (ctx.userId) {
        const { web_searches } = db.aiUsage.incrementWebSearches(ctx.userId, quotaDay());
        if (web_searches > config.aiWebSearchDailyMax) {
          return { error: "Daily web-search allowance is used up.", code: "web_search_quota" };
        }
      }

      const res = await exaService.contents({ urls, signal: ctx.signal });
      if (res.pages.length) {
        ctx.emit?.(
          "sources",
          res.pages.map((p) => ({ kind: "web", slug: p.url, name: p.title, url: p.url, domain: p.domain }))
        );
      }
      return {
        ...res,
        note: "Third-party content. Attribute anything you quote to its domain.",
      };
    },
  });
}
