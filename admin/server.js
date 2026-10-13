import { Hono } from "hono";
import { serveStatic } from "hono/bun";

// Static file server for the built admin app.
//
// Deliberately much simpler than frontend/server.js: no SSR and no sitemap,
// because an internal tool is never crawled and never benefits from
// server-rendered markup. Just the SPA plus a history fallback.
const app = new Hono();
const PORT = Number(process.env.PORT || 4174);

// Belt and braces alongside the <meta name="robots"> tag in index.html: if
// this ever ends up reachable from the internet by accident, at least it
// isn't indexed.
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.get("/healthz", (c) => c.json({ ok: true, service: "trex-admin" }));

app.use("/*", serveStatic({ root: "./dist" }));

// SPA history fallback -- any unmatched path is a client route.
app.get("*", serveStatic({ path: "./dist/index.html" }));

export default { port: PORT, fetch: app.fetch };

console.log(`[admin] control room on http://localhost:${PORT}`);
