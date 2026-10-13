import { Link } from "react-router-dom";
import { cn } from "@shared/lib/cn.js";

// Figures, at two levels of importance.
//
// Two decisions here come straight from how numbers are actually read:
//
// `tabular-nums` everywhere. Proportional digits change width as a value
// changes, so a figure that updates appears to jitter, and a column of them
// fails to align on the decimal point. In a tool whose whole job is comparing
// money down a column, that is not a detail.
//
// Colour is reserved for *state*, never decoration. A tile is tinted only when
// its number means something is wrong or waiting -- so an amber tile always
// means "someone must act", and a wall of tiles has at most one or two things
// pulling the eye. Tinting them all, which is the tempting version, conveys
// exactly as much as tinting none.

const TONES = {
  default: { value: "text-fg", accent: "" },
  brand: { value: "text-gradient", accent: "" },
  // Semantic. These carry meaning and are not interchangeable with each other.
  good: { value: "text-fg", accent: "text-brand-green" },
  warning: { value: "text-fg", accent: "text-amber-500" },
  critical: { value: "text-fg", accent: "text-rose-500" },
};

export function StatTile({ label, value, sub, tone = "default", icon, hero = false, className }) {
  const t = TONES[tone] || TONES.default;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-surface/8 bg-surface/[0.025] p-4 transition-colors hover:border-surface/14",
        className
      )}
    >
      <div className="flex items-center gap-2">
        {icon && <span className={cn("shrink-0", t.accent || "text-fg/30")}>{icon}</span>}
        <span className="truncate text-[11.5px] font-semibold uppercase tracking-[0.07em] text-fg/40">{label}</span>
      </div>

      <div
        className={cn(
          "mt-2 font-extrabold tabular-nums tracking-tight",
          // The hero variant exists so a dashboard has ONE number that is
          // obviously the headline. A grid where every figure is the same
          // size has no hierarchy, so the eye has to read all of them.
          hero ? "text-[clamp(28px,4vw,38px)] leading-none" : "text-[21px] leading-none",
          t.value
        )}
      >
        {value}
      </div>

      {sub && <div className="mt-1.5 text-[12px] text-fg/40">{sub}</div>}
    </div>
  );
}

/**
 * A count that needs attention, rendered as a link.
 *
 * Separate from StatTile because it answers a different question: not "how is
 * the business doing" but "what is waiting for me". It is only ever tinted
 * when the count is non-zero -- an empty queue is good news and should look
 * like the calm default rather than a warning nobody needs to act on.
 */
export function QueueTile({ label, count, to, tone = "warning", icon }) {
  const active = count > 0;
  const accent =
    tone === "critical"
      ? "border-rose-500/25 bg-rose-500/[0.06] text-rose-500"
      : "border-amber-500/25 bg-amber-500/[0.06] text-amber-500";

  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3.5 transition-colors",
        active ? accent : "border-surface/8 bg-surface/[0.02] hover:border-surface/14"
      )}
    >
      {icon && <span className={cn("shrink-0", active ? "" : "text-fg/25")}>{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className={cn("text-[19px] font-extrabold tabular-nums leading-none", active ? "" : "text-fg/70")}>
          {count}
        </div>
        <div className={cn("mt-1 truncate text-[12px]", active ? "opacity-80" : "text-fg/40")}>{label}</div>
      </div>
    </Link>
  );
}
