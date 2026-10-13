import { useState } from "react";
import { DeepPanel } from "../ui/primitives.jsx";
import { BRAND_CARDS, SUPPLY_COUNTRIES } from "../data/brands.js";
import { SupplyWorldMap } from "./SupplyWorldMap.jsx";
import { LogoCarousel } from "./LogoCarousel.jsx";
import { TextureOverlay } from "../../components/cult/texture-overlay.jsx";
import { countryName } from "../lib/labels.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The supply chain, stated as an argument rather than a logo wall: every
// brand here is a direct exclusive representation, which is what makes 48-
// hour service and genuine parts possible. A reseller cannot promise either.
//
// The map is the argument's evidence -- seven origin countries lit up, one
// destination, and no intermediate hop between them.
export function SupplyChain() {
  const t = useT();
  const [selected, setSelected] = useState(null);
  const country = SUPPLY_COUNTRIES.find((c) => c.country === selected) || null;
  // Brand cards for the selected origin, so clicking Korea on the map
  // answers "what do you bring in from there" rather than just highlighting.
  const brands = country
    ? BRAND_CARDS.filter((b) => country.brands.some((n) => b.name.includes(n.split(" ")[0])))
    : BRAND_CARDS;

  return (
    <DeepPanel className="relative p-5 sm:p-6">
      {/* Hatch rather than dots: on an inverted panel a dot matrix
          disappears into the gradient behind it. */}
      <TextureOverlay variant="hatch" mask="y" opacity={0.45} className="mix-blend-overlay" />
      <b className="relative text-lg font-black text-white">{t("store.supply.title")}</b>
      <p className="relative mt-1 text-[13px] text-white/60">{t("store.supply.lead")}</p>

      <SupplyWorldMap
        selected={selected}
        onSelect={setSelected}
        className="mt-4 rounded-2xl border border-white/12 bg-white/5 p-2"
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUPPLY_COUNTRIES.map((c) => (
          <button
            key={c.country}
            type="button"
            onClick={() => setSelected(selected === c.country ? null : c.country)}
            aria-pressed={selected === c.country}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
              selected === c.country
                ? "border-transparent bg-white text-ink"
                : "border-white/20 bg-white/8 text-white/70 hover:text-white"
            }`}
          >
            <span aria-hidden className="me-1">
              {c.flag}
            </span>
            {countryName(t, c.country)}
          </button>
        ))}
      </div>

      {/* Nothing selected: the roster cycles, because twelve marks do not
          fit as a static row at a size worth reading them at. Country
          selected: the grid, filtered -- an animated wall would be the wrong
          answer to "what do you bring in from Korea", which is a question
          about a specific short list. */}
      {!country ? (
        <LogoCarousel className="relative mt-3" columnCount={4} />
      ) : (
      <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {brands.map((b) => (
          <div
            key={b.name}
            className="flex items-center gap-2.5 rounded-2xl border border-white/12 bg-white/8 p-3"
          >
            {/* The mark, where we have it on file. `onError` hides it rather
                than leaving a broken-image icon on a page whose whole point
                is that these partnerships are real. */}
            {b.logo ? (
              <img
                src={b.logo}
                alt=""
                loading="lazy"
                className="h-8 w-8 shrink-0 rounded-lg bg-white/90 object-contain p-1"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <span className="min-w-0 text-[11px] leading-tight">
              <b className="block truncate text-white">
                <span aria-hidden className="me-1">
                  {b.flag}
                </span>
                {b.name}
              </b>
              <span className="block truncate text-white/55">{b.note}</span>
            </span>
          </div>
        ))}
      </div>
      )}

      {country ? (
        <p className="relative mt-3 text-[12px] text-white/60">
          <b className="text-white">
            {country.flag} {countryName(t, country.country)}
          </b>{" "}
          — {country.brands.join(" · ")}
        </p>
      ) : null}
    </DeepPanel>
  );
}
