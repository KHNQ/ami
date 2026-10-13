import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { refundService } from "../src/services/refundService.js";
import { releaseMaturedCommissions } from "../src/services/commissionService.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";
import { POST, signup, signupAdmin, createProduct, buy } from "./httpHelpers.js";

describe("Invariant 5 -- refund/clawback consistency", () => {
  test("full refund fully claws back a pending commission ledger entry", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const sponsor = makeUser("refund_sponsor");
    fundWallet(sponsor.id, 100000);
    const r1 = purchaseService.buy({ userId: sponsor.id, productId: product.id });

    const buyer = makeUser("refund_buyer");
    fundWallet(buyer.id, 100000);
    const r2 = purchaseService.buy({ userId: buyer.id, productId: product.id, redeemCode: r1.ownRedeemCode.code });
    const entry = r2.ledgerEntries[0];
    expect(entry.status).toBe("pending");

    const reserveBefore = db.reserve.getBalance();
    const buyerBalanceBefore = db.wallet.getBalance(buyer.id);

    const result = refundService.refund({ transactionId: r2.transaction.id, actorUserId: "admin" });

    expect(result.transaction.status).toBe("refunded");
    expect(result.clawbacks.length).toBe(1);
    expect(result.clawbacks[0].clawed_back_cents).toBe(entry.amount_cents);

    const reloadedEntry = db.ledger.get(entry.id);
    expect(reloadedEntry.status).toBe("clawed_back");
    expect(reloadedEntry.clawed_back_cents).toBe(entry.amount_cents);

    // Buyer got their money back.
    expect(db.wallet.getBalance(buyer.id)).toBe(buyerBalanceBefore + r2.transaction.y_at_sale_cents);
    // Reserve fund gave back its proportional cut.
    expect(db.reserve.getBalance()).toBe(reserveBefore - r2.transaction.reserve_amount_cents);
  });

  test("clawback on an already-PAID commission debits the sponsor's wallet", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const sponsor = makeUser("paid_sponsor");
    fundWallet(sponsor.id, 100000);
    const r1 = purchaseService.buy({ userId: sponsor.id, productId: product.id });

    const buyer = makeUser("paid_buyer");
    fundWallet(buyer.id, 100000);
    const r2 = purchaseService.buy({ userId: buyer.id, productId: product.id, redeemCode: r1.ownRedeemCode.code });
    const entry = r2.ledgerEntries[0];

    // Force-release commissions immediately (simulates the hold window elapsing).
    releaseMaturedCommissions({ holdDays: 0 });
    expect(db.ledger.get(entry.id).status).toBe("paid");
    const sponsorBalanceAfterRelease = db.wallet.getBalance(sponsor.id);

    refundService.refund({ transactionId: r2.transaction.id, actorUserId: "admin" });

    const reloadedEntry = db.ledger.get(entry.id);
    expect(reloadedEntry.status).toBe("clawed_back");
    expect(db.wallet.getBalance(sponsor.id)).toBe(sponsorBalanceAfterRelease - entry.amount_cents);
  });

  test("partial refund claws back a proportional share, not the whole entry", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const sponsor = makeUser("partial_sponsor");
    fundWallet(sponsor.id, 100000);
    const r1 = purchaseService.buy({ userId: sponsor.id, productId: product.id });

    const buyer = makeUser("partial_buyer");
    fundWallet(buyer.id, 100000);
    const r2 = purchaseService.buy({ userId: buyer.id, productId: product.id, redeemCode: r1.ownRedeemCode.code });
    const entry = r2.ledgerEntries[0];

    // Refund half the sale.
    const half = Math.floor(r2.transaction.y_at_sale_cents / 2);
    const result = refundService.refund({ transactionId: r2.transaction.id, amountCents: half, actorUserId: "admin" });

    expect(result.transaction.status).toBe("partially_refunded");
    const reloadedEntry = db.ledger.get(entry.id);
    expect(reloadedEntry.clawed_back_cents).toBeGreaterThan(0);
    expect(reloadedEntry.clawed_back_cents).toBeLessThan(entry.amount_cents);
    // Still pending on the un-clawed-back remainder.
    expect(reloadedEntry.status).toBe("pending");
  });

  test("cannot refund more than the remaining refundable amount", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000 });
    const buyer = makeUser("overrefund_buyer");
    fundWallet(buyer.id, 100000);
    const r = purchaseService.buy({ userId: buyer.id, productId: product.id });
    refundService.refund({ transactionId: r.transaction.id, amountCents: 6000, actorUserId: "admin" });
    expect(() => refundService.refund({ transactionId: r.transaction.id, amountCents: 6000, actorUserId: "admin" })).toThrow();
  });
});

// Regression: a refund that lands BEFORE the commission has matured shrinks
// the pending ledger entry in place (refundService leaves it `pending` with
// clawed_back_cents set). The release job must then pay the reduced amount
// -- paying amount_cents would hand the clawed-back share straight back and
// undo the refund. Found by the production simulation's audit.
describe("clawback survives commission release", () => {
  test("a partially clawed-back pending entry releases at its reduced value", async () => {
    const admin = await signupAdmin("clawrelease-admin");
    const sponsor = await signup("clawrelease-sponsor");
    const buyer = await signup("clawrelease-buyer");
    const product = await createProduct(admin.token, { xCents: 20_000, yCents: 100_000 });

    const sponsorBuy = await buy(sponsor, product);
    const purchase = await buy(buyer, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code });
    const txId = purchase.body.transaction.id;

    const entry = db.ledger.listByTransaction(txId)[0];
    expect(entry.status).toBe("pending");
    const earned = entry.amount_cents;
    expect(earned).toBeGreaterThan(0);

    // Half the sale comes back before the hold window elapses.
    await POST(`/admin/orders/${txId}/refund`, { amount_cents: 50_000 }, { token: admin.token });
    const clawed = db.ledger.get(entry.id);
    expect(clawed.status).toBe("pending");
    expect(clawed.clawed_back_cents).toBeGreaterThan(0);

    const owed = clawed.amount_cents - clawed.clawed_back_cents;
    const before = db.wallet.getBalance(sponsor.user.id);
    await POST("/admin/jobs/release-commissions", { holdDays: 0 }, { token: admin.token });

    // Exactly what is still owed -- not the full pre-refund commission.
    expect(db.wallet.getBalance(sponsor.user.id) - before).toBe(owed);
    expect(owed).toBeLessThan(earned);
  });

  test("an entry fully clawed back before maturing pays nothing and stops being pending", async () => {
    const admin = await signupAdmin("clawfull-admin");
    const sponsor = await signup("clawfull-sponsor");
    const buyer = await signup("clawfull-buyer");
    const product = await createProduct(admin.token, { xCents: 20_000, yCents: 100_000 });

    const sponsorBuy = await buy(sponsor, product);
    const purchase = await buy(buyer, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code });
    const entry = db.ledger.listByTransaction(purchase.body.transaction.id)[0];

    // Refund the whole sale.
    await POST(`/admin/orders/${purchase.body.transaction.id}/refund`, {}, { token: admin.token });
    const before = db.wallet.getBalance(sponsor.user.id);

    await POST("/admin/jobs/release-commissions", { holdDays: 0 }, { token: admin.token });

    expect(db.wallet.getBalance(sponsor.user.id)).toBe(before);
    expect(db.ledger.get(entry.id).status).not.toBe("pending");
  });
});
