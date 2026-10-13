import { Hono } from "hono";
import { optionalAuth, requireAuth, requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { supportService } from "../services/supportService.js";

// Support intake: a public form that lands in an admin queue.
//
// POST is anonymous on purpose -- see supportService.create -- so it is the
// one write here that gets a tight budget. The rest is staff only.
export const supportRoutes = new Hono();

const intakeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: "support:create" });

supportRoutes.post("/requests", intakeLimiter, optionalAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const request = supportService.create({
    name: body.name,
    contact: body.contact,
    message: body.message,
    userId: c.get("userId") || null,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null,
  });
  // Echo back only the id: this endpoint is anonymous, so returning the
  // stored row would let anyone confirm what was captured about someone else.
  return c.json({ id: request.id, message: "Thanks -- we'll be in touch shortly." }, 201);
});

supportRoutes.get("/requests", requireAuth, requirePermission("support.read_all"), (c) =>
  c.json({
    requests: supportService.list({
      status: c.req.query("status") || undefined,
      limit: Math.min(Number(c.req.query("limit") || 50), 200),
      offset: Number(c.req.query("offset") || 0),
    }),
    summary: supportService.summary(),
  })
);

supportRoutes.get("/requests/:id", requireAuth, requirePermission("support.read_all"), (c) =>
  c.json(supportService.get(c.req.param("id")))
);

supportRoutes.patch("/requests/:id", requireAuth, requirePermission("support.write"), async (c) => {
  const body = await c.req.json();
  return c.json(supportService.update(c.req.param("id"), body, c.get("userId")));
});
