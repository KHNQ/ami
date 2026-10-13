// Production server for the frontend: serves the built SPA (dist/client)
// exactly as nginx used to, PLUS real server-side rendering for the two
// routes that matter for SEO (`/`, `/products/:id`) using the SSR bundle
// built by `vite build --ssr` (dist/server/entry-server.js). Every other
// route -- the entire authenticated app -- is untouched: static assets if
// they exist, otherwise the same index.html shell for client-side routing.
//
// Dev mode intentionally does NOT run through this file -- `bun run dev`
// stays plain Vite (fast hot-reload CSR). Use `bun run preview:ssr` to
// build + run this for real to check SSR output.
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { CATEGORIES } from "./src/lib/siteContent.generated.js";
import { LOCALE_CODES, DEFAULT_LOCALE, splitLocalePath, localePath, localeMeta } from "./src/i18n/config.js";
// Plain data module, no JSX -- safe to import directly here rather than
// through the SSR bundle, and it keeps the sitemap in step with the range.
import { DEVICES } from "./src/b2b/data/devices.js";
import { isKnownRoute } from "./src/lib/knownRoutes.js";

// Slugs are the routing contract between content/, the SSR server and the
// client router. Reading them from the generated module means adding a
// category to content/ makes it routable and sitemapped with no further edit.
const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = dirname(new URL(import.meta.url).pathname);
const CLIENT_DIR = join(ROOT, "dist/client");
const PORT = Number(process.env.PORT || 4173);
const API_BASE_URL = process.env.VITE_API_BASE_URL || "http://localhost:3000";

if (!existsSync(join(CLIENT_DIR, "index.html")) || !existsSync(join(ROOT, "dist/server/entry-server.js"))) {
  console.error(
    "Missing build output. Run `bun run build:ssr` first (this builds both dist/client and dist/server)."
  );
  process.exit(1);
}

const template = readFileSync(join(CLIENT_DIR, "index.html"), "utf-8");
const { render } = await import("./dist/server/entry-server.js");

async function fetchJson(path) {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // backend unreachable -- SSR falls back to client-side fetch instead of a hard 500
  }
}

/**
 * Like fetchJson, but says WHY there is no data.
 *
 * A missing blog post and an unreachable API both come back as null from
 * fetchJson, and they need opposite answers: the first is a real 404 (a
 * crawler should forget the URL), the second is an outage (it must not be
 * reported as "this page does not exist", or one bad minute de-indexes the
 * blog). Only a definite 404 from the API is treated as one.
 */
async function fetchResult(path) {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (res.status === 404) return { data: null, missing: true };
    if (!res.ok) return { data: null, missing: false };
    return { data: await res.json(), missing: false };
  } catch {
    return { data: null, missing: false };
  }
}

// React 19 hoists every <title>/<meta>/<link> it finds anywhere in the
// rendered tree to the very front of renderToReadableStream's output --
// this pulls that leading run out so it can go in the real <head>, leaving
// the rest (the actual visible markup, plus any inline JSON-LD <script>,
// which React does NOT hoist) for #root. See HomePage/ProductDetailPage
// for what's actually rendered.
const HEAD_TAG_RUN = /^(?:<title>.*?<\/title>|<meta[^>]*\/>|<link[^>]*\/>)*/s;

/**
 * hreflang alternates for a path.
 *
 * Without these, the five language versions of a page compete with each other
 * as duplicate content instead of being understood as translations. x-default
 * points at English, which is the unprefixed canonical set.
 */
function alternateLinks(origin, path) {
  const links = LOCALE_CODES.map(
    (code) => `<link rel="alternate" hreflang="${code}" href="${origin}${localePath(code, path)}"/>`
  );
  links.push(`<link rel="alternate" hreflang="x-default" href="${origin}${localePath(DEFAULT_LOCALE, path)}"/>`);
  return links.join("");
}

