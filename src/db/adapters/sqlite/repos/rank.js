import { newId } from "../../../../lib/id.js";

export function makeRankTiersRepo(raw) {
  return {
    create({ productId, rankOrder, name, teamVolumeThresholdCents, personalVolumeThresholdCents, poolShareBp }) {
      const id = newId("rank");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO rank_tiers (
             id, product_id, rank_order, name, team_volume_threshold_cents,
             personal_volume_threshold_cents, pool_share_bp, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(id, productId, rankOrder, name, teamVolumeThresholdCents, personalVolumeThresholdCents, poolShareBp, now, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM rank_tiers WHERE id = ?`).get(id) || null;
    },
    // Highest rank_order first, since callers walk tiers best-to-worst to
    // find each node's highest qualifying rank.
    listByProduct(productId, { includeDisabled = false } = {}) {
      if (includeDisabled) {
        return raw.query(`SELECT * FROM rank_tiers WHERE product_id = ? ORDER BY rank_order DESC`).all(productId);
      }
      return raw
        .query(`SELECT * FROM rank_tiers WHERE product_id = ? AND status = 'active' ORDER BY rank_order DESC`)
        .all(productId);
    },
    update(id, { name, teamVolumeThresholdCents, personalVolumeThresholdCents, poolShareBp, status }) {
      const existing = this.get(id);
      if (!existing) return null;
      raw
        .query(
          `UPDATE rank_tiers SET
             name = ?, team_volume_threshold_cents = ?, personal_volume_threshold_cents = ?,
             pool_share_bp = ?, status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          name ?? existing.name,
          teamVolumeThresholdCents ?? existing.team_volume_threshold_cents,
          personalVolumeThresholdCents ?? existing.personal_volume_threshold_cents,
          poolShareBp ?? existing.pool_share_bp,
          status ?? existing.status,
          new Date().toISOString(),
          id
        );
      return this.get(id);
    },
  };
}

export function makeRankBonusPeriodsRepo(raw) {
  return {
    create({ productId, periodStart, periodEnd, trexNetBaseCents, fundedPctBp, poolAmountCents }) {
      const id = newId("rbp");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO rank_bonus_periods (
             id, product_id, period_start, period_end, trex_net_base_cents,
             funded_pct_bp, pool_amount_cents, distributed_cents, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'funded', ?)`
        )
        .run(id, productId, periodStart, periodEnd, trexNetBaseCents, fundedPctBp, poolAmountCents, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM rank_bonus_periods WHERE id = ?`).get(id) || null;
    },
    getByProductAndRange(productId, periodStart, periodEnd) {
      return (
        raw
          .query(`SELECT * FROM rank_bonus_periods WHERE product_id = ? AND period_start = ? AND period_end = ?`)
          .get(productId, periodStart, periodEnd) || null
      );
    },
    listByProduct(productId, { limit = 50, offset = 0 } = {}) {
      return raw
        .query(`SELECT * FROM rank_bonus_periods WHERE product_id = ? ORDER BY period_start DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(productId, limit, offset);
    },
    applyDistribution(id, distributedCents) {
      raw
        .query(`UPDATE rank_bonus_periods SET distributed_cents = ?, status = 'distributed' WHERE id = ?`)
        .run(distributedCents, id);
      return this.get(id);
    },
  };
}

export function makeRankBonusLedgerRepo(raw) {
  return {
    create({ periodId, nodeId, userId, rankTierId, teamVolumeCents, personalVolumeCents, amountCents }) {
      const id = newId("rble");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO rank_bonus_ledger_entries (
             id, period_id, node_id, user_id, rank_tier_id, team_volume_cents,
             personal_volume_cents, amount_cents, status, paid_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`
        )
        .run(id, periodId, nodeId, userId, rankTierId, teamVolumeCents, personalVolumeCents, amountCents, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM rank_bonus_ledger_entries WHERE id = ?`).get(id) || null;
    },
    listByPeriod(periodId) {
      return raw.query(`SELECT * FROM rank_bonus_ledger_entries WHERE period_id = ?`).all(periodId);
    },
    listByNode(nodeId, { limit = 50, offset = 0, status } = {}) {
      if (status) {
        return raw
          .query(
            `SELECT * FROM rank_bonus_ledger_entries WHERE node_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
          )
          .all(nodeId, status, limit, offset);
      }
      return raw
        .query(`SELECT * FROM rank_bonus_ledger_entries WHERE node_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(nodeId, limit, offset);
    },
    listPendingOlderThan(cutoffIso) {
      return raw
        .query(`SELECT * FROM rank_bonus_ledger_entries WHERE status = 'pending' AND created_at <= ?`)
        .all(cutoffIso);
    },
    markPaid(id) {
      raw
        .query(`UPDATE rank_bonus_ledger_entries SET status = 'paid', paid_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      return this.get(id);
    },
  };
}
