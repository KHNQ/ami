import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers.js";

// Locates the nearest ancestor SectionCard <Card className="p-4"> for a
// given section title, so selectors that repeat across sections (both the
// rank-tiers and quota-tiers sections have a "Name" field and an "Add
// tier" button) can be scoped unambiguously.
function section(page, titleText) {
  return page.locator("xpath=(//div[contains(text(),'" + titleText + "')])[1]/ancestor::div[contains(@class,'p-4')][1]");
}

test.describe("Admin -- commission plan, rank tiers, quota tiers", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/products");
    await page.locator("a[href^='/admin/products/']").first().click();
    await expect(page).toHaveURL(/\/admin\/products\//);
  });

  test("switching payout mode to 'quota' persists and shows the redirect explanation", async ({ page }) => {
    const plan = section(page, "Commission plan");
    await plan.getByRole("button", { name: "Fill quota tiers" }).click();
    await expect(plan.getByText(/redirected into quota-tier progress/i)).toBeVisible();
    await plan.getByRole("button", { name: "Save commission plan" }).click();
    await expect(page.getByText(/commission plan saved/i)).toBeVisible();

    await page.reload();
    await expect(section(page, "Commission plan").getByText(/redirected into quota-tier progress/i)).toBeVisible();

    // Reset back to wallet mode so other specs/re-runs start from default.
    await section(page, "Commission plan")
      .getByRole("button", { name: "Pay to wallet" })
      .click();
    await section(page, "Commission plan")
      .getByRole("button", { name: "Save commission plan" })
      .click();
    await expect(page.getByText(/commission plan saved/i)).toBeVisible();
  });

  test("adding a quota tier shows it in the list with the configured target and bonus", async ({ page }) => {
    const quota = section(page, "Quota tiers");
    await quota.getByLabel("Tier order").fill("1");
    await quota.getByLabel("Name").fill("Blue");
    await quota.getByLabel("Quota target ($)").fill("500");
    await quota.getByLabel("Cash bonus ($)").fill("25");
    await quota.getByLabel("Rate bonus %").fill("2");
    await quota.getByLabel("Perks (comma separated)").fill("Priority support, Early access");
    await quota.getByRole("button", { name: "Add tier" }).click();

    await expect(page.getByText(/quota tier added/i)).toBeVisible();
    await expect(quota.getByText("#1 Blue")).toBeVisible();
    await expect(quota.getByText(/Target \$500\.00/)).toBeVisible();
    await expect(quota.getByText(/Cash bonus \$25\.00/)).toBeVisible();
    await expect(quota.getByText(/Priority support/)).toBeVisible();
  });

  test("disabling a quota tier flips its status badge", async ({ page }) => {
    const quota = section(page, "Quota tiers");
    await quota.getByLabel("Tier order").fill("2");
    await quota.getByLabel("Name").fill("Silver");
    await quota.getByLabel("Quota target ($)").fill("1000");
    await quota.getByRole("button", { name: "Add tier" }).click();
    await expect(quota.getByText("#2 Silver")).toBeVisible();

    const row = quota.locator("div", { hasText: "#2 Silver" }).last();
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByRole("button", { name: "Enable" })).toBeVisible();
  });

  test("adding a rank tier shows it in the rank tiers list", async ({ page }) => {
    const rank = section(page, "Rank tiers");
    await rank.getByLabel("Rank order").fill("1");
    await rank.getByLabel("Name").fill("Bronze");
    await rank.getByLabel("Team volume threshold ($)").fill("0");
    await rank.getByLabel("Personal volume threshold ($)").fill("0");
    await rank.getByLabel("Pool share %").fill("100");
    await rank.getByRole("button", { name: "Add tier" }).click();
    await expect(rank.getByText("#1 Bronze")).toBeVisible();
  });
});
