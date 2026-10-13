import { cn } from "../../lib/cn.js";

// The signed-in screens' card.
//
// It used to be the commerce app's dark-glass surface (`bg-base-850/80`,
// `border-surface/8`, a backdrop blur). Those screens now render inside the
// storefront shell, on its opaque light canvas, where a translucent panel
// over a white page is a smear rather than a card -- so this is the
// storefront's surface instead: white, hairline rule, generous radius. Same
// component, same call sites, one visual system across the whole site.
export function Card({ className, children, glow = false, ...props }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border border-line bg-panel",
        glow && "shadow-[0_0_40px_-12px_color-mix(in_oklab,var(--color-brand-blue)_28%,transparent)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
