// Pure scroll-progress -> visual-state math for the product showcase.
//
// Split out of ProductShowcaseMotion (which imports gsap and three) so the
// curve itself can be tested directly, since none of it is reachable from
// jsdom otherwise.
//
// The 3D stage is the device alone now: the real product photograph sits
// inline in the description as a tappable thumbnail rather than being
// layered over the model, where it only ever hid what it was introducing.

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Assembly completes at 62% of the scroll so the device is still visibly
// coming together while the description is being read.
const ASSEMBLE_END = 0.62;
// Handoff: past this the model steps back and the specs own the page.
const HANDOFF = 0.74;

export function showcaseFrame(progress) {
  const p = clamp01(progress);
  const assemble = clamp01(p / ASSEMBLE_END);
  const handoff = clamp01((p - HANDOFF) / (1 - HANDOFF));

  return {
    assemble,
    explode: 1 - assemble,
    // Aura swells with the assembly, then dims on handoff so text scrolling
    // over the device stays readable.
    auraOpacity: Math.max(0, 0.12 + assemble * 0.5 - clamp01((p - 0.72) / 0.28) * 0.45),
    canvasOpacity: 1 - handoff * 0.72,
    // Slow orbit, so the device is seen from every side on the way down.
    lookX: p * 2.2 - 0.5,
    lookY: -0.08,
  };
}
