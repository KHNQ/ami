import { useMemo, useState } from "react";
import { cn } from "../../lib/cn.js";
import { IRAN_PROVINCES } from "../data/iran/provinces.js";
import { IRAN_BORDER, CASPIAN_D, PERSIAN_GULF_D } from "../data/iran/outline.js";
import { CITIES } from "../data/installations.js";
import { cityName } from "../lib/labels.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The installed base, on the real map.
//
// This replaces the stylised silhouette that stood here before. That shape
// was a diagram of Iran, and pins placed on a diagram are decoration --
// a doctor in Kerman looking for their own province could not find it. These
// are the actual province boundaries (see data/iran/provinces.js), so a
// province lights up where it really is and a pin sits where the city
// really is.
//
// Provinces are shaded by how many units are installed in them, so the
// national picture reads before any interaction: Tehran is dark, the
// provinces we have not reached are empty.

const VIEW_BOX = "20 0 970 960";

/**
 * Centre of a province, derived from its own path data.
 *
 * The alternative is measuring rendered elements with getBBox(), which
 * needs a live SVG in the DOM and therefore does not work server-side. The
 * path strings are just numbers, so the mean of the coordinate pairs is
 * computable anywhere and is stable across renders. It is a centroid of
 * control points rather than of area -- close enough to place a pin, and
 * for the handful of provinces where it drifts, `pin` below overrides it.
 */
function pathCentre(d) {
  const nums = d.match(/-?\d*\.?\d+/g);
  if (!nums || nums.length < 2) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    sx += Number(nums[i]);
    sy += Number(nums[i + 1]);
    n++;
  }
  return { x: sx / n, y: sy / n };
}

// Which province each installed-base city sits in.
//
// `pin` overrides the province centroid for cities the centroid represents
// badly -- Tehran city sits in the south of a province whose centroid is
// well north of it, and Mashhad is in the far east of a province spanning a
// third of the country.
//
// `label` nudges the text only. Karaj is genuinely 35 km from Tehran, so at
// national scale the two markers are always going to be on top of each
// other; moving the pin to fix that would be a lie about where the city is,
// so the label moves instead and the marker stays honest.
const CITY_PROVINCE = {
  Tehran: { province: "tehran", pin: { x: 356, y: 258 }, label: { dx: 26, dy: 0 } },
  Isfahan: { province: "isfahan" },
  Shiraz: { province: "fars", pin: { x: 405, y: 545 } },
  Mashhad: { province: "khorasan-razavi", pin: { x: 700, y: 190 } },
  Tabriz: { province: "azerbaijan-east", pin: { x: 150, y: 120 } },
  Ahvaz: { province: "khuzestan" },
  Karaj: { province: "alborz", pin: { x: 322, y: 244 }, label: { dx: -34, dy: -14 } },
  Yazd: { province: "yazd" },
  Kerman: { province: "kerman", pin: { x: 620, y: 520 } },
};

