import { describe, test, expect, beforeAll } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, signupStaff, createProduct, buy } from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import { adminService } from "../src/services/adminService.js";
import {
  staffRoleOf,
  permissionsFor,
  roleHas,
  isValidStaffRole,
  serializeStaffRole,
  scopesOf,
  ROOT,
  FINANCE_ADMIN,
  USERS_ADMIN,
  CONTENT_ADMIN,
} from "../src/lib/permissions.js";

// The point of splitting the admin role is that a sub-admin can reach their
// own surfaces and *nothing else*. A test that only proved the first half
// would be worse than no test -- it would look like coverage while the
// interesting failure (privilege creep) sailed through. So every case below
// asserts both directions.

let root, finance, users, content, financeContent, customer, product;

beforeAll(async () => {
  root = await signupAdmin("root");
  finance = await signupStaff(FINANCE_ADMIN);
  users = await signupStaff(USERS_ADMIN);
  content = await signupStaff(CONTENT_ADMIN);
  // Scopes combine: this one account is two kinds of admin at once.
  financeContent = await signupStaff([FINANCE_ADMIN, CONTENT_ADMIN], "financecontent");
  customer = await signup("customer");
  product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
});

describe("staff role resolution", () => {
  test("a plain user has no staff role and no permissions", () => {
    expect(staffRoleOf({ role: "user" })).toBe(null);
    expect(permissionsFor(null)).toEqual([]);
    expect(roleHas(null, "users.read")).toBe(false);
  });

  test("a legacy admin with no staff_role resolves to root", () => {
    // Migration 010 backfills this, but a row written by older code (or by
    // hand) must not silently lose access -- an admin this build can't
    // classify is still an admin.
    expect(staffRoleOf({ role: "admin", staff_role: null })).toBe(ROOT);
    expect(staffRoleOf({ role: "admin", staff_role: "nonsense_from_the_future" })).toBe(ROOT);
  });

  test("scopes are stored sorted, de-duplicated and only when valid", () => {
    expect(serializeStaffRole([USERS_ADMIN, FINANCE_ADMIN, USERS_ADMIN])).toBe("FINANCE_ADMIN,USERS_ADMIN");
    expect(serializeStaffRole("CONTENT_ADMIN, FINANCE_ADMIN")).toBe("CONTENT_ADMIN,FINANCE_ADMIN");
    expect(serializeStaffRole([ROOT, FINANCE_ADMIN])).toBe(ROOT);
    expect(serializeStaffRole([])).toBe(null);
    expect(isValidStaffRole("root")).toBe(true);
    expect(isValidStaffRole(["FINANCE_ADMIN", "CONTENT_ADMIN"])).toBe(true);
    expect(isValidStaffRole(["FINANCE_ADMIN", "supreme_leader"])).toBe(false);
    // root is a whole role, not a scope to combine with others.
    expect(isValidStaffRole(["root", "FINANCE_ADMIN"])).toBe(false);
    expect(isValidStaffRole([])).toBe(false);
    expect(scopesOf("CONTENT_ADMIN,FINANCE_ADMIN")).toEqual(["CONTENT_ADMIN", "FINANCE_ADMIN"]);
  });

  test("root holds every permission; each scope holds a strict subset", () => {
    const rootPerms = permissionsFor(ROOT);
    expect(rootPerms).toContain("admins.manage");
    expect(rootPerms).toContain("settings.write");

    for (const scope of [FINANCE_ADMIN, USERS_ADMIN, CONTENT_ADMIN]) {
      expect(permissionsFor(scope).length).toBeLessThan(rootPerms.length);
      // Nobody but root creates admins, assigns privileges or flips the site's switches.
      expect(roleHas(scope, "admins.manage")).toBe(false);
      expect(roleHas(scope, "settings.write")).toBe(false);
      expect(roleHas(scope, "jobs.run")).toBe(false);
      expect(roleHas(scope, "logs.read")).toBe(false);
    }
  });

  test("combined scopes hold exactly the union of their grants", () => {
    const combined = new Set(permissionsFor("CONTENT_ADMIN,FINANCE_ADMIN"));
    const union = new Set([...permissionsFor(FINANCE_ADMIN), ...permissionsFor(CONTENT_ADMIN)]);
    expect([...combined].sort()).toEqual([...union].sort());
    expect(roleHas("CONTENT_ADMIN,FINANCE_ADMIN", "content.write")).toBe(true);
    expect(roleHas("CONTENT_ADMIN,FINANCE_ADMIN", "money.write")).toBe(true);
    expect(roleHas("CONTENT_ADMIN,FINANCE_ADMIN", "users.write")).toBe(false);
  });

  test("/auth/me reports the staff role and its permissions", async () => {
    const me = await GET("/auth/me", { token: finance.token });
    expect(me.status).toBe(200);
    expect(me.body.staff_role).toBe(FINANCE_ADMIN);
    expect(me.body.permissions).toContain("orders.create_manual");
    expect(me.body.permissions).not.toContain("admins.manage");

    const both = await GET("/auth/me", { token: financeContent.token });
    expect(both.body.staff_role).toBe("CONTENT_ADMIN,FINANCE_ADMIN");
    expect(both.body.permissions).toContain("content.write");
    expect(both.body.permissions).toContain("money.read");

    const plain = await GET("/auth/me", { token: customer.token });
    expect(plain.body.staff_role).toBe(null);
    expect(plain.body.permissions).toEqual([]);
  });
});

