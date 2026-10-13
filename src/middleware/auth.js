import { verifyToken } from "../lib/auth.js";
import { Errors } from "../lib/errors.js";
import { db } from "../db/index.js";
import { staffRoleOf, roleHas } from "../lib/permissions.js";

// Verifies the bearer JWT and attaches { userId, role, staffRole } to context.
// Route handlers read these via c.get("userId") / c.get("role") /
// c.get("staffRole").
export async function requireAuth(c, next) {
  const header = c.req.header("Authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw Errors.unauthorized("Missing or malformed Authorization header");

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw Errors.unauthorized("Invalid or expired token");
  }

  const user = db.users.findById(payload.sub);
  if (!user) throw Errors.unauthorized("User no longer exists");
  if (user.status !== "active") throw Errors.forbidden("Account is not active", "account_inactive");

  // A bearer JWT is stateless, so nothing about it changes when the account's
  // password does. Without this check a stolen token stayed usable for its
  // full lifetime even after the victim reset their password -- which is
  // exactly the attack the reset flow exists to stop. Every credential change
  // bumps token_version, retiring every token minted before it.
  // Tokens predating this field carry no `tv`; they compare as 0, so they
  // keep working until that user next changes their password.
  if ((payload.tv ?? 0) !== user.token_version) {
    throw Errors.unauthorized("Session ended because the account password changed", "session_expired");
  }

  c.set("userId", user.id);
  c.set("role", user.role);
  c.set("staffRole", staffRoleOf(user));
  c.set("user", user);
  await next();
}

// Populates the same context keys as requireAuth when a valid token is
// present, and simply carries on when one isn't. For endpoints that are
// genuinely public but whose *response shape* depends on who is asking --
// the storefront product reads, which hide warehouse cost and (optionally)
// list price from anonymous visitors while still giving admins the full row
// their management screens need.
//
// A malformed, expired or superseded token is treated as anonymous rather
// than as an error: this is a public endpoint, and someone browsing the shop
// with a stale tab should see the shop, not a 401.
export async function optionalAuth(c, next) {
  const header = c.req.header("Authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      const payload = await verifyToken(token);
      const user = db.users.findById(payload.sub);
      if (user && user.status === "active" && (payload.tv ?? 0) === user.token_version) {
        c.set("userId", user.id);
        c.set("role", user.role);
        c.set("staffRole", staffRoleOf(user));
        c.set("user", user);
      }
    } catch {
      /* anonymous */
    }
  }
  await next();
}

// Coarse gate: is this account staff at all? Kept because plenty of surfaces
// are genuinely "any staff member", and because it is the cheapest possible
// check. Fine-grained authorization is requirePermission, below.
export async function requireAdmin(c, next) {
  if (c.get("role") !== "admin") throw Errors.forbidden("Admin access required");
  await next();
}

/**
 * Does the current caller hold `permission`?
 *
 * Use this in place of the `c.get("role") === "admin"` checks that get passed
 * down into services as an `isAdmin` override. That boolean means "may read
 * anyone's data", which is emphatically not something every staff role should
 * inherit -- an inventory admin has no business reading a stranger's network
 * earnings. Naming the permission makes each of those decisions explicit.
 */
export function can(c, permission) {
  return roleHas(c.get("staffRole"), permission);
}

/**
 * Route guard for a specific permission. Distinguishes 401 from 403 the same
 * way requireAuth/requireAdmin do, and names the missing permission in the
 * error so an operator staring at a 403 can tell which role they need rather
 * than guessing.
 */
export function requirePermission(permission) {
  return async function permissionMiddleware(c, next) {
    if (!c.get("userId")) throw Errors.unauthorized("Authentication required");
    if (!can(c, permission)) {
      throw Errors.forbidden(`This action requires the '${permission}' permission`, "insufficient_permission");
    }
    await next();
  };
}