async function renderPage(c, url, ssrData, status = 200) {
  const rendered = await render(url, ssrData);
  const [headTags] = rendered.match(HEAD_TAG_RUN);
  const bodyHtml = rendered.slice(headTags.length);

  // The static <title>/description in index.html are only a pre-JS
  // fallback for plain CSR routes -- browsers use the FIRST <title> in the
  // document, so leaving the static one in place would silently win over
  // the real, page-specific one computed above.
  // lang/dir have to be on <html> itself, not on a wrapper: scrollbar side,
  // text selection direction and native form controls all read them from the
  // root element, and a right-to-left page with lang="en" is also a real
  // accessibility failure for screen readers.
  const locale = ssrData?.locale || DEFAULT_LOCALE;
  const meta = localeMeta(locale);
  const alternates = ssrData?.path ? alternateLinks(ssrData.origin || "", ssrData.path) : "";

  const page = template
    .replace(/<title>.*?<\/title>/s, "")
    .replace(/<meta name="description"[^>]*>\s*/, "")
    .replace('<html lang="en">', `<html lang="${locale}" dir="${meta.dir}">`)
    .replace("</head>", `${headTags}${alternates}</head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root">${bodyHtml}</div><script>window.__SSR_DATA__ = ${JSON.stringify(ssrData).replace(/</g, "\\u003c")};</script>`
    );
  return c.html(page, status);
}

const app = new Hono();

// `Sitemap:` must be an absolute URL -- crawlers ignore a relative one -- and
// the origin is only known per request, so the file's placeholder is filled in
// here rather than hardcoded.
app.get("/robots.txt", (c) =>
  c.text(
    readFileSync(join(ROOT, "public/robots.txt"), "utf-8").replace(
      /^Sitemap:.*$/m,
      `Sitemap: ${new URL(c.req.url).origin}/sitemap.xml`
    )
  )
);

// Same-origin passthrough to the API's image route. og:image (Facebook /
// Twitter / LinkedIn link previews) must be a real fetchable URL, and
// serving it from the page's own origin avoids crawlers having to resolve
// a second host. The API does the decoding and sets the cache headers;
// this only relays them.
app.get("/products/:id/image", async (c) => {
  let upstream;
  try {
    upstream = await fetch(`${API_BASE_URL}/products/${c.req.param("id")}/image`);
  } catch {
    return c.notFound(); // backend unreachable -- a missing preview image is not a 500
  }
  if (!upstream.ok) return c.notFound();
  return c.body(await upstream.arrayBuffer(), 200, {
    "Content-Type": upstream.headers.get("content-type") || "image/png",
    "Cache-Control": upstream.headers.get("cache-control") || "public, max-age=86400",
  });
});

/** XML-escape for the few characters a URL or date can carry into a sitemap. */
const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

