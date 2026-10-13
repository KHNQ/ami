import { CATEGORIES, DEVICES } from "../data/devices.js";

// Joins the storefront's curated device catalogue onto the live product
// rows from GET /products.
//
// The rule this file exists to enforce: the API is authoritative for
// anything that can change without anyone editing the frontend -- whether a
// device is still sold, how many are in stock, what it costs, what its
// product id is -- and the bundled data is authoritative for the sales
// material that no admin screen can produce (catalogue page crops, ROI
// session pricing, the clinics running each unit).
//
// It is also the reason the storefront still works with the API down. A
// marketing site that 500s because a database is unreachable is worse than
// one showing last week's stock figures, so an empty or failed fetch simply
// leaves the bundled catalogue standing.

/**
 * The seeded catalogue carries `placeholder_pricing: true` on every device
 * row: the figures are round numbers filled in to make the commission
 * engine work, not quoted prices. Showing them to a clinic as if they were
 * real would misquote a €55,000 machine by tens of thousands, so a
 * placeholder price is ignored in favour of the curated indicative figure,
 * and only a price an operator has actually set is trusted.
 */
function livePriceEur(product) {
  if (!product) return null;
  if (product.price_on_request) return null;
  if (product.specs?.placeholder_pricing) return null;
  if (typeof product.list_price_y_cents !== "number") return null;
  return product.list_price_y_cents / 100;
}

/** Same argument as the price: a seeded stock of 10 on every device is not a stock level. */
function liveStock(product) {
  if (!product) return null;
  if (typeof product.stock_count !== "number") return null;
  if (product.specs?.placeholder_pricing) return null;
  return product.stock_count;
}

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id).filter((id) => id !== "all"));

/** A storefront category for a product that does not name one. */
function categoryFor(specs) {
  if (CATEGORY_IDS.has(specs?.cat)) return specs.cat;
  const hint = [...(specs?.category_slugs || []), specs?.category].filter(Boolean).join(" ").toLowerCase();
  if (/hair|epilat/.test(hint)) return "hair";
  if (/tattoo|pico|q-?switch/.test(hint)) return "tattoo";
  if (/slim|contour|fat|cryo|lipo/.test(hint)) return "slim";
  if (/vascular|vein|endovenous/.test(hint)) return "vascular";
  if (/body|analy[sz]|scan/.test(hint)) return "body";
  return "skin";
}

/**
 * The first sentence of a description, for a tagline.
 *
 * Deliberately no regex lookbehind (`(?<=...)`): Safari only supports it from
 * 16.4, and a regex literal the engine cannot parse is a SyntaxError at load
 * time -- it took the whole storefront down on older Safari, while Chrome and
 * Firefox ran it fine. A lookahead is supported everywhere.
 */
function firstSentence(description) {
  const value = typeof description === "string" ? description.trim() : "";
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(value);
  return (match ? match[0] : value).trim();
}

const text = (value, fallback = "") => (typeof value === "string" && value.trim() ? value.trim() : fallback);

/**
 * A storefront device built from nothing but a product row.
 *
 * The bundled catalogue is a curated set of the machines in the printed
 * brochure. Anything an admin creates afterwards has no bundled record, and
 * used to be invisible on the storefront -- it existed in the database and on
 * /products/:id, but never appeared in the shop. This is what makes a product
 * created in the admin console show up in the public catalogue, in the
 * server-rendered markup and in the sitemap, with no code change.
 *
 * Every field the storefront components read has a value, so nothing has to
 * special-case "a device with no sales material". Descriptive fields come
 * from `specs` (the admin form writes them there) and are left blank rather
 * than invented when absent.
 */
