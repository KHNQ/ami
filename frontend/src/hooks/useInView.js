import { useEffect, useLayoutEffect, useRef, useState } from "react";

// useLayoutEffect warns when it runs during server rendering (it can't do
// anything useful there), so fall back to useEffect on the server. The
// distinction matters below: the hide step has to happen before the browser
// paints, or the element flashes visible and then disappears.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Fires once when an element first scrolls into view.
 *
 * Starts **revealed** and hides itself on mount, rather than starting hidden.
 *
 * That ordering is the whole point. These pages are server-rendered for
 * crawlers and link-preview bots, so if the markup shipped with
 * `opacity: 0` baked in, a client that never runs this code -- a crawler that
 * doesn't execute JS, or any visitor whose JS chunk fails to load -- would be
 * left staring at content that is permanently invisible. Reveal-on-scroll is
 * decoration; it must never be the reason the page is unreadable.
 *
 * Hiding only happens for elements that are *already below the fold*, which
 * by definition the visitor cannot see, so nothing ever flashes out. Anything
 * already on screen simply stays visible -- it would have revealed
 * immediately anyway. This mirrors what HomeHeroMotion does for the home
 * page's own reveals.
 *
 * One-shot: content that fades back out on scroll-up and re-animates on the
 * way down reads as a glitch, so the observer disconnects after firing.
 */
export function useInView({ rootMargin = "0px 0px -12% 0px", threshold = 0.12, enabled = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(true);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;

    // Above or on the fold: leave it visible. Hiding it here is what would
    // cause a visible flash, and it has nothing to gain -- the observer
    // would fire on the very next tick regardless.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) return undefined;

    setInView(false);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setInView(true);
        observer.disconnect();
      },
      { rootMargin, threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold, enabled]);

  return [ref, inView];
}
