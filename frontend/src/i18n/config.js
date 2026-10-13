// Supported locales and how each one behaves.
//
// `dir` matters more than it looks: Arabic and Persian are right-to-left, and
// getting that wrong doesn't degrade gracefully -- it produces a page that is
// unreadable rather than merely untranslated.
//
// `numerals` records whether a locale conventionally uses its own digit forms.
// Persian and Arabic do, but medical model numbers ("MX_7000", "1470nm") must
// stay Latin, so this is applied only to formatted numbers and dates, never to
// interpolated content. Getting that backwards would render device names in a
// script their manufacturers never used.

export const LOCALES = {
  en: { code: "en", name: "English", nativeName: "English", dir: "ltr", intl: "en-US", flag: "🇬🇧" },
  fa: { code: "fa", name: "Persian", nativeName: "فارسی", dir: "rtl", intl: "fa-IR", flag: "🇮🇷", numerals: "arabext" },
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl", intl: "ar", flag: "🇸🇦", numerals: "arab" },
  fr: { code: "fr", name: "French", nativeName: "Français", dir: "ltr", intl: "fr-FR", flag: "🇫🇷" },
  it: { code: "it", name: "Italian", nativeName: "Italiano", dir: "ltr", intl: "it-IT", flag: "🇮🇹" },
};

export const LOCALE_CODES = Object.keys(LOCALES);
export const DEFAULT_LOCALE = "en";

export function isLocale(code) {
  return Object.prototype.hasOwnProperty.call(LOCALES, code);
}

export function localeMeta(code) {
  return LOCALES[code] || LOCALES[DEFAULT_LOCALE];
}

export function dirOf(code) {
  return localeMeta(code).dir;
}

/**
 * Splits a pathname into its locale prefix and the rest.
 *
 * English is served unprefixed at `/` rather than at `/en/`: it is the
 * existing canonical URL set, and moving it would invalidate every link and
 * search result that already exists.
 */
export function splitLocalePath(pathname) {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  if (match && isLocale(match[1]) && match[1] !== DEFAULT_LOCALE) {
    const rest = pathname.slice(match[0].length) || "/";
    return { locale: match[1], path: rest.startsWith("/") ? rest : `/${rest}` };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || "/" };
}

/** Builds the URL for `path` in `locale`. Inverse of splitLocalePath. */
export function localePath(locale, path = "/") {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/**
 * Best supported locale for a set of browser preferences.
 * Matches on the primary subtag, so `fa-IR` and `fr-CA` both resolve.
 */
export function negotiateLocale(preferences = []) {
  for (const pref of preferences) {
    if (!pref) continue;
    const primary = String(pref).toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
