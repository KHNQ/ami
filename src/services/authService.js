import { isValidEmail } from "../lib/validation.js";
import { db } from "../db/index.js";
import { hashPassword, verifyPassword, signToken } from "../lib/auth.js";
import { newResetToken, hashResetToken } from "../lib/resetToken.js";
import { Errors } from "../lib/errors.js";
import { config } from "../config.js";
import { emailService } from "./emailService.js";
import { ROOT, staffRoleOf, permissionsFor } from "../lib/permissions.js";

function publicUser(u) {
  // staff_role and permissions ride along so a client can render the right
  // navigation without hardcoding the role map -- and so the admin app can
  // hide surfaces the API would refuse anyway. The API is still the
  // authority; this is presentation.
  const staffRole = staffRoleOf(u);
  return {
    email_verified: Boolean(u.email_verified_at),
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone || null,
    role: u.role,
    staff_role: staffRole,
    permissions: permissionsFor(staffRole),
    status: u.status,
    created_at: u.created_at,
  };
}

export const authService = {
  async signup({ email, password, name }) {
    if (!email || !password || !name) throw Errors.badRequest("email, password, and name are required");
    if (typeof password !== "string" || typeof name !== "string") {
      throw Errors.badRequest("email, password, and name must be text");
    }
    if (!isValidEmail(email)) throw Errors.badRequest("email is not a valid address", "invalid_email");
    if (password.length < 8) throw Errors.badRequest("password must be at least 8 characters");
    const existing = db.users.findByEmail(email);
    if (existing) throw Errors.conflict("An account with this email already exists", "email_taken");

    const passwordHash = await hashPassword(password);
    const user = db.users.create({ email, passwordHash, name });
    db.wallet.ensureAccount(user.id);
    db.logs.record({ actorUserId: user.id, action: "user.signup", entityType: "user", entityId: user.id });

    const token = await signToken({ sub: user.id, role: user.role, tv: user.token_version });

    // Minting the token is local work (one insert); SENDING it is a network
    // call to Resend. Only the first is on the critical path, so the two are
    // separated: a signup must never wait on -- or be coupled to the
    // availability of -- a third-party mail provider.
    //
    // This previously awaited the send, despite a comment claiming otherwise.
    // The .catch() meant a provider outage could not fail the request, but it
    // could still make every signup hang for as long as Resend took to
    // answer, and it showed up as a measurable slowdown under load.
    const verification = this.issueVerificationToken(user);

    this.deliverVerificationEmail(user, verification).catch((err) => {
      console.warn(`[auth] verification email failed for ${user.id}: ${err}`);
    });

    const out = { user: publicUser(user), token };
    // Outside production the link is echoed back so the flow is testable
    // without a mail provider -- same convention as forgotPassword above.
    if (!config.isProduction() && verification?.link) out.debug_verification_link = verification.link;
    return out;
  },

  /**
   * Issues a fresh email-verification link.
   *
   * Link-based, not an OTP: a code has to be typed, which means it has to be
   * short, which means it needs its own rate limiting and lockout to resist
   * guessing. A 256-bit link in the inbox proves the same thing -- control of
   * the address -- with no guessing surface at all.
   */
  /** Mints a verification link. Local work only -- no network. */
  issueVerificationToken(user) {
    if (!user) throw Errors.notFound("User not found");
    if (user.email_verified_at) return null;

    const rawToken = newResetToken();
    const expiresAt = new Date(Date.now() + config.emailVerificationTtlHours * 3600_000).toISOString();

    db.transaction(() => {
      // Only one live token at a time, so a "resend" cannot leave several
      // valid links scattered across an inbox.
      db.emailVerifications.revokeActiveForUser(user.id);
      db.emailVerifications.create({ userId: user.id, tokenHash: hashResetToken(rawToken), expiresAt });
    });

    return { link: `${config.frontendBaseUrl}/verify-email?token=${rawToken}`, expiresAt };
  },

  /** Sends an already-minted link. Network -- never on a response's path. */
  async deliverVerificationEmail(user, verification) {
    if (!verification?.link) return { sent: false };
    return emailService.send({
      to: user.email,
      subject: `Confirm your email for ${config.companyName}`,
      text:
        `Hi ${user.name}, please confirm your email address by opening this link:\n\n${verification.link}\n\n` +
        `The link is valid for ${config.emailVerificationTtlHours} hours. ` +
        `If you did not create an account, you can ignore this message.`,
    });
  },

  /** Both halves, for callers that genuinely want to wait (see resend). */
  async sendVerificationEmail(user) {
    const verification = this.issueVerificationToken(user);
    if (!verification) return { alreadyVerified: true };
    await this.deliverVerificationEmail(user, verification);
    return verification;
  },

  /** Consumes a verification link. */
  verifyEmail({ token }) {
    if (!token) throw Errors.badRequest("token is required");
    const record = db.emailVerifications.findByHash(hashResetToken(token));

    // One generic failure for missing / expired / already-used, so a stolen
    // link cannot be used to probe which state it is in.
    if (!record || record.used_at || new Date(record.expires_at) <= new Date()) {
      throw Errors.badRequest("This verification link is invalid or has expired", "invalid_verification_token");
    }

    // markUsed is guarded on `used_at IS NULL`, so two concurrent clicks
    // produce exactly one winner rather than two "verified" writes.
    const won = db.emailVerifications.markUsed(record.id);
    if (!won) throw Errors.badRequest("This verification link has already been used", "invalid_verification_token");

    db.users.markEmailVerified(record.user_id);
    db.logs.record({
      actorUserId: record.user_id,
      action: "user.email_verified",
      entityType: "user",
      entityId: record.user_id,
    });

    const user = db.users.findById(record.user_id);
    return { message: "Your email address has been confirmed.", user: publicUser(user) };
  },

  /** Resend, for someone who lost the first mail. */
  async resendVerification(userId) {
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    if (user.email_verified_at) return { message: "Your email address is already confirmed." };
    const result = await this.sendVerificationEmail(user);
    const out = { message: "We've sent you a new confirmation link." };
    if (!config.isProduction() && result?.link) out.debug_verification_link = result.link;
    return out;
  },

  async login({ email, password }) {
    if (!email || !password) throw Errors.badRequest("email and password are required");
    const user = db.users.findByEmail(email);
    if (!user) throw Errors.unauthorized("Invalid email or password", "invalid_credentials");
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw Errors.unauthorized("Invalid email or password", "invalid_credentials");
    if (user.status !== "active") throw Errors.forbidden("Account is not active", "account_inactive");

    const token = await signToken({ sub: user.id, role: user.role, tv: user.token_version });
    db.logs.record({ actorUserId: user.id, action: "user.login", entityType: "user", entityId: user.id });
    return { user: publicUser(user), token };
  },

  me(userId) {
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    return publicUser(user);
  },

  // PATCH /profile/password -- requires the current password (unlike the
  // forgot/reset flow, which is for when you can't provide it). Distinct
  // from resetPassword: this always requires an authenticated session.
  async changePassword({ userId, currentPassword, newPassword }) {
    if (!currentPassword || !newPassword) {
      throw Errors.badRequest("currentPassword and newPassword are required");
    }
    if (newPassword.length < 8) throw Errors.badRequest("newPassword must be at least 8 characters");

    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) throw Errors.unauthorized("Current password is incorrect", "invalid_credentials");

    const passwordHash = await hashPassword(newPassword);
    const updated = db.users.updatePassword(userId, passwordHash);
    db.logs.record({ actorUserId: userId, action: "user.password_changed", entityType: "user", entityId: userId });

    // updatePassword bumps token_version, which retires every session --
    // including this one. Hand back a token minted at the new version so
    // the caller who just proved their current password stays signed in
    // while every *other* device is logged out. That asymmetry is the whole
    // point: changing your password should evict whoever else is holding a
    // token, not evict you.
    const token = await signToken({ sub: updated.id, role: updated.role, tv: updated.token_version });
    return { message: "Password changed.", token };
  },

  // DELETE /profile -- self-service soft delete, gated behind the current
  // password (same bar as changing it) so a hijacked-but-not-logged-out
  // session token alone can't nuke the account. The user row is never
  // actually removed -- transactions/wallet/commission history FK to it --
  // instead the email is anonymized (freeing the original address for a
  // fresh signup) and status flips to 'banned', which the existing login
  // check already rejects.
  async deleteAccount({ userId, password }) {
    if (!password) throw Errors.badRequest("password is required");
    const user = db.users.findById(userId);
    if (!user) throw Errors.notFound("User not found");
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw Errors.unauthorized("Password is incorrect", "invalid_credentials");

    // The same rule setUserRole enforces for demotion: if this is the last root
    // admin, nobody is left who can create admins or change anyone's access, and
    // nothing short of hand-editing the database can fix that. Deleting yourself
    // is demotion by another door.
    if (staffRoleOf(user) === ROOT && db.users.countRootAdmins() <= 1) {
      throw Errors.badRequest(
        "This is the last root admin -- promote another root admin before deleting this account",
        "last_root_admin"
      );
    }

    const anonymizedEmail = `deleted-${userId}@deleted.local`;
    db.users.markDeleted(userId, anonymizedEmail);
    db.logs.record({ actorUserId: userId, action: "user.account_deleted", entityType: "user", entityId: userId });
    return { message: "Account deleted." };
  },

  // POST /auth/forgot-password -- always returns the same generic shape
  // regardless of whether the email exists, so the response itself never
  // reveals which accounts are real (no user-enumeration via this endpoint).
  async forgotPassword({ email }) {
    if (!email) throw Errors.badRequest("email is required");
    const generic = { message: "If an account exists for that email, a password reset link has been sent." };

    const user = db.users.findByEmail(email);
    // Hash something regardless of which branch we're in, so the dominant
    // CPU cost is roughly equalized between "found" and "not found" --
    // doesn't fully close the timing side-channel (the found branch still
    // does extra DB writes below), but narrows it, and the rate limiter on
    // this route is the practical backstop either way.
    const rawToken = newResetToken();
    const tokenHash = hashResetToken(rawToken);

    if (!user) return generic;

    const expiresAt = new Date(Date.now() + config.passwordResetTokenTtlMinutes * 60_000).toISOString();
    db.transaction(() => {
      db.passwordResets.revokeActiveForUser(user.id);
      db.passwordResets.create({ userId: user.id, tokenHash, expiresAt });
      db.logs.record({ actorUserId: user.id, action: "user.password_reset_requested", entityType: "user", entityId: user.id });
    });

    const resetLink = `${config.frontendBaseUrl}/reset-password?token=${rawToken}`;
    try {
      await emailService.sendPasswordReset(user.email, resetLink);
    } catch (err) {
      // A failed send must never change the response -- that would leak
      // account existence via timing/shape. Log for admin visibility and
      // fall through to the same generic response either way.
      db.logs.record({
        actorUserId: user.id,
        action: "user.password_reset_email_failed",
        entityType: "user",
        entityId: user.id,
        meta: { error: String(err) },
      });
    }

    if (!config.isProduction()) return { ...generic, debug_token: rawToken, debug_reset_link: resetLink };
    return generic;
  },

  // POST /auth/reset-password
  async resetPassword({ token, new_password }) {
    if (!token || !new_password) throw Errors.badRequest("token and new_password are required");
    if (new_password.length < 8) throw Errors.badRequest("password must be at least 8 characters");

    const record = db.passwordResets.findByHash(hashResetToken(token));
    // Same generic error whether the token is missing, expired, or already
    // used -- no signal about which, so a stolen/guessed token can't be
    // used to probe token state.
    if (!record || record.status !== "active" || new Date(record.expires_at) <= new Date()) {
      throw Errors.badRequest("This reset link is invalid or has expired", "invalid_reset_token");
    }

    // Only reached once a valid token is confirmed -- the cheap sha256
    // lookup above gates this, so garbage-token spam never pays bcrypt's cost.
    const passwordHash = await hashPassword(new_password);
    db.transaction(() => {
      db.users.updatePassword(record.user_id, passwordHash);
      db.passwordResets.markUsed(record.id);
      db.passwordResets.revokeActiveForUser(record.user_id);
      db.logs.record({ actorUserId: record.user_id, action: "user.password_reset_completed", entityType: "user", entityId: record.user_id });
    });

    return { message: "Password has been reset. You can now sign in with your new password." };
  },

  publicUser,
};
