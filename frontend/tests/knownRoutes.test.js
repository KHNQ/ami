import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KNOWN_ROUTES, isKnownRoute } from "../src/lib/knownRoutes.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("the route manifest matches the router", () => {
  const app = read("../src/App.jsx");
  const routerPaths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");

  it("every path App.jsx serves is in the manifest", () => {
    // Adding a route to App.jsx without adding it to knownRoutes.js would make
    // the SSR server answer 404 for a page that works in the browser.
    const missing = routerPaths.filter((p) => !KNOWN_ROUTES.includes(p));
    expect(missing).toEqual([]);
  });

  it("the manifest lists nothing the router does not serve", () => {
    const stale = KNOWN_ROUTES.filter((p) => !routerPaths.includes(p));
    expect(stale).toEqual([]);
  });

  it("the SSR route table (entry-server.jsx) is a subset of the manifest", () => {
    const ssr = read("../src/entry-server.jsx");
    const ssrPaths = [...ssr.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(ssrPaths.filter((p) => !KNOWN_ROUTES.includes(p))).toEqual([]);
  });
});

describe("removed pages are not routes", () => {
  it.each(["/service", "/service/", "/service#academy", "/evidence", "/financing", "/leads", "/chat", "/support/tkt_1"])(
    "%s is unknown, so the server answers 404",
    (path) => {
      expect(isKnownRoute(path.split("#")[0])).toBe(false);
    }
  );

  it("none of them is mentioned in the client router, the SSR table or the manifest", () => {
    const sources = [read("../src/App.jsx"), read("../src/entry-server.jsx"), read("../src/lib/knownRoutes.js")].join("\n");
    for (const path of ["/service", "/evidence", "/financing", "/leads"]) {
      // Allowed only inside comments explaining their removal.
      const live = sources
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("{/*"))
        .filter((line) => line.includes(`"${path}`));
      expect(live, path).toEqual([]);
    }
  });

  it("the SSR server no longer renders them or lists them in the sitemap", () => {
    const server = read("../server.js");
    const live = server.split("\n").filter((l) => !l.trim().startsWith("//"));
    for (const path of ["/service", "/evidence", "/financing", "/leads"]) {
      expect(live.filter((l) => l.includes(`"${path}"`)), path).toEqual([]);
    }
  });
});

describe("known screens are recognised", () => {
  it.each(["/", "/devices", "/devices/aurora-diode-pro", "/blog", "/blog/some-post", "/contact", "/login", "/signup", "/profile", "/orders/ord_1", "/support"])(
    "%s",
    (path) => {
      expect(isKnownRoute(path)).toBe(true);
    }
  );

  it("tolerates a trailing slash but not extra segments", () => {
    expect(isKnownRoute("/blog/")).toBe(true);
    expect(isKnownRoute("/blog/a/b")).toBe(false);
    expect(isKnownRoute("/devices/a/b")).toBe(false);
    expect(isKnownRoute("/nope")).toBe(false);
  });
});
