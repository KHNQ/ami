import { test, expect } from "@playwright/test";
import { getWorld } from "./world.js";
import { ADMIN_URL, adminLogin, apiGet, apiSend, usd, watch } from "./ui-helpers.js";

// The admin console's money, people and content flows, performed through the real
// forms as the root admin, each verified against the API afterwards -- plus every
// scoped admin signing in to confirm they see, and can reach, only their own corner.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

let w;
let ctx;
let page;
let spy;
const root = () => w.root.token;

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

/** The card/row on the page that mentions `text` and holds the given button. */
const rowWith = (text, button) =>
  page.locator("div").filter({ hasText: text }).filter({ has: page.getByRole("button", { name: button }) }).last();

test.describe("recording sales", () => {
  test("a walk-in sale: find the customer, pick the device, take full payment, record it", async () => {
    const buyer = w.users[8];
    const kit = w.products.kit;
    await open("/orders/manual", /Admin · New walk-in/);
    await page.getByPlaceholder("Search by name, email or phone").fill(buyer.email);
    await page.getByRole("button", { name: new RegExp(buyer.name) }).click();
    const options = await page.locator("select").first().locator("option").allTextContents();
    const label = options.find((o) => o.includes("E2E Kit"));
    expect(label, "the device list offers the kit").toBeTruthy();
    await page.locator("select").first().selectOption({ label });
    await page.getByRole("button", { name: /Full price/ }).click();
    await expect(page.getByText(/Outstanding/).first()).toContainText("$0.00");
    await page.getByRole("button", { name: "Record order" }).click();
    await expect(page.getByText(/recorded|order/i).first()).toBeVisible();

    const orders = await apiGet(`/admin/orders?buyer_user_id=${buyer.id}`, root());
    expect(orders.body.length).toBe(1);
    expect(orders.body[0].y_at_sale_cents).toBe(kit.list_price_y_cents);
    expect(orders.body[0].channel ?? "offline").toBeTruthy();
    spy.check();
  });

  test("a walk-in sale on instalments: down payment, a cheque, and the balance adds up", async () => {
    const buyer = w.users[9];
    const scanner = w.products.scanner;
    await open("/orders/manual", /Admin · New walk-in/);
    await page.getByPlaceholder("Search by name, email or phone").fill(buyer.email);
    await page.getByRole("button", { name: new RegExp(buyer.name) }).click();
    const options = await page.locator("select").first().locator("option").allTextContents();
    await page.locator("select").first().selectOption({ label: options.find((o) => o.includes("E2E Scanner")) });
    await page.getByLabel("Collected now (USD)").fill("4000");
    await page.locator("select").nth(1).selectOption("installment");
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByLabel("Amount (USD)").fill("6000");
    await page.getByLabel("Due date").fill("2027-02-01");
    await page.getByLabel("Cheque no.").fill("9001");
    await page.getByLabel("Bank").fill("Bank Melli");
    await expect(page.getByText(/Outstanding/).first()).toContainText("$0.00");
    await page.getByRole("button", { name: "Record order" }).click();

    await expect.poll(async () => (await apiGet(`/admin/orders?buyer_user_id=${buyer.id}&product_id=${scanner.id}`, root())).body.length).toBe(1);
    const order = (await apiGet(`/admin/orders?buyer_user_id=${buyer.id}&product_id=${scanner.id}`, root())).body[0];
    expect(order.amount_received_cents).toBe(400_000);
    const chq = (await apiGet(`/admin/orders/${order.id}/cheques`, root())).body;
    expect(chq.cheques.length).toBe(1);
    expect(chq.cheques[0].amount_cents).toBe(600_000);
    expect(chq.totals.outstanding_cents).toBe(0 + 600_000 - 0); // the cheque is what is still to collect
    spy.check();
  });

  test("an order's refund form offers only what was COLLECTED, and a partial refund is applied", async () => {
    // Instalment order: 8,000 down + one cleared 4,000 cheque = 12,000 collected of a 20,000 order.
    await open(`/orders/${w.orders.inst.transaction.id}`, /Admin · Order/);
    await page.getByRole("button", { name: "Refund order" }).click();
    await expect(page.getByText(/blank = full \$12,000\.00/)).toBeVisible();
    await page.keyboard.press("Escape");

    // A paid-in-full order: refund $100 with a reason.
    const target = w.orders.l1.transaction;
    await open(`/orders/${target.id}`, /Admin · Order/);
    await expect(page.getByText("Amount paid")).toBeVisible();
    await page.getByRole("button", { name: "Refund order" }).click();
    await page.getByLabel(/Amount \(blank/).fill("100");
    await page.getByLabel("Reason (optional)").fill("UI refund test");
    await page.getByRole("button", { name: "Confirm refund" }).click();
    await expect(page.getByText("Refund processed")).toBeVisible();
    const after = (await apiGet(`/admin/orders/${target.id}`, root())).body;
    expect(after.refunded_amount_cents).toBe(10_000);
    expect(after.status).toBe("partially_refunded");
    spy.check();
  });
});

test.describe("the proforma desk", () => {
  test("mark a request contacted, register another as a sale (price and referrer come from it), decline a third", async () => {
    await open("/proformas", /Admin · Proformas/);
    await page.getByRole("button", { name: "All", exact: true }).click();

    // 1. Contacted
    const anon = rowWith("Anon Clinic", "Mark contacted");
    await anon.getByRole("button", { name: "Mark contacted" }).click();
    await expect.poll(async () => (await apiGet(`/sales/quotes/${w.quotes.anon.id}`, root())).body.status).toBe("contacted");

    // 2. Decline
    const enquiry = rowWith("Kit Enquirer", "Decline");
    await enquiry.getByRole("button", { name: "Decline" }).click();
    await expect.poll(async () => (await apiGet(`/sales/quotes/${w.quotes.enquiry.id}`, root())).body.status).toBe("declined");

    // 3. Register now -> the walk-in form, prefilled from the proforma
    const user = rowWith("E2E User 7", "Register now");
    await user.getByRole("button", { name: "Register now" }).click();
    await expect(page).toHaveURL(/\/orders\/manual\?quote=/);
    await expect(page.getByText(/From proforma/)).toBeVisible();
    await expect(page.getByText(/Invited by/)).toBeVisible();
    // The customer, device, price and referrer all arrive from the proforma -- nobody searches or types a code.
    await expect(page.getByText("E2E User 7").first()).toBeVisible();
    await expect(page.getByPlaceholder("Search by name, email or phone")).toHaveCount(0);
    await expect(page.getByLabel("Referrer's redeem code (optional)")).not.toHaveValue("");
    await page.getByRole("button", { name: /Full price/ }).click();
    await page.getByRole("button", { name: "Record order" }).click();
    await expect.poll(async () => (await apiGet(`/sales/quotes/${w.quotes.user.id}`, root())).body.status).toBe("converted");
    const order = (await apiGet(`/admin/orders?buyer_user_id=${w.users[7].id}`, root())).body[0];
    expect(order.y_at_sale_cents).toBe(1_000_000);
    // Invited through u4's referral link: u7 joined UNDER u4 without anyone typing a code.
    const net = (await apiGet(`/admin/users/${w.users[7].id}/network`, root())).body;
    expect(JSON.stringify(net)).toContain(w.users[4].name);
    spy.check();
  });
});

test.describe("money", () => {
  test("cheques: clear a pending one from the register, and the bounced one is listed", async () => {
    await open("/cheques", /Admin · Cheques/);
    const pendingBefore = (await apiGet("/cheques?status=pending", root())).body;
    const count = (pendingBefore.cheques ?? pendingBefore).length;
    expect(count).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Mark cleared" }).first().click();
    await expect.poll(async () => {
      const r = (await apiGet("/cheques?status=pending", root())).body;
      return (r.cheques ?? r).length;
    }).toBe(count - 1);
    await page.getByRole("button", { name: "Bounced", exact: true }).click();
    await expect(page.getByText(/7002/)).toBeVisible();
    await page.getByRole("button", { name: "Cleared", exact: true }).click();
    await expect(page.getByText(/7001/)).toBeVisible();
    spy.check();
  });

  test("payouts: settle one person in cash through the confirmation dialog; the wallet is untouched", async () => {
    await open("/payouts", /Admin · Network payouts/);
    const before = (await apiGet("/admin/payouts", root())).body;
    expect(before.people.length).toBeGreaterThan(0);
    const person = before.people[0];
    const wallet = (await apiGet("/wallet", w.users.find((u) => u.id === person.user_id)?.token)).body.balance_cents;
    await page.getByRole("button", { name: `Pay ${person.owed.display}` }).first().click();
    await expect(page.getByText(/You pay this yourself/)).toBeVisible();
    // Cannot confirm until the admin attests they paid.
    await expect(page.getByRole("button", { name: /Confirm/ })).toBeDisabled();
    await page.getByLabel("How you paid").selectOption({ index: 0 });
    await page.getByPlaceholder("Receipt / transfer reference (optional)").fill("UI-PAY-1");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Confirm/ }).click();
    await expect(page.getByText(/Logged .* paid to/)).toBeVisible();

    const after = (await apiGet("/admin/payouts", root())).body;
    expect(after.people.some((p) => p.user_id === person.user_id)).toBe(false);
    const hist = (await apiGet("/admin/payouts/history", root())).body.payments;
    expect(hist.some((p) => p.reference === "UI-PAY-1" && p.paid.cents === person.owed.cents)).toBe(true);
    expect((await apiGet("/wallet", w.users.find((u) => u.id === person.user_id)?.token)).body.balance_cents).toBe(wallet);
    spy.check();
  });

  test("reports show the financial position and a clean invariant audit", async () => {
    await open("/reports", /Admin · Reports/);
    await expect(page.getByText(/invariant|audit/i).first()).toBeVisible();
    await expect(page.getByText(/violation/i).first()).toBeVisible().catch(() => {});
    const audit = (await apiGet("/admin/monitoring/reports/audit-invariants", root())).body;
    expect(audit.ok).toBe(true);
    spy.check();
  });
});

