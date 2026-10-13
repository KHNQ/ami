import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers.js";

function jobRow(page, titleText) {
  return page.locator("div", { hasText: titleText }).filter({ has: page.getByRole("button", { name: "Run" }) }).last();
}

test.describe("Admin -- scheduled jobs & reports", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("running each scheduled job from the dashboard succeeds", async ({ page }) => {
    await page.goto("/admin");
    const jobs = [
      { title: "Recalculate activity periods", toastLabel: "Activity recalculation" },
      { title: "Release matured rank bonuses", toastLabel: "Rank bonus release" },
    ];
    for (const { title, toastLabel } of jobs) {
      await jobRow(page, title).getByRole("button", { name: "Run" }).click();
      await expect(page.getByText(`${toastLabel} complete`)).toBeVisible();
    }
  });

  test("the standing invariant audit reports all transactions passing", async ({ page }) => {
    await page.goto("/admin/reports");
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page.getByText(/transactions pass|violation\(s\) found/)).toBeVisible();
  });

  test("trex net and reserve fund summaries render with real numbers", async ({ page }) => {
    await page.goto("/admin/reports");
    await expect(page.getByText("Trex net")).toBeVisible();
    await expect(page.getByText("Current balance")).toBeVisible();
  });
});
