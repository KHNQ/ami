// Every number a buyer is shown -- payback, monthly profit, break-even,
// lease instalments, Rial conversion -- comes from this one module.
//
// It is deliberately pure and dependency-free: these figures end up on a
// printed proforma that a procurement committee reads, so they have to be
// reproducible from the inputs alone, and testable without a browser.

/** Gross margin left after consumables, staff time and utilities. */
export const MARGIN = 0.75;

/** Central Bank of Iran reference rate used for the 7-day Rial lock. */
export const CBI_EUR_IRR = 676190;

export const money = (n, currency = "€") =>
  `${currency}${Math.round(n).toLocaleString("en-US")}`;

export const irr = (eur) => `${Math.round(eur * CBI_EUR_IRR).toLocaleString("en-US")} IRR`;

/**
 * What to print where a price would go.
 *
 * `show_prices` is an operator switch on the backend, and B2B medical
 * equipment is routinely quoted rather than listed -- so when it is off,
 * nothing on the storefront may print a figure, including the payback model,
 * which would otherwise reveal the price by arithmetic. Every price on the
 * page goes through here so there is one place that decision is made.
 *
 * `t` is optional so this module stays pure and testable without the i18n
 * provider; callers that render into the page pass it, and the English
 * string is the fallback rather than a key path.
 */
export function priceLabel(device, pricesVisible, t) {
  if (!pricesVisible || device?.priceOnRequest) {
    return t ? t("store.device.priceOnRequest") : "Price on request";
  }
  return money(device.price);
}

export function pricesUsable(device, pricesVisible) {
  return Boolean(pricesVisible && !device?.priceOnRequest);
}

/**
 * Return on investment for one device at a given monthly session volume.
 *
 * `payback` is in months and is the number the whole page is built around --
 * it is what a clinic owner asks first and everything else is context for it.
 */
export function roi({ price, sessionPrice, sessionsPerMonth }) {
  const profitPerSession = sessionPrice * MARGIN;
  const monthlyProfit = sessionsPerMonth * profitPerSession;
  return {
    profitPerSession,
    monthlyProfit,
    yearlyProfit: monthlyProfit * 12,
    revenue: sessionsPerMonth * sessionPrice,
    // Guard the divide: a zero-session slider position would otherwise show
    // "Infinity months", which reads as a bug rather than as "never".
    payback: monthlyProfit > 0 ? price / monthlyProfit : Infinity,
    breakEvenSessions: Math.ceil(price / profitPerSession),
  };
}

export function formatPayback(months) {
  if (!Number.isFinite(months)) return "—";
  return months.toFixed(1);
}

// --- Leasing ---------------------------------------------------------------
//
// Lease terms are not constants any more. Each product carries its own rules,
// set by an admin when the product is created (see src/lib/leaseRules.js on
// the server, which this mirrors -- tests/leaseParity.test.js holds the two to
// the same numbers): which durations are offered, each with its own APR, the
// smallest upfront payment allowed, and optionally a base price to lease
// against. A product with no rules gets the standard four terms at the
// operator's current APR setting.

export const DEFAULT_LEASE_TERMS = [12, 24, 36, 48];

/** Rules for a product that has none configured. `aprBp` is basis points. */
export function defaultLeaseRules(aprBp = 1800) {
  return {
    enabled: true,
    base_price_cents: null,
    min_upfront_pct: 10,
    max_upfront_pct: 90,
    terms: DEFAULT_LEASE_TERMS.map((months) => ({ months, apr_bp: aprBp })),
  };
}

/**
 * The rules a device is leased under.
 *
 * Tolerant where the server is strict: whatever arrives from the API is
 * checked for shape and, if it does not hold up, replaced by the defaults, so
 * a hand-edited product can never blank out the lease tab. The server
 * re-validates everything on submit regardless.
 */
export function resolveLeaseRules(device, defaultAprBp = 1800) {
  const own = device?.leaseRules;
  if (!own || typeof own !== "object") return defaultLeaseRules(defaultAprBp);
  const terms = (Array.isArray(own.terms) ? own.terms : [])
    .map((t) => ({ months: Number(t?.months), apr_bp: Number(t?.apr_bp ?? 0) }))
    .filter((t) => Number.isInteger(t.months) && t.months > 0 && Number.isFinite(t.apr_bp) && t.apr_bp >= 0)
    .sort((a, b) => a.months - b.months);
  const enabled = own.enabled !== false;
  if (enabled && terms.length === 0) return defaultLeaseRules(defaultAprBp);
  const min = Number.isFinite(Number(own.min_upfront_pct)) ? Number(own.min_upfront_pct) : 10;
  const max = Number.isFinite(Number(own.max_upfront_pct)) ? Number(own.max_upfront_pct) : 90;
  return {
    enabled,
    base_price_cents: Number(own.base_price_cents) > 0 ? Number(own.base_price_cents) : null,
    min_upfront_pct: Math.min(Math.max(min, 0), 90),
    max_upfront_pct: Math.min(Math.max(max, min), 90),
    terms,
  };
}

/** Standard amortising instalment (the same PMT a bank would quote), in euros. */
export function instalment({ principal, months, aprBp }) {
  if (principal <= 0) return 0;
  const r = aprBp / 10000 / 12;
  if (r === 0) return principal / months;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

/** The price a device is leased against: the admin's lease price, else its own. */
export function leasePrice(device, rules) {
  return rules?.base_price_cents ? rules.base_price_cents / 100 : device.price;
}

/**
 * Prices one lease option. Returns null when the choice is outside the rules,
 * so the UI can show nothing rather than a number the server would refuse.
 */
export function leaseOption(rules, price, { months, upfrontPct }) {
  if (!rules?.enabled || !(price > 0)) return null;
  const term = rules.terms.find((t) => t.months === months);
  if (!term) return null;
  if (!(upfrontPct >= rules.min_upfront_pct && upfrontPct <= rules.max_upfront_pct)) return null;
  const upfront = (price * upfrontPct) / 100;
  const principal = price - upfront;
  const monthly = instalment({ principal, months: term.months, aprBp: term.apr_bp });
  return {
    price,
    months: term.months,
    aprBp: term.apr_bp,
    upfrontPct,
    upfront,
    principal,
    monthly,
    total: upfront + monthly * term.months,
  };
}

/** The term to pre-select: two years if offered, else the one nearest it. */
export function defaultLeaseTerm(rules) {
  if (!rules?.terms?.length) return null;
  return rules.terms.reduce((best, t) =>
    Math.abs(t.months - 24) < Math.abs(best.months - 24) ? t : best
  ).months;
}

/** Deterministic-looking reference for a locked quote. */
export function lockHash(seed = "") {
  const base = `${seed}${Date.now()}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 5).toUpperCase().padEnd(5, "K");
}

export const PRICE_LOCK_DAYS = 7;
export const HEDGE_DAYS = 90;

/** Milliseconds remaining on a lock that started at `startedAt`. */
export function lockRemaining(startedAt, days = PRICE_LOCK_DAYS) {
  return Math.max(0, startedAt + days * 86400000 - Date.now());
}

export function formatCountdown(ms, t) {
  if (ms <= 0) return t ? t("store.device.lockExpired") : "expired";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

export const BUNDLES = [
  {
    id: "device",
    name: "Device only",
    add: 0,
    includes: ["Machine + standard handpieces", "12-month base warranty"],
  },
  {
    id: "bundle",
    name: "Bundle",
    add: 2900,
    saving: 3200,
    popular: true,
    includes: ["2-year service contract", "On-site staff training", "50 consumable units"],
  },
];
