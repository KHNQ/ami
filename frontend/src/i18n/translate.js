import { DEFAULT_LOCALE, localeMeta } from "./config.js";

// The translation function itself, kept pure and free of React so it can be
// unit-tested directly and reused by the SSR server.
//
// Hand-rolled rather than react-i18next: this needs lookup, interpolation and
// plurals, which is about sixty lines. The library is ~40KB for that plus a
// plugin system, a backend loader and a namespace resolver none of which this
// app uses -- and "must be super lightweight" was an explicit constraint.

const INTERPOLATION = /\{\{(\w+)\}\}/g;

/**
 * Resolves a dotted key against a nested catalog.
 * Returns undefined rather than throwing so the caller can fall back.
 */
export function lookup(catalog, key) {
  if (!catalog) return undefined;
  let node = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Picks the plural form for `count` in `locale`.
 *
 * Uses Intl.PluralRules rather than an `n === 1` check, because that check is
 * wrong in most of the languages here: Arabic has six categories (including
 * dual and a distinct form for 11-99), and French treats 0 as singular where
 * English does not.
 */
export function pluralKey(catalog, key, count, locale) {
  const rules = new Intl.PluralRules(localeMeta(locale).intl);
  const category = rules.select(count);
  // Exact-value overrides win over category, so a catalog can special-case
  // "no items" without inventing a plural category for it.
  return (
    lookup(catalog, `${key}_${count}`) ??
    lookup(catalog, `${key}_${category}`) ??
    lookup(catalog, `${key}_other`) ??
    lookup(catalog, key)
  );
}

export function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(INTERPOLATION, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

/**
 * Builds a `t` bound to a locale and its catalog.
 *
 * `fallback` is the English catalog. A missing key resolves to the English
 * string rather than to the raw key: a partially translated page reading in
 * two languages is bad, but one showing `product.detail.cta_buy` to a customer
 * is worse.
 */
export function createTranslator({ catalog, fallback, locale = DEFAULT_LOCALE, onMissing }) {
  return function t(key, vars) {
    const hasCount = vars && typeof vars.count === "number";

    let template = hasCount ? pluralKey(catalog, key, vars.count, locale) : lookup(catalog, key);

    if (template === undefined) {
      template = hasCount ? pluralKey(fallback, key, vars.count, DEFAULT_LOCALE) : lookup(fallback, key);
      // Reported rather than swallowed, so the missing-key test can fail the
      // build instead of the gap being discovered by a customer.
      if (template !== undefined) onMissing?.(key, locale);
    }

    if (template === undefined) {
      onMissing?.(key, locale, true);
      // Last resort: the final segment of the key, which at least reads as
      // words rather than as a dotted path.
      return key.split(".").pop().replace(/_/g, " ");
    }

    return interpolate(template, vars);
  };
}
