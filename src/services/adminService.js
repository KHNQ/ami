import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { hashPassword } from "../lib/auth.js";
import {
  ROOT,
  SCOPES,
  isValidStaffRole,
  permissionsForScope,
  serializeStaffRole,
  staffRoleOf,
} from "../lib/permissions.js";

export const adminService = {
  listUsers(opts) {
    return db.users.list(opts).map((u) => ({ ...u, password_hash: undefined }));
  },

  setUserStatus(userId, status, actorUserId) {
    if (!["active", "suspended", "banned"].includes(status)) throw Errors.badRequest("invalid status");
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    // requireAuth rejects any non-active account, so an admin suspending
    // themselves would be locked out of the very surface that could undo
    // it -- recoverable only by hand-editing the database. Admins can still
    // suspend *other* admins.
    if (userId === actorUserId && status !== "active") {
      throw Errors.badRequest("You cannot suspend or ban your own account", "cannot_lock_self_out");
    }
    const updated = db.users.updateStatus(userId, status);
    db.logs.record({ actorUserId, action: "admin.user.set_status", entityType: "user", entityId: userId, meta: { status } });
    return { ...updated, password_hash: undefined };
  },

  // Sets the coarse role and, for staff, which scopes they hold.
  //
  // `staffRole` is 'root', or one or more scopes (an array, or a comma
  // separated string). Promoting to admin without saying which defaults to
  // 'root' -- that matches the pre-existing behaviour, where "admin" meant
  // full access, so nothing silently gains or loses privilege.
  //
  // The route guards this behind `admins.manage`, which only root holds: a
  // sub-admin can never mint another admin or widen their own access.
  setUserRole(userId, role, actorUserId, staffRole = null) {
    if (!["user", "admin"].includes(role)) throw Errors.badRequest("invalid role");
    if (staffRole !== null && staffRole !== undefined && !isValidStaffRole(staffRole)) {
      throw Errors.badRequest(
        `staff_role must be 'root' or one or more of: ${SCOPES.join(", ")}`,
        "invalid_staff_role"
      );
    }
    const nextStaffRole = staffRole ? serializeStaffRole(staffRole) : null;
    if (role !== "admin" && nextStaffRole) {
      throw Errors.badRequest("staff_role only applies to admin accounts", "invalid_staff_role");
    }
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    // Same reasoning as setUserStatus: self-demotion is irreversible from
    // inside the app. Promote a second admin first, then have them demote
    // this one.
    if (userId === actorUserId && role !== "admin") {
      throw Errors.badRequest("You cannot remove your own admin role", "cannot_lock_self_out");
    }
    // Demoting yourself to a *limited* scope set is the same trap wearing a
    // different hat: only root holds admins.manage, so a root who makes
    // themselves a finance admin can no longer promote anyone, including
    // themselves.
    if (userId === actorUserId && role === "admin" && nextStaffRole && nextStaffRole !== ROOT) {
      throw Errors.badRequest("You cannot reduce your own access below root admin", "cannot_lock_self_out");
    }
    // And the same trap at the level of the whole system: if this change
    // would retire the last root admin, nobody can ever grant the role back
    // without hand-editing the database.
    const losingRoot = staffRoleOf(user) === ROOT && (role !== "admin" || (nextStaffRole && nextStaffRole !== ROOT));
    if (losingRoot && db.users.countRootAdmins() <= 1) {
      throw Errors.badRequest(
        "This is the last root admin -- promote another root admin first",
        "last_root_admin"
      );
    }

    const updated = db.users.updateRole(userId, role, nextStaffRole);
    db.logs.record({
      actorUserId,
      action: "admin.user.set_role",
      entityType: "user",
      entityId: userId,
      meta: { role, staff_role: updated.staff_role },
    });
    return { ...updated, password_hash: undefined };
  },

  // Creates a staff account directly. Root only (the route enforces it).
  // The new account is marked email-verified: a root admin vouching for it
  // is a stronger statement than a confirmation link.
  async createAdmin({ email, password, name, staffRole }, actorUserId) {
    if (!email || !password || !name) throw Errors.badRequest("email, password and name are required");
    if (password.length < 8) throw Errors.badRequest("password must be at least 8 characters");
    if (!isValidStaffRole(staffRole)) {
      throw Errors.badRequest(
        `staff_role must be 'root' or one or more of: ${SCOPES.join(", ")}`,
        "invalid_staff_role"
      );
    }
    if (db.users.findByEmail(email)) throw Errors.conflict("An account with this email already exists", "email_taken");
    const passwordHash = await hashPassword(password);
    const user = db.transaction(() => {
      const created = db.users.create({ email, passwordHash, name, role: "user" });
      db.wallet.ensureAccount(created.id);
      db.users.markEmailVerified(created.id);
      return created;
    });
    const promoted = db.users.updateRole(user.id, "admin", serializeStaffRole(staffRole));
    db.logs.record({
      actorUserId,
      action: "admin.user.create_admin",
      entityType: "user",
      entityId: user.id,
      meta: { staff_role: promoted.staff_role },
    });
    return { ...promoted, password_hash: undefined };
  },

  // What each scope may do -- so the admin UI can render an accurate
  // permission matrix instead of duplicating the map in the frontend.
  roleCatalogue() {
    return [ROOT, ...SCOPES].map((role) => ({ role, permissions: permissionsForScope(role) }));
  },

  /**
   * One person's referral network, for the admin People view.
   *
   * For every product the user has joined: their sponsor chain upwards and
   * the full tree below them (capped at `maxDepth` so a deep tree cannot turn
   * one click into an unbounded response). Names and emails are resolved
   * here so the console draws a tree of people rather than of opaque ids.
   */
  userNetwork(userId, { maxDepth = 8 } = {}) {
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    const depthCap = Math.min(Math.max(Number(maxDepth) || 8, 1), 25);

    const people = new Map();
    const person = (id) => {
      if (!people.has(id)) {
        const u = db.users.findById(id);
        people.set(id, u ? { user_id: u.id, name: u.name, email: u.email } : { user_id: id, name: "Unknown", email: null });
      }
      return people.get(id);
    };

    const memberships = db.nodes.listByUser(userId).map((node) => {
      const product = db.products.get(node.product_id);
      const bySpace = db.nodes.listBySpace(node.space_id);
      const children = new Map();
      for (const n of bySpace) {
        if (!n.parent_node_id) continue;
        if (!children.has(n.parent_node_id)) children.set(n.parent_node_id, []);
        children.get(n.parent_node_id).push(n);
      }
      const build = (n, depth) => {
        const kids = children.get(n.id) || [];
        return {
          node_id: n.id,
          ...person(n.user_id),
          status: n.status,
          lifetime_volume_cents: n.lifetime_volume_cents,
          joined_at: n.joined_at,
          child_count: kids.length,
          // Past the cap the branch is reported as truncated rather than
          // silently looking like a leaf.
          truncated: depth >= depthCap && kids.length > 0,
          children: depth >= depthCap ? [] : kids.map((k) => build(k, depth + 1)),
        };
      };
      let size = 0;
      const count = (n) => {
        size += 1;
        for (const k of children.get(n.id) || []) count(k);
      };
      count(node);
      return {
        node_id: node.id,
        space_id: node.space_id,
        product_id: node.product_id,
        product_name: product?.name ?? null,
        status: node.status,
        joined_at: node.joined_at,
        lifetime_volume_cents: node.lifetime_volume_cents,
        downline_size: size - 1,
        upline: db.nodes.listAncestors(node.id).map((a) => ({ node_id: a.id, ...person(a.user_id), status: a.status })),
        tree: build(node, 1),
      };
    });

    return {
      user: { id: user.id, name: user.name, email: user.email, status: user.status },
      memberships,
    };
  },

  listOrders(opts) {
    return db.transactions.list(opts);
  },

  getOrder(id) {
    const tx = db.transactions.get(id);
    if (!tx) throw Errors.notFound("Transaction not found");
    return { ...tx, ledger_entries: db.ledger.listByTransaction(id) };
  },

  // GET /admin/monitoring/overview -- high-level live counts for a dashboard.
  monitoringOverview() {
    return {
      users_recent: db.users.list({ limit: 10 }).map((u) => ({ ...u, password_hash: undefined })),
      spaces_recent: db.spaces.list({ limit: 10 }),
      transactions_recent: db.transactions.list({ limit: 10 }),
      reserve_balance_cents: db.reserve.getBalance(),
      trex_net_summary: db.transactions.aggregateNet({}),
    };
  },
};
