import { matchPath } from "react-router-dom";

// What the assistant is told about where the visitor is.
//
// A fixed table, chosen client-side from the current path -- never free text
// assembled from user input. `description` is interpolated into the system
// prompt server-side, so anything a visitor could influence would be a
// prompt-injection channel. The server length-caps and strips newlines as a
// second line of defence (see routes/ai.js), but the real guarantee is that
// these strings are constants in this file.
//
// `description` stays English on purpose: it goes into an English system
// prompt, and it must remain a constant. What the visitor SEES is `key`,
// resolved against the translation catalogue (`aiRoute.<key>`) -- so a
// Persian visitor reads a Persian page name and Persian starter questions
// while the model still receives the same fixed English string.
//
// Deliberately *descriptions of the page*, never the visitor's own data. The
// assistant is grounded in the public catalogue; telling it someone's wallet
// balance would be both a privacy problem and useless, since it cannot act on
// an account anyway.

const ROUTES = [
  { key: "home", path: "/", description: "home page" },

  // The storefront. These were missing entirely, which meant every one of
  // them fell through to the generic "website" entry -- so on a device page
  // the assistant introduced itself with "you're on the website" and offered
  // starters about the company rather than about the machine in front of
  // the visitor. That is the single most-used route in the app.
  { key: "devices", path: "/devices", description: "device catalogue page listing every machine" },
  { key: "device", path: "/devices/:id", description: "product page for a specific device" },
  { key: "catalog", path: "/catalog", description: "interactive printed-catalogue viewer" },
  { key: "compare", path: "/compare", description: "device comparison page" },
  { key: "installations", path: "/installations", description: "installed-base map of clinics running our devices" },
  { key: "tools", path: "/tools", description: "decision tools page with the case matcher, demand model and ROI calculator" },
  { key: "affiliate", path: "/affiliate", description: "owner network programme page" },
  { key: "blog", path: "/blog", description: "blog listing page" },
  { key: "post", path: "/blog/:slug", description: "a blog article" },

  { key: "product", path: "/products/:id", description: "product page for a specific device" },
  { key: "category", path: "/c/:slug", description: "treatment category page" },
  { key: "partners", path: "/partners", description: "business partners page" },
  { key: "story", path: "/our-story", description: "company story page" },
  { key: "careers", path: "/careers", description: "careers page" },
  { key: "contact", path: "/contact", description: "contact page" },
  { key: "socials", path: "/socials", description: "newsroom page" },

  { key: "account", path: "/account", description: "visitor's own account dashboard" },
  { key: "profile", path: "/profile", description: "visitor's own profile page" },
  { key: "network", path: "/network", description: "network page, which shows the visitor's own network tree" },
  { key: "orders", path: "/orders", description: "order history page" },

];

const FALLBACK = { key: "fallback", description: "website" };

/**
 * Resolves a pathname to its context entry.
 *
 * Locale prefixes are stripped first (`/fa/partners` is still the partners
 * page), otherwise every non-English visitor would fall through to the
 * generic entry and lose the page-aware prompts entirely.
 */
export function routeContextFor(pathname, { localeCodes = ["fa", "ar", "fr", "it"] } = {}) {
  const stripped = pathname.replace(new RegExp(`^/(${localeCodes.join("|")})(?=/|$)`), "") || "/";
  for (const entry of ROUTES) {
    if (matchPath({ path: entry.path, end: true }, stripped)) return entry;
  }
  return FALLBACK;
}

/**
 * The visitor-facing name of a page, and the starters to offer on it.
 *
 * Both come from the catalogue so they are in the visitor's language. The
 * starters are ordinary questions typed on the visitor's behalf -- they go
 * through the same message path as anything else, not into the system
 * prompt -- so localising them is safe in a way localising `description`
 * would not be.
 */
export function routeLabel(t, entry) {
  return t(`aiRoute.${entry.key}.label`);
}

export function routePrompts(t, entry) {
  return [t(`aiRoute.${entry.key}.p1`), t(`aiRoute.${entry.key}.p2`)].filter(
    // A key with no translation resolves to the key itself; drop those rather
    // than offering the visitor a button labelled `aiRoute.foo.p2`.
    (s) => s && !s.startsWith("aiRoute.")
  );
}

export { ROUTES as ROUTE_CONTEXTS, FALLBACK as FALLBACK_CONTEXT };
