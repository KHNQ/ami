import { useEffect, useRef, useState } from "react";
import { Building2, Cpu, Stethoscope, Timer } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Card, CardContent } from "@/components/shadcn/card.jsx";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { TOTAL_CENTERS, TOTAL_DOCTORS } from "../data/installations.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The four numbers that establish the company, counted up as they scroll in.
//
// The count is the point: a static "1,247" is a claim, while a number that
// runs up to it reads as a measurement. It fires once, on entry, and only
// when the row is actually visible -- a counter that has finished before you
// scroll to it has animated for nobody.
//
// Under prefers-reduced-motion the final value renders immediately. That is
// the whole accommodation: no count, no hover lift, no icon movement.

function useCountUp(target, { enabled, duration = 1400 }) {
  const [value, setValue] = useState(enabled ? 0 : target);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo: most of the distance covered early, then a settle, so
      // the number feels like it is landing rather than ticking.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);

  return value;
}

const STATS = [
  {
    id: "centers",
    icon: Building2,
    value: TOTAL_CENTERS,
    format: (n) => n.toLocaleString("en-US"),
    labelKey: "store.feature.installations.statCenters",
    noteKey: "store.stats.centersNote",
    tint: "text-brand-green",
  },
  {
    id: "doctors",
    icon: Stethoscope,
    value: TOTAL_DOCTORS,
    format: (n) => `${n.toLocaleString("en-US")}+`,
    labelKey: "store.feature.installations.statDoctors",
    noteKey: "store.stats.doctorsNote",
    tint: "text-brand-blue",
  },
  {
    id: "devices",
    icon: Cpu,
    value: 13,
    format: (n) => String(n),
    labelKey: "store.stats.devicesLabel",
    noteKey: "store.stats.devicesNote",
    tint: "text-brand-teal",
  },
  {
    id: "importer",
    icon: Timer,
    value: 20,
    // "20+ yrs" has to be a catalog string, not a template: the unit does
    // not sit after the number in every language.
    format: (n, t) => t("store.stats.importerYears", { count: n }),
    labelKey: "store.stats.importerLabel",
    noteKey: "store.stats.slaNote",
    tint: "text-amber-500",
    dark: true,
  },
];

function StatCard({ stat, run }) {
  const t = useT();
  const value = useCountUp(stat.value, { enabled: run });
  const Icon = stat.icon;

  return (
    <Card
      className={cn(
        "group relative gap-0 overflow-hidden rounded-2xl py-0 transition-all duration-300",
        "hover:-translate-y-1 hover:shadow-[0_18px_40px_-18px_color-mix(in_oklab,var(--color-ink)_45%,transparent)]",
        stat.dark ? "border-transparent bg-ink text-canvas" : "border-line bg-panel"
      )}
    >
      {/* A wash that only appears on hover, so a row of four does not read as
          four competing coloured tiles at rest. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-green/8 to-brand-blue/8 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <CardContent className="relative p-4">
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
            stat.dark ? "bg-canvas/10" : "bg-panel-2",
            stat.tint
          )}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <b className="b2b-tnum mt-2.5 block text-2xl font-black sm:text-[28px]">
          {stat.format(value, t)}
        </b>
        <span
          className={cn(
            "block text-[10px] font-extrabold tracking-[0.08em] uppercase",
            stat.dark ? "text-canvas/60" : "text-ink-2"
          )}
        >
          {t(stat.labelKey)}
        </span>
        <span className={cn("mt-1 block text-[11px]", stat.dark ? "text-canvas/45" : "text-ink-3")}>
          {t(stat.noteKey)}
        </span>
      </CardContent>
    </Card>
  );
}

export function StatsRow({ className }) {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (reduced) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setRun(true);
        observer.disconnect();
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <div ref={ref} className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {STATS.map((stat) => (
        <StatCard key={stat.id} stat={stat} run={run && !reduced} />
      ))}
    </div>
  );
}
