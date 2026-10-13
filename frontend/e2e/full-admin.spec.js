import { test, expect } from "@playwright/test";
import { getWorld } from "./world.js";
import { ADMIN_URL, adminLogin, apiGet, apiSend, usd, watch } from "./ui-helpers.js";

// The admin console, driven the way staff drive it: signed in as the root admin
// and then as each scoped admin, over the data in e2e/world.js. Every page is
// opened and must render its data without a console error or a failed request;
// the flows that change money or stock are then performed through the real forms
// and checked against the API afterwards, so a screen that merely LOOKS right
// but saves the wrong thing fails here.

// The assistant ships switched off on this backend (as in production), so its two
// admin pages answer 503 by design; the sidebar hides them for the same reason.
const AI_OFF = [/503/, /ai_disabled/, /Failed to load resource.*503/];

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

let w;
let ctx;
let page;
let spy;

test.beforeAll(async ({ browser }) => {
  w = await getWorld();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await adminLogin(page, w.root);
});

test.afterAll(async () => {
  await ctx?.close();
});

test.beforeEach(() => {
  spy = watch(page);
});
test.afterEach(() => {
  spy.stop();
});

const open = async (path, title) => {
  await page.goto(ADMIN_URL + path);
  if (title) await expect(page).toHaveTitle(title, { timeout: 30_000 });
};

test.describe("every admin page renders its data", () => {
  test("overview shows the position, queues and scheduled jobs", async () => {
    await open("/", /Control Room/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("NEEDS ATTENTION", { exact: false })).toBeVisible();
    await expect(page.getByText(/TREX NET/i).first()).toBeVisible();
    await expect(page.getByText("Recent orders")).toBeVisible();
    await expect(page.getByText("Recent sign-ups")).toBeVisible();
    await expect(page.getByText("SCHEDULED JOBS", { exact: false })).toBeVisible();
    spy.check();
  });

  test("orders lists every sale and filters by status", async () => {
    await open("/orders", /Admin · Orders/);
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await expect(page.getByText("COMPLETED").first()).toBeVisible();
    await page.getByRole("button", { name: "Refunded" }).click();
    await expect(page.getByText(/PARTIALLY|REFUNDED/i).first()).toBeVisible();
    await page.getByRole("button", { name: "All" }).click();
    spy.check();
  });

  test("an order's detail shows the money split and its cheques", async () => {
    await open(`/orders/${w.orders.inst.transaction.id}`, /Admin · Order/);
    await expect(page.getByText(/commission|payout|margin/i).first()).toBeVisible();
    spy.check();
  });

  test("proformas, stock, cheques, payouts, reports, people, support, admins, blog, settings, messages and the audit log all load", async () => {
    const pages = [
      ["/proformas", /Admin · Proformas/, "Proformas"],
      ["/products", /Admin · Products/, "Stock"],
      ["/cheques", /Admin · Cheques/, "Cheques"],
      ["/payouts", /Admin · Network payouts/, "Network payouts"],
      ["/reports", /Admin · Reports/, "Reports"],
      ["/users", /Admin · People/, "People"],
      ["/support", /Admin · Support/, "Support requests"],
      ["/admins", /Admin · Admins & access/, "Admins & access"],
      ["/blog", /Admin · Blog/, "Blog"],
      ["/settings", /Admin · Settings/, "Site settings"],
      ["/notifications", /Admin · Messages/, "Messages"],
      ["/logs", /Admin · Logs/, "Audit log"],
    ];
    for (const [path, title, heading] of pages) {
      await open(path, title);
      await expect(page.getByRole("heading", { name: heading }).first(), path).toBeVisible();
    }
    spy.check();
  });

  test("the assistant pages degrade to a clear message, not a crash, when the assistant is off", async () => {
    const quiet = watch(page, { allow: AI_OFF });
    for (const [path, title] of [["/knowledge", /Assistant knowledge/], ["/ai-activity", /Assistant activity/]]) {
      await open(path, title);
      await expect(page.getByText(/switched off/i).first()).toBeVisible();
    }
    quiet.check();
    quiet.stop();
  });

  test("an unknown address returns to the overview instead of a blank page", async () => {
    await open("/definitely-not-a-page");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    spy.check();
  });
});