export function deviceFromProduct(product) {
  const specs = product.specs || {};
  const slug = specs.slug || product.id;
  const price = livePriceEur(product);
  const stock = typeof product.stock_count === "number" ? product.stock_count : 0;
  const features = Array.isArray(specs.features) ? specs.features.filter(Boolean) : [];

  return {
    id: slug,
    slug,
    name: product.name,
    brand: text(specs.manufacturer, "Ashkan Medical"),
    country: text(specs.country, "International"),
    flag: text(specs.flag, "🌐"),
    cat: categoryFor(specs),
    // 0 is only reachable for a product with no usable price; such a device
    // is flagged priceOnRequest, so no component prints it.
    price: price ?? 0,
    sessionPrice: Number(specs.session_price) > 0 ? Number(specs.session_price) : 40,
    icon: text(specs.icon, "✚"),
    tagline: text(specs.tagline) || firstSentence(product.description),
    wavelength: text(specs.wavelength),
    spot: text(specs.spot),
    shots: text(specs.shots),
    cooling: text(specs.cooling),
    indications: text(specs.indications) || (specs.applications || []).join(", "),
    fda: Boolean(specs.fda),
    ce: specs.ce !== false,
    iso: specs.iso !== false,
    consumable: text(specs.consumable),
    warranty: text(specs.warranty, "2 years"),
    stock,
    nextShipmentDays: Number(specs.next_shipment_days) > 0 ? Number(specs.next_shipment_days) : 45,
    highlights: features,
    shot: null,
    trusted: [],
    // From the live row:
    productId: product.id,
    live: true,
    status: product.status || "active",
    description: product.description || null,
    features,
    applications: specs.applications || [],
    certifications: specs.certifications || [],
    productImageUrl: specs.image_url || null,
    categorySlugs: specs.category_slugs || [],
    manufacturer: text(specs.manufacturer, "Ashkan Medical"),
    priceIsIndicative: price === null,
    priceOnRequest: Boolean(product.price_on_request) || price === null,
    stockIsIndicative: false,
    leaseRules: specs.lease_rules || null,
    // True for a device that exists only in the database.
    adminCreated: true,
  };
}

export function mergeDevices(products) {
  const bySlug = new Map();
  for (const p of products || []) {
    const slug = p?.specs?.slug;
    if (slug) bySlug.set(slug, p);
  }

  const bundled = DEVICES.map((device) => {
    const product = bySlug.get(device.slug) || null;
    if (!product) {
      // Not in the live catalogue -- either the API is unreachable or this
      // device has not been imported into this environment. Either way the
      // card still renders; it just cannot be quoted against a product id.
      return { ...device, productId: null, live: false, leaseRules: null };
    }

    const price = livePriceEur(product);
    const stock = liveStock(product);

    return {
      ...device,
      productId: product.id,
      live: true,
      // A device an admin has discontinued must stop being sold here, and
      // that is not something the bundled file can know.
      status: product.status || "active",
      // The API's description is the one an admin can correct; the bundled
      // tagline stays as the headline.
      description: product.description || null,
      features: product.specs?.features || [],
      applications: product.specs?.applications || [],
      certifications: product.specs?.certifications || [],
      productImageUrl: product.specs?.image_url || null,
      categorySlugs: product.specs?.category_slugs || [],
      manufacturer: product.specs?.manufacturer || device.brand,
      // Only overridden when the value is real -- see the notes above.
      price: price ?? device.price,
      priceIsIndicative: price === null,
      priceOnRequest: Boolean(product.price_on_request),
      stock: stock ?? device.stock,
      stockIsIndicative: stock === null,
      leaseRules: product.specs?.lease_rules || null,
    };
  });

  // Products with no bundled counterpart: created in the admin console.
  const bundledSlugs = new Set(DEVICES.map((d) => d.slug));
  const extras = (products || [])
    .filter((p) => p?.id && p.name && p.specs?.slug && !bundledSlugs.has(p.specs.slug))
    .map(deviceFromProduct);

  return [...bundled, ...extras];
}

/**
 * Devices a visitor should be offered.
 *
 * Discontinued rows are dropped rather than greyed out: a clinic that
 * enquires about a device we no longer import has wasted a call, and the
 * quickest way to prevent that is not to show it.
 */
export function sellableDevices(devices) {
  return devices.filter((d) => d.status !== "discontinued");
}
