import { Hono } from "hono";
import { authService } from "../services/authService.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireFeature } from "../middleware/featureFlag.js";

export const authRoutes = new Hono();

// Closing public registration must not lock out people who already have an
// account, so this gates signup only -- login, password reset and /me are
// untouched.
const requireOpenSignup = requireFeature("signup_enabled", {
  code: "signup_disabled",
  message: "New registrations are currently closed. Please contact us if you need an account.",
});

// Brute-force / credential-stuffing guard: these are all unauthenticated
// endpoints that take a password (or gate access to setting one).
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: "auth:signup" });
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: "auth:login" });
const forgotPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: "auth:forgot-password" });
const resetPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: "auth:reset-password" });
// Verification links are consumed once and are unguessable, so this budget is
// about stopping a flood of garbage tokens burning CPU, not about guessing.
const verifyEmailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: "auth:verify-email" });
// Resend is a mail-sending endpoint tied to a real account -- kept deliberately
// tight so it cannot be turned into a way to spam somebody's inbox.
const resendVerificationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "auth:resend-verification" });

authRoutes.post("/signup", requireOpenSignup, signupLimiter, async (c) => {
  const body = await c.req.json();
  const result = await authService.signup(body);
  return c.json(result, 201);
});

authRoutes.post("/login", loginLimiter, async (c) => {
  const body = await c.req.json();
  const result = await authService.login(body);
  return c.json(result);
});

authRoutes.get("/me", requireAuth, (c) => {
  return c.json(authService.me(c.get("userId")));
});

authRoutes.post("/forgot-password", forgotPasswordLimiter, async (c) => {
  const result = await authService.forgotPassword(await c.req.json());
  return c.json(result);
});

authRoutes.post("/reset-password", resetPasswordLimiter, async (c) => {
  const result = await authService.resetPassword(await c.req.json());
  return c.json(result);
});

// Anonymous on purpose: the link lands in an email client that has no session,
// and requiring sign-in first would make the most common path (open mail on a
// phone, tap link) fail for anyone not already logged in on that device.
authRoutes.post("/verify-email", verifyEmailLimiter, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(authService.verifyEmail({ token: body.token }));
});

authRoutes.post("/resend-verification", resendVerificationLimiter, requireAuth, async (c) => {
  return c.json(await authService.resendVerification(c.get("userId")));
});
