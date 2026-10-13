import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { signupNewUser } from "./helpers.js";

const SQLITE_PATH = resolve(import.meta.dirname, "..", process.env.E2E_SQLITE_FILE || "./e2e/.tmp/e2e.sqlite");

// Funds a user's wallet. Top-ups were removed from the product, so this writes
// the ledger directly (see e2e/fund-wallet.js) rather than driving a screen
// that no longer exists.
async function fundWallet(_browser, userPage, dollars, email) {
  execFileSync("bun", ["run", resolve(import.meta.dirname, "fund-wallet.js"), email, String(dollars * 100)], {
    cwd: resolve(import.meta.dirname, "..", ".."),
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test", SQLITE_FILE: SQLITE_PATH },
  });
  await userPage.reload();
}

test.describe("Purchase -> Space -> downline", () => {
  // Playwright's 30s default is not enough for this one, and raising it is
  // honest rather than a workaround: the test drives two browser contexts
  // through two sign-ups, two funded wallets and two purchases. That is the journey being verified; it simply
  // takes longer than a single-page assertion.
  //
  // 120s was still too tight and produced a genuinely misleading failure:
  // the clock ran out mid-action, so the report blamed whichever locator was
  // in flight ("locator.fill: Test ended" on the redeem-code field) and the
  // attached screenshot showed an unrelated page. Measured against a fresh
  // server, reaching just the redeem-code step takes ~108s on its own -- and
  // that is before the join assertion, the node view, and the downline and
  // earnings tabs. Under full-suite load it goes past two minutes, so the
  // budget covers the work rather than half of it.
  test.setTimeout(300_000);

  test("buying without a code starts a new Space; buying WITH that code joins it as a direct downline", async ({ browser }) => {
    const rootContext = await browser.newContext();
    const rootPage = await rootContext.newPage();
    const root = await signupNewUser(rootPage, { name: "Root Buyer" });
    await fundWallet(browser, rootPage, 200, root.email);

    await rootPage.goto("/");
    await rootPage.locator("a[href^='/products/']").first().click();
    await rootPage.getByRole("button", { name: /^Buy for/ }).click();
    await rootPage.getByRole("button", { name: "Confirm purchase" }).click();
    await expect(rootPage.getByText("You're in!")).toBeVisible();

    // The redeem code is the text content of CopyChip's <button class="font-mono ...">.
    const codeText = await rootPage.locator("button.font-mono").first().innerText();
    const code = codeText.trim();
    expect(code.length).toBeGreaterThan(3);

    await rootPage.getByRole("link", { name: "My node" }).click();
    await expect(rootPage).toHaveURL(/\/network\//);
    const rootNodeUrl = rootPage.url();

    const childContext = await browser.newContext();
    const childPage = await childContext.newPage();
    const child = await signupNewUser(childPage, { name: "Child Buyer" });
    await fundWallet(browser, childPage, 200, child.email);

    await childPage.goto("/");
    await childPage.locator("a[href^='/products/']").first().click();
    await childPage.getByRole("button", { name: /^Buy for/ }).click();
    await childPage.getByLabel("Redeem code (optional)").fill(code);
    await expect(childPage.getByText("Valid code")).toBeVisible();
    await childPage.getByRole("button", { name: "Confirm purchase" }).click();
    await expect(childPage.getByText("You joined an existing Space.")).toBeVisible();

    await rootPage.goto(rootNodeUrl);
    await rootPage.getByRole("button", { name: "Downline" }).click();
    await expect(rootPage.getByText("Member #")).toBeVisible();

    await rootPage.getByRole("button", { name: "Earnings" }).click();
    await expect(rootPage.getByText("Level 1 commission")).toBeVisible();

    await rootContext.close();
    await childContext.close();
  });
});
