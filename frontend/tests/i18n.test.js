import { describe, it, expect } from "vitest";
import en from "../src/i18n/locales/en.json";
import fa from "../src/i18n/locales/fa.json";
import ar from "../src/i18n/locales/ar.json";
import fr from "../src/i18n/locales/fr.json";
// Aliased: the bare name collides with vitest's `it`.
import itCatalog from "../src/i18n/locales/it.json";
import { createTranslator, lookup, interpolate, pluralKey } from "../src/i18n/translate.js";
import {
  LOCALES,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  splitLocalePath,
  localePath,
  negotiateLocale,
  dirOf,
  isLocale,
} from "../src/i18n/config.js";

const CATALOGS = { en, fa, ar, fr, it: itCatalog };

/** Every dotted key in a catalog, ignoring the _meta block. */
function keysOf(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (prefix === "" && k === "_meta") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") out.push(...keysOf(v, path));
    else out.push(path);
  }
  return out;
}

// A plural key like `inStock_one` exists in some locales and not others --
// Arabic has six categories, English two -- so completeness is compared on
// the base key rather than on every variant.
const baseKey = (k) => k.replace(/_(zero|one|two|few|many|other|\d+)$/, "");

describe("catalog completeness", () => {
  const englishBases = new Set(keysOf(en).map(baseKey));

  for (const code of LOCALE_CODES.filter((c) => c !== DEFAULT_LOCALE)) {
    it(`${code} covers every English key`, () => {
      const bases = new Set(keysOf(CATALOGS[code]).map(baseKey));
      const missing = [...englishBases].filter((k) => !bases.has(k));
      // A gap falls back to English at runtime, so nothing breaks -- which is
      // exactly why it needs a test, or the gap survives to launch unnoticed.
      expect(missing).toEqual([]);
    });

    it(`${code} has no keys English doesn't`, () => {
      const extra = [...new Set(keysOf(CATALOGS[code]).map(baseKey))].filter((k) => !englishBases.has(k));
      // A stale key is dead weight shipped to every visitor of that locale.
      expect(extra).toEqual([]);
    });

    it(`${code} preserves every interpolation placeholder`, () => {
      // The failure this catches is nasty: a translator drops {{price}} and
      // the button reads "Buy for" with no number, in one language only.
      //
      // Plural variants are exempt, and that exemption is not laziness: in
      // Arabic "قطعتان" already means "two pieces", so the dual form
      // correctly carries no {{count}} at all. Forcing the placeholder in
      // would produce "2 قطعتان" -- "2 two-pieces". The `_other` form, which
      // is the one that actually takes an arbitrary number, is checked below.
      const isPluralVariant = (k) => /_(zero|one|two|few|many)$/.test(k);
      const placeholders = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort();

      for (const key of keysOf(en)) {
        if (isPluralVariant(key)) continue;
        const source = lookup(en, key);
        const target = lookup(CATALOGS[code], key);
        if (!target) continue;
        expect(`${code}/${key}: ${placeholders(target)}`).toBe(`${code}/${key}: ${placeholders(source)}`);
      }

      // Every plural variant that *does* interpolate must use only
      // placeholders English defines for that key -- a typo'd {{cout}} would
      // otherwise render literally.
      for (const key of keysOf(CATALOGS[code]).filter(isPluralVariant)) {
        const base = baseKey(key);
        const allowed = new Set(placeholders(lookup(en, `${base}_other`) || lookup(en, base) || ""));
        for (const ph of placeholders(lookup(CATALOGS[code], key))) {
          expect(`${code}/${key}: ${ph}`).toBe(`${code}/${key}: ${allowed.has(ph) ? ph : "<unknown placeholder>"}`);
        }
      }
    });

    it(`${code}'s general plural form keeps its count placeholder`, () => {
      // The `_other` form is the one that has to render an arbitrary number.
      // Dropping {{count}} there means "in stock" with no quantity.
      const other = lookup(CATALOGS[code], "common.inStock_other");
      expect(`${code}: ${other?.includes("{{count}}")}`).toBe(`${code}: true`);
    });

    it(`${code} is flagged as needing native review`, () => {
      // These were drafted, not professionally translated. The flag is the
      // honest record of that, and this test stops it being quietly dropped.
      expect(CATALOGS[code]._meta).toBeTruthy();
      expect(CATALOGS[code]._meta.reviewed).toBe(false);
    });
  }
});

describe("lookup and interpolation", () => {
  it("resolves dotted paths and returns undefined for misses", () => {
    expect(lookup(en, "common.signIn")).toBe("Sign in");
    expect(lookup(en, "common.nope")).toBeUndefined();
    expect(lookup(en, "nope.nope.nope")).toBeUndefined();
    // A path that lands on an object, not a string, is a miss not a crash.
    expect(lookup(en, "common")).toBeUndefined();
  });

  it("substitutes placeholders and leaves unknown ones alone", () => {
    expect(interpolate("Buy for {{price}}", { price: "$10" })).toBe("Buy for $10");
    expect(interpolate("Hi {{name}}, {{missing}}", { name: "A" })).toBe("Hi A, {{missing}}");
    expect(interpolate("no vars", undefined)).toBe("no vars");
  });
});

