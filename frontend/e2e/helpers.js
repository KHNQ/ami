import { expect } from "@playwright/test";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, ADMIN_URL } from "../playwright.config.js";

let counter = 0;
export function uniqueEmail(prefix = "e2e") {
  counter += 1;
  return `${prefix}${Date.now()}_${counter}@e2e.local`;
}

// Signs a brand new user up through the real UI (not the API) so every spec
// that needs "a logged-in user" exercises the signup form at least once.
export async function signupNewUser(page, { name = "E2E User", password = "password123" } = {}) {
  const email = uniqueEmail();
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  return { email, password, name };
}

export async function login(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  // The storefront's login card says "Login"; the admin console's says
  // "Sign in". Both are the one submit button of their form.
  await page.getByRole("button", { name: /^(sign in|login)$/i }).click();
  await expect(page).toHaveURL("/");
}

export async function loginAsAdmin(page) {
  await login(page, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
}

/**
 * Signs in to the admin console, which is a SEPARATE app on its own origin.
 *
 * `loginAsAdmin` above authenticates against the storefront; it does not give
 * you an admin session in admin/, because the two apps do not share an origin
 * and therefore do not share the stored token.
 */
export async function loginToAdminApp(page) {
  await page.goto(ADMIN_URL + "/");
  await page.getByLabel("Email").fill(SEED_ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(SEED_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for something that only exists once signed in, not for a URL glob:
  // the console lives at "/" both before and after login, so `waitForURL`
  // matched instantly and let the next navigation run against a page that was
  // still unauthenticated -- which simply bounced back to this form.
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible({ timeout: 15_000 });
}

export async function logout(page) {
  await page.goto("/profile");
  await page.getByRole("button", { name: /sign out|log out/i }).click();
}
