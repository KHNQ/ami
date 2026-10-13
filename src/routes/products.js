import { Hono } from "hono";
import { requireAuth, optionalAuth, requirePermission, can } from "../middleware/auth.js";
import { productService } from "../services/productService.js";
import { commissionPlanService } from "../services/commissionPlanService.js";
import { Errors } from "../lib/errors.js";

export const productRoutes = new Hono();

// Public browsing -- this is the storefront, no auth required to look.
//
// optionalAuth rather than no auth: anonymous and ordinary callers get
// productService.publicView, which drops the warehouse cost and (when
// show_prices is off) the list price. Admins get the full row, because the
// product management screens read cost and price from these same endpoints.
productRoutes.get("/", optionalAuth, (c) => {
  const status = c.req.query("status");
  const category = c.req.query("category");
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  const opts = { status, category, limit, offset };
  // Full row (incl. warehouse cost) only for staff who may see cost.
  return c.json(can(c, "catalogue.read_cost") ? productService.list(opts) : productService.listPublic(opts));
});

// Which categories currently have products in them. Public -- it is the
// storefront's own navigation.
//
// MUST stay above the /:id route below: registered after it, Hono would match
// "categories" as a product id and this would 404.
productRoutes.get("/categories", (c) => c.json({ categories: productService.categories() }));

productRoutes.get("/:id", optionalAuth, (c) => {
  const id = c.req.param("id");
  const product = can(c, "catalogue.read_cost") ? productService.get(id) : productService.getPublic(id);
  let plan = null;
  try {
    plan = commissionPlanService.get(product.id);
  } catch {
    /* no plan yet */
  }
  return c.json({ ...product, commission_plan: plan });
});

// Admin-only: this is the per-unit purchase cost, i.e. exactly what the
// company pays its suppliers. It was public, which handed any visitor the
// margin on every device. Nothing but the admin product pages has ever read
// it, so restricting it costs nothing and closes a real commercial leak.
productRoutes.get("/:id/warehouse-cost", requireAuth, requirePermission("catalogue.read_cost"), (c) => {
  return c.json(productService.warehouseCostHistory(c.req.param("id")));
});

// Real image bytes, so the JSON responses don't have to carry a ~120KB
// base64 blob per product. Public and long-cached: this is storefront art,
// and it only changes when an admin uploads a replacement (which changes
// the ETag). Also what og:image / structured data point at -- crawlers
// can't fetch a data: URI.
productRoutes.get("/:id/image", (c) => {
  const image = productService.image(c.req.param("id"));
  if (!image) throw Errors.notFound("This product has no image", "no_image");
  if (c.req.header("if-none-match") === image.etag) return c.body(null, 304);
  return c.body(image.bytes, 200, {
    "Content-Type": image.mime,
    "Cache-Control": "public, max-age=86400",
    ETag: image.etag,
  });
});

productRoutes.post("/", requireAuth, requirePermission("catalogue.write"), async (c) => {
  const body = await c.req.json();
  const product = productService.create({ ...body, leaseRules: body.lease_rules ?? body.leaseRules }, c.get("userId"));
  return c.json(product, 201);
});

productRoutes.patch("/:id", requireAuth, requirePermission("catalogue.write"), async (c) => {
  const body = await c.req.json();
  return c.json(productService.update(c.req.param("id"), body, c.get("userId")));
});

productRoutes.patch("/:id/price", requireAuth, requirePermission("catalogue.write"), async (c) => {
  const { y_cents } = await c.req.json();
  return c.json(productService.updatePrice(c.req.param("id"), y_cents, c.get("userId")));
});

productRoutes.patch("/:id/status", requireAuth, requirePermission("catalogue.write"), async (c) => {
  const { status } = await c.req.json();
  return c.json(productService.setStatus(c.req.param("id"), status, c.get("userId")));
});

productRoutes.post("/:id/warehouse-cost", requireAuth, requirePermission("catalogue.write"), async (c) => {
  const { x_cents } = await c.req.json();
  return c.json(productService.appendWarehouseCost(c.req.param("id"), x_cents, c.get("userId")), 201);
});

productRoutes.patch("/:id/stock", requireAuth, requirePermission("catalogue.write"), async (c) => {
  const { delta } = await c.req.json();
  return c.json(productService.adjustStock(c.req.param("id"), delta, c.get("userId")));
});
