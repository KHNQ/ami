import { defineTool } from "../registry.js";
import { getIndex } from "../../aiService.js";
import { productService } from "../../productService.js";
import { settingsService } from "../../settingsService.js";
import { effectiveLeaseRules } from "../../../lib/leaseRules.js";

// Catalogue tools.
//
// `search_catalogue` runs the same BM25 index that grounds every answer, but
// exposes it as something the model can aim at a specific question -- "do you
// carry a CO2 laser" is a different query from the visitor's whole sentence,
// and letting the model phrase the search is most of the value.

// Below this, a hit is noise rather than a match. Tuned against the real
// corpus: a genuine product match scores several times this, while an
// unrelated query still returns something with a small positive score because
// BM25 always ranks whatever it has.
const RELEVANCE_FLOOR = 1.2;

defineTool("search_catalogue", {
  auth: "public",
  parallelSafe: true,
  timeoutMs: 3000,
  description:
    "Search the company's own catalogue and knowledge base for devices, treatments, brands, " +
    "policies and pages. Use this to check whether we actually carry something before answering. " +
    "Returns found:false when nothing matches, which means we do not sell it.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 200,
        description: "What to look for, e.g. 'CO2 fractional laser' or 'warranty length'.",
      },
      limit: { type: "integer", minimum: 1, maximum: 8 },
    },
    required: ["query"],
    additionalProperties: false,
  },

  summarise(result) {
    return result.found
      ? `Found ${result.results.length} match${result.results.length === 1 ? "" : "es"} in the catalogue`
      : "Not in our catalogue";
  },

  handler({ query, limit = 5 }) {
    const { index, corpus } = getIndex();
    const byId = new Map(corpus.map((c) => [c.id, c]));
    const showPrices = settingsService.isEnabled("show_prices");

    const hits = index
      .search(query, { limit })
      .map((h) => ({ ...h, chunk: byId.get(h.id) }))
      .filter((h) => h.chunk);

    const strong = hits.filter((h) => h.score >= RELEVANCE_FLOOR);

    // The explicit negative is the point of this tool. An empty array reads to
    // a model as "retrieval failed, answer from memory" and it substitutes the
    // nearest thing we do sell; `found: false` plus the near misses reads as
    // "we checked, and no" -- which is what the visitor is owed, and what
    // makes the supply-request path reachable.
    if (!strong.length) {
      return {
        found: false,
        query,
        note: "We do not carry anything matching this. Do not offer a different device as though it were the one asked for.",
        closest: hits.slice(0, 3).map((h) => ({ name: h.chunk.name, kind: h.chunk.kind })),
      };
    }

    return {
      found: true,
      query,
      results: strong.map((h) => shape(h.chunk, showPrices)),
    };
  },
});

function shape(chunk, showPrices) {
  const base = {
    kind: chunk.kind,
    slug: chunk.slug,
    name: chunk.name,
    // Enough to answer from, short enough that six of them do not crowd out
    // the conversation.
    summary: chunk.text.length > 400 ? `${chunk.text.slice(0, 397)}…` : chunk.text,
  };

  if (chunk.kind !== "product") return base;

  // Price and stock are read live rather than from the index, exactly as
  // buildContext does -- the index is cached for a minute and stock that is
  // a minute stale is stock the visitor is told wrongly.
  let product = null;
  try {
    product = productService.get(chunk.productId);
  } catch {
    product = null;
  }

  return {
    ...base,
    product_id: chunk.productId,
    href: `/devices/${chunk.slug}`,
    // Mirrors the guard in buildContext: with published prices switched off
    // no figure reaches the model at all, rather than reaching it alongside
    // an instruction not to repeat it. A prompt is a request; this is a
    // guarantee.
    price_usd:
      showPrices && product?.list_price_y_cents != null
        ? Number((product.list_price_y_cents / 100).toFixed(2))
        : null,
    price_on_request: !showPrices || product?.list_price_y_cents == null,
    in_stock: product ? product.stock_count > 0 : null,
    stock_count: product?.stock_count ?? null,
  };
}

