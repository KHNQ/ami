import { getToken, setToken } from "./token.js";

// Resolved at runtime, not baked in at build time. Pinning a single
// hostname here breaks the moment the app is opened from anywhere other
// than the machine that built it: hardcoding `localhost` breaks phones on
// the LAN, and hardcoding the LAN IP breaks the dev machine itself (a Mac
// on an iPhone hotspot can't route back to its own 172.20.10.x address).
//
// Deriving from the current page's hostname means the API is always reached
// the same way the app itself was -- localhost:5173 -> localhost:3000,
// 192.168.1.20:5173 -> 192.168.1.20:3000 -- with no rebuild.
// VITE_API_BASE_URL still wins when set, for real deployments where the API
// lives on its own domain.
const API_PORT = import.meta.env.VITE_API_PORT || "3000";

function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured;
  if (typeof window === "undefined") return `http://localhost:${API_PORT}`;
  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}

const BASE_URL = resolveBaseUrl();

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Fired whenever a request comes back 401 so the app-level auth context can
// clear state and bounce to /login without every call site handling it.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = "GET", body, query, auth = true, headers: extraHeaders } = {}) {
  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  // `extraHeaders` exists for credentials that are not the bearer token.
  const headers = { ...(extraHeaders || {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = data?.error || {};
    if (res.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(res.status, err.code || "unknown", err.message || "Request failed", err.details);
  }

  return data;
}

// Exported so the separate admin app (admin/) can build its own method set
// on the same HTTP layer -- base URL resolution, 401 handling and error
// mapping stay in one place rather than being duplicated per app.
export const get = (path, query, headers) => request(path, { method: "GET", query, headers });
export const post = (path, body, headers) => request(path, { method: "POST", body, headers });
export const patch = (path, body, headers) => request(path, { method: "PATCH", body, headers });
export const del = (path, body, headers) => request(path, { method: "DELETE", body, headers });

// The storefront's API surface. Privileged endpoints deliberately are NOT
// here -- they live in admin/src/lib/adminApi.js, built on the same request
// layer. A customer's bundle has no reason to ship a directory of every
// admin route in the system.
export const api = {
  // Exposed so non-fetch transports (EventSource for live config) resolve
  // the same origin as everything else rather than re-deriving it and
  // drifting.
  baseUrl: () => BASE_URL,

  // auth
  signup: (body) => post("/auth/signup", body),
  login: (body) => post("/auth/login", body),
  me: () => get("/auth/me"),
  forgotPassword: (body) => post("/auth/forgot-password", body),
  resetPassword: (body) => post("/auth/reset-password", body),

  // runtime site configuration -- which features are on, and the contact
  // details to show when they are off. Public, so no token is needed.
  siteConfig: () => request("/site-config", { auth: false }),

  // blog + socials -- public, no token needed
  listPosts: (query) => request("/blog/posts", { method: "GET", query, auth: false }),
  getPost: (slug) => request(`/blog/posts/${slug}`, { method: "GET", auth: false }),
  instagramFeed: () => request("/blog/instagram", { method: "GET", auth: false }),

  // The one way to ask for help: a name, a way to reach you, and what you
  // need. Lands in the admin queue; there is no conversation. Anonymous is
  // fine, but the bearer token is attached when there is one so a signed-in
  // sender is attributed.
  submitSupportRequest: (body) => post("/support/requests", body),

  // Storefront sales. Anything that is an ASK about buying a machine goes
  // here rather than to the support intake: a proforma, or a lease proforma
  // request with the term and upfront the visitor chose.
  //
  // `auth: false` is wrong on the surface for a signed-in customer, but the
  // request helper attaches the bearer token whenever one exists and
  // optionalAuth on the server attributes the quote to that account. Passing
  // auth:false here would strip it, so these deliberately use the default.
  createQuote: (body) => post("/sales/quotes", body),
  mySales: () => get("/sales/mine"),

  // careers page
  submitApplication: (body) => request("/careers/applications", { method: "POST", body, auth: false }),
  listCategories: () => get("/products/categories"),

  // cheques backing one of the caller's own instalment orders
  getOrderCheques: (orderId) => get(`/purchases/${orderId}/cheques`),
  getMyCheques: () => get("/cheques/mine"),

  // profile
  getProfile: () => get("/profile"),
  updateProfile: (body) => patch("/profile", body),
  changePassword: (body) => patch("/profile/password", body),
  deleteAccount: (body) => del("/profile", body),

  // products
  // Product images are served as real bytes rather than inlined into the
  // JSON as base64 (see productService.hydrate). Deliberately returned as a
  // SAME-ORIGIN path, not `${BASE_URL}${...}`: this is the one API resource
  // that gets rendered into server markup, and the server can't know the
  // hostname the browser used, so an absolute URL built there would bake in
  // `localhost` and break on every other device. The path is proxied to the
  // API by server.js in production and by the Vite dev proxy locally --
  // which also makes it same-origin for caching and CORS. Returns null when
  // a product has no image, so call sites can branch on it.
  productImageUrl: (product) => product?.specs?.image_url ?? null,

  /**
   * Turns the server's relative proforma link into one a browser can open.
   *
   * The API lives on its own origin, so the `download_url` that comes back
   * from POST /sales/quotes is relative to the API, not to the page. Opening
   * it as-is would ask the storefront for a document only the API can make.
   */
  absoluteUrl: (path) => (path ? `${BASE_URL}${path}` : null),
  listProducts: (query) => get("/products", query),
  getProduct: (id) => get(`/products/${id}`),

  // purchases
  purchase: (body) => post("/purchases", body),
  listMyPurchases: (query) => get("/purchases", query),
  getPurchase: (id) => get(`/purchases/${id}`),

  // spaces
  listSpaces: (query) => get("/spaces", query),
  getSpace: (id) => get(`/spaces/${id}`),
  getSpaceTree: (id) => get(`/spaces/${id}/tree`),

  // redeem codes
  generateRedeemCode: (body) => post("/redeem-codes", body),
  listMyRedeemCodes: (productId) => get("/redeem-codes/mine", { product_id: productId }),
  validateRedeemCode: (code) => get(`/redeem-codes/${code}`, undefined),
  revokeRedeemCode: (id) => post(`/redeem-codes/${id}/revoke`),

  // nodes
  listMyNodes: () => get("/nodes/mine"),
  getNode: (id) => get(`/nodes/${id}`),
  getNodeDownline: (id, query) => get(`/nodes/${id}/downline`, query),
  getNodeEarnings: (id, query) => get(`/nodes/${id}/earnings`, query),
  getNodeRedeemCodes: (id) => get(`/nodes/${id}/redeem-codes`),
  getNodeRank: (id) => get(`/nodes/${id}/rank`),
  getNodeRankBonuses: (id, query) => get(`/nodes/${id}/rank-bonuses`, query),
  getNodeQuota: (id) => get(`/nodes/${id}/quota`),
  getNodeQuotaBonuses: (id, query) => get(`/nodes/${id}/quota-bonuses`, query),

  // commission plans
  getCommissionPlan: (productId) => get(`/commission-plans/${productId}`),

  // rank/leadership bonus tiers
  listRankTiers: (productId) => get(`/commission-plans/${productId}/rank-tiers`),

  // quota/tier progression tiers
  listQuotaTiers: (productId) => get(`/commission-plans/${productId}/quota-tiers`),

};
