import { Hono } from "hono";
import { requireAuth, can } from "../middleware/auth.js";
import { spaceService } from "../services/spaceService.js";

export const spaceRoutes = new Hono();
spaceRoutes.use("*", requireAuth);

function requester(c) {
  // See nodes.js: this grants sight of every Space, so it is gated on an
  // explicit read-everything permission rather than on staff-ness.
  return { requesterUserId: c.get("userId"), isAdmin: can(c, "network.read_all") };
}

spaceRoutes.get("/", (c) => {
  const productId = c.req.query("product_id");
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(spaceService.list({ productId, limit, offset, ...requester(c) }));
});

spaceRoutes.get("/:id", (c) => c.json(spaceService.get(c.req.param("id"), requester(c))));

spaceRoutes.get("/:id/tree", (c) => c.json(spaceService.getTree(c.req.param("id"), requester(c))));
