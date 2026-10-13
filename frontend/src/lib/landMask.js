// A coarse land mask for the dotted partner map.
//
// No GeoJSON and no mapping library: this is a decorative background, and
// shipping a world-borders dataset (or Leaflet, or map tiles) to draw dots
// would cost more than the entire rest of the page.
//
// Land is described as a union of lat/lng boxes. That makes the map blocky --
// which suits the dot-matrix rendering, since each dot is quantised anyway --
// and, more usefully, makes it *verifiable*: "is Tehran on land" and "is the
// mid-Atlantic water" are assertions, where a hand-drawn bitmap could only be
// checked by looking at it, which is exactly what cannot be done here.
//
// Boxes are [westLng, southLat, eastLng, northLat].

const LAND = [
  // --- North America ---
  [-168, 54, -140, 71], // Alaska
  [-141, 49, -52, 70], // Canada
  [-125, 30, -68, 49], // contiguous US
  [-118, 23, -97, 32], // Mexico north
  [-105, 15, -86, 23], // Mexico south
  [-92, 8, -77, 18], // Central America
  [-73, 18, -68, 20], // Hispaniola
  [-85, 20, -74, 23], // Cuba
  [-56, 60, -20, 84], // Greenland

  // --- South America ---
  [-82, -5, -60, 12], // Colombia / Venezuela
  [-74, -18, -47, 5], // Amazon basin
  [-64, -34, -35, -5], // Brazil
  [-76, -30, -62, -10], // Peru / Bolivia
  [-73, -55, -62, -30], // Chile / Argentina south
  [-66, -40, -53, -22], // Argentina

  // --- Europe ---
  [-10, 36, 3, 44], // Iberia
  [-5, 43, 8, 51], // France
  [-8, 51, 2, 59], // British Isles
  [4, 47, 19, 55], // Germany / Poland
  [6, 36, 19, 47], // Italy / Alps
  [19, 35, 30, 49], // Balkans / Greece
  [4, 54, 32, 60], // Baltic / Scandinavia south
  [5, 58, 32, 71], // Scandinavia
  [28, 44, 60, 68], // European Russia

  // --- Africa ---
  [-18, 10, 25, 36], // Sahara / west
  [-18, 4, 15, 14], // West Africa
  [8, -6, 32, 12], // Central Africa
  [22, 8, 44, 32], // Egypt / Sudan / Horn
  [33, -12, 52, 12], // East Africa
  [11, -18, 36, -5], // Southern Africa north
  [14, -35, 33, -18], // South Africa
  [43, -26, 51, -12], // Madagascar

  // --- Middle East & Central Asia ---
  [34, 12, 60, 32], // Arabia
  [38, 25, 64, 42], // Iran / Iraq (Tehran lives here)
  [46, 36, 88, 56], // Central Asia
  [26, 36, 45, 43], // Anatolia / Caucasus

  // --- Asia ---
  [60, 50, 180, 78], // Siberia
  [60, 24, 90, 40], // Pakistan / NW India
  [68, 8, 90, 30], // India
  [88, 20, 123, 45], // China
  [97, 5, 110, 23], // Indochina
  [124, 33, 132, 43], // Korea
  [130, 31, 146, 46], // Japan

  // --- Oceania ---
  [95, -11, 141, 6], // Indonesia
  [113, -35, 154, -11], // Australia
  [140, -10, 151, -1], // New Guinea
  [166, -47, 179, -34], // New Zealand
];

/**
 * Is this coordinate over land?
 *
 * Deliberately a linear scan: the list is ~50 entries and this is called once
 * per dot at build-of-grid time, not per frame. An index would be more code
 * than the saving justifies.
 */
export function isLand(lng, lat) {
  for (const [w, s, e, n] of LAND) {
    if (lng >= w && lng <= e && lat >= s && lat <= n) return true;
  }
  return false;
}

export const LAND_BOXES = LAND;

/**
 * Builds the dot grid once, in 0..1 canvas space.
 *
 * `step` is in degrees; smaller means more dots. Returns only land dots, so
 * the renderer just iterates and draws without re-testing anything.
 */
// The countries this company actually has partners in.
//
// A country on a dot-matrix map is a *cluster* of dots, never one dot -- a
// single point standing in for all of Germany reads as a map pin, not as a
// landmass, and it is the thing that makes these maps look fake. Tagging the
// grid lets the renderer light up every dot that belongs to a country, so
// selecting a partner highlights the shape of the country it is in.
//
// Boxes are [westLng, southLat, eastLng, northLat], same as LAND. They are
// intersected with LAND, so a box overhanging the sea contributes no dots and
// costs nothing -- which means they only have to be roughly right.
const COUNTRIES = {
  germany: [[5.8, 47.2, 15.1, 55.1]],
  france: [[-4.8, 42.3, 8.2, 51.1]],
  italy: [[6.6, 36.6, 18.6, 47.1]],
  spain: [[-9.3, 36.0, 3.4, 43.8]],
  slovenia: [[13.3, 45.4, 16.6, 46.9]],
  "united-kingdom": [[-8.2, 49.9, 1.8, 58.7]],
  "united-states": [
    [-125, 24.5, -66.9, 49.4], // contiguous
    [-168, 54, -140, 71], // Alaska
  ],
  "south-korea": [[125.9, 33.1, 129.6, 38.6]],
  iran: [[44, 25, 63.3, 39.8]],
};

