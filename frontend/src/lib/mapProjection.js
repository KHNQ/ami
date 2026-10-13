// Equirectangular projection and great-circle arc maths for the partner map.
//
// Pure and separate from the canvas code so it can be unit-tested: a pin
// landing in the wrong ocean is the kind of bug that survives review because
// nobody has the coastlines memorised, but it is trivial to assert against
// known coordinates.

/** Longitude/latitude -> 0..1 within an equirectangular image. */
export function project(lng, lat) {
  return {
    x: (lng + 180) / 360,
    y: (90 - lat) / 180,
  };
}

/** ...and back, which the land-mask sampler needs. */
export function unproject(x, y) {
  return { lng: x * 360 - 180, lat: 90 - y * 180 };
}

// The map only covers -60..78 latitude (landMask's buildDotGrid range), so
// rendering crops to that band instead of wasting a third of the canvas on
// empty Southern Ocean. Shared here (rather than duplicated as a local
// constant in the canvas and again in whatever positions the click popup)
// so the two can never drift apart and place a pin one row off the dot it's
// supposed to sit on.
export const MAP_CROP = { top: 0.06, bottom: 0.84 };

/** Projected 0..1 point -> on-screen pixel, given the drawing area's size. */
export function toPixel({ x, y }, width, height, crop = MAP_CROP) {
  return {
    x: x * width,
    y: ((y - crop.top) / (crop.bottom - crop.top)) * height,
  };
}

const toRad = (d) => (d * Math.PI) / 180;

/**
 * Great-circle distance in kilometres. Used to scale each arc's height, so a
 * Tehran-Seoul flight bows more than Tehran-Ljubljana rather than every arc
 * sharing one arbitrary curve.
 */
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * A quadratic Bézier arc between two projected points, in 0..1 space.
 *
 * Arcs bow "upward" (toward smaller y) because the map is drawn with north at
 * the top and a flight path that dipped below the two endpoints would read as
 * a tunnel rather than a route.
 */
export function arcPoints(from, to, steps = 48) {
  const a = project(from.lng, from.lat);
  const b = project(to.lng, to.lat);

  // Longer routes bow higher, capped so an antipodal pair doesn't launch the
  // arc off the top of the canvas.
  const km = haversineKm(from, to);
  const lift = Math.min(0.26, 0.05 + (km / 20000) * 0.3);

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 - lift;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    points.push({
      x: mt * mt * a.x + 2 * mt * t * cx + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * cy + t * t * b.y,
      t,
    });
  }
  return points;
}

/**
 * How far along each arc the travelling dot sits, given overall progress and
 * the arc's index. Staggered so they don't all fire in unison, and wrapped so
 * the animation loops seamlessly.
 */
export function arcHead(progress, index, count) {
  const stagger = count > 0 ? index / count : 0;
  return (progress + stagger) % 1;
}
