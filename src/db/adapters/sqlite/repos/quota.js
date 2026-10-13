import { newId } from "../../../../lib/id.js";

export function makeQuotaTiersRepo(raw) {
  return {
    create({ productId, tierOrder, name, quotaTargetCents, cashBonusCents = 0, rateBonusBp = 0, perks = [] }) {
      const id = newId("qtier");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO quota_tiers (
             id, product_id, tier_order, name, quota_target_cents, cash_bonus_cents,
             rate_bonus_bp, perks_json, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(id, productId, tierOrder, name, quotaTargetCents, cashBonusCents, rateBonusBp, JSON.stringify(perks), now, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM quota_tiers WHERE id = ?`).get(id) || null;
    },
    // Ascending tier_order, since callers walk tiers worst-to-best to find
    // the next tier a node needs to complete.
    listByProduct(productId, { includeDisabled = false } = {}) {
      if (includeDisabled) {
        return raw.query(`SELECT * FROM quota_tiers WHERE product_id = ? ORDER BY tier_order ASC`).all(productId);
      }
      return raw
        .query(`SELECT * FROM quota_tiers WHERE product_id = ? AND status = 'active' ORDER BY tier_order ASC`)
        .all(productId);
    },
    update(id, { name, quotaTargetCents, cashBonusCents, rateBonusBp, perks, status }) {
      const existing = this.get(id);
      if (!existing) return null;
      raw
        .query(
          `UPDATE quota_tiers SET
             name = ?, quota_target_cents = ?, cash_bonus_cents = ?, rate_bonus_bp = ?,
             perks_json = ?, status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          name ?? existing.name,
          quotaTargetCents ?? existing.quota_target_cents,
          cashBonusCents ?? existing.cash_bonus_cents,
          rateBonusBp ?? existing.rate_bonus_bp,
          perks !== undefined ? JSON.stringify(perks) : existing.perks_json,
          status ?? existing.status,
          new Date().toISOString(),
          id
        );
      return this.get(id);
    },
  };
}

export function makeNodeQuotaStateRepo(raw) {
  return {
    get(nodeId, productId) {
      return raw.query(`SELECT * FROM node_quota_state WHERE node_id = ? AND product_id = ?`).get(nodeId, productId) || null;
    },
    // Every distributeCommission call and every GET /nodes/:id/quota read
    // needs a row to exist -- create the zeroed default lazily on first use
    // rather than at node-creation time, since most products never turn
    // quota mode on.
    ensure(nodeId, productId) {
      const existing = this.get(nodeId, productId);
      if (existing) return existing;
      const id = newId("nqs");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO node_quota_state (id, node_id, product_id, completed_tier_order, accumulated_cents, unlocked_rate_bonus_bp, updated_at)
           VALUES (?, ?, ?, 0, 0, 0, ?)`
        )
        .run(id, nodeId, productId, now);
      return this.get(nodeId, productId);
    },
    updateProgress(nodeId, productId, { completedTierOrder, accumulatedCents, unlockedRateBonusBp }) {
      this.ensure(nodeId, productId);
      raw
        .query(
          `UPDATE node_quota_state SET completed_tier_order = ?, accumulated_cents = ?, unlocked_rate_bonus_bp = ?, updated_at = ?
           WHERE node_id = ? AND product_id = ?`
        )
        .run(completedTierOrder, accumulatedCents, unlockedRateBonusBp, new Date().toISOString(), nodeId, productId);
      return this.get(nodeId, productId);
    },
  };
}

export function makeQuotaCompletionsRepo(raw) {
  return {
    create({ nodeId, userId, productId, quotaTierId, tierOrder, cashBonusCents, rateBonusBp }) {
      const id = newId("qtc");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO quota_tier_completions (
             id, node_id, user_id, product_id, quota_tier_id, tier_order,
             cash_bonus_cents, rate_bonus_bp, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, nodeId, userId, productId, quotaTierId, tierOrder, cashBonusCents, rateBonusBp, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM quota_tier_completions WHERE id = ?`).get(id) || null;
    },
    listByNode(nodeId, { limit = 50, offset = 0 } = {}) {
      return raw
        .query(`SELECT * FROM quota_tier_completions WHERE node_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(nodeId, limit, offset);
    },
  };
}