export function IranProvinceMap({ selected, onSelect, className }) {
  const t = useT();
  const [hovered, setHovered] = useState(null);

  // Installed units per province, and the pin position for each city.
  const { byProvince, pins, max } = useMemo(() => {
    const centres = new Map(IRAN_PROVINCES.map((p) => [p.className, pathCentre(p.d)]));
    const counts = new Map();
    const placed = [];

    for (const city of CITIES) {
      const link = CITY_PROVINCE[city.name];
      if (!link) continue;
      counts.set(link.province, (counts.get(link.province) || 0) + city.count);
      const centre = link.pin || centres.get(link.province) || { x: 0, y: 0 };
      placed.push({
        ...city,
        ...centre,
        province: link.province,
        labelDx: link.label?.dx || 0,
        labelDy: link.label?.dy || 0,
      });
    }

    return {
      byProvince: counts,
      pins: placed,
      max: Math.max(...counts.values(), 1),
    };
  }, []);

  const selectedProvince = selected ? CITY_PROVINCE[selected]?.province : null;

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={VIEW_BOX}
        className="h-full w-full"
        role="img"
        aria-label={t("store.installed.mapAria")}
      >
        {/* Water first, so the coastline reads even where a province ends. */}
        <path d={CASPIAN_D} className="fill-brand-blue/12" />
        <path d={PERSIAN_GULF_D} className="fill-brand-blue/12" />

        {/* National outline under the provinces: it closes the small gaps
            between neighbouring province paths, which otherwise show as
            hairline cracks through the whole country. */}
        <path d={IRAN_BORDER} className="fill-panel-2 stroke-line" strokeWidth={2} />

        {IRAN_PROVINCES.map((province) => {
          const count = byProvince.get(province.className) || 0;
          const isSelected = selectedProvince === province.className;
          const isHovered = hovered === province.className;
          // Shade by share of the largest province rather than by absolute
          // count: Tehran is five times the next one, so a linear absolute
          // scale would render everywhere else as effectively blank.
          const intensity = count > 0 ? 0.18 + (count / max) * 0.62 : 0;

          return (
            <path
              key={province.className}
              d={province.d}
              onMouseEnter={() => setHovered(province.className)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "transition-[fill,stroke] duration-150",
                count > 0 ? "cursor-pointer" : "cursor-default"
              )}
              style={{
                fill:
                  isSelected || isHovered
                    ? "var(--color-brand-green)"
                    : count > 0
                      ? `color-mix(in oklab, var(--color-brand-green) ${Math.round(intensity * 100)}%, var(--color-panel))`
                      : "var(--color-panel)",
                stroke: "var(--color-line)",
                strokeWidth: 1.4,
              }}
            >
              {/* Native tooltip: the province name in Persian, as printed on
                  the source map, plus what is installed there. */}
              <title>
                {province.name}
                {count > 0 ? ` — ${count} installed` : ""}
              </title>
            </path>
          );
        })}

        {/* City pins on top of the shading. The province tells you roughly
            where; the pin tells you which city, which is what a buyer
            actually asked. */}
        {pins.map((pin) => {
          const isSelected = selected === pin.name;
          return (
            <g
              key={pin.name}
              onClick={() => onSelect?.(isSelected ? null : pin.name)}
              onMouseEnter={() => setHovered(pin.province)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={t("store.installed.pinAria", {
                city: cityName(t, pin.name),
                count: pin.count,
              })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(isSelected ? null : pin.name);
                }
              }}
            >
              {/* Explicit hit area. Without it the click target is the
                  group's bounding box, which now spans the offset label
                  too -- so a click aimed between marker and text landed on
                  nothing. Also gives a finger a target worth aiming at. */}
              <circle cx={pin.x} cy={pin.y} r={20} fill="transparent" />
              <circle
                cx={pin.x}
                cy={pin.y}
                // Scaled by installed count, so the hub reads as the hub.
                r={7 + Math.min(9, pin.count / 48)}
                className={cn(
                  "transition-all",
                  isSelected ? "fill-ink" : "fill-brand-green hover:fill-ink"
                )}
                stroke="var(--color-panel)"
                strokeWidth={3}
              />
              <text
                x={pin.x + pin.labelDx}
                y={pin.y - 16 + pin.labelDy}
                textAnchor="middle"
                className="pointer-events-none fill-ink text-[15px] font-black"
                // A halo, so a label crossing a dark province stays
                // readable without a background plate behind it.
                stroke="var(--color-panel)"
                strokeWidth={4}
                paintOrder="stroke"
              >
                {cityName(t, pin.name)}
              </text>
              <text
                x={pin.x + pin.labelDx}
                y={pin.y + 2 + pin.labelDy}
                textAnchor="middle"
                className="pointer-events-none fill-ink-2 text-[13px] font-bold"
                stroke="var(--color-panel)"
                strokeWidth={4}
                paintOrder="stroke"
              >
                {pin.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
