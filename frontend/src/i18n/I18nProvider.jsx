import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./locales/en.json";
import { DEFAULT_LOCALE, LOCALE_CODES, isLocale, localeMeta, negotiateLocale } from "./config.js";
import { createTranslator } from "./translate.js";
import { setFormatLocale } from "../lib/format.js";

// English is bundled rather than lazy-loaded: it is the fallback for every
// missing key in every other language, so it has to be available
// synchronously or a partially-translated page would render key paths while
// waiting on a network request.
const LOADERS = {
  fa: () => import("./locales/fa.json"),
  ar: () => import("./locales/ar.json"),
  fr: () => import("./locales/fr.json"),
  it: () => import("./locales/it.json"),
};

const STORAGE_KEY = "trex-locale";
const I18nContext = createContext(null);

const missingReported = new Set();

function reportMissing(key, locale, absent) {
  if (import.meta.env.PROD) return;
  const id = `${locale}:${key}`;
  if (missingReported.has(id)) return;
  missingReported.add(id);
  // Warn once per key, in development only. A missing translation falls back
  // to English and the page still reads -- but silently, which is how a gap
  // survives to launch.
  console.warn(
    absent
      ? `[i18n] key "${key}" is missing from every catalog, including English`
      : `[i18n] "${key}" missing from ${locale}, falling back to English`
  );
}

/**
 * `initialCatalog` exists for server rendering.
 *
 * Catalogs are lazy-loaded in an effect, and effects do not run during SSR --
 * so without this the server rendered every page in English regardless of the
 * URL locale, and the correct language only appeared after hydration. That is
 * exactly the failure mode locale-prefixed URLs exist to avoid: a crawler or a
 * link-preview bot would only ever see English.
 *
 * entry-server.jsx imports all five catalogs statically and passes the right
 * one in. The server bundle is not shipped to browsers, so carrying all five
 * there costs nothing on the client.
 */
export function I18nProvider({ children, initialLocale, initialCatalog }) {
  const [locale, setLocaleState] = useState(() => {
    if (initialLocale && isLocale(initialLocale)) return initialLocale;
    if (typeof window === "undefined") return DEFAULT_LOCALE;
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored && isLocale(stored)) return stored;
    return negotiateLocale(window.navigator?.languages || [window.navigator?.language]);
  });

  const [catalogs, setCatalogs] = useState(() =>
    initialCatalog && initialLocale ? { en, [initialLocale]: initialCatalog } : { en }
  );

  useEffect(() => {
    if (locale === DEFAULT_LOCALE || catalogs[locale]) return;
    let cancelled = false;
    LOADERS[locale]?.()
      .then((mod) => {
        if (!cancelled) setCatalogs((c) => ({ ...c, [locale]: mod.default || mod }));
      })
      .catch(() => {
        // A failed catalog load leaves English in place. The page stays
        // usable in the wrong language, which beats an error screen.
      });
    return () => {
      cancelled = true;
    };
  }, [locale, catalogs]);

  // Keep the document in sync. `dir` in particular has to be on <html>, not on
  // a wrapper -- scrollbars, text selection and native form controls all read
  // it from the root element.
  useEffect(() => {
    // Money, dates and relative times localise through the same locale as the
    // copy. Set before the document sync so the very first formatted value on
    // a locale change is already correct.
    setFormatLocale(locale);
    if (typeof document === "undefined") return;
    const meta = localeMeta(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = meta.dir;
    try {
      window.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      /* private browsing */
    }
  }, [locale]);

  const setLocale = useCallback((next) => {
    if (isLocale(next)) setLocaleState(next);
  }, []);

  const value = useMemo(() => {
    const catalog = catalogs[locale] || en;
    const t = createTranslator({ catalog, fallback: en, locale, onMissing: reportMissing });
    const meta = localeMeta(locale);
    return {
      locale,
      setLocale,
      t,
      dir: meta.dir,
      isRTL: meta.dir === "rtl",
      meta,
      available: LOCALE_CODES,
      // True once the chosen catalog has actually arrived. Useful for
      // suppressing a flash of English on a slow connection.
      ready: locale === DEFAULT_LOCALE || Boolean(catalogs[locale]),
    };
  }, [locale, catalogs, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Rendered outside a provider (an isolated unit test, say): fall back to
    // an English translator rather than throwing, so a component under test
    // doesn't need the whole provider tree just to render a label.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: createTranslator({ catalog: en, fallback: en, locale: DEFAULT_LOCALE }),
      dir: "ltr",
      isRTL: false,
      meta: localeMeta(DEFAULT_LOCALE),
      available: LOCALE_CODES,
      ready: true,
    };
  }
  return ctx;
}

/** Sugar for the overwhelmingly common case. */
export function useT() {
  return useI18n().t;
}
