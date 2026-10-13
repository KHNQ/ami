// Staff access control.
//
// Two columns model this (see migrations 010 and 021):
//   users.role       'user' | 'admin'   -- is this account staff at all?
//   users.staff_role NULL | 'root' | a comma-separated list of scopes
//
// There are two kinds of staff:
//
//   * Root admins hold everything. There can be any number of them, and they
//     are the ONLY accounts that may create admins or change anyone's
//     privileges (`admins.manage` is deliberately in no scope's grant list).
//
//   * Sub-admins hold one or more SCOPES. Scopes combine: an account may be
//     FINANCE_ADMIN and CONTENT_ADMIN at once, and then holds the union of
//     both grants. The scope list is stored in the same `staff_role` column
//     as 'FINANCE_ADMIN,CONTENT_ADMIN' (sorted, de-duplicated), which is why
//     every existing `staffRole` call site -- the auth middleware, the login
//     payload, the AI agent -- keeps working untouched: they pass the string
//     around and ask roleHas()/permissionsFor() about it.
//
// A row with role='admin' and no staff_role is treated as 'root', which is
// what every pre-existing admin was backfilled to. That fallback is load
// bearing: it means adding this file could not silently demote anybody.
//
// The permission map lives in code rather than in a table, matching how the
// rest of this codebase handles policy (commission defaults in config.js,
// setting definitions in settingsService.js). Permissions change with
// deployments, not at runtime, and a table would invite an operator to grant
// themselves `plans.write` at 2am with no code review.

export const ROOT = "root";

// Scopes. Upper-case because they are identifiers an operator reads in the
// admin console and in audit logs, not prose.
export const FINANCE_ADMIN = "FINANCE_ADMIN"; // money, transactions, invoices, proformas
export const USERS_ADMIN = "USERS_ADMIN"; // people, network trees, profiles, support intake
export const CONTENT_ADMIN = "CONTENT_ADMIN"; // blog posts and assistant answers

export const SCOPES = [FINANCE_ADMIN, USERS_ADMIN, CONTENT_ADMIN];
export const STAFF_ROLES = [ROOT, ...SCOPES];

// Every permission the app knows about. Grouped by the surface it guards.
export const PERMISSIONS = [
  "settings.read", // the Settings & SEO screen -- root only
  "settings.write", // feature flags, contact details, SEO -- root only
  "seo.write", // the seo_* settings only -- root only; no scope grants it
  "admins.manage", // create admins, change anyone's staff role -- root only
  "users.read",
  "users.write", // suspend / reinstate an account
  "money.read", // payouts and the money overview
  "money.write", // recording a payout settlement
  "catalogue.read_cost", // warehouse cost -- the company's margin
  "catalogue.write", // products: create, price, stock, metadata, lease rules
  "plans.write", // commission plans, rank tiers, quota tiers
  "orders.read_all",
  "orders.refund",
  "orders.create_manual", // record a walk-in sale
  "cheques.read",
  "cheques.write",
  "sales.read", // proforma requests, quotes, lease agreements
  "sales.write",
  "careers.read",
  "careers.write",
  "network.read_all", // any node, space or redeem code
  "network.write", // suspend a node, revoke someone else's code
  "support.read_all", // the contact / ticket intake queue
  "support.write",
  "reports.read",
  "logs.read",
  "content.write", // blog posts, static pages
  "jobs.run",
];

const ALL = new Set(PERMISSIONS);

const SCOPE_PERMISSIONS = {
  // Money in and out: what is owed, what was paid, what was quoted.
  // Given catalogue.read_cost and catalogue.write because you cannot sanely
  // quote or lease a machine without knowing its cost, and the lease rules
  // live on the product.
  [FINANCE_ADMIN]: new Set([
    "money.read",
    "money.write",
    "orders.read_all",
    "orders.refund",
    "orders.create_manual",
    "cheques.read",
    "cheques.write",
    "sales.read",
    "sales.write",
    "catalogue.read_cost",
    "catalogue.write",
    "plans.write",
    "reports.read",
    "users.read", // a payout or an order is meaningless without the person
    "network.read_all",
  ]),

  // People: accounts, the referral trees, applicants and the support intake.
  // Can suspend an account but can never change what an admin may do.
  [USERS_ADMIN]: new Set([
    "users.read",
    "users.write",
    "network.read_all",
    "network.write",
    "support.read_all",
    "support.write",
    "careers.read",
    "careers.write",
  ]),

  // The public face: blog posts (and the assistant's answers). Deliberately
  // NOT Stock -- the catalogue, its prices and its lease terms belong to the
  // finance scope -- and NOT the Settings & SEO screen, which is root only. (A
  // post still carries its own title/description in its front matter; that is
  // content, not site settings.)
  [CONTENT_ADMIN]: new Set(["content.write"]),
};

/** Splits a stored staff_role value into its parts. */
function parts(staffRole) {
  if (!staffRole || typeof staffRole !== "string") return [];
  return staffRole
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Scopes in a staff role string (never includes 'root'). */
export function scopesOf(staffRole) {
  return parts(staffRole).filter((p) => SCOPES.includes(p));
}

/** Canonical stored form of a list of scopes (or 'root'). null for empty. */
export function serializeStaffRole(input) {
  const list = Array.isArray(input) ? input : parts(input);
  if (list.includes(ROOT)) return ROOT;
  const scopes = [...new Set(list.filter((p) => SCOPES.includes(p)))].sort();
  return scopes.length ? scopes.join(",") : null;
}

/**
 * Is `input` (a string or an array) a valid staff-role assignment?
 * Valid means exactly 'root', or one or more known scopes and nothing else.
 */
export function isValidStaffRole(input) {
  const list = Array.isArray(input) ? input : parts(input);
  if (list.length === 0) return false;
  if (list.includes(ROOT)) return list.length === 1;
  return list.every((p) => SCOPES.includes(p));
}

/**
 * The effective staff role for a user row, or null for a non-staff account.
 * Centralised so the role='admin' + staff_role=NULL legacy shape is
 * interpreted in exactly one place.
 */
export function staffRoleOf(user) {
  if (!user || user.role !== "admin") return null;
  const declared = user.staff_role;
  if (declared === ROOT) return ROOT;
  if (declared && isValidStaffRole(declared)) return serializeStaffRole(declared);
  // Either NULL (pre-migration admin) or a value this build doesn't
  // recognise. Both resolve to root: an admin row that this code cannot
  // classify is still an admin, and quietly downgrading them would lock an
  // operator out of their own system.
  return ROOT;
}

export function isRoot(staffRole) {
  return staffRole === ROOT;
}

export function roleHas(staffRole, permission) {
  if (!staffRole) return false;
  if (staffRole === ROOT) return ALL.has(permission);
  return scopesOf(staffRole).some((scope) => SCOPE_PERMISSIONS[scope]?.has(permission));
}

export function permissionsFor(staffRole) {
  if (!staffRole) return [];
  if (staffRole === ROOT) return [...ALL].sort();
  const out = new Set();
  for (const scope of scopesOf(staffRole)) {
    for (const p of SCOPE_PERMISSIONS[scope] ?? []) out.add(p);
  }
  return [...out].sort();
}

/** The grant list for one scope (or root), for the admin console's matrix. */
export function permissionsForScope(scope) {
  if (scope === ROOT) return [...ALL].sort();
  return [...(SCOPE_PERMISSIONS[scope] ?? [])].sort();
}
