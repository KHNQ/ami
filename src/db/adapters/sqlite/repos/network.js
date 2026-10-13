import { newId, newCode } from "../../../../lib/id.js";
import { Errors } from "../../../../lib/errors.js";

export function makeSpacesRepo(raw) {
  return {
    create({ productId, rootUserId }) {
      const id = newId("space");
      const now = new Date().toISOString();
      raw
        .query(`INSERT INTO spaces (id, product_id, root_user_id, root_node_id, created_at) VALUES (?, ?, ?, NULL, ?)`)
        .run(id, productId, rootUserId, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM spaces WHERE id = ?`).get(id) || null;
    },
    setRootNode(id, rootNodeId) {
      raw.query(`UPDATE spaces SET root_node_id = ? WHERE id = ?`).run(rootNodeId, id);
      return this.get(id);
    },
    listByProduct(productId, { limit = 50, offset = 0 } = {}) {
      return raw
        .query(`SELECT * FROM spaces WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(productId, limit, offset);
    },
    list({ limit = 50, offset = 0 } = {}) {
      return raw.query(`SELECT * FROM spaces ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(limit, offset);
    },
    // Spaces where this user actually has a node (i.e. is a participant
    // somewhere in the tree, not just the root) -- used to scope the
    // non-admin "my spaces" listing.
    listForUser(userId, { productId, limit = 50, offset = 0 } = {}) {
      if (productId) {
        return raw
          .query(
            `SELECT DISTINCT s.* FROM spaces s
               JOIN nodes n ON n.space_id = s.id
              WHERE n.user_id = ? AND s.product_id = ?
              ORDER BY s.created_at DESC, s.rowid DESC LIMIT ? OFFSET ?`
          )
          .all(userId, productId, limit, offset);
      }
      return raw
        .query(
          `SELECT DISTINCT s.* FROM spaces s
             JOIN nodes n ON n.space_id = s.id
            WHERE n.user_id = ?
            ORDER BY s.created_at DESC, s.rowid DESC LIMIT ? OFFSET ?`
        )
        .all(userId, limit, offset);
    },
    userHasNodeInSpace(spaceId, userId) {
      return !!raw.query(`SELECT 1 FROM nodes WHERE space_id = ? AND user_id = ? LIMIT 1`).get(spaceId, userId);
    },
  };
}

export function makeNodesRepo(raw) {
  return {
    create({ spaceId, productId, userId, parentNodeId }) {
      const id = newId("node");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO nodes (
             id, space_id, product_id, user_id, parent_node_id, own_redeem_code_id,
             personal_volume_period_cents, lifetime_volume_cents, status,
             last_active_at, last_period_reset_at, joined_at
           ) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 'active', ?, ?, ?)`
        )
        .run(id, spaceId, productId, userId, parentNodeId || null, now, now, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM nodes WHERE id = ?`).get(id) || null;
    },
    getByUserProduct(userId, productId) {
      return raw.query(`SELECT * FROM nodes WHERE user_id = ? AND product_id = ?`).get(userId, productId) || null;
    },
    setOwnRedeemCode(nodeId, redeemCodeId) {
      raw.query(`UPDATE nodes SET own_redeem_code_id = ? WHERE id = ?`).run(redeemCodeId, nodeId);
      return this.get(nodeId);
    },
    listChildren(nodeId, { limit = 100, offset = 0 } = {}) {
      return raw
        .query(`SELECT * FROM nodes WHERE parent_node_id = ? ORDER BY joined_at ASC, rowid ASC LIMIT ? OFFSET ?`)
        .all(nodeId, limit, offset);
    },
    listBySpace(spaceId) {
      return raw.query(`SELECT * FROM nodes WHERE space_id = ? ORDER BY joined_at ASC, rowid ASC`).all(spaceId);
    },
    // Ancestor chain from a node up to (and excluding) the given node itself,
    // ordered nearest-first (parent, grandparent, ...). Used by the
    // commission distribution walk and by "upline" lookups.
    listAncestors(nodeId, maxDepth = 1000) {
      const chain = [];
      let current = this.get(nodeId);
      let depth = 0;
      while (current && current.parent_node_id && depth < maxDepth) {
        const parent = this.get(current.parent_node_id);
        if (!parent) break;
        chain.push(parent);
        current = parent;
        depth++;
      }
      return chain;
    },
    // All descendant node ids below a node (full downline), BFS.
    listDownlineIds(nodeId) {
      const out = [];
      let frontier = [nodeId];
      while (frontier.length) {
        const placeholders = frontier.map(() => "?").join(",");
        const rows = raw.query(`SELECT id FROM nodes WHERE parent_node_id IN (${placeholders})`).all(...frontier);
        const ids = rows.map((r) => r.id);
        out.push(...ids);
        frontier = ids;
      }
      return out;
    },
    updateStatus(nodeId, status) {
      raw.query(`UPDATE nodes SET status = ? WHERE id = ?`).run(status, nodeId);
      return this.get(nodeId);
    },
    incrementVolume(nodeId, amountCents) {
      raw
        .query(
          `UPDATE nodes SET personal_volume_period_cents = personal_volume_period_cents + ?,
                              lifetime_volume_cents = lifetime_volume_cents + ?,
                              last_active_at = ?
           WHERE id = ?`
        )
        .run(amountCents, amountCents, new Date().toISOString(), nodeId);
      return this.get(nodeId);
    },
    resetPeriodVolume(nodeId) {
      raw
        .query(`UPDATE nodes SET personal_volume_period_cents = 0, last_period_reset_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), nodeId);
      return this.get(nodeId);
    },
    listAll({ limit = 1000, offset = 0 } = {}) {
      return raw.query(`SELECT * FROM nodes ORDER BY joined_at ASC, rowid ASC LIMIT ? OFFSET ?`).all(limit, offset);
    },
    listByUser(userId) {
      return raw.query(`SELECT * FROM nodes WHERE user_id = ? ORDER BY joined_at DESC, rowid DESC`).all(userId);
    },
    // Rank/leadership bonus pool (idea.md Section 7 item 4): team volume for
    // EVERY node in a space, computed in one pass via a recursive CTE rather
    // than walking the downline per-node (that'd be O(N) queries, each
    // O(depth) -- too slow to run per node per period). Not needed at
    // per-transaction time, only by the periodic rank-bonus job.
    teamVolumeBySpace(spaceId) {
      const rows = raw
        .query(
          `WITH RECURSIVE tree(root_id, node_id) AS (
             SELECT id, id FROM nodes WHERE space_id = ?
             UNION ALL
             SELECT t.root_id, n.id FROM nodes n JOIN tree t ON n.parent_node_id = t.node_id
           )
           SELECT t.root_id AS node_id, SUM(n.personal_volume_period_cents) AS team_volume_cents
           FROM tree t JOIN nodes n ON n.id = t.node_id
           GROUP BY t.root_id`
        )
        .all(spaceId);
      const map = new Map();
      for (const row of rows) map.set(row.node_id, row.team_volume_cents);
      return map;
    },
  };
}

