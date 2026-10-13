import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";

// A section wrapper whose background tint shifts as it moves through the
// viewport, so scrolling the home page reads as passing through zones rather
// than down one flat sheet.
//
// The tint is driven by a CSS custom property rather than by re-rendering:
// the scroll handler writes `--tint` on the element and the gradient reads
// it, so a scroll never triggers React work. `@property` in index.css
// declares it as a percentage, which is what makes it interpolate smoothly
// instead of snapping between values.
//
// Under prefers-reduced-motion the tint is fixed at its midpoint. A
// background that changes as you scroll is exactly the kind of motion that
// preference is asking us to stop.
export function ScrollTint({
  from = "var(--color-brand-green)",
  to = "var(--color-brand-blue)",
  strength = 7,
  className,
  children,
  ...props
}) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (reduced) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 as the section enters from below, 1 as it leaves past the top.
      const progress = Math.min(1, Math.max(0, 1 - (rect.top + rect.height * 0.35) / vh));
      el.style.setProperty("--tint", `${Math.round(progress * 100)}%`);
    };

    const onScroll = () => {
      // Coalesce to one write per frame: a scroll event can fire far more
      // often than the browser paints, and every extra write is wasted.
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    setReady(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      style={{
        // Two stops that slide past each other as --tint moves, so the
        // section crossfades from one brand colour to the other rather than
        // simply getting darker.
        backgroundImage: `linear-gradient(160deg,
          color-mix(in oklab, ${from} ${strength}%, transparent) 0%,
          transparent var(--tint, ${reduced || !ready ? "50%" : "0%"}),
          color-mix(in oklab, ${to} ${strength}%, transparent) 100%)`,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
