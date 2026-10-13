import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Sparkles } from "lucide-react";
import { DeviceCard } from "./DeviceCard.jsx";
import { FilterPill, PillButton, TextInput } from "../ui/primitives.jsx";
import { StatsRow } from "./StatsRow.jsx";
import { CATEGORIES, COUNTRIES } from "../data/devices.js";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { countryName } from "../lib/labels.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The shop. Category, country and free-text filters over the whole
// catalogue, with the filter state mirrored into the query string so a
// filtered view is a link a doctor can send to a colleague or a procurement
// manager -- which is exactly how these decisions get made.
//
// Search is deliberately matched across name, indications, wavelength,
// country, brand and the highlight bullets: a buyer types "melasma" or
// "fat freezing", not "Pico Premium".
function matches(device, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    device.name,
    device.brand,
    device.country,
    device.indications,
    device.wavelength,
    device.tagline,
    device.cooling,
    ...(device.highlights || []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function DeviceShop({ compact = false }) {
  const t = useT();
  // Live rows, so a device an admin discontinues disappears from the grid
  // and the counts without a redeploy.
  const { devices } = useCatalogue();
  const [params, setParams] = useSearchParams();
  const category = params.get("cat") || "all";
  const [countries, setCountries] = useState(() => new Set());
  const [query, setQuery] = useState("");

  const setCategory = (cat) => {
    const next = new URLSearchParams(params);
    if (cat === "all") next.delete("cat");
    else next.set("cat", cat);
    // replace, not push: cycling through six filters should not fill the
    // back button with states nobody wants to return through.
    setParams(next, { replace: true });
  };

  const toggleCountry = (name) => {
    setCountries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filtered = useMemo(
    () =>
      devices.filter(
        (d) =>
          (category === "all" || d.cat === category) &&
          (countries.size === 0 || countries.has(d.country)) &&
          matches(d, query)
      ),
    [devices, category, countries, query]
  );

  // Counted off the live list rather than the bundled one, so the number on
  // a filter pill always matches what clicking it produces.
  const countIn = (catId) =>
    catId === "all" ? devices.length : devices.filter((d) => d.cat === catId).length;

  return (
    <section id="shop" className="b2b-container mt-6 scroll-mt-24">
      <div className="rounded-3xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <b className="me-1 text-[13px] font-black text-ink">
            {t("store.shop.categoryLabel")}
          </b>
          {CATEGORIES.map((cat) => (
            <FilterPill
              key={cat.id}
              active={category === cat.id}
              onClick={() => setCategory(cat.id)}
            >
              {t(`store.cat.${cat.id}`)}
              <span className="ms-1 opacity-60">({countIn(cat.id)})</span>
            </FilterPill>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <b className="me-1 text-[13px] font-black text-ink">
            {t("store.shop.originLabel")}
          </b>
          {COUNTRIES.map((c) => (
            <FilterPill
              key={c.name}
              tone="teal"
              active={countries.has(c.name)}
              onClick={() => toggleCountry(c.name)}
            >
              {c.flag} {countryName(t, c.short)}
            </FilterPill>
          ))}
          {countries.size > 0 ? (
            <FilterPill onClick={() => setCountries(new Set())}>{t("store.shop.clear")}</FilterPill>
          ) : null}
        </div>

        <div id="search" className="mt-3 flex flex-wrap gap-2 scroll-mt-28">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("store.shop.searchPlaceholder")}
              className="rounded-full ps-10"
              aria-label={t("store.shop.searchAria")}
            />
          </div>
          <PillButton as={Link} to="/tools#matcher" variant="white">
            <Sparkles className="h-3.5 w-3.5" />
            {t("store.shop.matcherCta")}
          </PillButton>
        </div>
      </div>

      {!compact ? <StatsRow className="mt-4" /> : null}

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-line bg-panel p-10 text-center text-sm text-ink-2">
          {t("store.shop.noMatch", { count: devices.length })}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filtered.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}

      <p className="mt-3 text-center text-[12px] text-ink-2">
        {t("store.shop.showing", { shown: filtered.length, total: devices.length })}
      </p>
    </section>
  );
}
