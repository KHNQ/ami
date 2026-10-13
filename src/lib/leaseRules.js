// Lease rules: the terms an admin lets customers pick for a product.
//
// Stored on the product (specs.lease_rules) so they are set when the product
// is created and travel with it to the public catalogue. Pure and
// dependency-free: the same module computes the instalment the browser shows
// and the one the server stamps on a proforma request, so they cannot drift.
//
//   {
//     enabled: true,
//     base_price_cents: 3800000,   // price leased against; null = the list price
//     min_upfront_pct: 10,         // smallest down payment the customer may choose
//     max_upfront_pct: 90,
//     terms: [                     // the durations offered, each with its own rate
//       { months: 12, apr_bp: 1600 },
//       { months: 24, apr_bp: 1800 },
//       { months: 36, apr_bp: 1900 },
//       { months: 48, apr_bp: 2000 },
//     ],
//   }
//
// APR is in basis points (1800 = 18%), matching the rest of the app.

import { Errors } from "./errors.js";

export const DEFAULT_TERM_MONTHS = [12, 24, 36, 48];
export const MAX_TERMS = 8;
export const MAX_MONTHS = 120;

/**
 * Rules for a product that has none configured.
 *
 * Existing products predate lease rules, and the storefront must keep working
 * for them: the default offers the four standard terms at the operator's
 * current APR setting.
 */
export function defaultLeaseRules(aprBp = 1800) {
  return {
    enabled: true,
    base_price_cents: null,
    min_upfront_pct: 10,
    max_upfront_pct: 90,
    terms: DEFAULT_TERM_MONTHS.map((months) => ({ months, apr_bp: aprBp })),
  };
}

function int(value, field, { min, max }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw Errors.badRequest(`lease_rules.${field} must be a whole number between ${min} and ${max}`, "invalid_lease_rules");
  }
  return n;
}

/**
 * Validates and normalises admin input. Throws a 400 on anything malformed
 * rather than silently correcting it: a lease rule an admin thinks they set
 * and the system quietly changed is a mispriced contract.
 */
export function normalizeLeaseRules(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw Errors.badRequest("lease_rules must be an object", "invalid_lease_rules");
  }
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);

  const base =
    input.base_price_cents === null || input.base_price_cents === undefined || input.base_price_cents === ""
      ? null
      : int(input.base_price_cents, "base_price_cents", { min: 1, max: 10_000_000_000 });

  const minUpfront = int(input.min_upfront_pct ?? 10, "min_upfront_pct", { min: 0, max: 90 });
  const maxUpfront = int(input.max_upfront_pct ?? 90, "max_upfront_pct", { min: 0, max: 90 });
  if (maxUpfront < minUpfront) {
    throw Errors.badRequest("lease_rules.max_upfront_pct cannot be below min_upfront_pct", "invalid_lease_rules");
  }

  const rawTerms = Array.isArray(input.terms) ? input.terms : [];
  if (enabled && rawTerms.length === 0) {
    throw Errors.badRequest("lease_rules.terms needs at least one term when leasing is enabled", "invalid_lease_rules");
  }
  if (rawTerms.length > MAX_TERMS) {
    throw Errors.badRequest(`lease_rules.terms allows at most ${MAX_TERMS} terms`, "invalid_lease_rules");
  }
  const seen = new Set();
  const terms = rawTerms
    .map((t) => ({
      months: int(typeof t === "number" ? t : t?.months, "terms[].months", { min: 1, max: MAX_MONTHS }),
      apr_bp: int(typeof t === "number" ? 0 : (t?.apr_bp ?? 0), "terms[].apr_bp", { min: 0, max: 10_000 }),
    }))
    .filter((t) => {
      // A duplicate month count is an admin mistake, but harmless to drop:
      // the first one wins, which is the one they typed first.
      if (seen.has(t.months)) return false;
      seen.add(t.months);
      return true;
    })
    .sort((a, b) => a.months - b.months);

  return { enabled, base_price_cents: base, min_upfront_pct: minUpfront, max_upfront_pct: maxUpfront, terms };
}

/** The rules in force for a product: its own, or the defaults. */
export function effectiveLeaseRules(specs, defaultAprBp) {
  const own = specs?.lease_rules;
  if (!own) return defaultLeaseRules(defaultAprBp);
  try {
    return normalizeLeaseRules(own) ?? defaultLeaseRules(defaultAprBp);
  } catch {
    // Hand-edited data that no longer validates falls back rather than
    // taking the product's page down.
    return defaultLeaseRules(defaultAprBp);
  }
}

/** Standard amortising instalment (the PMT a bank would quote), in cents. */
export function instalmentCents({ principalCents, months, aprBp }) {
  if (!principalCents || principalCents <= 0) return 0;
  if (!months || months <= 0) throw Errors.badRequest("term_months must be positive");
  const r = aprBp / 10000 / 12;
  if (r === 0) return Math.round(principalCents / months);
  const factor = Math.pow(1 + r, months);
  return Math.round((principalCents * r * factor) / (factor - 1));
}

/**
 * Prices one lease option against a product's rules.
 *
 * `listPriceCents` is used when the rules name no base price of their own.
 * Throws a 400 when the choice is outside what the admin allowed -- the
 * server calls this on every lease proforma request, so a tampered browser
 * cannot request a term or down payment the rules do not offer.
 */
export function quoteLease(rules, listPriceCents, { months, upfrontPct }) {
  if (!rules?.enabled) throw Errors.badRequest("Leasing is not offered for this product", "lease_not_offered");
  const term = rules.terms.find((t) => t.months === Number(months));
  if (!term) {
    throw Errors.badRequest(
      `term_months must be one of: ${rules.terms.map((t) => t.months).join(", ")}`,
      "lease_term_not_allowed"
    );
  }
  const pct = Number(upfrontPct);
  if (!Number.isFinite(pct) || pct < rules.min_upfront_pct || pct > rules.max_upfront_pct) {
    throw Errors.badRequest(
      `upfront_pct must be between ${rules.min_upfront_pct} and ${rules.max_upfront_pct}`,
      "lease_upfront_out_of_range"
    );
  }
  const price = rules.base_price_cents ?? listPriceCents;
  if (!price || price <= 0) throw Errors.badRequest("This product has no price to lease against", "lease_no_price");

  const upfront = Math.round((price * pct) / 100);
  const principal = price - upfront;
  const instalment = instalmentCents({ principalCents: principal, months: term.months, aprBp: term.apr_bp });
  return {
    price_cents: price,
    months: term.months,
    apr_bp: term.apr_bp,
    upfront_pct: pct,
    upfront_cents: upfront,
    principal_cents: principal,
    instalment_cents: instalment,
    total_cents: upfront + instalment * term.months,
  };
}