test.describe("stock arrives with its own cost", () => {
  const laser = () => w.products.laser;
  // The world has already sold some units, so the starting count is read, not assumed.
  let base;
  test.beforeAll(async () => {
    base = (await apiGet(`/products/${laser().id}`, w.admins.fin.token)).body.stock_count;
    expect(base).toBeGreaterThan(3);
  });

  test("the Stock section has a quantity, a per-unit cost and a margin read-out", async () => {
    await open(`/products/${laser().id}`, /Admin · Product/);
    const stock = page.getByTestId("stock-count");
    await expect(stock).toHaveText(String(base));
    await expect(page.getByLabel("Quantity")).toBeVisible();
    await expect(page.getByLabel("Cost per unit")).toHaveValue("12000.00"); // defaults to the cost on record
    await expect(page.getByText(/Margin at the list price/)).toContainText("$8,000.00");
    // Nothing to add yet: the button is disabled until there is a quantity.
    await expect(page.getByRole("button", { name: "Add stock" })).toBeDisabled();
    spy.check();
  });

  test("adding stock at a NEW cost raises the count and moves the recorded cost, with history", async () => {
    await open(`/products/${laser().id}`, /Admin · Product/);
    await page.getByLabel("Quantity").fill("4");
    await page.getByLabel("Cost per unit").fill("13000");
    await expect(page.getByText(/becomes the warehouse cost for new sales/i)).toBeVisible();
    await expect(page.getByText(/Margin at the list price/)).toContainText("$7,000.00");
    await page.getByRole("button", { name: "Add stock" }).click();
    await expect(page.getByText("Added 4 to stock")).toBeVisible();

    await expect(page.getByTestId("stock-count")).toHaveText(String(base + 4));
    await expect(page.getByText("Current warehouse cost (x):")).toContainText("$13,000.00");
    // The history list gained the new figure without a reload.
    await expect(page.getByText("Cost history")).toBeVisible();
    await expect(page.getByText("$13,000.00").first()).toBeVisible();

    const p = await apiGet(`/products/${laser().id}`, w.admins.fin.token);
    expect(p.body.stock_count).toBe(base + 4);
    expect(p.body.current_x_cents).toBe(1_300_000);
    const hist = await apiGet(`/products/${laser().id}/warehouse-cost`, w.admins.fin.token);
    expect(hist.body.map((h) => h.x_cents).sort((a, b) => a - b)).toEqual([1_200_000, 1_300_000]);
    // The form cleared the quantity and now defaults to the new cost.
    await expect(page.getByLabel("Quantity")).toHaveValue("");
    await expect(page.getByLabel("Cost per unit")).toHaveValue("13000.00");
    spy.check();
  });

  test("restocking at the unchanged cost adds no cost-history row", async () => {
    await open(`/products/${laser().id}`, /Admin · Product/);
    await page.getByLabel("Quantity").fill("2");
    await page.getByRole("button", { name: "Add stock" }).click();
    await expect(page.getByText("Added 2 to stock")).toBeVisible();
    await expect(page.getByTestId("stock-count")).toHaveText(String(base + 6));
    const hist = await apiGet(`/products/${laser().id}/warehouse-cost`, w.admins.fin.token);
    expect(hist.body.length).toBe(2);
    spy.check();
  });

  test("a cost at or above the price is flagged before saving, because it would make every sale refuse", async () => {
    await open(`/products/${laser().id}`, /Admin · Product/);
    await page.getByLabel("Quantity").fill("1");
    await page.getByLabel("Cost per unit").fill("25000");
    await expect(page.getByText(/sales will be refused/i)).toBeVisible();
    // Not submitted: nothing changed.
    expect((await apiGet(`/products/${laser().id}`, w.admins.fin.token)).body.current_x_cents).toBe(1_300_000);
    await page.getByLabel("Cost per unit").fill("13000");
    await expect(page.getByText(/sales will be refused/i)).toHaveCount(0);
    spy.check();
  });

  test("a count correction removes stock, takes no cost, and cannot go below zero", async () => {
    await open(`/products/${laser().id}`, /Admin · Product/);
    await page.getByLabel("Quantity").fill("3");
    await page.getByRole("button", { name: "Remove (correction)" }).click();
    await expect(page.getByText("Removed 3 from stock")).toBeVisible();
    await expect(page.getByTestId("stock-count")).toHaveText(String(base + 3));
    expect((await apiGet(`/products/${laser().id}`, w.admins.fin.token)).body.current_x_cents).toBe(1_300_000);

    await page.getByLabel("Quantity").fill("9999");
    await page.getByRole("button", { name: "Remove (correction)" }).click();
    await expect(page.getByText(/below zero/i)).toBeVisible();
    await expect(page.getByTestId("stock-count")).toHaveText(String(base + 3));
    // The refusal is an expected 400 from the API, shown as a message.
    spy.problems.length = 0;
  });

  test("the sale after a restock locks the NEW cost; the order before it keeps the old one", async () => {
    const before = await apiGet(`/admin/orders/${w.orders.l0.transaction.id}`, w.root.token);
    expect(before.body.x_at_sale_cents).toBe(1_200_000);
    const buyer = w.users[9];
    const sale = await apiSend("POST", "/admin/orders/manual", { user_id: buyer.id, product_id: laser().id, amount_received_cents: 2_000_000 }, w.admins.fin.token);
    expect(sale.status).toBe(201);
    expect(sale.body.transaction.x_at_sale_cents).toBe(1_300_000);
    expect((await apiGet(`/admin/orders/${w.orders.l0.transaction.id}`, w.root.token)).body.x_at_sale_cents).toBe(1_200_000);
    await open(`/orders/${sale.body.transaction.id}`, /Admin · Order/);
    await expect(page.getByText(/\$13,000\.00/).first()).toBeVisible();
    spy.check();
  });
});
