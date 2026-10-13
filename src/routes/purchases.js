import { Hono } from "hono";
import { requireAuth, can } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireFeature } from "../middleware/featureFlag.js";
import { purchaseService } from "../services/purchaseService.js";
import { chequeService } from "../services/chequeService.js";
import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

export const purchaseRoutes = new Hono();
purchaseRoutes.use("*", requireAuth);

const purchaseLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: "purchases:create" });

// Gated on the online_purchase_enabled flag: when the company wants walk-in
// sales only, the storefront swaps the buy button for a "Visit us" panel and
// this endpoint refuses outright. Only self-service buying is affected --
// an admin recording a walk-in via POST /admin/orders/manual is a separate
// route and stays available.
const requireOnlinePurchasing = requireFeature("online_purchase_enabled", {
  code: "online_purchase_disabled",
  message: "Online purchasing is currently unavailable. Please contact us to place an order.",
});

// POST /purchases { product_id, redeem_code?, discount_cents? }
// Runs the full flow: validate code (or create space), create Node,
// create Transaction, run distribute_commission, return receipt.
purchaseRoutes.post("/", requireOnlinePurchasing, purchaseLimiter, async (c) => {
  const body = await c.req.json();
  const result = purchaseService.buy({
    userId: c.get("userId"),
    productId: body.product_id,
    redeemCode: body.redeem_code,
    discountCents: body.discount_cents || 0,
  });
  return c.json(result, 201);
});

purchaseRoutes.get("/", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(db.transactions.list({ buyerUserId: c.get("userId"), limit, offset }));
});

purchaseRoutes.get("/:id", (c) => {
  const tx = db.transactions.get(c.req.param("id"));
  if (!tx) throw Errors.notFound("Transaction not found");
  if (tx.buyer_user_id !== c.get("userId") && !can(c, "orders.read_all")) {
    throw Errors.forbidden("You do not have access to this transaction");
  }
  return c.json({ ...tx, ledger_entries: db.ledger.listByTransaction(tx.id) });
});

// A customer's own view of the cheques backing one of their orders. Same
// service call the admin surface makes, with canReadAll off so the ownership
// check inside actually bites.
purchaseRoutes.get("/:id/cheques", (c) =>
  c.json(
    chequeService.listForOrder(c.req.param("id"), {
      requesterUserId: c.get("userId"),
      canReadAll: can(c, "cheques.read"),
    })
  )
);