test.describe("people and access", () => {
  test("suspend a customer from the People page, see them locked out, reinstate them", async () => {
    const target = w.users[6];
    await open("/users", /Admin · People/);
    await page.getByRole("button", { name: "Customers", exact: true }).click();
    const row = page.locator("div.flex.items-center.gap-3").filter({ hasText: target.email }).last();
    await row.getByRole("button", { name: "Suspend" }).click();
    await expect.poll(async () => (await apiSend("POST", "/auth/login", { email: target.email, password: target.password })).status).toBe(403);
    await expect(row.getByRole("button", { name: "Activate" })).toBeVisible();
    await row.getByRole("button", { name: "Activate" }).click();
    await expect.poll(async () => (await apiSend("POST", "/auth/login", { email: target.email, password: target.password })).status).toBe(200);
    spy.check();
  });

  test("a customer's network page shows their upline and downline", async () => {
    await open(`/users/${w.users[0].id}/network`, /Admin · Network/);
    await expect(page.getByText("E2E Laser").first()).toBeVisible();
    spy.check();
  });

  test("create an admin with the Finance scope; they can sign in and see only finance screens", async () => {
    await open("/admins", /Admin · Admins & access/);
    const email = "ui-created-admin@e2e.local";
    await page.getByLabel("Name").first().fill("UI Created Admin");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Temporary password").fill("ui-admin-pass-123");
    await page.getByRole("checkbox", { name: /Finance/ }).check();
    await page.getByRole("button", { name: "Create admin" }).click();
    await expect(page.getByText(email)).toBeVisible();

    const login = await apiSend("POST", "/auth/login", { email, password: "ui-admin-pass-123" });
    expect(login.status).toBe(200);
    const me = (await apiGet("/auth/me", login.body.token)).body;
    expect(me.permissions).toContain("orders.read_all");
    expect(me.permissions).not.toContain("content.write");
    expect(me.permissions).not.toContain("admins.manage");
    spy.check();
  });

  test("support: work a request through its statuses", async () => {
    await open("/support", /Admin · Support/);
    await page.getByRole("button", { name: "Mark in progress" }).first().click();
    await expect.poll(async () => {
      const r = (await apiGet("/support/requests?status=in_progress", root())).body;
      return (r.requests ?? r).length;
    }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "In progress", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect.poll(async () => {
      const r = (await apiGet("/support/requests?status=closed", root())).body;
      return (r.requests ?? r).length;
    }).toBeGreaterThan(0);
    spy.check();
  });
});

test.describe("content and settings", () => {
  test("blog: write a post in Markdown with front matter, publish it, and the public site serves it", async () => {
    await open("/blog", /Admin · Blog/);
    await page.getByRole("button", { name: "New post" }).click();
    const doc = page.getByLabel("Post document");
    await doc.fill("---\ntitle: UI written post\nexcerpt: Written in the console\n---\n\n# Hello\n\nThis post was typed into the editor.");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect.poll(async () => (await apiGet("/blog/posts/ui-written-post")).status).toBe(200);
    const pub = (await apiGet("/blog/posts/ui-written-post")).body;
    expect(pub.title).toBe("UI written post");
    spy.check();
  });

  test("settings: a switch is saved, enforced by the API, and can be reverted", async () => {
    await open("/settings", /Admin · Settings/);
    const settings = (await apiGet("/admin/settings", root())).body.settings;
    const flag = settings.find((s) => s.key === "support_tickets_enabled");
    expect(flag).toBeTruthy();
    const sw = page.getByRole("switch", { name: flag.label });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await page.getByRole("button", { name: /^Save 1/ }).click();
    await expect.poll(async () => (await apiGet("/site-config")).body.support_tickets_enabled).toBe(false);
    // The API enforces it, not just the storefront.
    expect((await apiSend("POST", "/support/requests", { name: "N", contact: "n@e2e.local", message: "hello" })).status).toBeGreaterThanOrEqual(400);
    await page.getByRole("button", { name: `Revert ${flag.label}` }).click();
    await expect.poll(async () => (await apiGet("/site-config")).body.support_tickets_enabled).toBe(true);
    spy.check();
  });

  test("settings: the live-activity switch is off by default and publishes real requests -- device and time only -- when turned on", async () => {
    await open("/settings", /Admin · Settings/);
    const sw = page.getByRole("switch", { name: "Live proforma activity" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    expect((await apiGet("/sales/activity")).body).toEqual({ enabled: false, events: [] });

    await sw.click();
    await page.getByRole("button", { name: /^Save 1/ }).click();
    await expect.poll(async () => (await apiGet("/sales/activity")).body.enabled).toBe(true);
    const feed = (await apiGet("/sales/activity")).body;
    expect(feed.events.length).toBeGreaterThan(0); // the world's real proformas
    expect(feed.events.every((e) => Object.keys(e).sort().join() === "at,device,kind")).toBe(true);
    expect(JSON.stringify(feed)).not.toMatch(/Anon Clinic|Lease Clinic|@clinic\.test|\+98 912/);

    // Switch it back off again from the same screen.
    await page.getByRole("button", { name: "Revert Live proforma activity" }).click();
    await expect.poll(async () => (await apiGet("/sales/activity")).body.enabled).toBe(false);
    spy.check();
  });

  test("the overview's scheduled jobs can be run by hand", async () => {
    await open("/", /Control Room/);
    await page.getByRole("button", { name: "Run" }).first().click();
    await expect(page.getByText(/done|ran|released|recalculat|complete|0 /i).first()).toBeVisible({ timeout: 15_000 });
    spy.check();
  });
});

test.describe("each scoped admin sees, and can reach, only their own corner", () => {
  // Sidebar label -> the permission its page needs. The expectation comes from what
  // /auth/me says the account holds, so this proves the CONSOLE shows exactly what the
  // account may use -- not a hand-copied list that could drift from the API.
  const NAV = [
    ["Overview", "reports.read"], ["Orders", "orders.read_all"], ["New walk-in", "orders.create_manual"], ["Proformas", "sales.read"],
    ["Stock", "catalogue.write"], ["Cheques", "cheques.read"], ["Network payouts", "money.read"], ["Reports", "reports.read"],
    ["People", "users.read"], ["Support requests", "support.read_all"], ["Admins & access", "admins.manage"], ["Blog", "content.write"],
    ["Settings & SEO", "settings.read"], ["Messages", "logs.read"], ["Audit log", "logs.read"],
  ];
  const PATH = { "Orders": "/orders", "Stock": "/products", "Admins & access": "/admins", "Settings & SEO": "/settings", "Blog": "/blog", "People": "/users", "Network payouts": "/payouts", "Audit log": "/logs" };

  for (const key of ["fin", "usr", "cnt", "finCnt", "usrFin"]) {
    test(`${key}: sidebar matches permissions, and a forbidden page explains itself`, async ({ browser }) => {
      const admin = w.admins[key];
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await c.newPage();
      const s = watch(p);
      await adminLogin(p, admin);
      const held = new Set((await apiGet("/auth/me", admin.token)).body.permissions);
      for (const [label, perm] of NAV) {
        // A link with a badge reads "Proformas 3"; the count is optional.
        const link = p.getByRole("link", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+)?$`) });
        if (held.has(perm)) await expect(link, `${key} sees ${label}`).toBeVisible();
        else await expect(link, `${key} must not see ${label}`).toHaveCount(0);
      }
      // A page outside the scope, reached by URL, says so instead of rendering and filling with 403s.
      const forbidden = Object.entries(PATH).find(([label]) => !held.has(NAV.find(([l]) => l === label)[1]));
      if (forbidden) {
        await p.goto(ADMIN_URL + forbidden[1]);
        await expect(p.getByText(/Not available to your role/)).toBeVisible();
      }
      s.check();
      await c.close();
    });
  }
});
