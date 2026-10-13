import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

// GET /admin/reports/trex-net -- aggregate trex_net over a period, per
// product/space, for auditing. Also doubles as the standing regression
// check from Section 10 item 8: every historical transaction's
// trex_net_amount_cents must be > 0.
export const reportService = {
  trexNetSummary({ productId, spaceId, fromDate, toDate } = {}) {
    return db.transactions.aggregateNet({ productId, spaceId, fromDate, toDate });
  },

  reserveFundSummary() {
    return {
      balance_cents: db.reserve.getBalance(),
      recent_entries: db.reserve.listLedger({ limit: 20 }),
    };
  },

  // Standing invariant audit: scans every transaction and flags any row
  // that ever violated trex_net > 0 (post-reserve). Should always return
  // an empty `violations` array -- if it doesn't, something upstream broke
  // an invariant that was supposed to be structurally impossible.
  auditInvariants() {
    const all = db.transactions.listAll();
    const violations = [];
    for (const tx of all) {
      if (tx.trex_net_amount_cents <= 0) {
        violations.push({ transaction_id: tx.id, reason: "trex_net_amount_cents <= 0", trex_net_amount_cents: tx.trex_net_amount_cents });
      }
      if (tx.margin_cents <= 0) {
        violations.push({ transaction_id: tx.id, reason: "margin_cents <= 0", margin_cents: tx.margin_cents });
      }
      if (tx.total_payout_cents > tx.payout_pool_amount_cents) {
        violations.push({ transaction_id: tx.id, reason: "total_payout exceeds payout_pool", total_payout_cents: tx.total_payout_cents, payout_pool_amount_cents: tx.payout_pool_amount_cents });
      }
    }
    return { checked: all.length, violations, ok: violations.length === 0 };
  },

  // GET /admin/monitoring/reports/rank-bonus-periods[/:id] -- funded vs
  // distributed per period, with a per-node breakdown when a specific
  // period is requested.
  rankBonusPeriods(productId, opts) {
    return db.rankBonusPeriods.listByProduct(productId, opts);
  },

  rankBonusPeriodDetail(periodId) {
    const period = db.rankBonusPeriods.get(periodId);
    if (!period) throw Errors.notFound("Rank bonus period not found");
    return { period, entries: db.rankBonusLedger.listByPeriod(periodId) };
  },

  platformOverview() {
    return {
      trex_net_summary: db.transactions.aggregateNet({}),
      reserve_fund_balance_cents: db.reserve.getBalance(),
    };
  },
};
