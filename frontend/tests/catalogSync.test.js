import { describe, expect, it } from "vitest";
import { deviceFromProduct, mergeDevices, sellableDevices } from "../src/b2b/lib/mergeProducts.js";
import { DEVICES } from "../src/b2b/data/devices.js";

// A product an admin creates must show up in the public catalogue with no code
// change. Before this existed the storefront only ever listed the 13 machines
// in the printed brochure; anything created afterwards was in the database
// and on /products/:id but absent from the shop, the server-rendered markup
// and the sitemap.

const created = (over = {}) => ({
  id: "prod_new",
  name: "Aurora Diode Pro",
  description: "A new diode platform. It is quiet. It is fast.",
  status: "active",
  stock_count: 3,
  list_price_y_cents: 2_100_000,
  specs: {
    slug: "aurora-diode-pro",
    manufacturer: "Aurora Lasers",
    country: "Germany",
    flag: "🇩🇪",
    cat: "hair",
    wavelength: "808 nm",
    features: ["Quiet", "Fast"],
    lease_rules: { enabled: true, min_upfront_pct: 15, terms: [{ months: 18, apr_bp: 1700 }] },
  },
  ...over,
});

describe("admin-created products reach the catalogue", () => {
  it("appears alongside the bundled range", () => {
    const merged = mergeDevices([created()]);
    expect(merged).toHaveLength(DEVICES.length + 1);
    const device = merged.find((d) => d.id === "aurora-diode-pro");
    expect(device).toBeTruthy();
    expect(device.name).toBe("Aurora Diode Pro");
    expect(device.productId).toBe("prod_new");
    expect(device.live).toBe(true);
  });

  it("is keyed on its slug, so /devices/:slug resolves", () => {
    const device = mergeDevices([created()]).find((d) => d.slug === "aurora-diode-pro");
    expect(device.id).toBe(device.slug);
  });

  it("carries its real price and stock, and is not indicative", () => {
    const device = deviceFromProduct(created());
    expect(device.price).toBe(21_000);
    expect(device.priceIsIndicative).toBe(false);
    expect(device.priceOnRequest).toBe(false);
    expect(device.stock).toBe(3);
  });

  it("is quoted rather than listed when the price is hidden or placeholder", () => {
    expect(deviceFromProduct(created({ price_on_request: true })).priceOnRequest).toBe(true);
    const placeholder = deviceFromProduct(
      created({ specs: { slug: "x", placeholder_pricing: true } })
    );
    expect(placeholder.priceOnRequest).toBe(true);
    expect(placeholder.price).toBe(0);
  });

  it("carries its lease rules to the lease tab", () => {
    const device = deviceFromProduct(created());
    expect(device.leaseRules.terms).toEqual([{ months: 18, apr_bp: 1700 }]);
    expect(device.leaseRules.min_upfront_pct).toBe(15);
  });

  it("has a value for every field the shop reads, so no component special-cases it", () => {
    const device = deviceFromProduct({ id: "p", name: "Bare product", status: "active", stock_count: 0, list_price_y_cents: 100, specs: { slug: "bare-product" } });
    for (const field of ["brand", "country", "flag", "cat", "icon", "tagline", "wavelength", "spot", "shots", "cooling", "indications", "consumable", "warranty", "nextShipmentDays", "sessionPrice"]) {
      expect(device[field], field).not.toBeUndefined();
    }
    expect(Array.isArray(device.highlights)).toBe(true);
    expect(Array.isArray(device.trusted)).toBe(true);
    expect(device.cat).toBe("skin");
  });

  it("picks a category from the product's own data", () => {
    expect(deviceFromProduct(created({ specs: { slug: "a", cat: "tattoo" } })).cat).toBe("tattoo");
    expect(deviceFromProduct(created({ specs: { slug: "a", category_slugs: ["laser-hair-removal"] } })).cat).toBe("hair");
    expect(deviceFromProduct(created({ specs: { slug: "a", cat: "not-a-category" } })).cat).toBe("skin");
  });

  it("does not duplicate a product that matches a bundled device", () => {
    const bundled = DEVICES[0];
    const merged = mergeDevices([created({ specs: { slug: bundled.slug } })]);
    expect(merged).toHaveLength(DEVICES.length);
  });

  it("a discontinued admin product is dropped from what is sold", () => {
    const merged = mergeDevices([created({ status: "discontinued" })]);
    expect(sellableDevices(merged).some((d) => d.id === "aurora-diode-pro")).toBe(false);
  });

  it("uses its own image when it has one", () => {
    const device = deviceFromProduct(created({ specs: { slug: "a", image_url: "/products/prod_new/image" } }));
    expect(device.productImageUrl).toBe("/products/prod_new/image");
  });
});
