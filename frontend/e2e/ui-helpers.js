import { expect } from "@playwright/test";
import { ADMIN_URL, API_URL, BASE_URL } from "../playwright.config.js";

export { ADMIN_URL, API_URL, BASE_URL };

/**
 * Collects everything a user would experience as "broken" on a page: uncaught
 * errors, console errors and failed requests. `check()` fails the test with the
 * list. Nothing is silently ignored except what a caller names in `allow`, so
 * an expected failure (the assistant being switched off, say) is documented at
 * the call site instead of hidden in here.
 */
export function watch(page, { allow = [] } = {}) {
  const problems = [];
  const keep = (text) => !allow.some((re) => re.test(text));
  const onConsole = (m) => {
    if (m.type() === "error" && keep(m.text())) problems.push(`console: ${m.text().slice(0, 240)}`);
  };
  const onPageError = (e) => {
    const text = String(e);
    if (keep(text)) problems.push(`pageerror: ${text.slice(0, 240)}`);
  };
  const onResponse = (r) => {
    if (r.status() < 400 || r.url().includes("favicon")) return;
    const text = `http ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`;
    if (keep(text)) problems.push(text);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  return {
    problems,
    check() {
      expect(problems, "console errors, uncaught exceptions or failed requests on the page").toEqual([]);
    },
    stop() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
    },
  };
}

/** Signs in to the admin console (a separate app and origin from the storefront). */
export async function adminLogin(page, { email, password }) {
  await page.goto(ADMIN_URL + "/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("aside, nav").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(email, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
}

/** Signs in to the storefront. */
export async function storeLogin(page, { email, password }) {
  await page.goto(BASE_URL + "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^(sign in|login)$/i }).click();
  await expect(page).toHaveURL(BASE_URL + "/", { timeout: 30_000 });
}

/** Direct API read, authorised as `token`, for asserting what the UI actually changed. */
export async function apiGet(path, token) {
  const res = await fetch(API_URL + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function apiSend(method, path, body, token) {
  const res = await fetch(API_URL + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