describe("plurals", () => {
  it("uses Arabic's dual and few forms, not an n===1 check", () => {
    // The whole reason Intl.PluralRules is used: `n === 1 ? one : other` is
    // wrong in Arabic, which distinguishes 1, 2, 3-10 and 11-99.
    expect(pluralKey(ar, "common.inStock", 1, "ar")).toContain("واحدة");
    expect(pluralKey(ar, "common.inStock", 2, "ar")).toContain("قطعتان");
    expect(pluralKey(ar, "common.inStock", 5, "ar")).toContain("{{count}}");
    expect(pluralKey(ar, "common.inStock", 0, "ar")).toBeTruthy();
  });

  it("picks singular and plural in English and Italian", () => {
    expect(pluralKey(en, "common.inStock", 1, "en")).toBe("{{count}} in stock");
    expect(pluralKey(itCatalog, "common.inStock", 1, "it")).toBe("{{count}} disponibile");
    expect(pluralKey(itCatalog, "common.inStock", 3, "it")).toBe("{{count}} disponibili");
  });
});

describe("the translator", () => {
  it("falls back to English for a missing key rather than showing the path", () => {
    const sparse = { common: { signIn: "ورود" } };
    const t = createTranslator({ catalog: sparse, fallback: en, locale: "fa" });
    expect(t("common.signIn")).toBe("ورود");
    // Showing "product.detail.cta_buy" to a customer is worse than showing
    // them one English word.
    expect(t("common.signOut")).toBe("Sign out");
  });

  it("degrades to readable words when a key exists nowhere", () => {
    const t = createTranslator({ catalog: {}, fallback: {}, locale: "en" });
    expect(t("some.deeply.nested_missing_key")).toBe("nested missing key");
  });

  it("reports misses so they can be caught rather than shipped", () => {
    const seen = [];
    const t = createTranslator({
      catalog: {},
      fallback: en,
      locale: "fa",
      onMissing: (key, locale) => seen.push(`${locale}:${key}`),
    });
    t("common.signIn");
    expect(seen).toContain("fa:common.signIn");
  });

  it("translates and interpolates together", () => {
    const t = createTranslator({ catalog: fr, fallback: en, locale: "fr" });
    expect(t("product.buyFor", { price: "10 000 €" })).toBe("Acheter pour 10 000 €");
  });
});

describe("locale routing", () => {
  it("serves English unprefixed and everything else under a prefix", () => {
    // English keeps the existing canonical URLs -- moving it to /en/ would
    // invalidate every link and search result that already exists.
    expect(splitLocalePath("/")).toEqual({ locale: "en", path: "/" });
    expect(splitLocalePath("/products/abc")).toEqual({ locale: "en", path: "/products/abc" });
    expect(splitLocalePath("/fa")).toEqual({ locale: "fa", path: "/" });
    expect(splitLocalePath("/fa/products/abc")).toEqual({ locale: "fa", path: "/products/abc" });
    expect(splitLocalePath("/ar/c/rejuvenation")).toEqual({ locale: "ar", path: "/c/rejuvenation" });
  });

  it("does not mistake a two-letter path segment for a locale", () => {
    // `/it` IS Italian, but an unknown pair must stay part of the path.
    expect(splitLocalePath("/zz/products")).toEqual({ locale: "en", path: "/zz/products" });
    expect(splitLocalePath("/it")).toEqual({ locale: "it", path: "/" });
  });

  it("round-trips through localePath", () => {
    for (const code of LOCALE_CODES) {
      for (const path of ["/", "/products/abc", "/c/rejuvenation", "/partners"]) {
        expect(splitLocalePath(localePath(code, path))).toEqual({ locale: code, path });
      }
    }
  });

  it("negotiates from browser preferences on the primary subtag", () => {
    expect(negotiateLocale(["fa-IR", "en-US"])).toBe("fa");
    expect(negotiateLocale(["fr-CA"])).toBe("fr");
    expect(negotiateLocale(["de-DE", "it-IT"])).toBe("it");
    expect(negotiateLocale(["de-DE"])).toBe("en");
    expect(negotiateLocale([])).toBe("en");
    expect(negotiateLocale([null, undefined])).toBe("en");
  });
});

describe("locale metadata", () => {
  it("marks Arabic and Persian right-to-left and the rest left-to-right", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("fa")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
    expect(dirOf("fr")).toBe("ltr");
    expect(dirOf("it")).toBe("ltr");
    // An unknown code must not produce `undefined` on <html dir>.
    expect(dirOf("zz")).toBe("ltr");
  });

  it("gives every locale a valid Intl tag and a native name", () => {
    for (const code of LOCALE_CODES) {
      const meta = LOCALES[code];
      expect(isLocale(code)).toBe(true);
      expect(meta.nativeName).toBeTruthy();
      // Constructing these throws on an invalid tag, which is the point.
      expect(() => new Intl.NumberFormat(meta.intl)).not.toThrow();
      expect(() => new Intl.PluralRules(meta.intl)).not.toThrow();
    }
  });
});
