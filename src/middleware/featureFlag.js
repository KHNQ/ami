import { settingsService } from "../services/settingsService.js";
import { Errors } from "../lib/errors.js";

// Enforces an admin-controlled feature flag at the edge of a route.
//
// The point of doing this in middleware rather than in the frontend is that a
// flag which only hides a button is not a flag at all -- the button is gone,
// the endpoint isn't, and anyone with curl or a stale tab carries on as
// before. Disabled features have to be refused by the API.
//
// There is deliberately no admin bypass. Admin-side equivalents of gated
// actions live on their own routes (e.g. an admin records a walk-in sale via
// POST /admin/orders/manual, which is not gated by online_purchase_enabled),
// so a bypass here would only ever serve to weaken the switch.
export function requireFeature(key, { code, message }) {
  return async function featureFlagMiddleware(c, next) {
    if (!settingsService.isEnabled(key)) {
      throw Errors.forbidden(message, code);
    }
    await next();
  };
}
