import { buildApp } from "../src/app.js";
import { serializeStaffRole } from "../src/lib/permissions.js";
import { db } from "../src/db/index.js";

// One app instance for the whole HTTP test run. buildApp() is pure wiring --
// all state lives in the (in-memory, per-run) SQLite handle from setup.js --
// so sharing it across files is safe and keeps the rate-limiter buckets in
// one place, which the throttling tests rely on.
export const app = buildApp();

// Every rate limiter in src/middleware/rateLimit.js keys off the client IP.
// Tests that aren't specifically exercising throttling get a fresh IP per
// request so a long scenario can't trip a limiter it never meant to touch;
// the throttling tests pin a single IP on purpose.
let ipCounter = 0;
export function freshIp() {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65025) % 250}.${Math.floor(ipCounter / 255) % 255}.${(ipCounter % 254) + 1}`;
}

/**
 * Fires a real Request through the real Hono app -- middleware, guards,
 * error handler and all. Returns the parsed body alongside the status so
 * assertions can check both without awaiting twice.
 */
export async function api(method, path, { token, body, ip, headers = {} } = {}) {
  const h = { "x-forwarded-for": ip || freshIp(), ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const init = { method, headers: h };
  if (body !== undefined) {
    h["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init);
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export const GET = (path, opts) => api("GET", path, opts);
export const POST = (path, body, opts) => api("POST", path, { ...opts, body });
export const PATCH = (path, body, opts) => api("PATCH", path, { ...opts, body });
export const DELETE = (path, body, opts) => api("DELETE", path, { ...opts, body });

let userCounter = 0;
export function nextEmail(prefix = "http") {
  userCounter += 1;
  return `${prefix}-${userCounter}-${Date.now().toString(36)}@test.local`;
}

export const PASSWORD = "correct-horse-battery";

/** Signs a user up over HTTP and returns { token, user, email, password }. */
export async function signup(prefix = "user", password = PASSWORD) {
  const email = nextEmail(prefix);
  const res = await POST("/auth/signup", { email, password, name: prefix });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, user: res.body.user, email, password };
}

/**
 * Signs a user up and promotes them straight in the DB. requireAuth reads
 * the role off the user row rather than the JWT claim, so the token minted
 * at signup keeps working and picks up the new role immediately.
 */
export async function signupAdmin(prefix = "admin") {
  const actor = await signup(prefix);
  db.users.updateRole(actor.user.id, "admin");
  return { ...actor, user: { ...actor.user, role: "admin" } };
}

/**
 * Signs a user up and promotes them to a *limited* staff role: one scope
 * (FINANCE_ADMIN | USERS_ADMIN | CONTENT_ADMIN) or several, as an array or a
 * comma separated string. Same mechanism as signupAdmin -- requireAuth
 * re-reads the row each request, so the token minted at signup picks the new
 * role up immediately.
 */
export async function signupStaff(staffRole, prefix) {
  const stored = serializeStaffRole(staffRole);
  const actor = await signup(prefix || stored.toLowerCase().replace(/[^a-z]+/g, "-"));
  db.users.updateRole(actor.user.id, "admin", stored);
  return { ...actor, staffRole: stored, user: { ...actor.user, role: "admin", staff_role: stored } };
}

/** Credits a wallet directly. Wallet top-ups no longer exist in the app. */
export function fund(userId, amountCents) {
  return db.wallet.credit(userId, amountCents, { type: "deposit", note: "test fixture" });
}

let productCounter = 0;
/** Creates a product over the admin HTTP surface and returns the body. */
export async function createProduct(adminToken, overrides = {}) {
  productCounter += 1;
  const res = await POST(
    "/products",
    {
      name: `HTTP Product ${productCounter}`,
      description: "fixture",
      stockCount: 500,
      xCents: 4000,
      yCents: 10000,
      ...overrides,
    },
    { token: adminToken }
  );
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Full purchase: fund the wallet to cover the price, then buy. */
export async function buy(actor, product, { redeemCode, discountCents } = {}) {
  fund(actor.user.id, product.list_price_y_cents);
  const body = { product_id: product.id };
  if (redeemCode) body.redeem_code = redeemCode;
  if (discountCents) body.discount_cents = discountCents;
  return POST("/purchases", body, { token: actor.token });
}
