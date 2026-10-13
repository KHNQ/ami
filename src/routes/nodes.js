import { Hono } from "hono";
import { requireAuth, requirePermission, can } from "../middleware/auth.js";
import { nodeService } from "../services/nodeService.js";

export const nodeRoutes = new Hono();
nodeRoutes.use("*", requireAuth);

nodeRoutes.get("/mine", (c) => c.json(nodeService.listByUser(c.get("userId"))));

function requester(c) {
  // `isAdmin` here means "may read anyone's node", not "is staff" -- an
  // inventory admin has no business reading a stranger's earnings.
  return { requesterUserId: c.get("userId"), isAdmin: can(c, "network.read_all") };
}

nodeRoutes.get("/:id", (c) => c.json(nodeService.detail(c.req.param("id"), requester(c))));

nodeRoutes.get("/:id/downline", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(nodeService.downline(c.req.param("id"), { limit, offset, ...requester(c) }));
});

nodeRoutes.get("/:id/earnings", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  const status = c.req.query("status");
  return c.json(nodeService.earnings(c.req.param("id"), { limit, offset, status, ...requester(c) }));
});

nodeRoutes.get("/:id/redeem-codes", (c) => c.json(nodeService.listRedeemCodes(c.req.param("id"), requester(c))));

nodeRoutes.get("/:id/rank", (c) => c.json(nodeService.rank(c.req.param("id"), requester(c))));

nodeRoutes.get("/:id/rank-bonuses", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  const status = c.req.query("status");
  return c.json(nodeService.rankBonuses(c.req.param("id"), { limit, offset, status, ...requester(c) }));
});

nodeRoutes.get("/:id/quota", (c) => c.json(nodeService.quota(c.req.param("id"), requester(c))));

nodeRoutes.get("/:id/quota-bonuses", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(nodeService.quotaBonuses(c.req.param("id"), { limit, offset, ...requester(c) }));
});

nodeRoutes.patch("/:id/status", requirePermission("network.write"), async (c) => {
  const { status } = await c.req.json();
  return c.json(nodeService.setStatus(c.req.param("id"), status, c.get("userId")));
});
