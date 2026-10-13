// Gives every imported device a usable price pair, in one step:
//
//   list price (y)   the storefront price -- frontend/src/b2b/data/devices.js is
//                    read directly, so the three places that show a price (the
//                    storefront, the proforma, the walk-in desk) quote one number.
//   warehouse cost   a MOCK figure: COST_RATIO_PCT of that price (default 65%),
//                    rounded to the nearest $100. It stands in for the real cost
//                    until an admin enters it -- on the product's admin page
//                    ("Warehouse cost"), the same place stock is managed.
//
// It goes through productService exactly as the admin UI would, so cost history
// and the audit log are written, and a price being set clears
// `placeholder_pricing` (see productService.updatePrice).
//
// Only touches products still flagged `placeholder_pricing`: a device whose
// price an admin has already set is theirs, and is left alone unless --force.
// Existing orders are unaffected -- x and y are locked onto each sale.
//
// Usage:
//   bun run pricing:devices -- --dry-run     # show what would change
//   bun run pricing:devices                  # apply
//   COST_RATIO_PCT=55 bun run pricing:devices
//   bun run pricing:devices -- --force       # also overwrite admin-set prices
import { db } from "../src/db/index.js";
import { productService } from "../src/services/productService.js";
import { DEVICES } from "../frontend/src/b2b/data/devices.js";

const ACTOR = "device-pricing-script";
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const COST_RATIO_PCT = Number(process.env.COST_RATIO_PCT || 65);

if (!(COST_RATIO_PCT > 0 && COST_RATIO_PCT < 100)) {
  console.error("COST_RATIO_PCT must be between 0 and 100 (exclusive) -- a cost at or above the price has no margin.");
  process.exit(1);
}

const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const priceBySlug = new Map(DEVICES.filter((d) => Number.isFinite(d.price) && d.price > 0).map((d) => [d.slug, d.price]));

const mockCostCents = (priceCents) => Math.round((priceCents * COST_RATIO_PCT) / 100 / 10_000) * 10_000;

let changed = 0;
let skipped = 0;
let unmatched = 0;

for (const product of db.products.list({ limit: 1000 })) {
  const specs = JSON.parse(product.specs_json);
  if (specs.source !== "ashkan-medical.com") continue; // not an imported device (e.g. the seed demo kits)

  const price = priceBySlug.get(specs.slug);
  if (price === undefined) {
    console.log(`? ${product.name}: no storefront price for slug "${specs.slug}" -- left alone`);
    unmatched++;
    continue;
  }
  if (!specs.placeholder_pricing && !FORCE) {
    console.log(`- ${product.name}: price already set by an admin -- left alone (use --force to overwrite)`);
    skipped++;
    continue;
  }

  const yCents = price * 100;
  const xCents = mockCostCents(yCents);
  console.log(
    `${DRY_RUN ? "would set" : "set"} ${product.name}: ` +
      `price ${usd(product.list_price_y_cents)} -> ${usd(yCents)}, cost ${usd(product.current_x_cents)} -> ${usd(xCents)} ` +
      `(margin ${usd(yCents - xCents)})`
  );
  if (!DRY_RUN) {
    productService.updatePrice(product.id, yCents, ACTOR);
    productService.appendWarehouseCost(product.id, xCents, ACTOR);
  }
  changed++;
}

console.log(`\n${DRY_RUN ? "Dry run: " : ""}${changed} updated, ${skipped} skipped, ${unmatched} without a storefront price.`);
if (changed > 0 && !DRY_RUN) {
  console.log(`Costs are MOCK (${COST_RATIO_PCT}% of price). Replace them with real figures on each product's admin page.`);
}
