// A highlight that follows the cursor across every card on the page.
//
// One delegated `pointermove` on the document, not a listener per card. A
// storefront page renders forty-odd cards; forty listeners and forty pieces
// of React state would re-render the tree on every mouse move, which is how
// a "premium" effect turns into a janky one.
//
// What actually moves is two CSS custom properties on the hovered element.
// The paint is a radial-gradient in a ::before that the compositor owns, so
// the main thread does one style write per frame and nothing else. Writes are
// batched into a rAF so a fast sweep across the page costs one write per
// frame rather than one per event.
//
// Skipped entirely for a visitor who asked for reduced motion, and for coarse
// pointers -- there is no cursor to follow on a phone, and the listener would
// be pure cost.

const SELECTOR = "[data-spotlight]";

let frame = 0;
let pending = null;
let active = null;

function paint() {
  frame = 0;
  if (!pending) return;
  const { el, x, y } = pending;
  pending = null;
  el.style.setProperty("--spot-x", `${x}px`);
  el.style.setProperty("--spot-y", `${y}px`);
}

function onMove(event) {
  const el = event.target instanceof Element ? event.target.closest(SELECTOR) : null;

  if (el !== active) {
    // Fade the old one out by dropping its opacity var; the gradient itself
    // stays in place so there is nothing to re-create on the next hover.
    if (active) active.style.setProperty("--spot-opacity", "0");
    active = el;
    if (active) active.style.setProperty("--spot-opacity", "1");
  }
  if (!el) return;

  const rect = el.getBoundingClientRect();
  pending = { el, x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (!frame) frame = requestAnimationFrame(paint);
}

function onLeave() {
  if (active) active.style.setProperty("--spot-opacity", "0");
  active = null;
}

/** Starts the effect. Returns a teardown, so a caller can be an effect. */
export function startPointerSpotlight() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  if (reduced || coarse) return () => {};

  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", onLeave, { passive: true });
  window.addEventListener("blur", onLeave, { passive: true });

  return () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onLeave);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    onLeave();
  };
}
