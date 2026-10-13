import { localeMeta, DEFAULT_LOCALE } from "../i18n/config.js";

// Locale-aware formatting.
//
// These used to hardcode `en-US`, which produced "$95,000.00" for a Persian
// reader who expects "‎$۹۵٬۰۰۰٫۰۰" with Eastern Arabic numerals and a different
// group separator. Every function now takes an optional locale; components get
// it from useFormat() below rather than passing it by hand.
//
// Currency stays USD. The catalogue's prices are quoted in dollars and
// converting them would need a live rate and a decision about which rate --
// that is a business call, not a formatting one. Only the *presentation* of
// the number localises.

let activeLocale = DEFAULT_LOCALE;

/**
 * Sets the locale these functions use when none is passed.
 *
 * A module-level default rather than threading a parameter through every call
 * site: `money()` is called in ~40 places, most of them deep in render trees
 * that have no other reason to know about i18n. I18nProvider keeps this in
 * sync with the active locale.
 */
export function setFormatLocale(locale) {
  activeLocale = locale || DEFAULT_LOCALE;
}

const intlTag = (locale) => localeMeta(locale || activeLocale).intl;

export function money(cents, opts = {}) {
  if (cents === null || cents === undefined) return "—";
  const { locale, ...rest } = opts;
  return new Intl.NumberFormat(intlTag(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...rest,
  }).format(cents / 100);
}

export function number(value, opts = {}) {
  if (value === null || value === undefined) return "—";
  const { locale, ...rest } = opts;
  return new Intl.NumberFormat(intlTag(locale), rest).format(value);
}

export function pct(bp, locale) {
  if (bp === null || bp === undefined) return "—";
  return new Intl.NumberFormat(intlTag(locale), {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: bp % 100 === 0 ? 0 : 1,
  }).format(bp / 10000);
}

export function shortDate(iso, locale) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(intlTag(locale), { month: "short", day: "numeric" });
}

export function fullDate(iso, locale) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(intlTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(iso, locale) {
  if (!iso) return "—";
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: "auto" });
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs) return rtf.format(-Math.round(diffSec / secs), unit);
  }
  // "just now" is the one string here that is words rather than a number, so
  // it comes from Intl too -- second-level relative time renders as "now" in
  // every supported locale.
  return rtf.format(0, "second");
}

export function initials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function truncate(str, len = 24) {
  if (!str) return "";
  return str.length > len ? `${str.slice(0, len)}…` : str;
}