// One table, asserted for every actor. Adding a route to the admin surface
// without deciding who may reach it should make this fail.
describe("scope x route matrix", () => {
  const CASES = [
    // [label, request fn, actors that MUST be allowed]
    ["read settings & SEO", (t) => GET("/admin/settings", { token: t }), ["root"]],
    ["write settings", (t) => PATCH("/admin/settings", { show_prices: true }, { token: t }), ["root"]],
    ["write SEO settings", (t) => PATCH("/admin/settings", { seo_site_name: "Ashkan Medical Idea" }, { token: t }), ["root"]],
    ["read users", (t) => GET("/admin/users", { token: t }), ["root", "finance", "users", "financeContent"]],
    ["read a user's network tree", (t) => GET(`/admin/users/${customer.user.id}/network`, { token: t }), ["root", "finance", "users", "financeContent"]],
    ["suspend/reinstate a user", (t) => PATCH(`/admin/users/${customer.user.id}/status`, { status: "active" }, { token: t }), ["root", "users"]],
    ["change a user's staff role", (t) => PATCH(`/admin/users/${customer.user.id}/role`, { role: "user" }, { token: t }), ["root"]],
    ["create an admin", (t) => POST("/admin/admins", {}, { token: t }), ["root"]],
    ["read payouts", (t) => GET("/admin/payouts", { token: t }), ["root", "finance", "financeContent"]],
    ["read reports", (t) => GET("/admin/monitoring/overview", { token: t }), ["root", "finance", "financeContent"]],
    ["read audit log", (t) => GET("/admin/logs", { token: t }), ["root"]],
    ["run jobs", (t) => POST("/admin/jobs/release-commissions", {}, { token: t }), ["root"]],
    ["read order book", (t) => GET("/admin/orders", { token: t }), ["root", "finance", "financeContent"]],
    ["read proforma requests", (t) => GET("/sales/quotes", { token: t }), ["root", "finance", "financeContent"]],
    ["read support requests", (t) => GET("/support/requests", { token: t }), ["root", "users"]],
    ["read job applications", (t) => GET("/careers/applications", { token: t }), ["root", "users"]],
    ["read warehouse cost", (t) => GET(`/products/${product.id}/warehouse-cost`, { token: t }), ["root", "finance", "financeContent"]],
    ["adjust stock", (t) => PATCH(`/products/${product.id}/stock`, { delta: 1 }, { token: t }), ["root", "finance", "financeContent"]],
    ["edit commission plan", (t) => PATCH(`/commission-plans/${product.id}`, { max_payout_depth: 6 }, { token: t }), ["root", "finance", "financeContent"]],
    ["list blog posts (admin)", (t) => GET("/blog/admin/posts", { token: t }), ["root", "content", "financeContent"]],
    ["publish a blog post", (t) => POST("/blog/admin/posts", { title: `Matrix ${Math.random()}` }, { token: t }), ["root", "content", "financeContent"]],
  ];

  const ACTORS = () => ({
    root: root.token,
    finance: finance.token,
    users: users.token,
    content: content.token,
    financeContent: financeContent.token,
  });

  for (const [label, run, allowed] of CASES) {
    test(`${label}: only ${allowed.join(", ")}`, async () => {
      for (const [name, token] of Object.entries(ACTORS())) {
        const res = await run(token);
        if (allowed.includes(name)) {
          expect(`${label}/${name}=${res.status}`).not.toContain("=403");
        } else {
          expect(`${label}/${name}=${res.status}`).toBe(`${label}/${name}=403`);
          expect(res.body.error.code).toBe("insufficient_permission");
        }
      }
    });
  }

  test("a plain customer is refused the whole admin surface", async () => {
    for (const [label, run] of CASES.map((c) => [c[0], c[1]])) {
      const res = await run(customer.token);
      expect(`${label}=${res.status}`).toBe(`${label}=403`);
    }
  });

  test("settings and SEO are root only: no scope holds settings.read, settings.write or seo.write", () => {
    for (const perm of ["settings.read", "settings.write", "seo.write"]) {
      for (const role of [FINANCE_ADMIN, USERS_ADMIN, CONTENT_ADMIN, "CONTENT_ADMIN,FINANCE_ADMIN", "CONTENT_ADMIN,FINANCE_ADMIN,USERS_ADMIN"]) {
        expect(`${role}:${perm}=${roleHas(role, perm)}`).toBe(`${role}:${perm}=false`);
      }
      expect(roleHas(ROOT, perm)).toBe(true);
    }
  });

  test("a content admin cannot change SEO settings alone or mixed with other keys", async () => {
    for (const body of [{ seo_site_name: "Sneaky" }, { seo_site_name: "Sneaky", show_prices: false }]) {
      const res = await PATCH("/admin/settings", body, { token: content.token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("insufficient_permission");
    }
  });
});

describe("limited staff cannot read other people's data", () => {
  test("a content admin cannot read a stranger's node, space or order", async () => {
    // This is the failure mode the old `isAdmin` boolean invited: it meant
    // "may see anyone's data", so any new staff role would have inherited
    // sight of every customer's earnings by default.
    const buyer = await signup("buyer");
    const receipt = await buy(buyer, product);
    expect(receipt.status).toBe(201);
    const nodeId = receipt.body.node.id;
    const spaceId = receipt.body.node.space_id;
    const txId = receipt.body.transaction.id;

    for (const path of [`/nodes/${nodeId}`, `/nodes/${nodeId}/earnings`, `/spaces/${spaceId}`, `/purchases/${txId}`]) {
      expect((await GET(path, { token: content.token })).status).toBe(403);
    }

    // Root still sees everything -- that capability didn't move.
    expect((await GET(`/nodes/${nodeId}`, { token: root.token })).status).toBe(200);
    expect((await GET(`/spaces/${spaceId}`, { token: root.token })).status).toBe(200);
  });

  test("a users admin can read the network and suspend a node; a finance admin can read but not suspend", async () => {
    const buyer = await signup("buyer2");
    const receipt = await buy(buyer, product);
    const nodeId = receipt.body.node.id;

    expect((await GET(`/nodes/${nodeId}`, { token: finance.token })).status).toBe(200);
    // ...but suspending a node is network.write, which finance doesn't hold.
    const refused = await PATCH(`/nodes/${nodeId}/status`, { status: "suspended" }, { token: finance.token });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("insufficient_permission");

    const allowed = await PATCH(`/nodes/${nodeId}/status`, { status: "active" }, { token: users.token });
    expect(allowed.status).toBe(200);
  });
});

describe("role assignment guards", () => {
  test("only root may create an admin, and it can hand out combined scopes", async () => {
    const email = `new-admin-${Date.now()}@test.local`;
    const asContent = await POST(
      "/admin/admins",
      { email, password: "a-long-password", name: "Nope", staff_scopes: [FINANCE_ADMIN] },
      { token: content.token }
    );
    expect(asContent.status).toBe(403);
    // Not even the people admin, whose whole job is people.
    const asUsers = await POST(
      "/admin/admins",
      { email, password: "a-long-password", name: "Nope", staff_scopes: [FINANCE_ADMIN] },
      { token: users.token }
    );
    expect(asUsers.status).toBe(403);

    const created = await POST(
      "/admin/admins",
      { email, password: "a-long-password", name: "New Admin", staff_scopes: [FINANCE_ADMIN, USERS_ADMIN] },
      { token: root.token }
    );
    expect(created.status).toBe(201);
    expect(created.body.role).toBe("admin");
    expect(created.body.staff_role).toBe("FINANCE_ADMIN,USERS_ADMIN");
    expect(created.body.password_hash).toBeUndefined();

    // The new account can actually sign in and holds the union.
    const login = await POST("/auth/login", { email, password: "a-long-password" });
    expect(login.status).toBe(200);
    const me = await GET("/auth/me", { token: login.body.token });
    expect(me.body.permissions).toContain("money.read");
    expect(me.body.permissions).toContain("users.write");
    expect(me.body.permissions).not.toContain("content.write");

    // Duplicate email is refused.
    const again = await POST(
      "/admin/admins",
      { email, password: "a-long-password", name: "Dup", staff_scopes: [FINANCE_ADMIN] },
      { token: root.token }
    );
    expect(again.status).toBe(409);
  });

  test("there can be several root admins", async () => {
    const second = await POST(
      "/admin/admins",
      { email: `root2-${Date.now()}@test.local`, password: "a-long-password", name: "Root Two", staff_role: "root" },
      { token: root.token }
    );
    expect(second.status).toBe(201);
    expect(second.body.staff_role).toBe(ROOT);
    expect(db.users.countRootAdmins()).toBeGreaterThan(1);
  });

  test("assigning an unknown scope is refused", async () => {
    const victim = await signup("victim");
    const res = await PATCH(
      `/admin/users/${victim.user.id}/role`,
      { role: "admin", staff_scopes: ["supreme_leader"] },
      { token: root.token }
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_staff_role");
  });

  test("a staff role cannot be pinned on a non-admin account", async () => {
    const victim = await signup("victim2");
    const res = await PATCH(
      `/admin/users/${victim.user.id}/role`,
      { role: "user", staff_scopes: [FINANCE_ADMIN] },
      { token: root.token }
    );
    expect(res.status).toBe(400);
  });

  test("promoting without naming a scope yields root, as it always did", async () => {
    const victim = await signup("victim3");
    const res = await PATCH(`/admin/users/${victim.user.id}/role`, { role: "admin" }, { token: root.token });
    expect(res.status).toBe(200);
    expect(res.body.staff_role).toBe(ROOT);
  });

  test("root can change an admin's scopes later", async () => {
    const victim = await signup("victim4");
    await PATCH(`/admin/users/${victim.user.id}/role`, { role: "admin", staff_scopes: [CONTENT_ADMIN] }, { token: root.token });
    const res = await PATCH(
      `/admin/users/${victim.user.id}/role`,
      { role: "admin", staff_scopes: [CONTENT_ADMIN, USERS_ADMIN] },
      { token: root.token }
    );
    expect(res.status).toBe(200);
    expect(res.body.staff_role).toBe("CONTENT_ADMIN,USERS_ADMIN");
  });

  test("demoting yourself below root is refused", async () => {
    const solo = await signupAdmin("selfdemote");
    const res = await PATCH(
      `/admin/users/${solo.user.id}/role`,
      { role: "admin", staff_scopes: [CONTENT_ADMIN] },
      { token: solo.token }
    );
    // Only root holds admins.manage, so this would strand them with no way
    // back -- the same trap self-demotion to 'user' already guarded against.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("cannot_lock_self_out");
  });

  test("the last root admin cannot be demoted", () => {
    // Deliberately a service-level test, not an HTTP one.
    //
    // Over HTTP this guard is unreachable: only root holds admins.manage, so
    // the actor is always an active root. Demoting somebody *else* therefore
    // leaves at least the actor, and demoting *themselves* trips
    // cannot_lock_self_out first. The check is defence in depth for callers
    // that skip the route guard -- a seeding script, a future admin tool --
    // and this test exercises it where it can actually fire rather than
    // contorting the HTTP surface to pretend otherwise.
    const roots = db.users
      .list({ role: "admin", limit: 500 })
      .filter((u) => u.status === "active" && (u.staff_role === null || u.staff_role === ROOT));
    expect(roots.length).toBeGreaterThan(1);

    const survivor = roots[0];
    const parked = roots.slice(1);
    for (const r of parked) db.users.updateRole(r.id, "admin", CONTENT_ADMIN);

    try {
      expect(db.users.countRootAdmins()).toBe(1);
      // Actor is somebody other than the survivor, so the self-lockout guard
      // doesn't intercept and the last-root guard is what has to hold.
      expect(() => adminService.setUserRole(survivor.id, "user", parked[0].id)).toThrow(/last root admin/i);
      // Demoting them to a limited scope set is the same loss of root.
      expect(() => adminService.setUserRole(survivor.id, "admin", parked[0].id, [CONTENT_ADMIN])).toThrow(
        /last root admin/i
      );
      // The row is untouched by the refusal.
      expect(db.users.findById(survivor.id).staff_role).toBe(ROOT);
    } finally {
      // Shared in-memory database: hand every root back before leaving, or
      // later files inherit a system with no working administrator.
      for (const r of parked) db.users.updateRole(r.id, "admin", ROOT);
    }
  });
});

describe("legacy role migration", () => {
  test("old single roles map onto the closest scope", async () => {
    const { runExtraMigrations } = await import("../src/db/adapters/sqlite/migrations.js");
    const legacy = {
      sales_agent: FINANCE_ADMIN,
      inventory_admin: CONTENT_ADMIN,
      support_agent: USERS_ADMIN,
    };
    const ids = {};
    for (const role of Object.keys(legacy)) {
      const actor = await signup(`legacy-${role}`);
      // Written the way the previous build wrote it.
      db._raw.query("UPDATE users SET role = 'admin', staff_role = ? WHERE id = ?").run(role, actor.user.id);
      ids[role] = actor.user.id;
    }
    // Re-run the one migration on a database that still holds legacy rows.
    db._raw.query("DELETE FROM schema_migrations WHERE id = '021_staff_scopes'").run();
    runExtraMigrations(db._raw);
    for (const [role, scope] of Object.entries(legacy)) {
      expect(db.users.findById(ids[role]).staff_role).toBe(scope);
    }
  });
});
