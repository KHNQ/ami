import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { walletService } from "../services/walletService.js";

// Read-only. Top-ups and withdrawals were removed: this business collects
// payment and pays its network in person, and the system's job is to record
// what is owed (see /admin/payouts), not to move money itself.
export const walletRoutes = new Hono();
walletRoutes.use("*", requireAuth);

walletRoutes.get("/", (c) => c.json(walletService.getWallet(c.get("userId"))));

walletRoutes.get("/ledger", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const offset = Number(c.req.query("offset") || 0);
  return c.json(walletService.listLedger(c.get("userId"), { limit, offset }));
});
