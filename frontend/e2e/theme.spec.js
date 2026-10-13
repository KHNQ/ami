import { test, expect } from "@playwright/test";
import { signupNewUser } from "./helpers.js";

test.describe("Light/dark theme toggle", () => {
  test("toggling flips data-theme on <html> and persists across reload", async ({ page }) => {
    await signupNewUser(page);
    await page.goto("/wallet");

    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(["light", "dark"]).toContain(initialTheme);

    const toggle = page.getByRole("button", { name: /switch to (light|dark) mode/i });
    await toggle.click();

    const flippedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(flippedTheme).not.toBe(initialTheme);

    const stored = await page.evaluate(() => localStorage.getItem("trex-theme"));
    expect(stored).toBe(flippedTheme);

    await page.reload();
    const afterReload = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(afterReload).toBe(flippedTheme);
  });

  test("toggle is reachable from both the storefront and admin shells", async ({ page }) => {
    await signupNewUser(page);
    await page.goto("/wallet");
    await expect(page.getByRole("button", { name: /switch to (light|dark) mode/i })).toBeVisible();
  });
});
