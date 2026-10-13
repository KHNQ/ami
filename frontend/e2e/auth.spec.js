import { test, expect } from "@playwright/test";
import { signupNewUser, login, logout, uniqueEmail } from "./helpers.js";

test.describe("Auth", () => {
  test("sign up, sign out, sign back in", async ({ page }) => {
    const { email, password, name } = await signupNewUser(page);
    await expect(page.getByText(name)).toBeVisible();

    await logout(page);
    await expect(page).toHaveURL(/\/(login)?$/);

    await login(page, email, password);
    await expect(page.getByText(name)).toBeVisible();
  });

  test("rejects an unknown login with a visible error, no navigation", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(uniqueEmail("nobody"));
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: /^(sign in|login)$/i }).click();
    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("forgot password shows a generic confirmation regardless of whether the email exists (dev debug link works end to end)", async ({
    page,
  }) => {
    const { email } = await signupNewUser(page);
    await logout(page);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    // Dev-mode fallback: no RESEND_API_KEY configured for the e2e backend,
    // so authService returns a debug_reset_link the UI surfaces directly.
    const resetLink = page.getByRole("link", { name: /reset-password\?token=/ });
    await expect(resetLink).toBeVisible();
    await resetLink.click();
    await expect(page).toHaveURL(/\/reset-password/);

    const newPassword = "brand-new-password-1";
    // `exact` matters: "New password" is a substring of "Confirm new
    // password", so a loose label match resolves to both inputs and Playwright
    // refuses under strict mode.
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: /reset password/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, email, newPassword);
  });

  test("same email cannot be used twice, same generic-looking form re-shown with an error", async ({ page }) => {
    const { email, password } = await signupNewUser(page);
    await logout(page);

    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Duplicate User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    // Asserted on the exact message rather than a loose regex: the page's
    // footer carries "Already have an account?", which a /already/ match also
    // hits, and two matches is a strict-mode failure rather than a pass.
    await expect(page.getByText("An account with this email already exists")).toBeVisible();
  });
});
