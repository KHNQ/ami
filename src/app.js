import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { walletRoutes } from "./routes/wallet.js";
import { productRoutes } from "./routes/products.js";
import { purchaseRoutes } from "./routes/purchases.js";
import { spaceRoutes } from "./routes/spaces.js";
import { redeemCodeRoutes } from "./routes/redeemCodes.js";
import { nodeRoutes } from "./routes/nodes.js";
import { commissionPlanRoutes } from "./routes/commissionPlans.js";
import { orderRoutes } from "./routes/orders.js";
import { adminRoutes } from "./routes/admin.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { supportRoutes } from "./routes/support.js";
import { logRoutes } from "./routes/logs.js";
import { siteConfigRoutes } from "./routes/siteConfig.js";
import { salesRoutes } from "./routes/sales.js";
import { chequeRoutes } from "./routes/cheques.js";
import { careerRoutes } from "./routes/careers.js";
import { aiDisabledRoutes } from "./routes/aiDisabled.js";
import { eventRoutes } from "./routes/events.js";
import { blogRoutes } from "./routes/blog.js";

// Loaded only when the assistant is switched on. A static import would pull in
// aiService, the agent loop, all 30-odd tools and the Exa client on every boot
// -- including the deployments that have the feature off and will never serve
// a single request from any of it. Top-level await is fine here: anything
// importing app.js waits for this to settle before it sees buildApp.
const aiRoutes = config.aiEnabled ? (await import("./routes/ai.js")).aiRoutes : null;

export function buildApp() {
  const app = new Hono();

  // Request logging everywhere except the test runner, where thousands of
  // in-process requests would bury the actual assertion output.
  if (process.env.NODE_ENV !== "test") app.use("*", logger());
  app.use("*", cors({ origin: config.corsOrigins }));
  app.use("*", secureHeaders());
  app.onError(errorHandler);

  app.get("/health", (c) => c.json({ ok: true, service: "trex-backend" }));

  app.route("/site-config", siteConfigRoutes);
  app.route("/auth", authRoutes);
  app.route("/profile", profileRoutes);
  app.route("/wallet", walletRoutes);
  app.route("/products", productRoutes);
  app.route("/purchases", purchaseRoutes);
  app.route("/spaces", spaceRoutes);
  app.route("/redeem-codes", redeemCodeRoutes);
  app.route("/nodes", nodeRoutes);
  app.route("/commission-plans", commissionPlanRoutes);
  app.route("/support", supportRoutes);
  app.route("/sales", salesRoutes);
  app.route("/cheques", chequeRoutes);
  app.route("/careers", careerRoutes);
  app.route("/ai", aiRoutes ?? aiDisabledRoutes);
  app.route("/events", eventRoutes);
  app.route("/blog", blogRoutes);

  // Admin surface, grouped under /admin/*.
  app.route("/admin/orders", orderRoutes);
  app.route("/admin", adminRoutes);
  app.route("/admin/monitoring", monitoringRoutes);
  app.route("/admin/logs", logRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such route" } }, 404));

  return app;
}
