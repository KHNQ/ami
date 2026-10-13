import { defineTool } from "../registry.js";
import { authService } from "../../authService.js";
import { salesService } from "../../salesService.js";
import { getIndex } from "../../aiService.js";

// Writes that raise a request with our sales team.
//
// All of these are SAFE writes: they execute immediately, without a
// confirmation card. The test is reversibility, not importance. A proforma
// request creates a row our team reads and can decline; nothing moves, nothing
// is charged, and a mistaken one costs an email. Cards are for irreversible
// money -- see tools/consequential.js.
//
// The confirmation that matters here is CONVERSATIONAL: the agent is told (in
// prompt rule 7) to establish what the visitor actually wants before raising
// anything. Putting a tap-to-confirm card in front of a lead request would
// mostly just lose the lead.

/**
 * Contact details, filled from the account rather than from the model.
 *
 * This removes a whole class of bug where the model "helpfully" invents an
 * email address, and removes a conversational turn asking for something we
 * already hold. It also means `contact_name` can never be a required argument
 * the model has to guess at.
 */
function contactFor(ctx) {
  const me = authService.me(ctx.userId);
  return {
    contactName: me.name || me.email,
    contactEmail: me.email,
    contactPhone: me.phone || undefined,
  };
}

/** Slugs the model may name, so a quote can never point at a device we do not list. */
function productIdForSlug(slug) {
  if (!slug) return null;
  const { corpus } = getIndex();
  const hit = corpus.find((c) => c.kind === "product" && (c.slug === slug || c.productId === slug));
  return hit?.productId ?? null;
}

defineTool("request_unlisted_equipment", {
  auth: "user",
  parallelSafe: false,
  description:
    "Raise a supply request for equipment we do NOT carry, so our team can look into sourcing it. " +
    "Use only after search_catalogue has reported found:false AND the visitor has told you which " +
    "manufacturer and model they mean and what they need it for. Never guess those details.",
  parameters: {
    type: "object",
    properties: {
      manufacturer: { type: "string", maxLength: 100 },
      model: { type: "string", maxLength: 120 },
      intended_use: {
        type: "string",
        maxLength: 500,
        description: "What the clinic needs it for, in the visitor's own words.",
      },
      quantity: { type: "integer", minimum: 1, maximum: 100 },
      timeline: { type: "string", maxLength: 100 },
      clinic_city: { type: "string", maxLength: 100 },
    },
    required: ["model", "intended_use"],
    additionalProperties: false,
  },

  summarise: (r) => `Supply request raised — ${r.reference}`,

  handler({ manufacturer, model, intended_use, quantity, timeline, clinic_city }, ctx) {
    // `kind: enquiry` rather than `proforma`: "can you source this" is
    // literally an enquiry, and a proforma implies a price we cannot possibly
    // quote for something we do not stock.
    const quote = salesService.createQuote({
      kind: "enquiry",
      productId: null,
      // Free text with no product_id is exactly the case createQuote was
      // written for. amountCents stays null, so no rate lock is taken -- which
      // is right for something we cannot price yet.
      subject: [manufacturer, model].filter(Boolean).join(" ").slice(0, 200),
      ...contactFor(ctx),
      userId: ctx.userId,
      clinicCity: clinic_city,
      timeline,
      notes: [
        `Raised through the assistant.`,
        manufacturer ? `Manufacturer: ${manufacturer}` : null,
        `Model: ${model}`,
        quantity ? `Quantity: ${quantity}` : null,
        `Intended use: ${intended_use}`,
      ]
        .filter(Boolean)
        .join("\n"),
      source: "ai_agent",
      ip: ctx.ip,
    });

    return {
      raised: true,
      reference: quote.reference,
      what: [manufacturer, model].filter(Boolean).join(" "),
      next: "Our team reviews supply requests and comes back within two working days. Quote the reference if they get in touch.",
    };
  },
});

defineTool("create_quote", {
  auth: "user",
  parallelSafe: false,
  description:
    "Raise a proforma, or a lease proforma request, for a device we DO carry. For a lease, " +
    "establish the term and the upfront percentage the visitor wants first (the device's lease " +
    "options are in get_product). Establish what the visitor actually wants before calling " +
    "this -- it creates a real request our sales team acts on.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["proforma", "enquiry", "lease"],
      },
      product_slug: {
        type: "string",
        maxLength: 100,
        description: "The slug of the device, from search_catalogue or get_product.",
      },
      notes: { type: "string", maxLength: 1500, description: "What the visitor asked for." },
      timeline: { type: "string", maxLength: 100 },
      term_months: { type: "integer", minimum: 1, maximum: 120, description: "Lease only: duration in months." },
      upfront_pct: { type: "number", minimum: 0, maximum: 90, description: "Lease only: percentage paid upfront." },
      clinic_city: { type: "string", maxLength: 100 },
    },
    required: ["kind", "product_slug"],
    additionalProperties: false,
  },

  summarise: (r) => `${r.kind} raised — ${r.reference}`,

  handler({ kind, product_slug, notes, timeline, term_months, upfront_pct, clinic_city }, ctx) {
    const productId = productIdForSlug(product_slug);
    if (!productId) {
      // Returned as a result, not thrown: the model corrects itself on the
      // next step rather than the visitor seeing an error.
      return {
        error: `No device with slug "${product_slug}". Call search_catalogue first and use the slug it returns.`,
        code: "unknown_product",
      };
    }

    const quote = salesService.createQuote({
      kind,
      productId,
      ...contactFor(ctx),
      userId: ctx.userId,
      clinicCity: clinic_city,
      timeline,
      termMonths: term_months,
      upfrontPct: upfront_pct,
      notes: notes ? `Raised through the assistant.\n${notes}` : "Raised through the assistant.",
      source: "ai_agent",
      ip: ctx.ip,
    });

    return {
      raised: true,
      kind,
      reference: quote.reference,
      rate_locked_until: quote.locked_until ?? null,
      next: "Our team responds within two working hours during business hours.",
    };
  },
});

defineTool("request_demo", {
  auth: "user",
  parallelSafe: false,
  description:
    "Book a demonstration of a device, either at our showroom or at a clinic already running one.",
  parameters: {
    type: "object",
    properties: {
      product_slug: { type: "string", maxLength: 100 },
      clinic_city: { type: "string", maxLength: 100 },
      timeline: { type: "string", maxLength: 100, description: "When they would like to see it." },
      notes: { type: "string", maxLength: 1000 },
    },
    required: ["product_slug"],
    additionalProperties: false,
  },

  summarise: (r) => `Demo requested — ${r.reference}`,

  handler({ product_slug, clinic_city, timeline, notes }, ctx) {
    const productId = productIdForSlug(product_slug);
    if (!productId) {
      return { error: `No device with slug "${product_slug}".`, code: "unknown_product" };
    }

    // `demo` is a valid quote kind with no frontend caller -- the storefront
    // never built a form for it. It is genuinely a capability the agent has
    // and a clicking visitor does not.
    const quote = salesService.createQuote({
      kind: "demo",
      productId,
      ...contactFor(ctx),
      userId: ctx.userId,
      clinicCity: clinic_city,
      timeline,
      notes: notes ? `Demo requested through the assistant.\n${notes}` : "Demo requested through the assistant.",
      source: "ai_agent",
      ip: ctx.ip,
    });

    return { raised: true, reference: quote.reference, next: "Our team will arrange a time." };
  },
});
