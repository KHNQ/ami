import { useInView } from "../../hooks/useInView.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { cn } from "../../lib/cn.js";

// Scroll-triggered reveals, shared across every page.
//
// Plain CSS transitions on transform/opacity driven by one IntersectionObserver
// per element -- not GSAP. GSAP is already ~112KB and is loaded only by the
// two pages that genuinely need scroll *scrubbing*; making every marketing
// page pull it in to fade a heading up 20px would be a bad trade. transform
// and opacity are the two properties the compositor can animate without
// touching layout or paint, so this stays smooth on a mid-range phone.
//
// Under `prefers-reduced-motion` these render as plain, already-visible
// elements: no transform, no transition, no observer.

const DIRECTIONS = {
  up: "translate3d(0, 22px, 0)",
  down: "translate3d(0, -22px, 0)",
  left: "translate3d(24px, 0, 0)",
  right: "translate3d(-24px, 0, 0)",
  scale: "scale(0.94)",
  none: "none",
};

export function Reveal({
  children,
  as: Tag = "div",
  from = "up",
  delay = 0,
  duration = 620,
  className,
  ...rest
}) {
  const reducedMotion = useReducedMotion();
  const [ref, inView] = useInView({ enabled: !reducedMotion });

  if (reducedMotion) {
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref}
      className={cn("will-change-[transform,opacity]", className)}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : DIRECTIONS[from] || DIRECTIONS.up,
        // No transition on the way *out*. The element starts visible (so the
        // server-rendered markup is readable without JS -- see useInView) and
        // is hidden on mount only when it is already below the fold. That
        // hide must be instant: animating it would mean a visitor who scrolls
        // down immediately catches it fading away before it fades back in.
        transition: inView
          ? `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`
          : "none",
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Staggers its children, one reveal each.
 *
 * Takes the children as an array and wraps each, rather than asking every
 * call site to compute its own per-item delay -- that arithmetic is where
 * stagger code usually goes wrong.
 */
export function RevealGroup({ children, stagger = 70, from = "up", className, ...rest }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className={className} {...rest}>
      {items.map((child, i) => (
        <Reveal key={i} from={from} delay={i * stagger}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
