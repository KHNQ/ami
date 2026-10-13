import { Hono } from "hono";
import { optionalAuth, requireAuth, requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { salesService } from "../services/salesService.js";
import { proformaService } from "../services/proformaService.js";

// The storefront's sales surface.
//
// Split deliberately down the middle:
//
//   POST /sales/quotes                     public and anonymous. Asking for a
//                                          price must not require an account,
//                                          or the enquiry is simply lost.
//
//   everything else                        staff. Reading someone else's
//                                          quote, or turning one into a
//                                          €55,000 lease, is not something an
//                                          anonymous caller may do.
//
// `optionalAuth` on the public POSTs so a signed-in customer's quote is
// attributed to their account, while an anonymous one still works.
export const salesRoutes = new Hono();

// The only anonymous INSERT here, so it gets its own budget -- tighter than
// the authenticated routes and separate from the contact-form limiter, which
// would otherwise let junk on one starve the other.
const quoteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, keyPrefix: "sales:quote" });

salesRoutes.post("/quotes", quoteLimiter, optionalAuth, async (c) => {
  const body = await c.req.json();
  const quote = salesService.createQuote({
    kind: body.kind,
    productId: body.product_id,
    subject: body.subject,
    userId: c.get("userId") || null,
    contactName: body.contact_name ?? body.name,
    contactPhone: body.contact_phone ?? body.phone,
    contactEmail: body.contact_email ?? body.email,
    clinicCity: body.clinic_city ?? body.city,
    specialty: body.specialty,
    timeline: body.timeline,
    financing: body.financing,
    currency: body.currency,
    amountCents: body.amount_cents,
    depositCents: body.deposit_cents,
    bundle: body.bundle,
    lockDays: body.lock_days,
    notes: body.notes ?? body.message,
    source: body.source || "storefront",
    termMonths: body.term_months,
    upfrontPct: body.upfront_pct,
    referralCode: body.referral_code,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null,
  });

  // Echo the reference, the lock and the download link, and nothing else.
  // This endpoint is anonymous, so returning the stored row would let anyone
  // who guessed an id read back what was captured about someone else.
  return c.json(
    {
      id: quote.id,
      reference: quote.reference,
      locked_until: quote.locked_until,
      locked_rate: quote.locked_rate,
      // The id and the reference together ARE the capability -- see
      // proformaService.getForDownload. The customer has no account at this
      // point, so there is no token to authorise with.
      download_url: `/sales/quotes/${quote.id}/proforma.pdf?ref=${quote.reference}`,
      message: "Thanks -- your reference is above and an advisor will be in touch.",
    },
    201
  );
});

/**
 * The proforma, as a PDF.
 *
 * Anonymous by necessity: the person who asked for a price has no account
 * yet, and making them create one to read their own quotation is how the
 * enquiry gets abandoned. The id and the reference must both match, which is
 * what stops it being an enumerable document store.
 *
 * Rate-limited on its own budget: generating a PDF is more expensive than
 * reading a row, and this one is reachable without a token.
 */
const downloadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyPrefix: "sales:proforma" });

salesRoutes.get("/quotes/:id/proforma.pdf", downloadLimiter, (c) => {
  const quote = proformaService.getForDownload(c.req.param("id"), c.req.query("ref"));
  const pdf = proformaService.render(quote);
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` so it opens in the browser's viewer, which is what someone
      // tapping "download your proforma" on a phone actually wants; the
      // filename is still right when they save it.
      "Content-Disposition": `inline; filename="${proformaService.filename(quote)}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/**
 * The storefront's "live activity" feed: real recent proforma requests, reduced to
 * device + time (see salesService.recentActivity). Public and anonymous, so it has
 * its own modest budget -- it is polled by every open storefront tab.
 */
const activityLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: "sales:activity" });
salesRoutes.get("/activity", activityLimiter, (c) => {
  c.header("Cache-Control", "public, max-age=30");
  return c.json(salesService.recentActivity());
});

/**
 * A customer's own quotes and agreements.
 *
 * Scoped to the caller by userId rather than taking one as a parameter --
 * "my" endpoints that accept an id are how one customer ends up reading
 * another's finances.
 */
salesRoutes.get("/mine", requireAuth, (c) => {
  const userId = c.get("userId");
  return c.json({
    quotes: salesService.listQuotes({ userId, limit: 50 }),
    agreements: salesService.listAgreements({ userId, limit: 50 }),
  });
});

/* --- Staff ------------------------------------------------------------- */

salesRoutes.get("/quotes", requireAuth, requirePermission("sales.read"), (c) => {
  return c.json({
    quotes: salesService.listQuotesForStaff({
      status: c.req.query("status"),
      kind: c.req.query("kind"),
      limit: Number(c.req.query("limit") || 50),
      offset: Number(c.req.query("offset") || 0),
    }),
    summary: salesService.summary(),
  });
});

salesRoutes.get("/quotes/:id", requireAuth, requirePermission("sales.read"), (c) =>
  c.json(salesService.getQuote(c.req.param("id")))
);

salesRoutes.patch("/quotes/:id", requireAuth, requirePermission("sales.write"), async (c) => {
  const body = await c.req.json();
  return c.json(salesService.updateQuote(c.req.param("id"), body, c.get("userId")));
});

salesRoutes.get("/agreements", requireAuth, requirePermission("sales.read"), (c) =>
  c.json({
    agreements: salesService.listAgreements({
      status: c.req.query("status"),
      kind: c.req.query("kind"),
      limit: Number(c.req.query("limit") || 50),
      offset: Number(c.req.query("offset") || 0),
    }),
  })
);

salesRoutes.get("/agreements/:id", requireAuth, requirePermission("sales.read"), (c) =>
  c.json(salesService.getAgreement(c.req.param("id")))
);

// Creating an agreement is the moment a quote becomes money owed over years,
// so it is a write permission and never anonymous.
salesRoutes.post("/agreements", requireAuth, requirePermission("sales.write"), async (c) => {
  const body = await c.req.json();
  const agreement = salesService.createAgreement({
    kind: body.kind,
    quoteId: body.quote_id,
    productId: body.product_id,
    subject: body.subject,
    userId: body.user_id,
    contactName: body.contact_name,
    contactPhone: body.contact_phone,
    contactEmail: body.contact_email,
    currency: body.currency,
    principalCents: body.principal_cents,
    depositCents: body.deposit_cents,
    termMonths: body.term_months,
    aprBp: body.apr_bp,
    intervalDays: body.interval_days,
    item: body.item,
    transfersOwnership: body.transfers_ownership,
    instalmentOverrideCents: body.instalment_cents,
    startsOn: body.starts_on,
  });
  return c.json(agreement, 201);
});

salesRoutes.patch("/agreements/:id", requireAuth, requirePermission("sales.write"), async (c) => {
  const body = await c.req.json();
  return c.json(salesService.updateAgreement(c.req.param("id"), body, c.get("userId")));
});

salesRoutes.patch("/instalments/:id", requireAuth, requirePermission("sales.write"), async (c) => {
  const body = await c.req.json();
  return c.json(salesService.markInstalment(c.req.param("id"), body, c.get("userId")));
});

salesRoutes.get("/summary", requireAuth, requirePermission("sales.read"), (c) =>
  c.json(salesService.summary())
);
