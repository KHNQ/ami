import { Hono } from "hono";
import { requireAuth, requireAdmin, requirePermission } from "../middleware/auth.js";
import { adminService } from "../services/adminService.js";
import { reportService } from "../services/reportService.js";

// Full monitoring surface for any section (admin only): live overview plus
// the financial reporting endpoints from Section 9/10.
export const monitoringRoutes = new Hono();
monitoringRoutes.use("*", requireAuth, requireAdmin, requirePermission("reports.read"));

monitoringRoutes.get("/overview", (c) => c.json(adminService.monitoringOverview()));

monitoringRoutes.get("/reports/trex-net", (c) => {
  const { product_id, space_id, from, to } = c.req.query();
  return c.json(reportService.trexNetSummary({ productId: product_id, spaceId: space_id, fromDate: from, toDate: to }));
});

monitoringRoutes.get("/reports/reserve-fund", (c) => c.json(reportService.reserveFundSummary()));

monitoringRoutes.get("/reports/audit-invariants", (c) => c.json(reportService.auditInvariants()));

monitoringRoutes.get("/reports/rank-bonus-periods", (c) => {
  const { product_id } = c.req.query();
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(reportService.rankBonusPeriods(product_id, { limit, offset }));
});

monitoringRoutes.get("/reports/rank-bonus-periods/:id", (c) => c.json(reportService.rankBonusPeriodDetail(c.req.param("id"))));
