import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { rankService } from "./rankService.js";
import { quotaService } from "./quotaService.js";

// A node's own PV/lifetime-volume/status/upline are visible to anyone via
// the Space tree (GET /spaces/:id/tree), but this node-detail surface goes
// further -- it includes the node's own invite code and full commission
// ledger, which are private to that node's owner. Every method here that
// takes a bare node id must check ownership before returning that data.
function assertOwnerOrAdmin(node, requesterUserId, isAdmin) {
  if (isAdmin) return;
  if (!requesterUserId || node.user_id !== requesterUserId) {
    throw Errors.forbidden("You do not have access to this node");
  }
}

export const nodeService = {
  get(id) {
    const node = db.nodes.get(id);
    if (!node) throw Errors.notFound("Node not found");
    return node;
  },

  getForUserAndProduct(userId, productId) {
    return db.nodes.getByUserProduct(userId, productId);
  },

  listByUser(userId) {
    return db.nodes.listByUser(userId);
  },

  // GET /nodes/:id -- node detail incl. status, PV, lifetime volume, upline
  // chain, own code. Owner or admin only (own_redeem_code is sensitive).
  detail(id, { requesterUserId, isAdmin } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    const upline = db.nodes.listAncestors(id);
    const ownCode = node.own_redeem_code_id ? db.redeemCodes.get(node.own_redeem_code_id) : null;
    return {
      ...node,
      upline: upline.map((n) => ({ node_id: n.id, user_id: n.user_id, status: n.status })),
      own_redeem_code: ownCode,
    };
  },

  // GET /nodes/:id/downline -- paginated direct-children listing (dashboard view).
  downline(id, { limit = 50, offset = 0, requesterUserId, isAdmin } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    return db.nodes.listChildren(id, { limit, offset });
  },

  fullDownlineIds(id) {
    this.get(id);
    return db.nodes.listDownlineIds(id);
  },

  // GET /nodes/:id/earnings -- commission ledger for this node. Owner or
  // admin only: exact commission amounts are private financial data.
  earnings(id, { requesterUserId, isAdmin, ...opts } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    const entries = db.ledger.listByNode(id, opts);
    // quota_applied entries were redirected into tier progress, never a
    // real wallet payout -- excluded from these cash totals (they show up
    // in nodeService.quota()/quotaBonuses() instead), but still returned in
    // `entries` so the history view can show what happened to that share.
    const totals = entries.reduce(
      (acc, e) => {
        if (e.status === "quota_applied") return acc;
        acc.total_cents += e.amount_cents;
        acc[`${e.status}_cents`] = (acc[`${e.status}_cents`] || 0) + e.amount_cents;
        return acc;
      },
      { total_cents: 0 }
    );
    return { entries, totals };
  },

  listRedeemCodes(id, { requesterUserId, isAdmin } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    return db.redeemCodes.listByOwnerNode(id);
  },

  // GET /nodes/:id/rank -- live tier + team/personal volume, computed
  // on-demand from the current period's PV (not stored -- rank is only
  // "official" once a rank_bonus_period is funded/distributed for real).
  rank(id, { requesterUserId, isAdmin } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    const tiersDesc = db.rankTiers.listByProduct(node.product_id);
    const teamVolumes = db.nodes.teamVolumeBySpace(node.space_id);
    const teamVolumeCents = teamVolumes.get(node.id) || 0;
    const personalVolumeCents = node.personal_volume_period_cents;
    const currentTier = rankService.assignRank({ teamVolumeCents, personalVolumeCents }, tiersDesc);
    return { node_id: node.id, team_volume_cents: teamVolumeCents, personal_volume_cents: personalVolumeCents, current_tier: currentTier };
  },

  // GET /nodes/:id/rank-bonuses -- rank bonus ledger history for this node.
  rankBonuses(id, { requesterUserId, isAdmin, ...opts } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    return db.rankBonusLedger.listByNode(id, opts);
  },

  // GET /nodes/:id/quota -- live quota/tier progress for this node's product.
  quota(id, { requesterUserId, isAdmin } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    return quotaService.getNodeState(node.id, node.product_id);
  },

  // GET /nodes/:id/quota-bonuses -- tier completion history for this node.
  quotaBonuses(id, { requesterUserId, isAdmin, ...opts } = {}) {
    const node = this.get(id);
    assertOwnerOrAdmin(node, requesterUserId, isAdmin);
    return quotaService.listCompletions(id, opts);
  },

  setStatus(id, status, actorUserId) {
    this.get(id);
    if (!["active", "inactive", "suspended"].includes(status)) throw Errors.badRequest("invalid status");
    const node = db.nodes.updateStatus(id, status);
    db.logs.record({ actorUserId, action: "node.set_status", entityType: "node", entityId: id, meta: { status } });
    return node;
  },
};
