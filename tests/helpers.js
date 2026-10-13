import { db } from "../src/db/index.js";
import { productService } from "../src/services/productService.js";
import { commissionPlanService } from "../src/services/commissionPlanService.js";

let counter = 0;
export function uniq(prefix) {
  counter += 1;
  return `${prefix}${counter}`;
}

export function makeUser(name = "user") {
  const id = uniq(name);
  return db.users.create({ email: `${id}@test.local`, passwordHash: "x", name: id });
}

export function fundWallet(userId, amountCents) {
  db.wallet.credit(userId, amountCents, { type: "deposit" });
}

// stockCount defaults high: purchases decrement stock and are refused once
// it hits zero, and these fixtures exist to exercise commission maths, not
// inventory. Tests that care about stock pass an explicit count.
export function makeProduct({ xCents = 4000, yCents = 10000, name = "TestProduct", stockCount = 1_000_000, planOverrides } = {}) {
  const product = productService.create({ name: uniq(name), xCents, yCents, stockCount }, "test-admin");
  if (planOverrides) {
    commissionPlanService.update(product.id, planOverrides, "test-admin");
  }
  return product;
}
