import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { refundService } from "../src/services/refundService.js";
import { jobsService } from "../src/services/jobsService.js";
import { reportService } from "../src/services/reportService.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";

// End-to-end business simulation: multiple independent Spaces on the same
// Product, people joining both as fresh roots and via redeem codes several
// levels deep, spread across three monthly batches (a quarter). After each
// month we run the scheduled jobs (activity period reset + commission
// release) and pull a trex-net report for that month, asserting Trex's
// books stay sound throughout -- exactly the "build spaces and join
// people... monitor trex net and dev net... one month at a time" scenario
// from idea.md.
describe("Quarter-long multi-space simulation", () => {
  test("trex_net and reserve stay positive across 3 monthly batches, multiple spaces, and a mid-quarter refund", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000, name: "QuarterProduct" });

    function fundedUser(tag) {
      const u = makeUser(tag);
      fundWallet(u.id, 1_000_000); // $10,000, plenty for many $100 purchases
      return u;
    }

    // Build N independent spaces, each rooted by a fresh no-code purchase,
    // then grow each into a branching tree by mixing root-sponsor codes and
    // deeper generated codes -- covers "unbounded branching factor" and
    // multiple concurrent Spaces on one Product (Section 3).
    function buildSpace(spaceTag, width, depth) {
      const root = fundedUser(`${spaceTag}_root`);
      const rootResult = purchaseService.buy({ userId: root.id, productId: product.id });
      const receipts = [rootResult];

      let frontier = [rootResult.ownRedeemCode.code];
      for (let level = 0; level < depth; level++) {
        const nextFrontier = [];
        for (const parentCode of frontier) {
          for (let w = 0; w < width; w++) {
            const u = fundedUser(`${spaceTag}_L${level}_${w}`);
            const res = purchaseService.buy({ userId: u.id, productId: product.id, redeemCode: parentCode });
            receipts.push(res);
            nextFrontier.push(res.ownRedeemCode.code);
          }
        }
        frontier = nextFrontier;
      }
      return receipts;
    }

    const monthlyReports = [];
    let refundedTxId = null;

    for (let month = 1; month <= 3; month++) {
      const monthStart = new Date().toISOString();

      // Each month: two brand-new spaces (fresh roots) plus growth of a
      // small branching tree (width 2, depth 2 = 1 + 2 + 4 = 7 nodes) each.
      buildSpace(`m${month}_a`, 2, 2);
      buildSpace(`m${month}_b`, 2, 2);

      // On month 2, refund one of month 1's sales mid-quarter and confirm
      // the books still balance afterward (Invariant 5).
      if (month === 2 && refundedTxId) {
        refundService.refund({ transactionId: refundedTxId, actorUserId: "test-admin", reason: "quarterly test refund" });
      }
      if (month === 1) {
        // remember a transaction to refund next month
        const all = db.transactions.list({ productId: product.id, limit: 1 });
        refundedTxId = all[0].id;
      }

      // End-of-month scheduled jobs: roll activity periods, release matured
      // commissions (force-released here since this test doesn't run for
      // real weeks -- holdDays: 0 simulates the hold window having elapsed).
      const jobResult = jobsService.runAll({ holdDays: 0 });
      expect(jobResult.releases.releasedCents).toBeGreaterThanOrEqual(0);

      const monthEnd = new Date().toISOString();
      const report = reportService.trexNetSummary({ productId: product.id, fromDate: monthStart, toDate: monthEnd });
      monthlyReports.push({ month, ...report });

      expect(report.tx_count).toBeGreaterThan(0);
      expect(report.total_trex_net_cents).toBeGreaterThan(0);
      // Every cent of margin is accounted for: payout + reserve + trex_net.
      expect(report.total_payout_cents + report.total_reserve_cents + report.total_trex_net_cents).toBe(
        report.total_margin_cents
      );
      // Payout never exceeds the pool, in aggregate either.
      expect(report.total_payout_cents).toBeLessThanOrEqual(report.total_payout_pool_cents);
    }

    // Full-quarter rollup across all three months.
    const quarterReport = reportService.trexNetSummary({ productId: product.id });
    expect(quarterReport.tx_count).toBe(monthlyReports.reduce((a, r) => a + r.tx_count, 0));
    expect(quarterReport.total_trex_net_cents).toBeGreaterThan(0);
    expect(db.reserve.getBalance()).toBeGreaterThanOrEqual(0);

    // Standing regression check (Section 10 item 8): every historical
    // transaction for this product must have trex_net_amount_cents > 0.
    const audit = reportService.auditInvariants();
    expect(audit.ok).toBe(true);
    expect(audit.violations).toEqual([]);

    // Sanity print for a human reading test output -- "in one month with
    // this amount of sale for this product with this price we have this net".
    console.log("\nQuarter simulation report (product:", product.id, "):");
    for (const r of monthlyReports) {
      console.log(
        `  Month ${r.month}: ${r.tx_count} sales, revenue=$${(r.total_revenue_cents / 100).toFixed(2)}, ` +
          `margin=$${(r.total_margin_cents / 100).toFixed(2)}, payout=$${(r.total_payout_cents / 100).toFixed(2)}, ` +
          `reserve=$${(r.total_reserve_cents / 100).toFixed(2)}, trex_net=$${(r.total_trex_net_cents / 100).toFixed(2)}`
      );
    }
    console.log(
      `  Quarter total: ${quarterReport.tx_count} sales, trex_net=$${(quarterReport.total_trex_net_cents / 100).toFixed(2)}, ` +
        `reserve_fund_balance=$${(db.reserve.getBalance() / 100).toFixed(2)}\n`
    );
  });

  test("deep chain beyond max_payout_depth still keeps trex_net positive and caps payout at the pool", () => {
    const product = makeProduct({ xCents: 4000, yCents: 10000, name: "DeepChainProduct" });
    const plan = db.commissionPlans.getByProductId(product.id);

    const root = makeUser("deep_root");
    fundWallet(root.id, 1_000_000);
    let result = purchaseService.buy({ userId: root.id, productId: product.id });
    let code = result.ownRedeemCode.code;

    // Go twice as deep as max_payout_depth to prove levels beyond the cap
    // simply stop earning, without ever threatening Invariant 2/3.
    for (let i = 0; i < plan.max_payout_depth * 2; i++) {
      const u = makeUser(`deep_${i}`);
      fundWallet(u.id, 1_000_000);
      result = purchaseService.buy({ userId: u.id, productId: product.id, redeemCode: code });
      expect(result.transaction.trex_net_amount_cents).toBeGreaterThan(0);
      expect(result.ledgerEntries.length).toBeLessThanOrEqual(plan.max_payout_depth);
      code = result.ownRedeemCode.code;
    }
  });
});
