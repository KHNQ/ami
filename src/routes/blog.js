import { Hono } from "hono";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { blogService } from "../services/blogService.js";
import { socialService } from "../services/socialService.js";

export const blogRoutes = new Hono();

// --- public ----------------------------------------------------------------

blogRoutes.get("/posts", (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json({
    posts: blogService.publicList({
      limit: Math.min(Number(c.req.query("limit") || 20), 50),
      offset: Number(c.req.query("offset") || 0),
    }),
  });
});

blogRoutes.get("/slugs", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ posts: blogService.publicSlugs() });
});

blogRoutes.get("/posts/:slug", (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json(blogService.publicGet(c.req.param("slug")));
});

/** The Instagram feed for /socials. */
blogRoutes.get("/instagram", async (c) => {
  const feed = await socialService.instagramFeed();
  // Short cache: Instagram rate-limits hard, and the feed is not
  // time-critical. socialService caches server-side too; this stops a burst
  // of page loads all arriving at the same cold moment.
  c.header("Cache-Control", "public, max-age=300");
  return c.json(feed);
});

// --- admin -----------------------------------------------------------------

blogRoutes.get("/admin/posts", requireAuth, requirePermission("content.write"), (c) => {
  return c.json({
    posts: blogService.list({
      status: c.req.query("status") || null,
      limit: Math.min(Number(c.req.query("limit") || 50), 200),
    }),
  });
});

blogRoutes.get("/admin/posts/:id", requireAuth, requirePermission("content.write"), (c) => {
  return c.json(blogService.get(c.req.param("id")));
});

blogRoutes.post("/admin/posts", requireAuth, requirePermission("content.write"), async (c) => {
  const body = await c.req.json();
  return c.json(blogService.create(body, c.get("userId")), 201);
});

blogRoutes.patch("/admin/posts/:id", requireAuth, requirePermission("content.write"), async (c) => {
  const body = await c.req.json();
  return c.json(blogService.update(c.req.param("id"), body));
});

blogRoutes.delete("/admin/posts/:id", requireAuth, requirePermission("content.write"), (c) => {
  blogService.remove(c.req.param("id"));
  return c.json({ ok: true });
});
