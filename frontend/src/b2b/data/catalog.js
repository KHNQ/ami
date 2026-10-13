// The printed Ashkan 2024 catalogue, page by page.
//
// The images under public/catalog are the actual pages of "Ashkan
// products.pdf" (extracted at build-prep time, see README note in
// CatalogViewer) -- so what a visitor flips through here is the same
// brochure the sales team hands over in person, not a re-typed web version
// of it. The PDF itself is served alongside them for download.
//
// A hotspot carries EITHER `device` (a machine with its own page) or
// `order` (a machine printed in the brochure that we do not list -- the
// Smartrion Combi and the Magneto STYM). The second kind used to point at
// the nearest similar device, which sent a buyer to a page for a product
// they had not clicked on; now it opens an enquiry naming what they did.
//
// `hotspots` are percentage rectangles over the page. They are what makes
// this a storefront rather than a PDF reader: every machine printed on a page
// is a click target that opens that device's 3D view, ROI model and proforma
// flow. Coordinates are x/y of the top-left corner and w/h, all in percent of
// the page, so they hold at any zoom level or screen size.

export const CATALOG_PDF = "/catalog/ashkan-products-2024.pdf";
export const CATALOG_PDF_SIZE = "4.9 MB";

export const CATALOG_PAGES = [
  {
    n: 1,
    label: "Cover — Ashkan Medical Idea",
    keywords: ["cover", "ashkan", "medical idea"],
    hotspots: [],
  },
  {
    n: 2,
    label: "Sinclair Primelase + Prime V — Hair removal",
    keywords: ["sinclair", "primelase", "prime v", "hair removal", "vascular", "4800w"],
    hotspots: [
      { x: 10, y: 55, w: 34, h: 40, label: "Primelase Excellence", device: "primelase" },
      { x: 46, y: 45, w: 26, h: 22, label: "Prime V vascular handpiece", device: "primelase" },
    ],
  },
  {
    n: 3,
    label: "Sinclair Elysion Pro — 2000 W diode",
    keywords: ["sinclair", "elysion", "hair removal", "2000w", "blend", "alex", "diode"],
    hotspots: [{ x: 58, y: 60, w: 36, h: 32, label: "Elysion Pro", device: "elysion" }],
  },
  {
    n: 4,
    label: "IDS Smartrion Combi — Alexandrite & Nd:YAG",
    keywords: ["ids", "smartrion", "combi", "alexandrite", "nd:yag", "hair removal", "melasma"],
    hotspots: [{ x: 10, y: 62, w: 36, h: 32, label: "Smartrion Combi", order: "IDS Smartrion Combi — Alexandrite & Nd:YAG" }],
  },
  {
    n: 5,
    label: "IDS Q-10 + Pico Premium — Tattoo removal",
    keywords: ["q-10", "q10", "pico", "premium", "tattoo", "melasma", "pigment", "ids"],
    hotspots: [
      { x: 68, y: 22, w: 26, h: 30, label: "Q-10", device: "q10" },
      { x: 8, y: 52, w: 26, h: 42, label: "Pico Premium", device: "pico" },
    ],
  },
  {
    n: 6,
    label: "Angela CO₂ + 4Plus DQRF — Rejuvenation",
    keywords: ["angela", "co2", "fractional", "4plus", "dqrf", "novaclinical", "rejuvenation"],
    hotspots: [
      { x: 8, y: 8, w: 24, h: 42, label: "Angela CO₂ 50 W", device: "angela" },
      { x: 58, y: 76, w: 38, h: 22, label: "4Plus DQRF", device: "plus4" },
    ],
  },
  {
    n: 7,
    label: "ASHLEY RF + Exciplex 308 — Microneedle & excimer",
    keywords: ["ashley", "rf", "micro needle", "exciplex", "308", "clarteis", "vitiligo", "psoriasis"],
    hotspots: [
      { x: 68, y: 10, w: 26, h: 38, label: "ASHLEY RF Micro Needle", device: "ashley" },
      { x: 6, y: 58, w: 36, h: 24, label: "Exciplex 308", device: "exciplex" },
    ],
  },
  {
    n: 8,
    label: "Sinclair Cooltech — Fat freezing handpieces",
    keywords: ["cooltech", "cocoon", "sinclair", "cryolipolysis", "fat freezing", "slimming"],
    hotspots: [{ x: 52, y: 52, w: 44, h: 42, label: "Cooltech", device: "cooltech" }],
  },
  {
    n: 9,
    label: "Cooltech Define — 360° full-body contouring",
    keywords: ["cooltech", "define", "360", "full body", "contouring", "applicators"],
    hotspots: [{ x: 8, y: 6, w: 32, h: 34, label: "Cooltech Define", device: "cooltech" }],
  },
  {
    n: 10,
    label: "Iskra TESLA Former + Magneto STYM — FMS",
    keywords: ["tesla", "former", "iskra", "fms", "magneto", "stym", "muscle", "pelvic floor"],
    hotspots: [
      { x: 8, y: 18, w: 30, h: 30, label: "TESLA Former", device: "tesla" },
      { x: 46, y: 62, w: 46, h: 28, label: "Magneto STYM", order: "Iskra Magneto STYM — pelvic floor FMS" },
    ],
  },
  {
    n: 11,
    label: "InBody — Body composition analyzers",
    keywords: ["inbody", "body composition", "bioimpedance", "lookinbody", "970", "analyzer"],
    hotspots: [{ x: 16, y: 68, w: 74, h: 26, label: "InBody — 8 models", device: "inbody" }],
  },
  {
    n: 12,
    label: "Back cover — Ideals are rooted in ideas",
    keywords: ["contact", "tehran", "vanak", "address", "back cover", "ashkan medical"],
    hotspots: [],
  },
];

export const pageImage = (n) => `/catalog/pages/page-${String(n).padStart(2, "0")}.jpg`;
export const pageThumb = (n) => `/catalog/thumbs/page-${String(n).padStart(2, "0")}.jpg`;

/**
 * Free-text search across the catalogue.
 *
 * Matches page labels, the per-page keyword list, and the names of the
 * devices hotspotted on each page -- so "cryo", "define" and "cooltech" all
 * land on the same spread, which is how a doctor actually searches.
 */
export function searchCatalog(query, devicesById) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CATALOG_PAGES.filter((page) => {
    if (page.label.toLowerCase().includes(q)) return true;
    if (page.keywords.some((k) => k.includes(q))) return true;
    return page.hotspots.some((h) => {
      if (h.label.toLowerCase().includes(q)) return true;
      const device = devicesById?.get(h.device);
      return Boolean(device && device.name.toLowerCase().includes(q));
    });
  }).map((page) => page.n);
}