app.get("/sitemap.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const [products, blog] = await Promise.all([
    fetchJson("/products?limit=1000"),
    fetchJson("/blog/slugs"),
  ]);
  const catalogue = products || [];
  const posts = blog?.posts || [];

  // Storefront device pages: the bundled devices, plus anything an admin has
  // created since that has no bundled record (it is keyed on its slug). A
  // discontinued product is not sold, so it is not advertised.
  const live = new Map(catalogue.map((p) => [p?.specs?.slug, p]));
  const bundledSlugs = new Set(DEVICES.map((d) => d.slug));
  const devicePaths = [
    ...DEVICES.filter((d) => live.get(d.slug)?.status !== "discontinued").map((d) => [`/devices/${d.id}`, "0.9"]),
    ...catalogue
      .filter((p) => p?.specs?.slug && !bundledSlugs.has(p.specs.slug) && p.status !== "discontinued")
      .map((p) => [`/devices/${p.specs.slug}`, "0.9"]),
  ];

  // Priorities are relative, and these are the honest ones: the catalogue
  // root and individual devices are what people search for; the marketing
  // pages support them.
  const paths = [
    ["/", "1.0"],
    ["/devices", "0.9"],
    ...devicePaths,
    ["/catalog", "0.8"],
    ...catalogue.filter((p) => p.status === "active").map((p) => [`/products/${p.id}`, "0.8"]),
    ...CATEGORY_SLUGS.map((slug) => [`/c/${slug}`, "0.8"]),
    ["/blog", "0.8"],
    ...posts.map((p) => [`/blog/${p.slug}`, "0.7", p.updated_at || p.published_at]),
    ["/installations", "0.7"],
    ["/tools", "0.6"],
    ["/affiliate", "0.5"],
    ["/partners", "0.6"],
    ["/our-story", "0.5"],
    ["/contact", "0.5"],
    ["/careers", "0.4"],
  ];

  // One entry per path per language, each carrying xhtml:link alternates.
  // A sitemap that listed only the English URLs would leave the other four
  // languages undiscoverable except by crawling.
  const urls = paths
    .flatMap(([path, priority, lastmod]) =>
      LOCALE_CODES.map((code) => {
        const alts = LOCALE_CODES.map(
          (alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${xml(origin + localePath(alt, path))}"/>`
        ).join("");
        const mod = lastmod ? `<lastmod>${xml(new Date(lastmod).toISOString())}</lastmod>` : "";
        return `<url><loc>${xml(origin + localePath(code, path))}</loc>${alts}${mod}<priority>${priority}</priority></url>`;
      })
    )
    .join("");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`, 200, {
    "Content-Type": "application/xml",
    "Cache-Control": "public, max-age=900",
  });
});

// Locale-prefixed variants of every server-rendered route. English keeps the
// unprefixed URLs it already has -- moving it under /en/ would invalidate every
// existing link and search result.
// The alternation MUST be wrapped in a non-capturing group.
//
// Written bare as `:locale{fa|ar|fr|it}`, Hono splices it into a larger
// pattern where the `|` binds loosely, so the constraint stops meaning "this
// segment is one of these four" and starts meaning "this segment contains one
// of these four". `p-ar-tners` and `c-ar-eers` both do -- so /partners and
// /careers were silently served the home page as locale "ar", while
// /our-story (no such substring) worked fine. Grouping anchors it.
const LOCALE_PREFIX = `(?:${LOCALE_CODES.filter((l) => l !== DEFAULT_LOCALE).join("|")})`;

function ssrRoute(pattern, handler) {
  app.get(pattern, handler);
  app.get(`/:locale{${LOCALE_PREFIX}}${pattern === "/" ? "" : pattern}`, handler);
}

// The storefront's indexable routes. All of their content comes from
// the bundled catalogue data rather than the API, so unlike the commerce
// routes below there is nothing to fetch except the site config the
// providers need -- which is why these are cheap enough to render on every
// request.
// The storefront's indexable routes.
//
// All four render the same shell, so they share one loader: the site config
// (which decides whether prices may be printed at all) and the live product
// list (which the catalogue context merges over its bundled device data, so
// the server-rendered markup already shows real stock and carries real
// product ids). Both are fetched in parallel, and a failure of either
// degrades rather than 500s -- CatalogProvider falls back to the bundled
// catalogue exactly as it does on the client.
function storefrontRoute(pattern, route) {
  ssrRoute(pattern, async (c) => {
    const url = new URL(c.req.url);
    const { locale } = splitLocalePath(url.pathname);
    const [products, siteConfig] = await Promise.all([
      // Unfiltered by status on purpose -- see CatalogContext.
      fetchJson("/products?limit=100"),
      fetchJson("/site-config"),
    ]);
    const path = url.pathname.replace(new RegExp(`^/${LOCALE_PREFIX}`), "") || "/";

    // A device page for something that is neither in the bundled range nor a
    // product in the database is a 404 -- answered as one, so a crawler drops
    // the URL, while the visitor still gets the shell and its not-found copy.
    let status = 200;
    const deviceId = c.req.param("id");
    if (route === "device" && deviceId) {
      const known =
        DEVICES.some((d) => d.id === deviceId) ||
        (products || []).some((p) => p?.specs?.slug === deviceId);
      if (!known) status = 404;
    }

    return renderPage(
      c,
      path,
      {
        route,
        products: products || [],
        siteConfig,
        origin: url.origin,
        locale,
        path,
        deviceId: deviceId || undefined,
      },
      status
    );
  });
}

storefrontRoute("/", "home");
storefrontRoute("/devices", "devices");
storefrontRoute("/devices/:id", "device");
storefrontRoute("/catalog", "catalog");

// The feature routes.
//
// The sitemap has always advertised these, but they were served as an empty
// SPA shell -- a crawler followed the sitemap and found nothing. That was
// survivable while the home page rendered all of their content inline, since
// the words existed *somewhere* server-rendered. It stopped being survivable
// when the home page was cut back to an argument plus a directory: this is
// now the only place that copy exists, so it has to reach a crawler.
//
// They cost the same as the four above -- the shared loader fetches the site
// config and the product list, and nothing here needs anything else.
for (const path of ["/installations", "/tools", "/affiliate"]) {
  storefrontRoute(path, path.slice(1));
}

// The contact page carries no data beyond the site config, but it is a page
// people search for ("Ashkan Medical Tehran address"), so it is rendered.
storefrontRoute("/contact", "contact");

// The blog. The post is fetched here so the article's text, title and
// structured data are in the HTML a crawler or link-preview bot receives;
// an unknown (or draft) slug is a real 404.
ssrRoute("/blog", async (c) => {
  const url = new URL(c.req.url);
  const { locale } = splitLocalePath(url.pathname);
  const [list, siteConfig, products] = await Promise.all([
    fetchJson("/blog/posts?limit=50"),
    fetchJson("/site-config"),
    fetchJson("/products?limit=100"),
  ]);
  return renderPage(c, "/blog", {
    route: "blog",
    posts: list?.posts || [],
    products: products || [],
    siteConfig,
    origin: url.origin,
    locale,
    path: "/blog",
  });
});

ssrRoute("/blog/:slug", async (c) => {
  const slug = c.req.param("slug");
  const url = new URL(c.req.url);
  const { locale } = splitLocalePath(url.pathname);
  const [{ data: post, missing }, siteConfig, products] = await Promise.all([
    fetchResult(`/blog/posts/${encodeURIComponent(slug)}`),
    fetchJson("/site-config"),
    fetchJson("/products?limit=100"),
  ]);
  return renderPage(
    c,
    `/blog/${slug}`,
    {
      route: "blogPost",
      post,
      products: products || [],
      siteConfig,
      origin: url.origin,
      locale,
      path: `/blog/${slug}`,
    },
    missing ? 404 : 200
  );
});

ssrRoute("/products/:id", async (c) => {
  const id = c.req.param("id");
  const origin = new URL(c.req.url).origin;
  const { locale } = splitLocalePath(new URL(c.req.url).pathname);
  // Config is fetched alongside the product so the server-rendered CTA is
  // already right -- a buy button that appears and then swaps to "Visit us"
  // on hydration is worse than either state on its own.
  const [product, siteConfig] = await Promise.all([fetchJson(`/products/${id}`), fetchJson("/site-config")]);
  return renderPage(c, `/products/${id}`, {
    route: "product", product, siteConfig, origin, locale, path: `/products/${id}`,
  });
});

// Category pages fetch their own product list so the devices are in the
// server-rendered markup rather than appearing a beat later on the client --
// which is the entire point of rendering these on the server.
ssrRoute("/c/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!CATEGORY_SLUGS.includes(slug)) return c.notFound();
  const origin = new URL(c.req.url).origin;
  const { locale } = splitLocalePath(new URL(c.req.url).pathname);
  const products = (await fetchJson(`/products?category=${encodeURIComponent(slug)}&status=active&limit=50`)) || [];
  return renderPage(c, `/c/${slug}`, { route: "category", slug, products, origin, locale, path: `/c/${slug}` });
});

// These three are entirely static content (generated from content/ at build
// time), so there is nothing to fetch -- they are server-rendered purely so
// crawlers and link-preview bots see real copy instead of an empty shell.
for (const path of ["/partners", "/our-story", "/careers"]) {
  ssrRoute(path, (c) => {
    const url = new URL(c.req.url);
    const { locale } = splitLocalePath(url.pathname);
    return renderPage(c, path, { route: path.slice(1), origin: url.origin, locale, path });
  });
}

// Everything else: real static assets if present, otherwise the same SPA
// shell for client-side routing -- identical to the old nginx fallback.
//
// Vite writes a content hash into every built asset's filename, so
// `index-B0OEuXn2.js` can never change meaning: a new build is a new name.
// That makes them safe to cache for a year and never revalidate, which is
// the difference between a repeat visit costing one HTML request and costing
// a conditional request for every script, stylesheet and font on the page.
//
// Anything NOT hashed -- the service worker, the manifest, favicons -- must
// keep revalidating, or a stale sw.js pins visitors to an old build.
app.use(
  "/*",
  serveStatic({
    root: "./dist/client",
    onFound: (path, c) => {
      c.header(
        "Cache-Control",
        /\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate"
      );
    },
  })
);
// The SPA shell for every client-side screen -- and a real 404 for any path
// the client router does not know (including the removed /service, /evidence,
// /financing and /leads). The visitor sees the same friendly not-found screen
// either way; the status is for crawlers and for anything that checks it.
app.get("*", (c) => {
  const { pathname } = new URL(c.req.url);
  const { path } = splitLocalePath(pathname);
  return c.html(template, isKnownRoute(path) ? 200 : 404);
});

export default { port: PORT, fetch: app.fetch };
