// Maps each catalogue product onto the procedural archetype whose silhouette
// matches the real hardware, plus a per-product accent colour for its
// display glow. Derived from the manufacturer + feature data captured in
// content/ashkan-medical/products.json during the site content import.
//
// Matching is by name substring rather than product id, because ids are
// generated per-database (dev, e2e, and production all differ) while the
// names come from the imported catalogue and are stable.

const GREEN = 0x22c55e;
const BLUE = 0x3b82f6;
const CYAN = 0x38bdf8;
const VIOLET = 0x8b5cf6;
const AMBER = 0xf59e0b;
const ROSE = 0xf43f5e;

const CATALOGUE = [
  // Laser platforms on carts -- tower, big display, articulated delivery arm.
  // Primelase, like Angela, is modelled from the manufacturer's own
  // component decomposition sheet rather than the shared laserCart
  // silhouette: white two-part shell over an open metal frame, 4800W PSU,
  // four-wavelength source module, Crystal Freeze handpiece on an umbilical.
  { match: "prime lase", variant: "primelase", accent: BLUE, tagline: "4800W, four wavelengths, Crystal Freeze" },
  { match: "primelase", variant: "primelase", accent: BLUE, tagline: "4800W, four wavelengths, Crystal Freeze" },
  { match: "elysion", variant: "laserCart", accent: CYAN, tagline: "Four wavelengths, zero downtime" },
  // Angela has its own archetype rather than the shared laserCart: the
  // manufacturer's component decomposition sheet is available for this one
  // device, so it's modelled part-for-part (X caster base, dark side
  // enclosures with vertical branding and dotted vent grilles, curved
  // silver front inset, 7-mirror articulated arm, cone-nozzle handpiece).
  { match: "angela", variant: "angela", accent: ROSE, tagline: "Fractional CO2 resurfacing, 10,600nm" },
  { match: "pico", variant: "laserCart", accent: VIOLET, tagline: "350 picosecond pulses" },
  { match: "q10", variant: "laserCart", accent: GREEN, tagline: "Q-switched Nd:YAG" },

  // RF / vacuum / cryo consoles -- cabinet with multiple handpieces.
  // Fourth sheet-derived rig, and the only pedestal in the catalogue: a
  // two-hemisphere bowl head on a slender column over a tripod base, with
  // five applicators racked on a curved tray above it.
  { match: "4plus", variant: "fourPlus", accent: CYAN, tagline: "Five modalities, one platform" },
  { match: "4 plus", variant: "fourPlus", accent: CYAN, tagline: "Five modalities, one platform" },
  // Third sheet-derived rig: gloss white leaning tower, swept dark inlays,
  // front storage drawer, and three docked applicators (roll / multi-polar
  // / thermal) rather than the shared rfPlatform cabinet.
  { match: "powershape", variant: "powershape2", accent: AMBER, tagline: "RF, vacuum and laser in one platform" },
  { match: "ashley", variant: "rfPlatform", accent: ROSE, tagline: "Micro-needle radiofrequency" },
  { match: "cooltech", variant: "rfPlatform", accent: BLUE, tagline: "Cryolipolysis at -8°C" },

  // Compact benchtop / handheld units.
  { match: "exciplex", variant: "handheld", accent: VIOLET, tagline: "308nm excimer, 950 grams" },
  { match: "wolf", variant: "handheld", accent: GREEN, tagline: "1470nm diode, fully portable" },

  // Body contouring station with a magnetic applicator ring.
  { match: "tesla", variant: "contourStation", accent: VIOLET, tagline: "50,000 pulses per session" },

  // Body composition analyzer.
  { match: "inbody", variant: "analyzer", accent: GREEN, tagline: "Direct impedance measurement" },
];

const FALLBACK = { variant: "analyzer", accent: GREEN, tagline: "Medical grade precision" };

export function deviceForProduct(product) {
  if (!product?.name) return FALLBACK;
  const name = product.name.toLowerCase();
  return CATALOGUE.find((entry) => name.includes(entry.match)) || FALLBACK;
}

// The rotation of archetypes the homepage scrolls through, so a visitor sees
// the breadth of the catalogue rather than the same device five times.
export const HOME_SHOWCASE = [
  { variant: "laserCart", accent: BLUE },
  { variant: "rfPlatform", accent: CYAN },
  { variant: "contourStation", accent: VIOLET },
  { variant: "handheld", accent: GREEN },
];