// Boxes flattened and sorted smallest-area-first.
//
// These regions overlap, and the overlaps are not incidental: Italy's box
// (6.6..18.6 lng, 36.6..47.1 lat) completely contains Slovenia's. Resolving
// by declaration order therefore meant Italy claimed every Slovenian dot and
// Slovenia was tagged on nothing at all -- its highlight silently lit up
// nothing. Smallest box wins instead, so the most specific country always
// takes the point, and adding a new country can't quietly swallow a
// neighbour.
const SORTED_BOXES = Object.entries(COUNTRIES)
  .flatMap(([slug, boxes]) => boxes.map((box) => ({ slug, box, area: (box[2] - box[0]) * (box[3] - box[1]) })))
  .sort((a, b) => a.area - b.area);

/** Country slug for a coordinate, or null. */
export function countryAt(lng, lat) {
  for (const { slug, box } of SORTED_BOXES) {
    const [w, s, e, n] = box;
    if (lng >= w && lng <= e && lat >= s && lat <= n) return slug;
  }
  return null;
}

export const COUNTRY_BOXES = COUNTRIES;

/**
 * "South Korea" -> "south-korea", so a partner record's human-readable
 * country string can be matched against the tagged grid without every call
 * site re-implementing the same slugify.
 */
export function countrySlug(name) {
  if (!name) return null;
  const slug = String(name).trim().toLowerCase().replace(/\s+/g, "-");
  return slug in COUNTRIES ? slug : null;
}

/**
 * Builds the dot grid once, in 0..1 canvas space.
 *
 * `step` is in degrees; smaller means more dots. Returns only land dots, so
 * the renderer just iterates and draws without re-testing anything. Each dot
 * carries the country it falls in (or null), which is what lets a whole
 * country be highlighted as a group.
 */
// A country must read as a *cluster*. Below this many dots it renders as a
// speck -- indistinguishable from the city pin drawn on top of it, which is
// the exact "one dot per country" look this grid exists to avoid.
const MIN_DOTS_PER_COUNTRY = 6;

export function buildDotGrid({ step = 3.2, latLimit = 78 } = {}) {
  const dots = [];
  // Keyed by rounded position, so the densify pass below cannot stack a
  // second dot on top of one the base grid already placed.
  const seen = new Set();
  const key = (x, y) => `${x.toFixed(4)}:${y.toFixed(4)}`;

  const push = (lng, lat) => {
    const x = (lng + 180) / 360;
    const y = (90 - lat) / 180;
    const k = key(x, y);
    if (seen.has(k)) return;
    seen.add(k);
    dots.push({ x, y, country: countryAt(lng, lat) });
  };

  for (let lat = latLimit; lat >= -60; lat -= step) {
    // Equirectangular stretches longitude badly toward the poles, so widen
    // the spacing with latitude. Without this the Arctic is a solid bar of
    // dots and the tropics look sparse by comparison.
    const lngStep = step / Math.max(0.35, Math.cos((lat * Math.PI) / 180));
    for (let lng = -180; lng <= 180; lng += lngStep) {
      if (!isLand(lng, lat)) continue;
      push(lng, lat);
    }
  }

  // --- densify countries smaller than the grid spacing --------------------
  // Slovenia's box is roughly 3.3 x 1.5 degrees; at a 3.1 degree step that is
  // one dot, sometimes zero. Rather than making the whole grid finer -- which
  // would multiply the per-frame cost of the entire map to fix a handful of
  // small countries -- each undersized country gets its own finer sub-grid.
  // Cost is bounded by the size of those boxes, which is precisely why they
  // needed it.
  const counts = new Map();
  for (const d of dots) if (d.country) counts.set(d.country, (counts.get(d.country) || 0) + 1);

  for (const [slug, boxes] of Object.entries(COUNTRIES)) {
    if ((counts.get(slug) || 0) >= MIN_DOTS_PER_COUNTRY) continue;
    for (const [w, s, e, n] of boxes) {
      // Aim for roughly a 4x4 lattice inside the box, floored so a very thin
      // country still gets a usable step rather than one enormous cell.
      const lngStep = Math.max(0.28, (e - w) / 4);
      const latStep = Math.max(0.28, (n - s) / 4);
      for (let lat = s; lat <= n; lat += latStep) {
        for (let lng = w; lng <= e; lng += lngStep) {
          // Still gated on isLand, so a box overhanging the Adriatic does not
          // sprinkle dots across the sea.
          if (!isLand(lng, lat)) continue;
          push(lng, lat);
        }
      }
    }
  }

  return dots;
}

/** Groups a built grid by country slug, for highlight lookups. */
export function groupByCountry(dots) {
  const map = new Map();
  for (const d of dots) {
    if (!d.country) continue;
    if (!map.has(d.country)) map.set(d.country, []);
    map.get(d.country).push(d);
  }
  return map;
}
