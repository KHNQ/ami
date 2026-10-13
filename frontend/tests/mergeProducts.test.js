import { describe, expect, it } from "vitest";
import { mergeDevices, sellableDevices } from "../src/b2b/lib/mergeProducts.js";
import { DEVICES } from "../src/b2b/data/devices.js";

// The join between the curated storefront catalogue and the live product
// rows decides what price a clinic is quoted and which product id a lead is
// filed against. Both are things that cost real money to get wrong, and
// neither is visible in a screenshot -- hence tests.

const product = (over = {}) => ({
  id: "prod_test",
  name: "Cooltech / Cooltech Define",
  description: "From the API",
  status: "active",
  stock_count: 4,
  list_price_y_cents: 1234500,
  specs: { slug: "cooltech-cooltech-define", features: ["a"], category_slugs: ["slimming"] },
  ...over,
});

const find = (list, id) => list.find((d) => d.id === id);

describe("mergeDevices", () => {
  it("keeps the full bundled catalogue when there are no live rows", () => {
    const merged = mergeDevices([]);
    expect(merged).toHaveLength(DEVICES.length);
    expect(merged.every((d) => d.live === false)).toBe(true);
    expect(merged.every((d) => d.productId === null)).toBe(true);
  });

  it("survives a null product list (API unreachable)", () => {
    expect(mergeDevices(null)).toHaveLength(DEVICES.length);
  });

  it("attaches the product id so a lead can reference the real row", () => {
    const merged = mergeDevices([product()]);
    expect(find(merged, "cooltech").productId).toBe("prod_test");
    expect(find(merged, "cooltech").live).toBe(true);
    // Untouched devices stay unmatched rather than inheriting anything.
    expect(find(merged, "inbody").productId).toBeNull();
  });

  it("joins on slug, not on name", () => {
    // The API calls it "Cooltech / Cooltech Define"; the brochure calls it
    // "Cooltech Define". A name join would miss, and a fuzzy name join
    // would eventually match the wrong machine.
    const merged = mergeDevices([product({ name: "something else entirely" })]);
    expect(find(merged, "cooltech").productId).toBe("prod_test");
  });

  it("takes a real price from the API", () => {
    const merged = mergeDevices([product()]);
    const d = find(merged, "cooltech");
    expect(d.price).toBe(12345);
    expect(d.priceIsIndicative).toBe(false);
  });

  it("ignores a seeded placeholder price and keeps the curated figure", () => {
    const bundled = DEVICES.find((d) => d.id === "cooltech");
    const merged = mergeDevices([
      product({
        list_price_y_cents: 9500000,
        specs: { slug: "cooltech-cooltech-define", placeholder_pricing: true },
      }),
    ]);
    const d = find(merged, "cooltech");
    expect(d.price).toBe(bundled.price);
    expect(d.priceIsIndicative).toBe(true);
  });

  it("shows no price at all when the operator has switched prices off", () => {
    const merged = mergeDevices([
      product({ price_on_request: true, list_price_y_cents: undefined }),
    ]);
    const d = find(merged, "cooltech");
    expect(d.priceOnRequest).toBe(true);
    expect(d.priceIsIndicative).toBe(true);
  });

  it("does the same for stock: a seeded count is not a stock level", () => {
    const bundled = DEVICES.find((d) => d.id === "cooltech");
    const real = mergeDevices([product()]);
    expect(find(real, "cooltech").stock).toBe(4);
    expect(find(real, "cooltech").stockIsIndicative).toBe(false);

    const seeded = mergeDevices([
      product({ stock_count: 10, specs: { slug: "cooltech-cooltech-define", placeholder_pricing: true } }),
    ]);
    expect(find(seeded, "cooltech").stock).toBe(bundled.stock);
    expect(find(seeded, "cooltech").stockIsIndicative).toBe(true);
  });

  it("carries the API description and feature list through", () => {
    const merged = mergeDevices([product()]);
    const d = find(merged, "cooltech");
    expect(d.description).toBe("From the API");
    expect(d.features).toEqual(["a"]);
    // The curated sales copy is not overwritten by it.
    expect(d.tagline).toBe(DEVICES.find((x) => x.id === "cooltech").tagline);
  });

  it("propagates a discontinued status", () => {
    const merged = mergeDevices([product({ status: "discontinued" })]);
    expect(find(merged, "cooltech").status).toBe("discontinued");
  });

  it("ignores rows with no slug rather than mismatching them", () => {
    const merged = mergeDevices([{ id: "x", name: "Trex Starter Kit", specs: {} }]);
    expect(merged.every((d) => d.productId === null)).toBe(true);
  });
});

describe("sellableDevices", () => {
  it("drops discontinued devices so nobody enquires about one", () => {
    const merged = mergeDevices([product({ status: "discontinued" })]);
    const sellable = sellableDevices(merged);
    expect(sellable).toHaveLength(DEVICES.length - 1);
    expect(find(sellable, "cooltech")).toBeUndefined();
  });

  it("leaves an active catalogue untouched", () => {
    expect(sellableDevices(mergeDevices([product()]))).toHaveLength(DEVICES.length);
  });
});
