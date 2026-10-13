import { m } from "framer-motion";
import { cn } from "../../lib/cn.js";

export function SegmentedControl({ options, value, onChange, className }) {
  return (
    <div className={cn("relative flex rounded-2xl border border-line bg-panel p-1", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
              active ? "text-white" : "text-ink-2"
            )}
          >
            {active && (
              <m.div
                layoutId={`segmented-${options.map((o) => o.value).join("-")}`}
                className="absolute inset-0 -z-10 rounded-xl bg-brand-gradient"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
