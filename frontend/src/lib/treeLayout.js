// Pure, dependency-free tree layout: assigns each node a slot position so
// leaves are evenly spaced left-to-right and parents sit centered above
// their children (the standard "leaf order" layout used by simple org-chart
// / family-tree renderers). Also collects edges and per-node subtree stats
// in the same pass so callers don't need a second tree walk.

const NODE_SPACING_X = 96; // px between sibling leaf slots
const LEVEL_SPACING_Y = 128; // px between depth levels
const PADDING = 64; // px margin around the whole layout

export function layoutTree(root) {
  const positions = new Map(); // node_id -> { node, x, y, depth, descendantCount, childCount }
  const edges = []; // { fromId, toId }
  let nextSlot = 0;
  let maxDepth = 0;

  function countDescendants(node) {
    const kids = node.children || [];
    return kids.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
  }

  function assign(node, depth, parentId) {
    maxDepth = Math.max(maxDepth, depth);
    const kids = node.children || [];
    let slotX;
    if (kids.length === 0) {
      slotX = nextSlot;
      nextSlot += 1;
    } else {
      const childSlots = kids.map((c) => assign(c, depth + 1, node.node_id));
      slotX = (childSlots[0] + childSlots[childSlots.length - 1]) / 2;
    }
    positions.set(node.node_id, {
      node,
      depth,
      slotX,
      x: PADDING + slotX * NODE_SPACING_X,
      y: PADDING + depth * LEVEL_SPACING_Y,
      childCount: kids.length,
      descendantCount: countDescendants(node),
    });
    if (parentId) edges.push({ fromId: parentId, toId: node.node_id });
    return slotX;
  }

  if (root) assign(root, 0, null);

  const width = root ? PADDING * 2 + Math.max(nextSlot - 1, 0) * NODE_SPACING_X : 0;
  const height = root ? PADDING * 2 + maxDepth * LEVEL_SPACING_Y : 0;

  return { positions, edges, width, height, nodeSpacingX: NODE_SPACING_X };
}
