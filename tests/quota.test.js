import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { commissionPlanService } from "../src/services/commissionPlanService.js";
import { quotaService } from "../src/services/quotaService.js";
import { nodeService } from "../src/services/nodeService.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { refundService } from "../src/services/refundService.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";

// Default plan: xCents=4000, yCents=10000 -> margin=6000, level1 rate 2000bp
// (from config.defaults.levelRatesBp), so a direct downline purchase always
// sends exactly 1200 cents ($12.00) to its immediate parent, quota mode or
// not. Every test below relies on that fixed, predictable amount.
const LEVEL1_SHARE_CENTS = 1200;

function makeRoot(product) {
  const root = makeUser("q_root");
  fundWallet(root.id, 1_000_000);
  const result = purchaseService.buy({ userId: root.id, productId: product.id });
  return { user: root, node: result.node, code: result.ownRedeemCode.code };
}

function buyUnder(product, code) {
  const buyer = makeUser("q_child");
  fundWallet(buyer.id, 1_000_000);
  return purchaseService.buy({ userId: buyer.id, productId: product.id, redeemCode: code });
}

describe("Quota/tier progression -- tier config validation", () => {
  test("rejects a non-positive quota_target_cents", () => {
    const product = makeProduct();
    expect(() =>
      quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 0 })
    ).toThrow();
  });

  test("rejects duplicate tier_order for the same product", () => {
    const product = makeProduct();
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 500 });
    expect(() =>
      quotaService.createTier(product.id, { tier_order: 1, name: "Also blue", quota_target_cents: 900 })
    ).toThrow();
  });

  test("accepts a valid tier and lists tiers ascending by tier_order", () => {
    const product = makeProduct();
    quotaService.createTier(product.id, { tier_order: 2, name: "Silver", quota_target_cents: 2000 });
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 1000, cash_bonus_cents: 50 });
    const tiers = quotaService.listTiers(product.id);
    expect(tiers.map((t) => t.name)).toEqual(["Blue", "Silver"]);
    expect(tiers[0].cash_bonus_cents).toBe(50);
  });

  test("updateTier rejects a tier id from a different product", () => {
    const productA = makeProduct();
    const productB = makeProduct();
    const tier = quotaService.createTier(productA.id, { tier_order: 1, name: "Blue", quota_target_cents: 1000 });
    expect(() => quotaService.updateTier(productB.id, tier.id, { name: "Hijacked" })).toThrow();
  });
});

describe("Quota/tier progression -- wallet mode is unaffected by default", () => {
  test("a plan with payout_mode='wallet' (the default) still pays cash into pending commissions, not quota", () => {
    const product = makeProduct();
    const { code } = makeRoot(product);
    const { ledgerEntries } = buyUnder(product, code);
    const level1Entry = ledgerEntries.find((e) => e.level_depth === 1);
    expect(level1Entry.status).toBe("pending");
    expect(level1Entry.amount_cents).toBe(LEVEL1_SHARE_CENTS);
  });
});

describe("Quota/tier progression -- progress accumulation", () => {
  test("a purchase below a tier's target only accumulates progress, no completion", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 5000 });
    const { node, code } = makeRoot(product);

    buyUnder(product, code);

    const state = quotaService.getNodeState(node.id, product.id);
    expect(state.accumulated_cents).toBe(LEVEL1_SHARE_CENTS);
    expect(state.current_tier).toBeNull();
    expect(state.next_tier.name).toBe("Blue");
  });

  test("exactly reaching a tier's target completes it, pays the cash bonus once, and resets progress", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, {
      tier_order: 1,
      name: "Blue",
      quota_target_cents: LEVEL1_SHARE_CENTS,
      cash_bonus_cents: 300,
      rate_bonus_bp: 0,
    });
    const { user, node, code } = makeRoot(product);
    const balanceBefore = db.wallet.getBalance(user.id);

    buyUnder(product, code);

    const state = quotaService.getNodeState(node.id, product.id);
    expect(state.accumulated_cents).toBe(0);
    expect(state.current_tier.name).toBe("Blue");

    const balanceAfter = db.wallet.getBalance(user.id);
    expect(balanceAfter - balanceBefore).toBe(300);

    const completions = quotaService.listCompletions(node.id);
    expect(completions.length).toBe(1);
    expect(completions[0].cash_bonus_cents).toBe(300);
  });

  test("a single purchase can complete multiple tiers at once, carrying overflow forward", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 300, cash_bonus_cents: 10 });
    quotaService.createTier(product.id, { tier_order: 2, name: "Silver", quota_target_cents: 300, cash_bonus_cents: 20 });
    quotaService.createTier(product.id, { tier_order: 3, name: "Gold", quota_target_cents: 300, cash_bonus_cents: 30 });
    const { node, code } = makeRoot(product);

    // 1200 cents in one shot: 300 + 300 + 300 = 900 completes all three
    // tiers, leaving 300 cents overflow with nowhere further to go.
    buyUnder(product, code);

    const state = quotaService.getNodeState(node.id, product.id);
    expect(state.current_tier.name).toBe("Gold");
    expect(state.next_tier).toBeNull();
    const completions = quotaService.listCompletions(node.id);
    expect(completions.length).toBe(3);
    expect(completions.map((c) => c.tier_order).sort()).toEqual([1, 2, 3]);
  });

  test("progress and cash bonuses never double up when a node re-purchases across multiple tiers", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 2000, cash_bonus_cents: 100 });
    const { user, node, code: rootCode } = makeRoot(product);
    const balanceBefore = db.wallet.getBalance(user.id);

    // Two separate purchases from two different children of the same root,
    // 1200 + 1200 = 2400 -- crosses the 2000 target exactly once.
    buyUnder(product, rootCode);
    buyUnder(product, rootCode);

    const completions = quotaService.listCompletions(node.id);
    expect(completions.length).toBe(1);
    expect(db.wallet.getBalance(user.id) - balanceBefore).toBe(100);
    // Only one tier is configured, so the 400 cents left over after
    // completing it (2400 - 2000) has nowhere further to go and isn't
    // tracked -- matches the "maxed out every configured tier" behavior.
    const state = quotaService.getNodeState(node.id, product.id);
    expect(state.accumulated_cents).toBe(0);
  });
});

