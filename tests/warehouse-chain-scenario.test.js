import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { reportService } from "../src/services/reportService.js";
import { bpOf } from "../src/lib/money.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";

// Runs the "N buyers, one straight referral chain in a single Space"
// scenario for whatever x (warehouse/cost price) and y (final/retail price)
// the caller supplies, in cents:
//   P1 (root, no code) -> P2 -> P3 -> ... -> P{buyerCount}
// Every purchase pays commission up that same chain. Expected numbers are
// independently recomputed here from the commission plan's own rates
// (not hand-hardcoded), so this same function is valid for any x/y pair.
function runChainScenario({ xCents, yCents, buyerCount = 10, label }) {
  if (!Number.isInteger(xCents) || xCents < 0) throw new Error("xCents must be a non-negative integer (cents)");
  if (!Number.isInteger(yCents) || yCents <= xCents) {
    throw new Error("yCents must be a positive integer (cents) greater than xCents");
  }

  const product = makeProduct({ xCents, yCents, name: `Chain_${label ?? `${xCents}_${yCents}`}` });
  const plan = db.commissionPlans.getByProductId(product.id);
  // reserve_fund is a single global singleton shared by every test file's
  // in-memory DB in this process -- measure the delta this scenario causes
  // rather than trusting an absolute balance.
  const reserveBalanceBefore = db.reserve.getBalance();

  const marginCents = yCents - xCents;

  const buyers = [];
  let code = null;
  for (let i = 1; i <= buyerCount; i++) {
    const user = makeUser(`p${i}`);
    fundWallet(user.id, yCents); // exactly enough to buy in
    const result = purchaseService.buy({ userId: user.id, productId: product.id, redeemCode: code });
    buyers.push({ index: i, user, result });
    code = result.ownRedeemCode.code; // next buyer joins under this one
  }

  // ---- Independently recompute expected totals from the plan's own rates ----
  const perPersonExpectedEarnedCents = new Array(buyerCount).fill(0);
  let expectedTotalPayoutCents = 0;
  let expectedTotalReserveCents = 0;
  let expectedTotalTrexNetCents = 0;

  for (let n = 1; n <= buyerCount; n++) {
    let payoutForTxCents = 0;
    for (let depth = 1; depth <= plan.max_payout_depth; depth++) {
      const ancestorIndex = n - depth; // 1-based buyer index of the ancestor at this depth
      if (ancestorIndex < 1) break;
      const rateBp = plan.level_rates_bp[depth - 1] ?? 0;
      const amountCents = bpOf(marginCents, rateBp);
      if (amountCents > 0) {
        payoutForTxCents += amountCents;
        perPersonExpectedEarnedCents[ancestorIndex - 1] += amountCents;
      }
    }
    const trexNetPreReserveCents = marginCents - payoutForTxCents;
    const reserveCents = bpOf(trexNetPreReserveCents, plan.reserve_pct_bp);
    expectedTotalPayoutCents += payoutForTxCents;
    expectedTotalReserveCents += reserveCents;
    expectedTotalTrexNetCents += trexNetPreReserveCents - reserveCents;
  }

  // ---- Actuals, read back from the DB exactly like a real report would ----
  const perPerson = buyers.map(({ index, user, result }) => {
    const entries = db.ledger.listByNode(result.node.id);
    const earnedCents = entries.reduce((sum, e) => sum + e.amount_cents, 0);
    return {
      index,
      name: user.name,
      paidCents: yCents,
      earnedCents,
      netCents: earnedCents - yCents,
      commissionCount: entries.length,
    };
  });

  const summary = reportService.trexNetSummary({ productId: product.id });
  const reserveBalanceDelta = db.reserve.getBalance() - reserveBalanceBefore;
  const houseProfitCents = summary.total_trex_net_cents + reserveBalanceDelta;

  return {
    xCents,
    yCents,
    buyerCount,
    marginCents,
    plan,
    perPerson,
    summary,
    reserveBalanceDelta,
    houseProfitCents,
    expected: {
      perPersonEarnedCents: perPersonExpectedEarnedCents,
      totalPayoutCents: expectedTotalPayoutCents,
      totalReserveCents: expectedTotalReserveCents,
      totalTrexNetCents: expectedTotalTrexNetCents,
    },
  };
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function printReport(r) {
  console.log(
    `\nProduct: warehouse cost ${money(r.xCents)}, retail price ${money(r.yCents)}, margin/sale ${money(r.marginCents)}`
  );
  console.log(`${r.buyerCount} buyers in one Space, single referral chain (buyer N redeems buyer N-1's code):\n`);
  console.log("   # | Paid    | Earned  | Net       | # payouts received");
  console.log("  ---|---------|---------|-----------|--------------------");
  for (const p of r.perPerson) {
    const sign = p.netCents >= 0 ? "+" : "-";
    console.log(
      `  ${String(p.index).padStart(2)} | ${money(p.paidCents).padStart(7)} | ${money(p.earnedCents).padStart(7)} | ` +
        `${sign}${money(Math.abs(p.netCents)).padStart(8)} | ${p.commissionCount}`
    );
  }
  console.log("\nOverall (Trex side):");
  console.log(`  Total revenue:           ${money(r.summary.total_revenue_cents)}`);
  console.log(`  Total warehouse cost:    ${money(r.buyerCount * r.xCents)}`);
  console.log(`  Total margin:            ${money(r.summary.total_margin_cents)}`);
  console.log(`  Paid out to the network: ${money(r.summary.total_payout_cents)}`);
  console.log(`  Dev/reserve fund:        ${money(r.summary.total_reserve_cents)}`);
  console.log(`  Trex net:                ${money(r.summary.total_trex_net_cents)}`);
  console.log(`  Total house profit:      ${money(r.houseProfitCents)}  (trex_net + reserve)\n`);
}

function assertScenario(r) {
  expect(r.summary.total_revenue_cents).toBe(r.buyerCount * r.yCents);
  expect(r.summary.total_margin_cents).toBe(r.buyerCount * r.marginCents);
  expect(r.summary.total_payout_cents).toBe(r.expected.totalPayoutCents);
  expect(r.summary.total_reserve_cents).toBe(r.expected.totalReserveCents);
  expect(r.summary.total_trex_net_cents).toBe(r.expected.totalTrexNetCents);
  expect(r.reserveBalanceDelta).toBe(r.expected.totalReserveCents);
  expect(r.houseProfitCents).toBe(r.expected.totalTrexNetCents + r.expected.totalReserveCents);

  // Every cent of margin is accounted for: payout + reserve + trex_net.
  expect(r.summary.total_payout_cents + r.summary.total_reserve_cents + r.summary.total_trex_net_cents).toBe(
    r.summary.total_margin_cents
  );

  r.perPerson.forEach((p, i) => expect(p.earnedCents).toBe(r.expected.perPersonEarnedCents[i]));
  expect(r.perPerson.reduce((s, p) => s + p.earnedCents, 0)).toBe(r.summary.total_payout_cents);

  const audit = reportService.auditInvariants();
  expect(audit.ok).toBe(true);
  expect(audit.violations).toEqual([]);
}

// A small matrix of (x, y) pairs to sanity-check the math holds across
// different margins, not just the one $100/$200 example.
const scenarios = [
  { label: "100_200", xCents: 10_000, yCents: 20_000 }, // $100 -> $200, 50% margin
  { label: "50_150", xCents: 5_000, yCents: 15_000 }, // $50 -> $150, 66.6% margin
  { label: "80_85", xCents: 8_000, yCents: 8_500 }, // $80 -> $85, thin ~5.9% margin
];

describe("Warehouse (x) / retail (y) price -- 10-buyer chain profit breakdown", () => {
  for (const scenario of scenarios) {
    test(`x=${money(scenario.xCents)}, y=${money(scenario.yCents)}`, () => {
      const result = runChainScenario(scenario);
      assertScenario(result);
      printReport(result);
    });
  }

  // Supply your own x/y from the command line, e.g.:
  //   X_CENTS=12000 Y_CENTS=25000 bun test tests/warehouse-chain-scenario.test.js
  const customX = process.env.X_CENTS ? Number(process.env.X_CENTS) : null;
  const customY = process.env.Y_CENTS ? Number(process.env.Y_CENTS) : null;
  if (customX !== null && customY !== null) {
    test(`custom input: x=${money(customX)}, y=${money(customY)}`, () => {
      const result = runChainScenario({ xCents: customX, yCents: customY, label: "custom" });
      assertScenario(result);
      printReport(result);
    });
  }
});
