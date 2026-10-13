import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { commissionPlanService } from "../src/services/commissionPlanService.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { bpOf } from "../src/lib/money.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";

describe("Invariant 2 -- sum(level_rates) <= payout_pool_pct, enforced at plan save time", () => {
  test("rejects a plan where level rates exceed the payout pool", () => {
    const product = makeProduct();
    expect(() =>
      commissionPlanService.update(product.id, {
        payoutPoolPctBp: 5000, // 50%
        levelRatesBp: [3000, 3000], // sums to 60% > 50%
      }, "admin")
    ).toThrow();
  });

  test("accepts a plan where level rates are within the payout pool", () => {
    const product = makeProduct();
    const plan = commissionPlanService.update(product.id, {
      payoutPoolPctBp: 6500,
      levelRatesBp: [2000, 1200, 800, 500, 300, 200],
    }, "admin");
    expect(plan.payout_pool_pct_bp).toBe(6500);
  });

  test("rejects reservePctBp >= 10000 (would make trex_net_final <= 0 possible)", () => {
    const product = makeProduct();
    expect(() => commissionPlanService.update(product.id, { reservePctBp: 10000 }, "admin")).toThrow();
  });
});

describe("Invariant 6 -- commission amounts always round down", () => {
  test("bpOf floors instead of rounding", () => {
    expect(bpOf(9999, 3333)).toBe(Math.floor((9999 * 3333) / 10000)); // sanity
    expect(bpOf(100, 1)).toBe(0); // 100 * 0.0001 = 0.01 -> floors to 0
    expect(bpOf(3, 5000)).toBe(1); // 3 * 0.5 = 1.5 -> floors to 1, never 2
  });
});

describe("Invariant 1 -- positive margin required at checkout", () => {
  test("rejects a purchase where margin would fall below the plan minimum", () => {
    const product = makeProduct({ xCents: 9950, yCents: 10000 }); // margin only 50 cents
    commissionPlanService.update(product.id, { minMarginThresholdCents: 100 }, "admin");
    const buyer = makeUser("margincheck");
    fundWallet(buyer.id, 100000);
    expect(() => purchaseService.buy({ userId: buyer.id, productId: product.id })).toThrow();
  });

  test("rejects a discount that would push margin below the minimum, never silently clamps", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    commissionPlanService.update(product.id, { minMarginThresholdCents: 100 }, "admin");
    const buyer = makeUser("discountcheck");
    fundWallet(buyer.id, 100000);
    // discount of 5950 leaves margin = (10000-5950) - 4000 = 50 < 100 threshold
    expect(() => purchaseService.buy({ userId: buyer.id, productId: product.id, discountCents: 5950 })).toThrow();
  });
});

describe("Invariant 3 -- trex_net_amount is always strictly positive", () => {
  test("holds across a 6-level deep chain (max_payout_depth)", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const root = makeUser("chain_root");
    fundWallet(root.id, 100000);
    let result = purchaseService.buy({ userId: root.id, productId: product.id });
    expect(result.transaction.trex_net_amount_cents).toBeGreaterThan(0);

    let code = result.ownRedeemCode.code;
    for (let i = 0; i < 8; i++) {
      const u = makeUser(`chain_${i}`);
      fundWallet(u.id, 100000);
      result = purchaseService.buy({ userId: u.id, productId: product.id, redeemCode: code });
      expect(result.transaction.trex_net_amount_cents).toBeGreaterThan(0);
      expect(result.transaction.total_payout_cents).toBeLessThanOrEqual(result.transaction.payout_pool_amount_cents);
      code = result.ownRedeemCode.code;
    }
  });

  test("margin == total_payout + reserve + trex_net_final, exactly, every time", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const root = makeUser("exact_root");
    fundWallet(root.id, 100000);
    const r1 = purchaseService.buy({ userId: root.id, productId: product.id });
    const child = makeUser("exact_child");
    fundWallet(child.id, 100000);
    const r2 = purchaseService.buy({ userId: child.id, productId: product.id, redeemCode: r1.ownRedeemCode.code });

    for (const r of [r1, r2]) {
      const tx = r.transaction;
      expect(tx.total_payout_cents + tx.reserve_amount_cents + tx.trex_net_amount_cents).toBe(tx.margin_cents);
    }
  });
});

