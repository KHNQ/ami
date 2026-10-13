import { describe, test, expect } from "vitest";
import { showcaseFrame } from "../src/components/products/showcaseFrame.js";

// The product page's 3D device assembles itself as the description is
// read. These guard the shape of that curve -- above all, that it starts
// from a genuinely un-started state, since a choreography whose progress is
// already advanced on first paint is what previously made the page open
// mid-animation.
describe("product showcase scroll curve", () => {
  test("at rest the device is fully in pieces and the stage is at full strength", () => {
    const f = showcaseFrame(0);
    expect(f.explode).toBe(1);
    expect(f.assemble).toBe(0);
    expect(f.canvasOpacity).toBe(1);
  });

  test("the device is fully assembled by the end of the description", () => {
    expect(showcaseFrame(0.62).assemble).toBeCloseTo(1, 5);
    expect(showcaseFrame(1).explode).toBe(0);
    // Assembly only ever moves forward as you scroll down.
    let previous = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const { assemble } = showcaseFrame(p);
      expect(assemble).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = assemble;
    }
  });

  test("every output stays inside its legal range across the whole scroll", () => {
    for (let p = -0.5; p <= 1.5; p += 0.01) {
      const f = showcaseFrame(p);
      for (const key of ["assemble", "explode", "auraOpacity", "canvasOpacity"]) {
        expect(f[key]).toBeGreaterThanOrEqual(0);
        expect(f[key]).toBeLessThanOrEqual(1);
      }
      expect(Number.isFinite(f.lookX)).toBe(true);
    }
  });

  test("the model dims for the handoff but never disappears entirely", () => {
    expect(showcaseFrame(0.5).canvasOpacity).toBe(1);
    expect(showcaseFrame(1).canvasOpacity).toBeLessThan(0.4);
    expect(showcaseFrame(1).canvasOpacity).toBeGreaterThan(0.1);
  });
});