export function makeRedeemCodesRepo(raw) {
  return {
    create({ ownerNodeId, productId, spaceId, maxUses = null, expiresAt = null }) {
      const id = newId("rc");
      const code = `${newCode(10)}`;
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO redeem_codes (id, code, owner_node_id, product_id, space_id, max_uses, uses_count, expires_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?)`
        )
        .run(id, code, ownerNodeId, productId, spaceId, maxUses, expiresAt, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM redeem_codes WHERE id = ?`).get(id) || null;
    },
    getByCode(code) {
      return raw.query(`SELECT * FROM redeem_codes WHERE code = ?`).get(code) || null;
    },
    listByOwnerNode(ownerNodeId) {
      return raw.query(`SELECT * FROM redeem_codes WHERE owner_node_id = ? ORDER BY created_at DESC, rowid DESC`).all(ownerNodeId);
    },
    revoke(id) {
      raw.query(`UPDATE redeem_codes SET status = 'revoked' WHERE id = ?`).run(id);
      return this.get(id);
    },
    // Atomic use-count increment guarded by max_uses at the SQL level, so
    // concurrent redemptions can never push uses_count past max_uses
    // (see idea.md Section 8, "Concurrent redeem-code use at max_uses boundary").
    tryIncrementUse(id) {
      // UPDATE ... RETURNING gives us the atomic "did this actually match"
      // check without depending on a driver-level rows-changed count.
      const updated = raw
        .query(
          `UPDATE redeem_codes
             SET uses_count = uses_count + 1
           WHERE id = ?
             AND status = 'active'
             AND (max_uses IS NULL OR uses_count < max_uses)
             AND (expires_at IS NULL OR expires_at > ?)
           RETURNING *`
        )
        .get(id, new Date().toISOString());
      if (!updated) {
        throw Errors.unprocessable("Redeem code is not usable (expired, revoked, or at max uses)", "redeem_code_unusable");
      }
      return updated;
    },
  };
}
