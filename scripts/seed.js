// Bootstraps a usable dev environment: one admin user + one demo product
// with a default commission plan, so you can log in and hit the API
// immediately without hand-crafting an admin through the DB.
import { db } from "../src/db/index.js";
import { hashPassword } from "../src/lib/auth.js";
import { productService } from "../src/services/productService.js";

// This is a dev/test fixture generator -- it creates an admin account with
// a well-known default password (SEED_ADMIN_PASSWORD, or a hardcoded
// fallback if unset). Never intended to run against a real production
// database; the escape hatch below exists only for a deliberate one-off.
if (process.env.NODE_ENV === "production" && !process.env.ALLOW_SEED_IN_PRODUCTION) {
  console.error(
    "Refusing to run: NODE_ENV=production. scripts/seed.js creates a well-known admin login and " +
      "demo product, meant for dev/test only. Set ALLOW_SEED_IN_PRODUCTION=1 if you really intend " +
      "to run this against a live database."
  );
  process.exit(1);
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@trex.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "admin12345";

  let admin = db.users.findByEmail(email);
  if (!admin) {
    const passwordHash = await hashPassword(password);
    admin = db.users.create({ email, passwordHash, name: "Trex Admin", role: "admin" });
    db.wallet.ensureAccount(admin.id);
    console.log(`Created admin: ${email} / ${password}`);
  } else {
    console.log(`Admin already exists: ${email}`);
  }

  const existingProducts = db.products.list({ limit: 1 });
  if (existingProducts.length === 0) {
    const product = productService.create(
      {
        name: "Trex Starter Kit",
        description: "Demo product for the MLM commission engine.",
        specs: { weight_kg: 1.2 },
        stockCount: 10000,
        xCents: 4000,
        yCents: 10000,
      },
      admin.id
    );
    console.log(`Created demo product: ${product.id} (x=$40.00, y=$100.00)`);
  } else {
    console.log("Products already exist, skipping demo product creation.");
  }

  console.log("Seed complete.");
}

main();