describe("Quota/tier progression -- unlocked rate bonus applies going forward, in both modes", () => {
  test("rate_bonus_bp from a completed tier boosts the node's rate on its NEXT commission, even after switching back to wallet mode", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, {
      tier_order: 1,
      name: "Blue",
      quota_target_cents: LEVEL1_SHARE_CENTS,
      rate_bonus_bp: 500, // +5%
    });
    const { node, code } = makeRoot(product);

    // Completes Blue immediately (exact match), unlocking +500bp.
    buyUnder(product, code);
    expect(quotaService.rateBonusBp(node.id, product.id)).toBe(500);

    // Switch back to wallet mode and buy again -- the level-1 entry must
    // reflect the base rate (2000bp) PLUS the unlocked bonus (500bp).
    commissionPlanService.update(product.id, { payoutMode: "wallet" }, "test-admin");
    const { ledgerEntries } = buyUnder(product, code);
    const level1Entry = ledgerEntries.find((e) => e.level_depth === 1);
    expect(level1Entry.rate_applied_bp).toBe(2500);
    expect(level1Entry.status).toBe("pending");
    expect(level1Entry.amount_cents).toBe(Math.floor((6000 * 2500) / 10000));
  });
});

describe("Quota/tier progression -- accounting", () => {
  test("quota-mode shares are excluded from totalPayoutCents / trex_net, and from nodeService.earnings totals", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 1_000_000 });
    const { node, code } = makeRoot(product);

    const { transaction } = buyUnder(product, code);
    // Nothing was actually paid out in cash -- the whole payout pool share
    // stayed inside trex_net.
    expect(transaction.total_payout_cents).toBe(0);
    expect(transaction.trex_net_amount_cents).toBeGreaterThan(0);

    const { entries, totals } = nodeService.earnings(node.id, { requesterUserId: node.user_id, isAdmin: false });
    const quotaEntry = entries.find((e) => e.status === "quota_applied");
    expect(quotaEntry.amount_cents).toBe(LEVEL1_SHARE_CENTS);
    expect(totals.total_cents).toBe(0);
    expect(totals.quota_applied_cents).toBeUndefined();
  });
});

describe("Quota/tier progression -- refund is non-retroactive", () => {
  test("refunding a quota-mode purchase does not touch quota progress or the quota_applied ledger entry", () => {
    const product = makeProduct({ planOverrides: { payoutMode: "quota" } });
    quotaService.createTier(product.id, { tier_order: 1, name: "Blue", quota_target_cents: 5000 });
    const { node, code } = makeRoot(product);
    const { transaction } = buyUnder(product, code);

    const stateBefore = quotaService.getNodeState(node.id, product.id);
    refundService.refund({ transactionId: transaction.id, actorUserId: "test-admin", reason: "test" });
    const stateAfter = quotaService.getNodeState(node.id, product.id);

    expect(stateAfter.accumulated_cents).toBe(stateBefore.accumulated_cents);
    const entries = db.ledger.listByTransaction(transaction.id);
    const level1Entry = entries.find((e) => e.level_depth === 1);
    expect(level1Entry.status).toBe("quota_applied");
    expect(level1Entry.clawed_back_cents).toBe(0);
  });
});
