import { Hono } from "hono";
import { requireAuth, requireAdmin, requirePermission } from "../middleware/auth.js";
import { adminService } from "../services/adminService.js";
import { jobsService } from "../services/jobsService.js";
import { settingsService } from "../services/settingsService.js";
import { notificationService } from "../services/notificationService.js";
import { payoutService } from "../services/payoutService.js";

// Various admin controls: user management, site settings, network payouts,
// and the scheduled-job triggers (activity recalculation, commission
// release).
//
// requireAdmin is the coarse "is this staff at all" gate; each route then
// names the specific permission it needs. Previously the blanket guard was
// the whole story, which meant anyone who could reach this router could do
// every one of these things -- approve withdrawals, rewrite settings, run
// jobs. Splitting them is what makes a sales agent or an inventory admin
// safe to create.
export const adminRoutes = new Hono();
adminRoutes.use("*", requireAuth, requireAdmin);

adminRoutes.get("/users", requirePermission("users.read"), (c) => {
  const { role, status } = c.req.query();
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(adminService.listUsers({ role, status, limit, offset }));
});

adminRoutes.patch("/users/:id/status", requirePermission("users.write"), async (c) => {
  const { status } = await c.req.json();
  return c.json(adminService.setUserStatus(c.req.param("id"), status, c.get("userId")));
});

// Changing what an admin may do is the one thing no sub-admin scope can
// reach -- not even USERS_ADMIN. Only root holds `admins.manage`, which is
// what makes "only root admins create admins and assign privileges" a fact
// about the API rather than a convention in the UI.
adminRoutes.patch("/users/:id/role", requirePermission("admins.manage"), async (c) => {
  const body = await c.req.json();
  return c.json(
    adminService.setUserRole(
      c.req.param("id"),
      body.role,
      c.get("userId"),
      body.staff_scopes ?? body.staff_role ?? null
    )
  );
});

adminRoutes.post("/admins", requirePermission("admins.manage"), async (c) => {
  const body = await c.req.json();
  const admin = await adminService.createAdmin(
    { email: body.email, password: body.password, name: body.name, staffRole: body.staff_scopes ?? body.staff_role },
    c.get("userId")
  );
  return c.json(admin, 201);
});

// The role -> permission matrix, so the admin UI doesn't have to duplicate it.
adminRoutes.get("/roles", requirePermission("users.read"), (c) => c.json({ roles: adminService.roleCatalogue() }));

// One person's place in the referral network: who sponsors them, and the
// tree beneath them, for every product they have joined.
adminRoutes.get("/users/:id/network", requirePermission("network.read_all"), (c) =>
  c.json(adminService.userNetwork(c.req.param("id"), { maxDepth: Number(c.req.query("depth") || 8) }))
);

// Runtime site configuration. Returns values alongside their defaults and
// metadata so the admin UI can render an editor without hardcoding the list.
adminRoutes.get("/settings", requirePermission("settings.read"), (c) => c.json({ settings: settingsService.adminConfig() }));

// A patch made up only of seo_* keys needs just `seo.write`, so a
// CONTENT_ADMIN can maintain search metadata without being able to flip the
// site's feature flags. Anything else still needs `settings.write`.
adminRoutes.patch("/settings", async (c, next) => {
  const body = await c.req.json().catch(() => null);
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  const seoOnly = keys.length > 0 && keys.every((k) => k.startsWith("seo_"));
  return requirePermission(seoOnly ? "seo.write" : "settings.write")(c, next);
}, async (c) => {
  const body = await c.req.json();
  return c.json({ settings: settingsService.update(body, c.get("userId")) });
});

adminRoutes.post("/settings/:key/reset", requirePermission("settings.write"), (c) =>
  c.json({ settings: settingsService.reset(c.req.param("key"), c.get("userId")) })
);

// Outbound message queue: the drain job, plus visibility over what was sent
// and the ability to retry a failure.
adminRoutes.post("/jobs/send-due-notifications", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await jobsService.sendDueNotifications(body));
});

adminRoutes.get("/notifications", requirePermission("logs.read"), (c) => {
  const { status, channel } = c.req.query();
  const limit = Number(c.req.query("limit") || 100);
  const offset = Number(c.req.query("offset") || 0);
  return c.json({ notifications: notificationService.list({ status, channel, limit, offset }) });
});

adminRoutes.post("/notifications/:id/retry", requirePermission("jobs.run"), (c) =>
  c.json(notificationService.retry(c.req.param("id")))
);

adminRoutes.post("/jobs/queue-cheque-reminders", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(jobsService.queueChequeReminders(body));
});

adminRoutes.post("/jobs/recalculate-activity", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(jobsService.recalculateActivityPeriods(body));
});

adminRoutes.post("/jobs/release-commissions", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(jobsService.releaseCommissions(body));
});

adminRoutes.post("/jobs/run-all", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(jobsService.runAll(body));
});

// Rank/leadership bonus pool jobs -- run per-product on a monthly-ish
// cadence, so triggered individually rather than folded into run-all.
adminRoutes.post("/jobs/fund-rank-pool", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json();
  return c.json(jobsService.fundRankPool({ productId: body.product_id, periodStart: body.period_start, periodEnd: body.period_end }));
});

adminRoutes.post("/jobs/distribute-rank-bonuses", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json();
  return c.json(jobsService.distributeRankBonuses({ periodId: body.period_id }));
});

adminRoutes.post("/jobs/release-rank-bonuses", requirePermission("jobs.run"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(jobsService.releaseRankBonuses(body));
});

// --- Network payouts -------------------------------------------------------
//
// What the company owes the people in its networks, and a record of handing
// it over. Nothing here moves money: this business pays its network in person
// the same way it takes payment for a device, so the system's job is to be
// the authority on who is owed what, not to pretend it is a bank.
//
// Behind money.read / money.write rather than network.*: this is the payroll
// of the affiliate programme, and it belongs to the finance scope.

adminRoutes.get("/payouts", requirePermission("money.read"), (c) =>
  c.json(payoutService.sheet({ productId: c.req.query("product_id") || null }))
);

adminRoutes.get("/payouts/history", requirePermission("money.read"), (c) =>
  c.json({
    payments: payoutService.history({
      limit: Math.min(Number(c.req.query("limit") || 100), 500),
      offset: Number(c.req.query("offset") || 0),
    }),
  })
);

adminRoutes.get("/payouts/:userId", requirePermission("money.read"), (c) =>
  c.json(payoutService.detail(c.req.param("userId"), { productId: c.req.query("product_id") || null }))
);

adminRoutes.post("/payouts/:userId/settle", requirePermission("money.write"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(
    payoutService.settle({
      userId: c.req.param("userId"),
      // The amount the admin had on screen when they counted out the cash.
      // Required, and checked against the live total, so a sale or a refund
      // landing mid-payment cannot settle a different number than the one
      // that was actually paid.
      expectedCents: body.expected_cents,
      method: body.method,
      reference: body.reference,
      note: body.note,
      productId: body.product_id || null,
      actorUserId: c.get("userId"),
    })
  );
});
