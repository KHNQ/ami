import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { authService } from "../services/authService.js";
import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";

export const profileRoutes = new Hono();
profileRoutes.use("*", requireAuth);

profileRoutes.get("/", (c) => {
  return c.json(authService.me(c.get("userId")));
});

profileRoutes.patch("/", async (c) => {
  const { name, phone } = await c.req.json();
  if (name !== undefined && !name) throw Errors.badRequest("name cannot be empty");
  if (name === undefined && phone === undefined) throw Errors.badRequest("name or phone is required");
  // Phone is optional and clearable (explicit null), and is what cheque
  // reminders are sent to when present.
  const updated = db.users.updateProfile(c.get("userId"), {
    ...(name !== undefined ? { name } : {}),
    ...(phone !== undefined ? { phone: phone ? String(phone).trim().slice(0, 40) : null } : {}),
  });
  return c.json(authService.publicUser(updated));
});

profileRoutes.patch("/password", async (c) => {
  const { current_password, new_password } = await c.req.json();
  const result = await authService.changePassword({
    userId: c.get("userId"),
    currentPassword: current_password,
    newPassword: new_password,
  });
  return c.json(result);
});

profileRoutes.delete("/", async (c) => {
  const { password } = await c.req.json();
  const result = await authService.deleteAccount({ userId: c.get("userId"), password });
  return c.json(result);
});
