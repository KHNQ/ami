import { config } from "../config.js";

const RESEND_API_URL = "https://api.resend.com/emails";

// Thin wrapper over Resend's REST API (plain fetch -- this codebase
// deliberately keeps dependencies minimal, and Resend's send call is a
// single POST, so pulling in their full SDK isn't worth it). Callers should
// treat a rejected promise as "email did not go out" and decide for
// themselves whether that's fatal (see authService.forgotPassword, which
// swallows failures so a broken mail provider never leaks account
// existence via a differing error response).
export const emailService = {
  // Generic send, used by the notification queue. sendPasswordReset predates
  // it and stays as-is: it is called directly (not queued) because the reset
  // link has to reach the user while they are still sitting on the page, and
  // its failure handling is deliberately special (swallowed, to avoid leaking
  // account existence).
  async send({ to, subject, text, html }) {
    if (!config.resendApiKey) {
      console.log(`[email] (no RESEND_API_KEY set) to ${to} -- ${subject}: ${text || ""}`);
      return { sent: false };
    }
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [to],
        subject,
        ...(html ? { html } : { text }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend send failed: ${res.status} ${body}`);
    }
    return { sent: true };
  },

  async sendPasswordReset(toEmail, resetLink) {
    if (!config.resendApiKey) {
      // No provider configured -- dev/test fallback. Never reachable in
      // production (see config.js boot guard).
      console.log(`[email] (no RESEND_API_KEY set) password reset link for ${toEmail}: ${resetLink}`);
      return { sent: false };
    }

    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [toEmail],
        subject: "Reset your Trex password",
        html: `<p>We received a request to reset your Trex password.</p>
<p><a href="${resetLink}">${resetLink}</a></p>
<p>This link expires in ${config.passwordResetTokenTtlMinutes} minutes. If you didn't request this, you can ignore this email.</p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend send failed: ${res.status} ${body}`);
    }
    return { sent: true };
  },
};
