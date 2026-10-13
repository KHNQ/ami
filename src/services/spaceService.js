import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

function buildTree(nodesBySpace, nodeId) {
  const node = nodesBySpace.get(nodeId);
  if (!node) return null;
  const children = [...nodesBySpace.values()].filter((n) => n.parent_node_id === nodeId);
  return {
    node_id: node.id,
    user_id: node.user_id,
    status: node.status,
    personal_volume_period_cents: node.personal_volume_period_cents,
    lifetime_volume_cents: node.lifetime_volume_cents,
    joined_at: node.joined_at,
    children: children.map((c) => buildTree(nodesBySpace, c.id)),
  };
}

// Space trees show every member's PV/lifetime-volume, and a member's own
// node detail (reachable from the tree) exposes their invite code -- so
// viewing a Space is restricted to admins and people who actually have a
// node in it, not the whole authenticated userbase.
function assertParticipantOrAdmin(spaceId, requesterUserId, isAdmin) {
  if (isAdmin) return;
  if (!requesterUserId || !db.spaces.userHasNodeInSpace(spaceId, requesterUserId)) {
    throw Errors.forbidden("You do not have access to this Space");
  }
}

export const spaceService = {
  get(id, { requesterUserId, isAdmin } = {}) {
    const space = db.spaces.get(id);
    if (!space) throw Errors.notFound("Space not found");
    assertParticipantOrAdmin(id, requesterUserId, isAdmin);
    return space;
  },

  // Non-admins only ever see Spaces they actually participate in; admins
  // can see the full platform-wide listing (optionally filtered by product).
  list({ requesterUserId, isAdmin, productId, limit, offset } = {}) {
    if (!isAdmin) return db.spaces.listForUser(requesterUserId, { productId, limit, offset });
    return productId ? db.spaces.listByProduct(productId, { limit, offset }) : db.spaces.list({ limit, offset });
  },

  // GET /spaces/:id/tree -- full tree structure for visualization (Section 9/10).
  getTree(id, { requesterUserId, isAdmin } = {}) {
    const space = db.spaces.get(id);
    if (!space) throw Errors.notFound("Space not found");
    assertParticipantOrAdmin(id, requesterUserId, isAdmin);
    const nodes = db.nodes.listBySpace(id);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    if (!space.root_node_id) return { space_id: id, product_id: space.product_id, root: null };
    return { space_id: id, product_id: space.product_id, root: buildTree(byId, space.root_node_id) };
  },
};
