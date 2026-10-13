// Populates Products from the crawled Ashkan Medical Idea catalog
// (content/ashkan-medical/*.json, sourced from https://ashkan-medical.com/en/).
// Uses the existing productService exactly as the admin UI/API would --
// no schema, service, or route changes. Safe to re-run: skips any product
// whose name already exists.
//
// IMPORTANT: the source site never displays prices (B2B medical equipment,
// sold via quote). The prices below are PLACEHOLDERS only, loosely tiered by
// how sophisticated each device is -- an admin must replace them with real
// cost/list price via the existing "Pricing" section on each product's
// admin page (or `appendWarehouseCost` / `updateProductPrice`) before this
// is trustworthy for real commission math.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "../src/db/index.js";
import { productService } from "../src/services/productService.js";

const CONTENT_DIR = join(dirname(new URL(import.meta.url).pathname), "..", "content", "ashkan-medical");

// [xCents (warehouse cost), yCents (list price)] -- placeholders, see notice above.
const PLACEHOLDER_PRICING_USD_CENTS = {
  "prime-lase": [5_500_000, 8_500_000],
  "elysion-pro": [4_800_000, 7_500_000],
  angela: [3_800_000, 6_000_000],
  ashley: [2_800_000, 4_500_000],
  "cooltech-cooltech-define": [6_000_000, 9_500_000],
  powershape2: [3_200_000, 5_000_000],
  "4plus": [4_000_000, 6_500_000],
  "tesla-former": [3_500_000, 5_500_000],
  inbody: [1_100_000, 1_800_000],
  "pico-premium": [4_500_000, 7_000_000],
  q10: [2_500_000, 4_000_000],
  exciplex: [1_600_000, 2_500_000],
  wolf: [1_900_000, 3_000_000],
};

/**
 * Builds slug -> [categorySlug] from categories.json.
 *
 * Membership is many-to-many on the source site: 4plus appears under both
 * slimming and rejuvenation, InBody under both slimming and body analysis.
 * The free-text `category` string already on each product is kept as-is for
 * display; these normalised slugs are what the category pages filter on.
 */
function buildCategoryIndex() {
  const { categories } = JSON.parse(readFileSync(join(CONTENT_DIR, "categories.json"), "utf8"));
  const index = new Map();
  for (const c of categories) {
    for (const slug of c.product_slugs) {
      if (!index.has(slug)) index.set(slug, []);
      index.get(slug).push(c.slug);
    }
  }
  return index;
}

async function main() {
  const products = JSON.parse(readFileSync(join(CONTENT_DIR, "products.json"), "utf8"));
  const categoryIndex = buildCategoryIndex();
  const existing = new Map(db.products.list({ limit: 1000 }).map((p) => [p.name, p]));

  let created = 0;
  let skipped = 0;
  let recategorised = 0;

  for (const item of products) {
    const categorySlugs = categoryIndex.get(item.slug) || [];

    if (existing.has(item.name)) {
      // Re-runnable: an already-imported product still gets its category
      // wiring refreshed, so adding a category to categories.json takes
      // effect without having to wipe and re-import the catalogue.
      const current = existing.get(item.name);
      const specs = JSON.parse(current.specs_json);
      const sameCategories =
        JSON.stringify(specs.category_slugs || []) === JSON.stringify(categorySlugs);
      if (sameCategories) {
        console.log(`Skipping "${item.name}" -- already present and correctly categorised.`);
        skipped++;
      } else {
        productService.update(current.id, { specs: { slug: item.slug, category_slugs: categorySlugs } }, "content-import-script");
        console.log(`Recategorised "${item.name}" -> [${categorySlugs.join(", ")}]`);
        recategorised++;
      }
      continue;
    }

    const [xCents, yCents] = PLACEHOLDER_PRICING_USD_CENTS[item.slug] || [1_000_000, 1_500_000];

    const product = productService.create(
      {
        name: item.name,
        description: item.description,
        specs: {
          source: "ashkan-medical.com",
          source_url: item.source_url,
          category: item.category,
          // Normalised, many-to-many. `category` above stays as the
          // human-readable label the source site shows.
          category_slugs: categorySlugs,
          slug: item.slug,
          manufacturer: item.manufacturer,
          features: item.features,
          applications: item.applications,
          certifications: item.certifications,
          image: item.image,
          placeholder_pricing: true,
        },
        stockCount: 10,
        xCents,
        yCents,
      },
      "content-import-script"
    );
    console.log(`Created "${product.name}" (${product.id})`);
    created++;
  }

  console.log(`\nDone. Created ${created}, recategorised ${recategorised}, skipped ${skipped}.`);
  if (created > 0) {
    console.log(
      "\nReminder: prices are placeholders (see PLACEHOLDER_PRICING_USD_CENTS in this script). " +
        "Update real cost/list price per product via the admin Pricing UI before relying on commission math."
    );
  }
}

main();
