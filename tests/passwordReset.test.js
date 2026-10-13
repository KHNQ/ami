import { describe, test, expect, spyOn } from "bun:test";
import { db } from "../src/db/index.js";
import { authService } from "../src/services/authService.js";
import { emailService } from "../src/services/emailService.js";
import { hashResetToken } from "../src/lib/resetToken.js";
import { uniq } from "./helpers.js";

describe("Password reset", () => {
  test("happy path: request -> reset -> old password rejected, new password works", async () => {
    const email = `${uniq("pwreset")}@test.local`;
    await authService.signup({ email, password: "original-pw", name: "Reset Tester" });

    const requestRes = await authService.forgotPassword({ email });
    expect(requestRes.message).toBeTruthy();
    expect(requestRes.debug_token).toBeTruthy(); // NODE_ENV isn't "production" during tests

    const resetRes = await authService.resetPassword({ token: requestRes.debug_token, new_password: "brand-new-pw" });
    expect(resetRes.message).toBeTruthy();

    await expect(authService.login({ email, password: "original-pw" })).rejects.toThrow();
    const loginRes = await authService.login({ email, password: "brand-new-pw" });
    expect(loginRes.user.email).toBe(email.toLowerCase());

    const user = db.users.findByEmail(email);
    const record = db.passwordResets.findByHash(hashResetToken(requestRes.debug_token));
    expect(record.status).toBe("used");
    expect(record.user_id).toBe(user.id);
  });

  test("expired token is rejected", async () => {
    const email = `${uniq("pwreset")}@test.local`;
    await authService.signup({ email, password: "original-pw", name: "Reset Tester" });
    const user = db.users.findByEmail(email);

    const rawToken = "expired-raw-token-value";
    db.passwordResets.create({
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // already expired
    });

    await expect(authService.resetPassword({ token: rawToken, new_password: "whatever-new" })).rejects.toThrow(
      /invalid or has expired/
    );
  });

  test("an already-used token is rejected on a second attempt", async () => {
    const email = `${uniq("pwreset")}@test.local`;
    await authService.signup({ email, password: "original-pw", name: "Reset Tester" });

    const { debug_token } = await authService.forgotPassword({ email });
    await authService.resetPassword({ token: debug_token, new_password: "first-new-pw" });

    await expect(authService.resetPassword({ token: debug_token, new_password: "second-new-pw" })).rejects.toThrow(
      /invalid or has expired/
    );
  });

  test("a garbage/unknown token is rejected", async () => {
    await expect(
      authService.resetPassword({ token: "this-token-was-never-issued", new_password: "whatever-new" })
    ).rejects.toThrow(/invalid or has expired/);
  });

  test("requesting a reset for a nonexistent email doesn't throw or leak a token", async () => {
    const res = await authService.forgotPassword({ email: "nobody-at-all@test.local" });
    expect(res.message).toBeTruthy();
    expect(res.debug_token).toBeUndefined();
    expect(res.debug_reset_link).toBeUndefined();
  });

  test("actually attempts to send the reset email (not just console.log)", async () => {
    const email = `${uniq("pwreset")}@test.local`;
    await authService.signup({ email, password: "original-pw", name: "Reset Tester" });

    const spy = spyOn(emailService, "sendPasswordReset").mockResolvedValue({ sent: true });
    try {
      const res = await authService.forgotPassword({ email });
      expect(spy).toHaveBeenCalledTimes(1);
      const [toEmail, resetLink] = spy.mock.calls[0];
      expect(toEmail).toBe(email.toLowerCase());
      expect(resetLink).toContain(res.debug_token);
    } finally {
      spy.mockRestore();
    }
  });

  test("a failed email send still returns the generic response, never an error", async () => {
    const email = `${uniq("pwreset")}@test.local`;
    await authService.signup({ email, password: "original-pw", name: "Reset Tester" });

    const spy = spyOn(emailService, "sendPasswordReset").mockRejectedValue(new Error("provider down"));
    try {
      const res = await authService.forgotPassword({ email });
      expect(res.message).toBeTruthy();
      // Still succeeds end-to-end -- the token was created even though the
      // email failed, so the debug link (dev/test only) still works.
      const resetRes = await authService.resetPassword({ token: res.debug_token, new_password: "recovered-pw" });
      expect(resetRes.message).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  test("in production, found and not-found responses are byte-identical", async () => {
    const email = `${uniq("pwreset")}@test.local`;
    await authService.signup({ email, password: "original-pw", name: "Reset Tester" });

    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const foundRes = await authService.forgotPassword({ email });
      const notFoundRes = await authService.forgotPassword({ email: "still-nobody@test.local" });
      expect(foundRes).toEqual(notFoundRes);
      expect(Object.keys(foundRes)).toEqual(["message"]);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
