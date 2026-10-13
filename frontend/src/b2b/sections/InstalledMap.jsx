import { useState } from "react";
import { Chip, PillButton } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { CITIES, TOTAL_CENTERS } from "../data/installations.js";
import { IranProvinceMap } from "./IranProvinceMap.jsx";
import { cityName } from "../lib/labels.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// "Where else is this machine already running?" is the question that closes
// a medical device sale, and it is the one a brochure cannot answer. Each
// pin is a city, sized by installed count, and opens the device mix and the
// verified doctors there.
//
// The map itself is the real thing -- actual province geometry, shaded by
// installed count (see IranProvinceMap). The list below it is not a
// duplicate: it is the keyboard- and screen-reader-navigable version of the
// same data, and on a phone it is the only version that is usable at all.
export function InstalledMap() {
  const t = useT();
  const { notify } = useStorefront();
  const [selected, setSelected] = useState(null);
  const city = CITIES.find((c) => c.name === selected) || null;

  return (
    <div className="rounded-3xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <b className="text-lg font-black text-ink">{t("store.installed.title")}</b>
          <p className="text-[12px] text-ink-2">{t("store.installed.lead")}</p>
        </div>
        <Chip tone="brand">
          {t("store.installed.liveChip", { count: TOTAL_CENTERS.toLocaleString("en-US") })}
        </Chip>
      </div>

      <IranProvinceMap
        selected={selected}
        onSelect={setSelected}
        className="mt-4 h-[320px] overflow-hidden rounded-2xl border border-line bg-panel-2 p-2 sm:h-[400px]"
      />

      {/* The same nine cities as buttons. The SVG carries the geography;
          this carries the interaction for anyone not using a mouse. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CITIES.map((c) => (
          <button
            key={c.name}
            type="button"
            onClick={() => setSelected(selected === c.name ? null : c.name)}
            aria-pressed={selected === c.name}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
              selected === c.name
                ? "border-ink bg-ink text-canvas"
                : "border-line bg-panel text-ink-2 hover:text-ink"
            }`}
          >
            {cityName(t, c.name)} <span className="opacity-60">{c.count}</span>
          </button>
        ))}
      </div>

      {city ? (
        <div className="mt-4 rounded-2xl border border-line bg-panel-2 p-4 text-[13px]">
          <b className="text-ink">
            {t("store.installed.cityHeading", {
              city: cityName(t, city.name),
              count: city.count,
            })}
          </b>
          <p className="mt-1 text-ink-2">{city.devices}</p>
          <p className="mt-1 text-[12px] font-semibold text-brand-green">
            {t("store.installed.doctors", { names: city.doctors, count: city.verified })}
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-line p-4 text-center text-[12px] text-ink-3">
          {t("store.installed.prompt", { count: CITIES[0].count })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <PillButton variant="dark" className="flex-1" onClick={() => setSelected("Tehran")}>
          {t("store.installed.exploreTehran")}
        </PillButton>
        <PillButton
          variant="white"
          onClick={() =>
            notify(t("store.installed.referenceNote"))
          }
        >
          {t("store.installed.referenceCta")}
        </PillButton>
      </div>
    </div>
  );
}
