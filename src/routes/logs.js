import { Hono } from "hono";
import { requireAuth, requireAdmin, requirePermission } from "../middleware/auth.js";
import { db } from "../db/index.js";

export const logRoutes = new Hono();
logRoutes.use("*", requireAuth, requireAdmin, requirePermission("logs.read"));

logRoutes.get("/", (c) => {
  const { actor_user_id, action, entity_type } = c.req.query();
  const limit = Number(c.req.query("limit") || 100);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(db.logs.list({ actorUserId: actor_user_id, action, entityType: entity_type, limit, offset }));
});
