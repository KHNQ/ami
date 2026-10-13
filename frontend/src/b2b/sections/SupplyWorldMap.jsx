import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { SUPPLY_COUNTRIES } from "../data/brands.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The supply chain as an actual world map.
//
// @react-map/world is ~1.2 MB of SVG path data, which is more than the rest
// of the home page put together -- so it is behind BOTH a lazy import and an
// intersection observer. It downloads when the section is about to enter the
// viewport and not before, and never at all for a visitor who does not scroll
// that far. vite.config.js gives it its own chunk so it cannot be pulled into
// the shared vendor bundle (which would make it eager again).
const World = lazy(() => import("@react-map/world"));

// The map keys countries by full English name. Ours are stored the same way
// on the country records, with the two that differ mapped here.
const MAP_NAME = {
  USA: "United States",
  Iran: "Iran",
};

const mapName = (country) => MAP_NAME[country] || country;

/** Fires once when the element gets close to the viewport. */
function useNearViewport(margin = "300px") {
  const ref = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // No IntersectionObserver (old browser, jsdom): load immediately rather
    // than never. A heavy map is better than a missing one.
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: margin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [margin]);

  return [ref, near];
}

export function SupplyWorldMap({ selected, onSelect, className }) {
  const t = useT();
  const [hostRef, near] = useNearViewport();
  const [width, setWidth] = useState(0);

  // The component sizes itself off a `size` prop in pixels rather than
  // scaling to its container, so the container has to be measured and the
  // number fed back in. ResizeObserver rather than a resize listener, since
  // this box also changes width when the grid around it reflows.
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Origin countries get the brand fill; Iran, the destination, is inverted
  // so the map reads as "from all of these, to here" without a legend.
  const cityColors = {};
  for (const c of SUPPLY_COUNTRIES) {
    cityColors[mapName(c.country)] =
      c.country === "Iran" ? "var(--color-brand-blue)" : "var(--color-brand-green)";
  }
  if (selected) cityColors[mapName(selected)] = "var(--color-brand-teal)";

  return (
    <div ref={hostRef} className={cn("relative", className)}>
      <div ref={boxRef} className="w-full overflow-hidden">
        {near && width > 0 ? (
          <Suspense fallback={<MapSkeleton label={t("store.supply.loading")} />}>
            <World
              type="select-single"
              size={width}
              // Dotted borders: at this scale solid country outlines turn
              // Europe into a smear, and the dotted treatment is what makes
              // the map read as a diagram rather than as an atlas.
              borderStyle="dotted"
              mapColor="rgba(255,255,255,0.10)"
              strokeColor="rgba(255,255,255,0.28)"
              strokeWidth={0.6}
              hoverColor="var(--color-brand-teal)"
              selectColor="var(--color-brand-teal)"
              cityColors={cityColors}
              hints
              hintBackgroundColor="var(--color-ink)"
              hintTextColor="var(--color-canvas)"
              hintPadding="6px 10px"
              hintBorderRadius={999}
              onSelect={(country) => {
                // The map hands back its own naming; translate back to ours
                // so callers only ever deal with one vocabulary.
                const ours = SUPPLY_COUNTRIES.find((c) => mapName(c.country) === country);
                onSelect?.(ours ? ours.country : null);
              }}
            />
          </Suspense>
        ) : (
          <MapSkeleton label={t("store.supply.loading")} />
        )}
      </div>
    </div>
  );
}

function MapSkeleton({ label }) {
  return (
    <div
      aria-hidden
      className="flex h-[220px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase sm:h-[280px]"
    >
      {label}
    </div>
  );
}
