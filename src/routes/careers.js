import { Hono } from "hono";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { careerService } from "../services/careerService.js";

// The careers page: a public application form, and the staff inbox behind it.
export const careerRoutes = new Hono();

// Public, unauthenticated, and it accepts a file. Tighter than the leads
// limiter for that reason -- each submission can carry 5MB.
const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "careers:apply" });

careerRoutes.post("/applications", applyLimiter, async (c) => {
  const body = await c.req.json();
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const application = await careerService.apply(body, ip);
  // Only the id comes back. This is an anonymous endpoint, so echoing the
  // stored row would let anyone confirm what was submitted about someone else.
  return c.json({ id: application.id, message: "Thanks — we'll be in touch if there's a fit." }, 201);
});

// The field-of-work options, so the form renders from the server's list rather
// than a hardcoded copy that can drift out of sync with validation.
careerRoutes.get("/fields", (c) => c.json({ fields_of_work: careerService.fieldsOfWork }));

// --- staff -----------------------------------------------------------------
// Applications are people, so they sit with USERS_ADMIN.

careerRoutes.get("/applications", requireAuth, requirePermission("careers.read"), (c) => {
  const status = c.req.query("status");
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json({ applications: careerService.list({ status, limit, offset }), summary: careerService.summary() });
});

careerRoutes.get("/applications/:id", requireAuth, requirePermission("careers.read"), (c) =>
  c.json(careerService.get(c.req.param("id")))
);

// A CV is personal data: staff-only, never cached, and served as a download
// rather than rendered inline.
careerRoutes.get("/applications/:id/resume", requireAuth, requirePermission("careers.read"), async (c) => {
  const file = await careerService.resume(c.req.param("id"));
  return c.body(file.bytes, 200, {
    "Content-Type": file.mime,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "private, no-store",
  });
});

careerRoutes.patch("/applications/:id", requireAuth, requirePermission("careers.write"), async (c) => {
  const body = await c.req.json();
  return c.json(careerService.update(c.req.param("id"), body, c.get("userId")));
});

careerRoutes.delete("/applications/:id", requireAuth, requirePermission("careers.write"), async (c) =>
  c.json(await careerService.remove(c.req.param("id"), c.get("userId")))
);
