import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

// POST /redeem-codes -- generate an *extra* code for the caller's own node
// (beyond the one auto-issued at join time), e.g. for governance limits
// (Section 7.6: max_uses / expires_at, optional issuance fee for extras).
export const redeemCodeService = {
  generate({ userId, productId, maxUses, expiresAt }) {
    const node = db.nodes.getByUserProduct(userId, productId);
    if (!node) throw Errors.notFound("You don't have a position for this product yet", "no_node_for_product");
    if (maxUses !== undefined && maxUses !== null && (!Number.isInteger(maxUses) || maxUses <= 0)) {
      throw Errors.badRequest("maxUses must be a positive integer or null for unlimited");
    }
    const code = db.redeemCodes.create({
      ownerNodeId: node.id,
      productId,
      spaceId: node.space_id,
      maxUses: maxUses ?? null,
      expiresAt: expiresAt ?? null,
    });
    db.logs.record({ actorUserId: userId, action: "redeem_code.generate", entityType: "redeem_code", entityId: code.id });
    return code;
  },

  // GET /redeem-codes/:code -- validate a code (product, space, owner, remaining uses).
  validate(code) {
    const row = db.redeemCodes.getByCode(code);
    if (!row) throw Errors.notFound("Redeem code not found", "redeem_code_not_found");
    const now = new Date();
    const usable =
      row.status === "active" &&
      (row.max_uses === null || row.uses_count < row.max_uses) &&
      (!row.expires_at || new Date(row.expires_at) > now);
    const ownerNode = db.nodes.get(row.owner_node_id);
    return {
      code: row.code,
      product_id: row.product_id,
      space_id: row.space_id,
      owner_node_id: row.owner_node_id,
      owner_user_id: ownerNode ? ownerNode.user_id : null,
      max_uses: row.max_uses,
      uses_count: row.uses_count,
      expires_at: row.expires_at,
      status: row.status,
      usable,
    };
  },

  listMine(userId, productId) {
    const node = db.nodes.getByUserProduct(userId, productId);
    if (!node) return [];
    return db.redeemCodes.listByOwnerNode(node.id);
  },

  revoke(id, actorUserId, isAdmin = false) {
    const code = db.redeemCodes.get(id);
    if (!code) throw Errors.notFound("Redeem code not found");
    if (!isAdmin) {
      const ownerNode = db.nodes.get(code.owner_node_id);
      if (!ownerNode || ownerNode.user_id !== actorUserId) {
        throw Errors.forbidden("You do not have access to this redeem code");
      }
    }
    const revoked = db.redeemCodes.revoke(id);
    db.logs.record({ actorUserId, action: "redeem_code.revoke", entityType: "redeem_code", entityId: id });
    return revoked;
  },
};