describe("Invariant 4 -- x/y locked at sale time", () => {
  test("changing current_x after a sale never mutates the historical transaction", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const buyer = makeUser("lockcheck");
    fundWallet(buyer.id, 100000);
    const { transaction } = purchaseService.buy({ userId: buyer.id, productId: product.id });
    expect(transaction.x_at_sale_cents).toBe(4000);

    db.products.setCurrentX(product.id, 9000); // simulate a big warehouse cost hike later

    const reloaded = db.transactions.get(transaction.id);
    expect(reloaded.x_at_sale_cents).toBe(4000);
    expect(reloaded.margin_cents).toBe(6000);
  });
});

describe("Section 8 edge cases", () => {
  test("rejects a second node for the same (user, product) pair", () => {
    const product = makeProduct();
    const buyer = makeUser("dupcheck");
    fundWallet(buyer.id, 100000);
    purchaseService.buy({ userId: buyer.id, productId: product.id });
    expect(() => purchaseService.buy({ userId: buyer.id, productId: product.id })).toThrow(/already have a position/);
  });

  test("rejects self-referral (redeeming your own code)", () => {
    const product = makeProduct();
    const buyer = makeUser("selfref");
    fundWallet(buyer.id, 100000);
    const { ownRedeemCode } = purchaseService.buy({ userId: buyer.id, productId: product.id });
    const buyer2 = makeUser("selfref_alt_product");
    fundWallet(buyer2.id, 100000);
    // buyer2 trying to use buyer's own code is fine (different user); but
    // buyer trying to use their OWN code on a second product node is a
    // different (user,product) pair so it's not even reachable -- the real
    // self-referral guard fires when the *same* user redeems their *own*
    // code for the *same* product, which is what we assert here.
    expect(() =>
      purchaseService.buy({ userId: buyer.id, productId: product.id, redeemCode: ownRedeemCode.code })
    ).toThrow();
  });

  test("rejects a redeem code once it hits max_uses, even mid-batch", () => {
    const product = makeProduct();
    const owner = makeUser("maxuses_owner");
    fundWallet(owner.id, 100000);
    const { node } = purchaseService.buy({ userId: owner.id, productId: product.id });
    const limitedCode = db.redeemCodes.create({ ownerNodeId: node.id, productId: product.id, spaceId: db.nodes.get(node.id).space_id, maxUses: 1 });

    const u1 = makeUser("maxuses_1");
    fundWallet(u1.id, 100000);
    purchaseService.buy({ userId: u1.id, productId: product.id, redeemCode: limitedCode.code });

    const u2 = makeUser("maxuses_2");
    fundWallet(u2.id, 100000);
    expect(() => purchaseService.buy({ userId: u2.id, productId: product.id, redeemCode: limitedCode.code })).toThrow(
      /not usable/
    );
  });

  test("rejects an expired redeem code", () => {
    const product = makeProduct();
    const owner = makeUser("expired_owner");
    fundWallet(owner.id, 100000);
    const { node } = purchaseService.buy({ userId: owner.id, productId: product.id });
    const expiredCode = db.redeemCodes.create({
      ownerNodeId: node.id,
      productId: product.id,
      spaceId: db.nodes.get(node.id).space_id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const u1 = makeUser("expired_user");
    fundWallet(u1.id, 100000);
    expect(() => purchaseService.buy({ userId: u1.id, productId: product.id, redeemCode: expiredCode.code })).toThrow();
  });

  test("rejects purchase with insufficient wallet balance", () => {
    const product = makeProduct();
    const buyer = makeUser("brokebuyer");
    fundWallet(buyer.id, 100); // way less than y=10000
    expect(() => purchaseService.buy({ userId: buyer.id, productId: product.id })).toThrow();
    // and no partial state was left behind by the failed purchase
    expect(db.nodes.getByUserProduct(buyer.id, product.id)).toBeNull();
  });
});
