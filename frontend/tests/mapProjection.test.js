import { describe, it, expect } from "vitest";
import { project, unproject, haversineKm, arcPoints, arcHead } from "../src/lib/mapProjection.js";

const TEHRAN = { lat: 35.7575, lng: 51.4103 };
const SEOUL = { lat: 37.5665, lng: 126.978 };
const LONDON = { lat: 51.5072, lng: -0.1276 };

describe("equirectangular projection", () => {
  it("puts the origin at the centre of the image", () => {
    const p = project(0, 0);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });

  it("maps the corners to the unit square", () => {
    expect(project(-180, 90)).toEqual({ x: 0, y: 0 });
    expect(project(180, -90)).toEqual({ x: 1, y: 1 });
  });

  it("places real cities where they belong", () => {
    // Tehran is north of the equator and east of Greenwich, so upper-right
    // quadrant. A sign error here would silently drop every pin in the sea.
    const t = project(TEHRAN.lng, TEHRAN.lat);
    expect(t.x).toBeGreaterThan(0.5);
    expect(t.y).toBeLessThan(0.5);

    // Seoul is further east than Tehran.
    expect(project(SEOUL.lng, SEOUL.lat).x).toBeGreaterThan(t.x);
    // London is west of Greenwich, so just left of centre.
    expect(project(LONDON.lng, LONDON.lat).x).toBeLessThan(0.5);
  });

  it("round-trips through unproject", () => {
    const { x, y } = project(TEHRAN.lng, TEHRAN.lat);
    const back = unproject(x, y);
    expect(back.lng).toBeCloseTo(TEHRAN.lng, 6);
    expect(back.lat).toBeCloseTo(TEHRAN.lat, 6);
  });
});

describe("great-circle distance", () => {
  it("agrees with known distances to within a percent", () => {
    // Tehran -> Seoul is roughly 6,700km; Tehran -> London roughly 4,400km.
    expect(haversineKm(TEHRAN, SEOUL)).toBeGreaterThan(6300);
    expect(haversineKm(TEHRAN, SEOUL)).toBeLessThan(7100);
    expect(haversineKm(TEHRAN, LONDON)).toBeGreaterThan(4100);
    expect(haversineKm(TEHRAN, LONDON)).toBeLessThan(4700);
  });

  it("is zero for a point to itself, and symmetric", () => {
    expect(haversineKm(TEHRAN, TEHRAN)).toBeCloseTo(0, 6);
    expect(haversineKm(TEHRAN, SEOUL)).toBeCloseTo(haversineKm(SEOUL, TEHRAN), 6);
  });
});

describe("arcs", () => {
  it("starts and ends exactly on its endpoints", () => {
    // If an arc misses its pin the map looks broken in a way that is hard to
    // describe and easy to ship.
    const pts = arcPoints(TEHRAN, SEOUL);
    const a = project(TEHRAN.lng, TEHRAN.lat);
    const b = project(SEOUL.lng, SEOUL.lat);
    expect(pts[0].x).toBeCloseTo(a.x, 6);
    expect(pts[0].y).toBeCloseTo(a.y, 6);
    expect(pts[pts.length - 1].x).toBeCloseTo(b.x, 6);
    expect(pts[pts.length - 1].y).toBeCloseTo(b.y, 6);
  });

  it("bows upward, never below the endpoints", () => {
    const pts = arcPoints(TEHRAN, SEOUL);
    const endpointY = Math.min(pts[0].y, pts[pts.length - 1].y);
    const apex = Math.min(...pts.map((p) => p.y));
    // Smaller y is higher on screen; an arc dipping below would read as a
    // tunnel rather than a route.
    expect(apex).toBeLessThan(endpointY);
  });

  it("bows further for longer routes", () => {
    const near = arcPoints({ lat: 45.4, lng: 10.99 }, { lat: 46.05, lng: 14.5 }); // Verona -> Ljubljana
    const far = arcPoints(TEHRAN, { lat: 33.19, lng: -96.63 }); // Tehran -> Texas
    const lift = (pts) => {
      const mid = (pts[0].y + pts[pts.length - 1].y) / 2;
      return mid - Math.min(...pts.map((p) => p.y));
    };
    expect(lift(far)).toBeGreaterThan(lift(near));
  });

  it("stays on the canvas even for the longest route", () => {
    const far = arcPoints({ lat: -40, lng: 170 }, { lat: 60, lng: -160 });
    for (const p of far) {
      expect(p.y).toBeGreaterThan(-0.3);
      expect(p.y).toBeLessThan(1.3);
    }
  });
});

describe("arc animation heads", () => {
  it("stays within 0..1 and staggers between arcs", () => {
    const count = 5;
    const heads = Array.from({ length: count }, (_, i) => arcHead(0.2, i, count));
    for (const h of heads) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    // All firing in unison would look like a single pulse rather than traffic.
    expect(new Set(heads).size).toBe(count);
  });

  it("wraps seamlessly so the loop has no visible seam", () => {
    const justBefore = arcHead(0.999, 0, 4);
    const justAfter = arcHead(1.001, 0, 4);
    expect(justBefore).toBeGreaterThan(0.99);
    expect(justAfter).toBeLessThan(0.01);
  });
});
