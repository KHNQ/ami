import { defineTool } from "../registry.js";
import { db } from "../../../db/index.js";
import { nodeService } from "../../nodeService.js";
import { spaceService } from "../../spaceService.js";
import { redeemCodeService } from "../../redeemCodeService.js";
import { money } from "./shape.js";

// The visitor's network: their nodes, downline, earnings, rank and spaces.
//
// These are the tools where the ownership boundary is a security property
// rather than a nicety, so it is worth being explicit about how it holds.
//
// Several of them take a `node_id` the MODEL supplies. That is safe — and only
// safe — because every one calls a service method that runs
// `assertOwnerOrAdmin(node, requesterUserId, isAdmin)` internally and throws
// `forbidden` for someone else's node. `ctx.isAdmin` is the `network.read_all`
// permission, exactly as src/routes/nodes.js derives it, so a plain customer
// can only ever read their own.
//
// Reading `db.nodes.get(id)` directly here instead would look equivalent and
// would silently remove the only check there is. The rule is: tools call
// services, never repos, wherever ownership is involved.

const ownership = (ctx) => ({ requesterUserId: ctx.userId, isAdmin: ctx.isAdmin });

defineTool("get_my_network", {
  auth: "user",
  description:
    "The visitor's own network positions — one per product they have bought — with the lifetime " +
    "and current-period volume of each. Start here for any question about their network, then " +
    "use the node id it returns with the more detailed tools.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  summarise: (r) => `Found ${r.count} network position${r.count === 1 ? "" : "s"}`,
  handler(_args, ctx) {
    const nodes = nodeService.listByUser(ctx.userId);
    return {
      count: nodes.length,
      note: nodes.length
        ? undefined
        : "This visitor has no network position yet. One is created when they buy a product or redeem someone's code.",
      nodes: nodes.map((n) => ({
        node_id: n.id,
        product_id: n.product_id,
        product_name: db.products.get(n.product_id)?.name ?? null,
        status: n.status,
        is_root: !n.parent_node_id,
        lifetime_volume: money(n.lifetime_volume_cents),
        period_volume: money(n.personal_volume_period_cents),
        joined_at: n.joined_at,
      })),
    };
  },
});

