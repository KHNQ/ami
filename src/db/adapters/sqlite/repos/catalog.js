import { newId } from "../../../../lib/id.js";

export function makeProductsRepo(raw) {
  return {
    create({ name, description, specs = {}, stockCount = 0, xCents, yCents }) {
      const id = newId("prod");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO products (id, name, description, specs_json, stock_count, current_x_cents, list_price_y_cents, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(id, name, description || "", JSON.stringify(specs), stockCount, xCents, yCents, now, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM products WHERE id = ?`).get(id) || null;
    },
    list({ status, limit = 50, offset = 0 } = {}) {
      if (status) {
        return raw
          .query(`SELECT * FROM products WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
          .all(status, limit, offset);
      }
      return raw.query(`SELECT * FROM products ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(limit, offset);
    },
    updatePrice(id, yCents) {
      raw.query(`UPDATE products SET list_price_y_cents = ?, updated_at = ? WHERE id = ?`).run(yCents, new Date().toISOString(), id);
      return this.get(id);
    },
    setCurrentX(id, xCents) {
      raw.query(`UPDATE products SET current_x_cents = ?, updated_at = ? WHERE id = ?`).run(xCents, new Date().toISOString(), id);
      return this.get(id);
    },
    setCommissionPlan(id, planId) {
      raw.query(`UPDATE products SET commission_plan_id = ?, updated_at = ? WHERE id = ?`).run(planId, new Date().toISOString(), id);
      return this.get(id);
    },
    setStatus(id, status) {
      raw.query(`UPDATE products SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
      return this.get(id);
    },
    adjustStock(id, delta) {
      raw.query(`UPDATE products SET stock_count = stock_count + ?, updated_at = ? WHERE id = ?`).run(delta, new Date().toISOString(), id);
      return this.get(id);
    },
    // Sells one unit, conditionally. The `stock_count > 0` guard lives in
    // the UPDATE rather than in a read-then-write in the service so two
    // buyers racing for the last unit can't both pass a check and drive
    // stock negative -- exactly one UPDATE matches a row. Returns false when
    // there was nothing left to sell.
    tryDecrementStock(id) {
      raw
        .query(`UPDATE products SET stock_count = stock_count - 1, updated_at = ? WHERE id = ? AND stock_count > 0`)
        .run(new Date().toISOString(), id);
      return raw.query(`SELECT changes() AS changed`).get().changed > 0;
    },
    update(id, fields) {
      const allowed = ["name", "description"];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          sets.push(`${key === "description" ? "description" : key} = ?`);
          params.push(fields[key]);
        }
      }
      if (fields.specs !== undefined) {
        sets.push("specs_json = ?");
        params.push(JSON.stringify(fields.specs));
      }
      if (!sets.length) return this.get(id);
      sets.push("updated_at = ?");
      params.push(new Date().toISOString());
      params.push(id);
      raw.query(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return this.get(id);
    },
  };
}

export function makeWarehouseCostRepo(raw) {
  return {
    append({ productId, xCents, createdBy }) {
      const id = newId("wch");
      const now = new Date().toISOString();
      raw
        .query(`INSERT INTO warehouse_cost_history (id, product_id, x_cents, effective_from, created_by) VALUES (?, ?, ?, ?, ?)`)
        .run(id, productId, xCents, now, createdBy || null);
      return raw.query(`SELECT * FROM warehouse_cost_history WHERE id = ?`).get(id);
    },
    listByProduct(productId, { limit = 100, offset = 0 } = {}) {
      return raw
        .query(`SELECT * FROM warehouse_cost_history WHERE product_id = ? ORDER BY effective_from DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(productId, limit, offset);
    },
  };
}

export function makeCommissionPlansRepo(raw) {
  function rowToPlan(row) {
    if (!row) return null;
    return { ...row, level_rates_bp: JSON.parse(row.level_rates_bp_json) };
  }
  return {
    getByProductId(productId) {
      return rowToPlan(raw.query(`SELECT * FROM commission_plans WHERE product_id = ?`).get(productId));
    },
    get(id) {
      return rowToPlan(raw.query(`SELECT * FROM commission_plans WHERE id = ?`).get(id));
    },
    // Upsert-by-product-id. Caller (service layer) is responsible for
    // validating sum(level_rates) <= payout_pool_pct before calling this
    // (Invariant 2, must be enforced at save-time, not per-transaction).
    upsert({
      productId,
      minMarginThresholdCents,
      payoutPoolPctBp,
      levelRatesBp,
      maxPayoutDepth,
      activityMinPvCents,
      activityPeriodDays,
      decayInactiveDays,
      decayPctPerPeriodBp,
      reservePctBp,
      compressionEnabled = false,
      rankBonusPoolPctBp = 0,
      payoutMode = "wallet",
    }) {
      const existing = raw.query(`SELECT * FROM commission_plans WHERE product_id = ?`).get(productId);
      const now = new Date().toISOString();
      if (existing) {
        raw
          .query(
            `UPDATE commission_plans SET
               min_margin_threshold_cents = ?, payout_pool_pct_bp = ?, level_rates_bp_json = ?,
               max_payout_depth = ?, activity_min_pv_cents = ?, activity_period_days = ?,
               decay_inactive_days = ?, decay_pct_per_period_bp = ?, reserve_pct_bp = ?,
               compression_enabled = ?, rank_bonus_pool_pct_bp = ?, payout_mode = ?, version = version + 1, updated_at = ?
             WHERE product_id = ?`
          )
          .run(
            minMarginThresholdCents,
            payoutPoolPctBp,
            JSON.stringify(levelRatesBp),
            maxPayoutDepth,
            activityMinPvCents,
            activityPeriodDays,
            decayInactiveDays,
            decayPctPerPeriodBp,
            reservePctBp,
            compressionEnabled ? 1 : 0,
            rankBonusPoolPctBp,
            payoutMode,
            now,
            productId
          );
        return this.getByProductId(productId);
      }
      const id = newId("plan");
      raw
        .query(
          `INSERT INTO commission_plans (
             id, product_id, min_margin_threshold_cents, payout_pool_pct_bp, level_rates_bp_json,
             max_payout_depth, activity_min_pv_cents, activity_period_days, decay_inactive_days,
             decay_pct_per_period_bp, reserve_pct_bp, compression_enabled, rank_bonus_pool_pct_bp,
             payout_mode, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          id,
          productId,
          minMarginThresholdCents,
          payoutPoolPctBp,
          JSON.stringify(levelRatesBp),
          maxPayoutDepth,
          activityMinPvCents,
          activityPeriodDays,
          decayInactiveDays,
          decayPctPerPeriodBp,
          reservePctBp,
          compressionEnabled ? 1 : 0,
          rankBonusPoolPctBp,
          payoutMode,
          now,
          now
        );
      return this.getByProductId(productId);
    },
  };
}