defineTool("list_products", {
  auth: "public",
  timeoutMs: 3000,
  description:
    "Browse the catalogue rather than search it: every device we carry, optionally filtered by " +
    "treatment category. Use when the visitor asks what we sell, or for a comparison across the " +
    "range rather than one machine.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        maxLength: 60,
        description: "Category slug, e.g. 'hair-removal'. Omit for everything.",
      },
      limit: { type: "integer", minimum: 1, maximum: 30 },
    },
    additionalProperties: false,
  },
  summarise: (r) => `Listed ${r.count} device${r.count === 1 ? "" : "s"}`,
  handler({ category, limit = 20 }) {
    const showPrices = settingsService.isEnabled("show_prices");
    // listPublic, not list: it applies the same stripping the storefront API
    // does, so warehouse cost never reaches the model at all.
    const rows = productService.listPublic({ status: "active", category, limit, offset: 0 });
    return {
      count: rows.length,
      prices_visible: showPrices,
      products: rows.map((p) => ({
        product_id: p.id,
        name: p.name,
        slug: p.specs?.slug ?? p.id,
        manufacturer: p.specs?.manufacturer ?? null,
        price_usd:
          showPrices && p.list_price_y_cents != null
            ? Number((p.list_price_y_cents / 100).toFixed(2))
            : null,
        price_on_request: !showPrices || p.list_price_y_cents == null,
        in_stock: p.stock_count > 0,
      })),
    };
  },
});

defineTool("get_product", {
  auth: "public",
  timeoutMs: 3000,
  description:
    "Everything we hold on one device: description, specifications, manufacturer, price and " +
    "stock. Use when the visitor asks about a specific machine by name.",
  parameters: {
    type: "object",
    properties: {
      product_id: { type: "string", maxLength: 80, description: "The product id, or its slug." },
    },
    required: ["product_id"],
    additionalProperties: false,
  },
  summarise: (r) => `Read ${r.name}`,
  handler({ product_id }) {
    const showPrices = settingsService.isEnabled("show_prices");

    // Accepts a slug as well as an id. The model has seen slugs in search
    // results and in SUGGEST, so demanding an internal id here would fail on
    // the identifier it is most likely to have.
    let p = null;
    try {
      p = productService.getPublic(product_id);
    } catch {
      p = null;
    }
    if (!p) {
      const { corpus } = getIndex();
      const bySlug = corpus.find((c) => c.kind === "product" && c.slug === product_id);
      if (bySlug) {
        try {
          p = productService.getPublic(bySlug.productId);
        } catch {
          p = null;
        }
      }
    }
    if (!p) return { found: false, note: "No such product. Use search_catalogue to find one." };

    return {
      found: true,
      product_id: p.id,
      name: p.name,
      slug: p.specs?.slug ?? p.id,
      description: p.description,
      manufacturer: p.specs?.manufacturer ?? null,
      model: p.specs?.model ?? null,
      features: p.specs?.features ?? [],
      price_usd:
        showPrices && p.list_price_y_cents != null
          ? Number((p.list_price_y_cents / 100).toFixed(2))
          : null,
      price_on_request: !showPrices || p.list_price_y_cents == null,
      in_stock: p.stock_count > 0,
      stock_count: p.stock_count,
      // What a lease proforma may be requested on, so the visitor is only
      // offered terms the server will accept.
      lease: (() => {
        const rules = effectiveLeaseRules(p.specs, Number(settingsService.get("lease_apr_bp")) || 1800);
        if (!rules.enabled) return { offered: false };
        return {
          offered: true,
          terms_months: rules.terms.map((t) => t.months),
          min_upfront_pct: rules.min_upfront_pct,
          max_upfront_pct: rules.max_upfront_pct,
        };
      })(),
      href: `/devices/${p.specs?.slug ?? p.id}`,
    };
  },
});