defineTool("get_network_downline", {
  auth: "user",
  description:
    "Who sits directly beneath one of the visitor's nodes. Use for 'who is in my network', " +
    "'how many people have I signed up'.",
  parameters: {
    type: "object",
    properties: {
      node_id: { type: "string", maxLength: 80 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["node_id"],
    additionalProperties: false,
  },
  summarise: (r) => `${r.count} direct member${r.count === 1 ? "" : "s"}`,
  handler({ node_id, limit = 25 }, ctx) {
    const rows = nodeService.downline(node_id, { limit, offset: 0, ...ownership(ctx) });
    return {
      count: rows.length,
      members: rows.map((n) => ({
        // Deliberately NOT the member's name or email. The visitor is
        // entitled to know their network's shape and volume; the people in it
        // did not consent to having their contact details read out by a
        // chatbot. The web UI shows the same thing.
        member_ref: `#${String(n.id).slice(-6)}`,
        status: n.status,
        lifetime_volume: money(n.lifetime_volume_cents),
        joined_at: n.joined_at,
      })),
    };
  },
});

defineTool("get_network_earnings", {
  auth: "user",
  description:
    "Commission earned on one of the visitor's nodes, with the running totals. Use for 'how much " +
    "have I earned', 'what is my revenue', 'what commission is pending'.",
  parameters: {
    type: "object",
    properties: {
      node_id: { type: "string", maxLength: 80 },
      status: { type: "string", enum: ["pending", "paid", "clawed_back"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["node_id"],
    additionalProperties: false,
  },
  summarise: (r) => `Earnings read — ${r.totals?.released?.display ?? "0"} released`,
  handler({ node_id, status, limit = 25 }, ctx) {
    const { entries, totals } = nodeService.earnings(node_id, {
      ...ownership(ctx),
      status,
      limit,
      offset: 0,
    });
    return {
      totals: {
        released: money(totals?.released_cents ?? 0),
        pending: money(totals?.pending_cents ?? 0),
        clawed_back: money(totals?.clawed_back_cents ?? 0),
      },
      entries: entries.map((e) => ({
        level: e.level_depth,
        amount: money(e.amount_cents),
        status: e.status,
        at: e.created_at,
      })),
    };
  },
});

defineTool("get_network_rank", {
  auth: "user",
  description:
    "The current rank tier on one of the visitor's nodes, with the team and personal volume it " +
    "is computed from, and their quota progress.",
  parameters: {
    type: "object",
    properties: { node_id: { type: "string", maxLength: 80 } },
    required: ["node_id"],
    additionalProperties: false,
  },
  summarise: (r) => `Rank: ${r.rank?.current_tier ?? "unranked"}`,
  handler({ node_id }, ctx) {
    const rank = nodeService.rank(node_id, ownership(ctx));
    let quota = null;
    try {
      quota = nodeService.quota(node_id, ownership(ctx));
    } catch {
      // Quota tiers are configured per product and may simply not exist.
      quota = null;
    }
    return {
      rank: {
        current_tier: rank?.current_tier?.name ?? null,
        team_volume: money(rank?.team_volume_cents ?? 0),
        personal_volume: money(rank?.personal_volume_cents ?? 0),
      },
      quota: quota
        ? {
            current_tier: quota.current_tier?.name ?? null,
            next_tier: quota.next_tier?.name ?? null,
            accumulated: money(quota.accumulated_cents ?? 0),
            unlocked_bonus_bp: quota.unlocked_rate_bonus_bp ?? 0,
          }
        : null,
    };
  },
});

defineTool("get_my_spaces", {
  auth: "user",
  description:
    "The spaces (product trees) the visitor belongs to. Use before get_space_tree, which needs a " +
    "space id.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  summarise: (r) => `Member of ${r.count} space${r.count === 1 ? "" : "s"}`,
  handler(_args, ctx) {
    const rows = spaceService.list({ ...ownership(ctx), limit: 25, offset: 0 });
    return {
      count: rows.length,
      spaces: rows.map((s) => ({
        space_id: s.id,
        product_id: s.product_id,
        product_name: db.products.get(s.product_id)?.name ?? null,
        created_at: s.created_at,
      })),
    };
  },
});

defineTool("get_space_tree", {
  auth: "user",
  description:
    "The full tree of a space the visitor is part of, with each position's volume. Use for " +
    "'how big is my space', 'what is the total volume in my space'.",
  parameters: {
    type: "object",
    properties: { space_id: { type: "string", maxLength: 80 } },
    required: ["space_id"],
    additionalProperties: false,
  },
  summarise: (r) => `${r.total_members} positions, ${r.total_volume?.display ?? "0"} lifetime`,
  handler({ space_id }, ctx) {
    // Throws for a space this visitor has no node in -- see
    // spaceService.assertParticipantOrAdmin.
    const tree = spaceService.getTree(space_id, ownership(ctx));

    // Flattened to totals and a depth profile rather than handed over whole.
    // A large tree is thousands of nodes; the question behind "how big is my
    // space" is answered by the numbers, and the shape is what the /space
    // page draws.
    let members = 0;
    let volume = 0;
    let depth = 0;
    const walk = (node, d) => {
      if (!node) return;
      members++;
      volume += node.lifetime_volume_cents || 0;
      depth = Math.max(depth, d);
      for (const child of node.children || []) walk(child, d + 1);
    };
    walk(tree?.root, 1);

    return {
      space_id,
      total_members: members,
      total_volume: money(volume),
      depth,
      direct_members: (tree?.root?.children || []).length,
    };
  },
});

defineTool("get_my_redeem_codes", {
  auth: "user",
  description:
    "The visitor's own referral/redeem codes, how many times each has been used, and whether it " +
    "is still active.",
  parameters: {
    type: "object",
    properties: { product_id: { type: "string", maxLength: 80 } },
    additionalProperties: false,
  },
  summarise: (r) => `${r.count} code${r.count === 1 ? "" : "s"}`,
  handler({ product_id }, ctx) {
    const rows = redeemCodeService.listMine(ctx.userId, product_id || undefined);
    return {
      count: rows.length,
      codes: rows.map((c) => ({
        code: c.code,
        product_id: c.product_id,
        uses: c.uses,
        max_uses: c.max_uses,
        status: c.status,
        expires_at: c.expires_at,
      })),
    };
  },
});
