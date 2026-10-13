import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { getWorld } from "./world.js";
import { BASE_URL, apiGet, apiSend, storeLogin, usd, watch } from "./ui-helpers.js";

// The customer-facing web app, driven as a visitor and then as signed-in customers
// over the data in e2e/world.js: every public page, every public form, the whole
// account lifecycle, the order and network screens, and an online purchase made
// with a referral code. Nothing here is mocked -- the forms post to the real API
// and each outcome is read back from it.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

const SQLITE_PATH = resolve(import.meta.dirname, "..", process.env.E2E_SQLITE_FILE || "./e2e/.tmp/e2e.sqlite");
const fund = (email, cents) =>
  execFileSync("bun", ["run", resolve(import.meta.dirname, "fund-wallet.js"), email, String(cents)], {
    cwd: resolve(import.meta.dirname, "..", ".."),
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", SQLITE_FILE: SQLITE_PATH },
  });

let w;
test.beforeAll(async () => {
  w = await getWorld();
});

/** Opens `path` and returns a spy that must come back clean. */
async function visit(page, path, title) {
  await page.goto(BASE_URL + path);
  if (title) await expect(page).toHaveTitle(title, { timeout: 30_000 });
}

test.describe("a visitor can open every public page", () => {
  test("the pages render, carry a proper title, and raise no errors", async ({ page }) => {
    const spy = watch(page);
    const pages = [
      ["/", /Medical & aesthetic equipment|Ashkan/],
      ["/devices", /All devices/],
      ["/devices/elysion", /Elysion Pro/],
      ["/catalog", /catalogue/i],
      ["/compare", /Ashkan Medical Idea/],
      ["/installations", /Installed base/],
      ["/affiliate", /owner network/i],
      ["/tools", /Decision tools/],
      ["/contact", /Contact us/],
      ["/blog", /^Blog/],
      [`/blog/${w.post.slug}`, /E2E world: launch day/],
      ["/partners", /Business partners/],
      ["/our-story", /Our story/],
      ["/careers", /Ashkan Medical Idea/],
      ["/socials", /Newsroom/],
      [`/products/${w.products.laser.id}`, /E2E Laser/],
      ["/login", /Sign In/],
      ["/signup", /Sign Up/],
      ["/forgot-password", /Forgot Password/],
      ["/reset-password", /Reset Password/],
    ];
    for (const [path, title] of pages) {
      await visit(page, path, title);
      await expect(page.locator("body"), path).not.toContainText("Something went wrong");
    }
    spy.check();
  });

  test("an unknown address gets a real 404 page, and a signed-out visit to the account goes to sign-in", async ({ page }) => {
    await visit(page, "/definitely-not-here", /Page Not Found/);
    await visit(page, "/account");
    await expect(page).toHaveURL(/\/login/);
    await visit(page, "/orders");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the blog shows the published post and hides the draft", async ({ page }) => {
    await visit(page, "/blog", /Blog/);
    await expect(page.getByText("E2E world: launch day").first()).toBeVisible();
    await expect(page.getByText("E2E world: a draft")).toHaveCount(0);
    await visit(page, "/blog/e2e-world-a-draft");
    await expect(page.getByText("E2E world: a draft")).toHaveCount(0); // a draft is not served
  });
});

