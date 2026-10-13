import { Hono } from "hono";
import { requireAuth, requirePermission, can } from "../middleware/auth.js";
import { chequeService } from "../services/chequeService.js";

// Cheque register, staff side. Creation lives on the order it belongs to
// (POST /admin/orders/:id/cheques); everything here operates on a cheque
// that already exists.
export const chequeRoutes = new Hono();
chequeRoutes.use("*", requireAuth);

chequeRoutes.get("/", requirePermission("cheques.read"), (c) => {
  const { status, due_before, due_after } = c.req.query();
  const limit = Number(c.req.query("limit") || 100);
  const offset = Number(c.req.query("offset") || 0);
  return c.json({ cheques: chequeService.list({ status, dueBefore: due_before, dueAfter: due_after, limit, offset }) });
});

chequeRoutes.get("/mine", (c) => c.json({ cheques: chequeService.listMine(c.get("userId")) }));

chequeRoutes.get("/:id", requirePermission("cheques.read"), (c) => c.json(chequeService.get(c.req.param("id"))));

// The scan itself. Note the deliberate contrast with GET /products/:id/image,
// which is public and cached for a day: a cheque shows a bank account number,
// so this is owner-or-staff only and explicitly never stored by any cache.
chequeRoutes.get("/:id/image", (c) => {
  const image = chequeService.image(c.req.param("id"), {
    requesterUserId: c.get("userId"),
    canReadAll: can(c, "cheques.read"),
  });
  return c.body(image.bytes, 200, {
    "Content-Type": image.mime,
    "Cache-Control": "private, no-store",
  });
});

chequeRoutes.patch("/:id", requirePermission("cheques.write"), async (c) => {
  const body = await c.req.json();
  return c.json(chequeService.update(c.req.param("id"), body, c.get("userId")));
});

// Recording what the bank did. Clearing updates the order's collected total;
// bouncing notifies the customer and leaves the sale alone -- unwinding a
// default is a decision an admin makes through the refund route, not an
// automatic consequence.
chequeRoutes.post("/:id/status", requirePermission("cheques.write"), async (c) => {
  const { status } = await c.req.json();
  return c.json(chequeService.setStatus(c.req.param("id"), status, c.get("userId")));
});
