import { Hono } from "hono";
import { requireAuth, can } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { redeemCodeService } from "../services/redeemCodeService.js";

export const redeemCodeRoutes = new Hono();

// Unauthenticated + keyspace is guessable-in-principle, so this is the one
// endpoint here most worth throttling against brute-force code enumeration.
const validateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: "redeem:validate" });

// Generating/listing/revoking your own codes requires auth; validating a
// code you were handed does not (you might not have an account yet).
redeemCodeRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.json();
  const code = redeemCodeService.generate({
    userId: c.get("userId"),
    productId: body.product_id,
    maxUses: body.max_uses,
    expiresAt: body.expires_at,
  });
  return c.json(code, 201);
});

redeemCodeRoutes.get("/mine", requireAuth, (c) => {
  const productId = c.req.query("product_id");
  return c.json(redeemCodeService.listMine(c.get("userId"), productId));
});

redeemCodeRoutes.get("/:code", validateLimiter, (c) => c.json(redeemCodeService.validate(c.req.param("code"))));

redeemCodeRoutes.post("/:id/revoke", requireAuth, (c) =>
  c.json(redeemCodeService.revoke(c.req.param("id"), c.get("userId"), can(c, "network.write")))
);
