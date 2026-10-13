import { Hono } from "hono";
import { requireAuth, requireAdmin, requirePermission } from "../middleware/auth.js";
import { adminService } from "../services/adminService.js";
import { refundService } from "../services/refundService.js";
import { manualOrderService } from "../services/manualOrderService.js";
import { chequeService } from "../services/chequeService.js";

// Admin-only order (== transaction) management.
export const orderRoutes = new Hono();
orderRoutes.use("*", requireAuth, requireAdmin);

// Reading the order book and reversing a sale are different privileges: a
// sales agent needs the former to service their customers and must not have
// the latter, which moves money and claws back commission.

orderRoutes.get("/", requirePermission("orders.read_all"), (c) => {
  const { product_id, space_id, buyer_user_id, status } = c.req.query();
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(adminService.listOrders({ productId: product_id, spaceId: space_id, buyerUserId: buyer_user_id, status, limit, offset }));
});

orderRoutes.get("/:id", requirePermission("orders.read_all"), (c) => c.json(adminService.getOrder(c.req.param("id"))));

// POST /admin/orders/manual -- record a sale made in person.
//
// Mounted before /:id-shaped routes above it would shadow, and before the
// generic refund route. The customer must already have an account (the tree
// keys off user_id), so the flow is: find or create the user, then record the
// order against them.
orderRoutes.post("/manual", requirePermission("orders.create_manual"), async (c) => {
  const body = await c.req.json();
  const result = manualOrderService.create({
    userId: body.user_id,
    productId: body.product_id,
    redeemCode: body.redeem_code,
    discountCents: body.discount_cents || 0,
    amountReceivedCents: body.amount_received_cents,
    paymentTerms: body.payment_terms,
    cheques: body.cheques,
    note: body.note,
    overrideDownPayment: body.override_down_payment === true,
    quoteId: body.quote_id,
    actor: c.get("user"),
  });
  return c.json(result, 201);
});

// --- Cheque register -------------------------------------------------------
// Staff surfaces. The customer's own view of their cheques lives on
// /purchases/:id/cheques, which is owner-scoped.

orderRoutes.get("/:id/cheques", requirePermission("cheques.read"), (c) =>
  c.json(chequeService.listForOrder(c.req.param("id"), { requesterUserId: c.get("userId"), canReadAll: true }))
);

orderRoutes.post("/:id/cheques", requirePermission("cheques.write"), async (c) => {
  const body = await c.req.json();
  return c.json(chequeService.create(c.req.param("id"), body, c.get("userId")), 201);
});

// POST /admin/orders/:id/refund -- refunds the buyer, claws back the
// upline commissions and the reserve cut proportionally, and records the
// refunded amount on the transaction.
//
// It deliberately does NOT rewrite the sale's booked margin/payout/trex_net:
// those stay as an audit record of what happened at sale time, and whether
// the warehouse cost is recoverable on a return is a commercial question
// this service can't answer. Reports therefore carry total_refunded_cents
// alongside total_trex_net_cents so the two are always read together.
orderRoutes.post("/:id/refund", requirePermission("orders.refund"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = refundService.refund({
    transactionId: c.req.param("id"),
    amountCents: body.amount_cents,
    actorUserId: c.get("userId"),
    reason: body.reason,
  });
  return c.json(result);
});
