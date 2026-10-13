// Every path the client router (App.jsx) serves, as patterns.
//
// The SPA shell is the fallback for any URL the server does not render itself,
// which used to mean it answered 200 for everything -- including pages that
// were deleted (/service, /evidence, /financing, /leads) and typos. A browser
// showed the 404 screen, but a crawler saw a successful response for a page
// that does not exist and kept it in the index.
//
// server.js uses this list to tell the two apart: a path that matches is a real
// screen and is served normally; one that does not gets the same shell with an
// HTTP 404 status, so people still see the friendly 404 page and crawlers see
// the status they need to drop the URL.
//
// tests/knownRoutes.test.js reads App.jsx and fails if a route is added
// there without being added here, so the two cannot drift apart.

export const KNOWN_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/products/:id",
  "/c/:slug",
  "/partners",
  "/our-story",
  "/careers",
  "/socials",
  "/admin",
  "/devices",
  "/devices/:id",
  "/catalog",
  "/compare",
  "/installations",
  "/affiliate",
  "/tools",
  "/contact",
  "/support",
  "/blog",
  "/blog/:slug",
  "/account",
  "/wallet",
  "/network",
  "/network/:nodeId",
  "/space/:spaceId",
  "/profile",
  "/orders",
  "/orders/:id",
];

const compiled = KNOWN_ROUTES.map((pattern) => {
  const source = pattern
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}/?$`);
});

/** Is `pathname` (already stripped of its locale prefix) a screen the client serves? */
export function isKnownRoute(pathname) {
  const path = pathname || "/";
  return compiled.some((re) => re.test(path));
}