test.describe("public forms reach the staff who work them", () => {
  test("the contact form sends a support request that lands in the admin queue", async ({ page }) => {
    const spy = watch(page);
    await visit(page, "/contact", /Contact us/);
    await page.getByPlaceholder(/Your name/i).or(page.getByLabel("Your name")).first().fill("Contact Form Visitor");
    await page.getByLabel("Phone or email").fill("visitor-ui@e2e.local");
    await page.getByLabel("How can we help?").fill("Can you ship a laser to Isfahan next month?");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect.poll(async () => {
      const r = (await apiGet("/support/requests?status=new", w.admins.usr.token)).body;
      return (r.requests ?? r).some((x) => x.message.includes("ship a laser to Isfahan"));
    }).toBe(true);
    spy.check();
  });

  test("the careers form is usable and submits an application the people-admin can read", async ({ page }) => {
    const spy = watch(page);
    await visit(page, "/careers");
    await expect(page.getByRole("button", { name: /submit/i })).toBeDisabled(); // required fields first
    await page.getByLabel("Field of work").selectOption("Technical");
    await page.getByLabel("First name").fill("Careers");
    await page.getByLabel("Last name").fill("Applicant");
    await page.getByLabel("Mobile phone number").fill("+989121234000");
    await page.getByLabel("Date of birth").fill("1995-04-12");
    await page.getByRole("button", { name: /submit/i }).click();
    await expect.poll(async () => {
      const r = (await apiGet("/careers/applications", w.admins.usr.token)).body;
      return (r.applications ?? r).some((x) => x.last_name === "Applicant");
    }).toBe(true);
    spy.check();
  });

  test("the proforma wizard issues a numbered, downloadable proforma that appears in the sales queue", async ({ page }) => {
    const spy = watch(page);
    await visit(page, "/devices/elysion", /Elysion Pro/);
    await page.getByRole("button", { name: /Request a proforma/ }).first().click();
    await expect(page.getByRole("heading", { name: /step 1 of 3/i })).toBeVisible();
    await page.getByRole("button", { name: /^Next/ }).click();
    await expect(page.getByRole("heading", { name: /step 2 of 3/i })).toBeVisible();
    await page.getByRole("button", { name: /^Next/ }).click();
    await expect(page.getByRole("heading", { name: /step 3 of 3/i })).toBeVisible();
    await page.getByLabel("Clinic or doctor name").fill("Wizard Clinic");
    await page.getByLabel(/Phone or WhatsApp/).fill("+98 912 777 0000");
    await page.getByLabel("Email").fill("wizard@clinic.test");
    await page.getByRole("button", { name: /Generate branded PDF proforma/ }).click();
    await expect(page.getByRole("heading", { name: "Proforma generated ✓" })).toBeVisible({ timeout: 30_000 });
    const ref = (await page.getByText(/Proforma #PRO-/).first().innerText()).match(/PRO-[A-Z0-9]{6}/)[0];

    const queue = (await apiGet("/sales/quotes?status=new&limit=100", w.admins.fin.token)).body;
    const quote = queue.quotes.find((q) => q.reference === ref);
    expect(quote, "the proforma is in the sales queue").toBeTruthy();
    expect(quote.contact_name).toBe("Wizard Clinic");
    // The document the customer was promised really downloads, and is a PDF.
    const pdf = await fetch(`http://localhost:3033/sales/quotes/${quote.id}/proforma.pdf?ref=${ref}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    spy.check();
  });
});

test.describe("an account, from sign-up to deletion", () => {
  const email = `ui-life-${Date.now()}@e2e.local`;
  const name = "UI Lifecycle";
  const password = "ui-life-pass-123";

  test("sign up through the form, and the account page greets them by name", async ({ page }) => {
    const spy = watch(page);
    await visit(page, "/signup");
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(BASE_URL + "/");
    await visit(page, "/account", /Your account/);
    await expect(page.getByText(`Welcome back, ${name}`)).toBeVisible();
    spy.check();
  });

  test("the sign-up form refuses a bad email and a short password, and a duplicate account", async ({ page }) => {
    await visit(page, "/signup");
    await page.getByLabel("Full name").fill("Bad Email");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByLabel("Email").fill(email); // taken
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("An account with this email already exists")).toBeVisible();
    expect((await apiSend("POST", "/auth/signup", { email: "not-an-email", password, name: "x" })).status).toBe(400);
  });

  test("sign out, a wrong password is rejected visibly, the right one signs back in", async ({ page }) => {
    const spy = watch(page, { allow: [/401/, /Failed to load resource.*401/] });
    await visit(page, "/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: /^(sign in|login)$/i }).click();
    await expect(page.getByText(/invalid|incorrect|failed/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^(sign in|login)$/i }).click();
    await expect(page).toHaveURL(BASE_URL + "/");
    await visit(page, "/profile", /Profile/);
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await visit(page, "/account");
    await expect(page).toHaveURL(/\/login/);
    spy.stop();
  });

  test("change the password from the profile page: the old one stops working", async ({ page }) => {
    await storeLogin(page, { email, password });
    await visit(page, "/profile", /Profile/);
    await page.getByRole("button", { name: /Change password/ }).click();
    // The sheet is not exposed as a dialog role, so fields are found by their labels; its
    // submit button is the last "Change password" (the first is the row that opened it).
    await page.getByLabel("Current password").fill(password);
    await page.getByLabel("New password", { exact: true }).fill("ui-life-pass-456");
    await page.getByLabel("Confirm new password").fill("ui-life-pass-456");
    await page.getByRole("button", { name: "Change password" }).last().click();
    await expect.poll(async () => (await apiSend("POST", "/auth/login", { email, password: "ui-life-pass-456" })).status).toBe(200);
    expect((await apiSend("POST", "/auth/login", { email, password })).status).toBe(401);
  });

  test("delete the account from the profile page: they are signed out and cannot return", async ({ page }) => {
    await storeLogin(page, { email, password: "ui-life-pass-456" });
    await visit(page, "/profile", /Profile/);
    await page.getByRole("button", { name: "Delete account" }).click();
    await page.getByLabel("Password", { exact: true }).fill("ui-life-pass-456");
    await page.getByRole("button", { name: /Permanently delete my account/ }).click();
    await expect.poll(async () => (await apiSend("POST", "/auth/login", { email, password: "ui-life-pass-456" })).status).toBe(401);
  });

  test("forgot password: the form is generic, and the emailed link sets a new password", async ({ page }) => {
    const fresh = await apiSend("POST", "/auth/signup", { email: `ui-forgot-${Date.now()}@e2e.local`, password, name: "Forgetful" });
    const addr = fresh.body.user.email;
    await visit(page, "/forgot-password", /Forgot Password/);
    await page.getByLabel("Email").fill("ghost-nobody@e2e.local");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible(); // the same answer for an unknown address
    await visit(page, "/forgot-password");
    await page.getByLabel("Email").fill(addr);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    await page.getByRole("link", { name: /reset-password\?token=/ }).click();
    await page.getByLabel("New password", { exact: true }).fill("brand-new-pass-789");
    await page.getByLabel("Confirm new password").fill("brand-new-pass-789");
    await page.getByRole("button", { name: /reset password/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect.poll(async () => (await apiSend("POST", "/auth/login", { email: addr, password: "brand-new-pass-789" })).status).toBe(200);
  });
});

test.describe("a customer inside their network", () => {
  test("orders: the list and an order's receipt", async ({ page }) => {
    const spy = watch(page);
    await storeLogin(page, w.users[0]);
    await visit(page, "/orders", /My orders/);
    await expect(page.getByText("E2E Laser").first()).toBeVisible();
    await expect(page.getByText("COMPLETED").first()).toBeVisible();
    await page.getByText("E2E Laser").first().click();
    await expect(page).toHaveURL(/\/orders\/tx_/);
    await expect(page.getByText("Amount paid")).toBeVisible();
    await expect(page.getByText("$20,000.00").first()).toBeVisible();
    spy.check();
  });

  test("an instalment customer sees what they have PAID, and what the order is worth", async ({ page }) => {
    const spy = watch(page);
    await storeLogin(page, w.users[3]);
    await visit(page, `/orders/${w.orders.inst.transaction.id}`, /Order/);
    // $8,000 down + one cleared $4,000 cheque of a $20,000 order.
    await expect(page.getByText("Amount paid")).toBeVisible();
    await expect(page.getByText("$12,000.00").first()).toBeVisible();
    await expect(page.getByText("Order value")).toBeVisible();
    await expect(page.getByText("$20,000.00").first()).toBeVisible();
    spy.check();
  });

  test("the network: node page, downline, earnings, codes, and the whole Space tree", async ({ page }) => {
    const spy = watch(page);
    await storeLogin(page, w.users[0]);
    await visit(page, "/network", /Network/);
    await expect(page.getByText("E2E Laser")).toBeVisible();
    await page.getByText("E2E Laser").first().click();
    await expect(page).toHaveURL(/\/network\/node_/);
    await expect(page.getByText("Your node")).toBeVisible();
    await expect(page.getByText("TEAM VOLUME", { exact: false })).toBeVisible();
    // This product has no quota programme: the contradictory "No tier yet / all completed" card must not appear.
    await expect(page.getByText("All configured tiers completed.")).toHaveCount(0);

    await page.getByRole("button", { name: "Downline" }).click();
    await expect(page.getByText("Member #").first()).toBeVisible();
    await page.getByRole("button", { name: "Earnings" }).click();
    await expect(page.getByText("Level 1 commission").first()).toBeVisible();

    // Mint a new code, then revoke it.
    const before = (await apiGet(`/redeem-codes/mine?product_id=${w.products.laser.id}`, w.users[0].token)).body.length;
    await page.getByRole("button", { name: "New code" }).click();
    // "New code" opens a sheet (max uses, expiry); the code is minted by its submit button.
    await page.getByRole("button", { name: "Generate code" }).click();
    await expect.poll(async () => (await apiGet(`/redeem-codes/mine?product_id=${w.products.laser.id}`, w.users[0].token)).body.length).toBe(before + 1);
    await page.reload();
    await page.getByRole("button", { name: "Revoke" }).last().click();
    await expect.poll(async () => (await apiGet(`/redeem-codes/mine?product_id=${w.products.laser.id}`, w.users[0].token)).body.filter((c) => c.status === "revoked").length).toBeGreaterThan(0);

    await page.getByRole("link", { name: /View full Space tree/ }).or(page.getByRole("button", { name: /View full Space tree/ })).first().click();
    await expect(page).toHaveURL(/\/space\//);
    // A customer sees the SHAPE of their Space -- themself, the member count and depth --
    // and other members only as anonymous ids, never by name.
    await expect(page.getByText("Space tree")).toBeVisible();
    await expect(page.getByText("You", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("MEMBERS", { exact: false }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(w.users[1].name);
    await expect(page.locator("body")).not.toContainText(w.users[2].email);
    spy.check();
  });

  test("one customer cannot open another's order or node by address", async ({ page }) => {
    const spy = watch(page, { allow: [/403/, /Failed to load resource.*403/] });
    await storeLogin(page, w.users[9]);
    await visit(page, `/orders/${w.orders.l0.transaction.id}`);
    await expect(page.getByText("E2E Laser")).toHaveCount(0);
    const node = (await apiGet("/nodes/mine", w.users[0].token)).body[0];
    await visit(page, `/network/${node.id}`);
    await expect(page.getByText("Your node")).toHaveCount(0);
    spy.stop();
  });
});

test.describe("buying online", () => {
  test("a new customer funds up, joins an existing Space with a referral code, and the sponsor earns", async ({ page }) => {
    // Typing a deliberately fake code makes the live-validation request answer 404; that is the point.
    const spy = watch(page, { allow: [/redeem-codes\/NOT-A-REAL-CODE/, /Failed to load resource.*404/] });
    const email = `ui-buyer-${Date.now()}@e2e.local`;
    const created = await apiSend("POST", "/auth/signup", { email, password: "buyer-pass-123", name: "UI Buyer" });
    const sponsor = w.users[6]; // holds a position in the kit
    const code = (await apiGet(`/redeem-codes/mine?product_id=${w.products.kit.id}`, sponsor.token)).body[0]?.code;
    expect(code, "the sponsor has a kit code").toBeTruthy();
    fund(email, 200_000);
    const sponsorNode = (await apiGet("/nodes/mine", sponsor.token)).body.find((n) => n.product_id === w.products.kit.id);
    const earningsBefore = (await apiGet(`/nodes/${sponsorNode.id}/earnings`, sponsor.token)).body.entries.length;

    await storeLogin(page, { email, password: "buyer-pass-123" });
    await visit(page, `/products/${w.products.kit.id}`, /E2E Kit/);
    await page.getByRole("button", { name: /^Buy for/ }).click();
    // A code that does not exist is simply not endorsed: no "Valid code" badge appears for it.
    await page.getByLabel("Redeem code (optional)").fill("NOT-A-REAL-CODE");
    await expect(page.getByText("Checking code…")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/^Valid code/)).toHaveCount(0);
    await page.getByLabel("Redeem code (optional)").fill(code);
    await expect(page.getByText("Valid code")).toBeVisible();
    await page.getByRole("button", { name: "Confirm purchase" }).click();
    await expect(page.getByText("You joined an existing Space.")).toBeVisible({ timeout: 30_000 });

    expect((await apiGet("/wallet", created.body.token)).body.balance_cents).toBe(200_000 - w.products.kit.list_price_y_cents);
    const mine = (await apiGet("/nodes/mine", created.body.token)).body;
    expect(mine.length).toBe(1);
    // The sponsor earned from the new member's purchase: exactly one more ledger row, at level 1.
    const earnings = (await apiGet(`/nodes/${sponsorNode.id}/earnings`, sponsor.token)).body.entries;
    expect(earnings.length).toBe(earningsBefore + 1);
    expect(earnings.some((e) => e.level_depth === 1 && e.amount_cents > 0)).toBe(true);
    spy.check();
  });

  test("a customer who already holds a position cannot buy a second one, and is not charged", async ({ page }) => {
    const spy = watch(page, { allow: [/40\d/, /Failed to load resource.*40\d/] });
    const before = (await apiGet("/wallet", w.users[6].token)).body.balance_cents;
    await storeLogin(page, w.users[6]); // already in the kit
    await visit(page, `/products/${w.products.kit.id}`);
    const buy = page.getByRole("button", { name: /^Buy for/ });
    if (await buy.count()) {
      await buy.click();
      await page.getByRole("button", { name: "Confirm purchase" }).click();
      await expect(page.getByText(/already have a position/i).first()).toBeVisible();
    }
    // Whatever the page offered, no second position was taken and no money moved.
    expect((await apiGet("/nodes/mine", w.users[6].token)).body.filter((n) => n.product_id === w.products.kit.id).length).toBe(1);
    expect((await apiGet("/wallet", w.users[6].token)).body.balance_cents).toBe(before);
    spy.stop();
  });
});

test.describe("the live-activity pop-up shows real requests, only when an admin turns it on", () => {
  test("absent by default; on, it shows a real proforma request without any personal detail; off again, it goes away", async ({ page }) => {
    const spy = watch(page);
    const flag = (value) => apiSend("PATCH", "/admin/settings", { show_live_activity: value }, w.root.token);
    try {
      await visit(page, "/devices", /All devices/);
      await expect(page.getByTestId("live-activity")).toHaveCount(0); // off: nothing is rendered at all

      expect((await flag(true)).status).toBe(200);
      // The flag reaches this already-open page over the live config stream -- no reload.
      const popup = page.getByTestId("live-activity");
      await expect(popup).toHaveCount(1, { timeout: 20_000 });
      await expect(popup).toContainText(/A clinic requested (a proforma|a lease quote) for (E2E Laser|E2E Scanner)/, { timeout: 20_000 });
      const shown = await popup.innerText();
      for (const private_ of ["Anon Clinic", "Lease Clinic", "E2E User", "anon@clinic.test", "+98 912", "Tehran"]) {
        expect(shown, `the pop-up must not show "${private_}"`).not.toContain(private_);
      }

      expect((await flag(false)).status).toBe(200);
      await expect(page.getByTestId("live-activity")).toHaveCount(0, { timeout: 20_000 });
    } finally {
      await flag(false);
    }
    spy.check();
  });
});

test.describe("language, direction and theme", () => {
  test("switching to Persian flips the page to right-to-left without errors, and back to English", async ({ page }) => {
    const spy = watch(page);
    await visit(page, "/", /Medical|Ashkan/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await page.getByRole("button", { name: "Language" }).first().click();
    await page.getByText("فارسی").first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // The language lives in the URL (/fa/...): an unprefixed address is English by design.
    await expect(page).toHaveURL(/\/fa(\/|$)/);
    await visit(page, "/fa/devices");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await page.getByRole("button", { name: /زبان|Language/ }).first().click();
    await page.getByText("English").first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    spy.stop();
  });

  test("dark mode toggles and is remembered across a reload", async ({ page }) => {
    await visit(page, "/");
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme || "light");
    const before = await theme();
    await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).first().click();
    await expect.poll(theme).not.toBe(before);
    const after = await theme();
    await page.reload();
    expect(await theme()).toBe(after);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the main pages fit the screen: no sideways scrolling, and the bottom navigation is there", async ({ page }) => {
    await storeLogin(page, w.users[0]);
    for (const path of ["/", "/devices", "/devices/elysion", "/contact", "/blog", "/account", "/orders", "/network", "/profile", "/careers", `/products/${w.products.laser.id}`]) {
      await visit(page, path);
      await page.waitForLoadState("networkidle").catch(() => {});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    }
    await visit(page, "/account");
    await expect(page.getByRole("button", { name: "Orders" }).or(page.getByRole("link", { name: "Orders" })).first()).toBeVisible();
  });
});
