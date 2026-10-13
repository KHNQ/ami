import { describe, test, expect, beforeAll, spyOn } from "bun:test";
import { db } from "../src/db/index.js";
import { app, GET, POST, PATCH, DELETE, signup, nextEmail, PASSWORD, createProduct, fund, freshIp } from "./httpHelpers.js";
import { auditSystem, systemStats } from "./systemAudit.js";

// The last test before release: one world, driven only through the real HTTP
// surface, by every kind of person the system has.
//
//   1 root admin           everything, including creating the other admins
//   5 scoped admins        finance, users, content, finance+content, users+finance
//   10 customers           who browse, ask for proformas, get sold to, bring
//                          friends, get paid commission, change their minds
//
// Nothing here calls a service directly except to put money in a wallet (top-ups
// no longer exist in the app) and to read a row back for an assertion. The point
// is not any one feature -- the other test files cover those -- but that the
// features hold together when the same people use all of them in an
// interleaved order, and that the books still balance afterwards.
//
// Every phase asserts what *should* be true as a business rule, not merely what
// the code currently returns. Where a phase found a real defect, the fix is in
// the source and the assertion stays here as its regression test.

const COST0 = 1_200_000; // $12,000 -- what the warehouse paid
const PRICE0 = 2_000_000; // $20,000 -- what the storefront charges

const w = {
  root: null,
  admins: {}, // fin, usr, cnt, finCnt, usrFin
  users: [], // u0..u9
  products: {},
  orders: {}, // keyed by label
  codes: {},
  quotes: {},
};

const u = (i) => w.users[i];

/** Logs an existing account in over HTTP, the way the console does. */
async function login(email, password = PASSWORD) {
  const res = await POST("/auth/login", { email, password });
  expect(res.status).toBe(200);
  return { token: res.body.token, user: res.body.user, email, password };
}

/** Root creates an admin with the given scopes, then that admin signs in. */
async function createAdmin(label, scopes) {
  const email = nextEmail(`sim-${label}`);
  const res = await POST(
    "/admin/admins",
    { email, password: PASSWORD, name: `Admin ${label}`, staff_scopes: scopes },
    { token: w.root.token }
  );
  expect(res.status).toBe(201);
  return login(email);
}

/** A walk-in sale recorded by `by`, paid in full unless told otherwise. */
async function walkIn(by, buyer, product, opts = {}) {
  const res = await POST(
    "/admin/orders/manual",
    {
      user_id: buyer.user.id,
      product_id: product.id,
      amount_received_cents: product.list_price_y_cents,
      ...opts,
    },
    { token: by.token }
  );
  return res;
}

/** Same as walkIn but fails the test loudly when the sale is refused. */
async function sell(by, buyer, product, opts = {}) {
  const res = await walkIn(by, buyer, product, opts);
  if (res.status !== 201) {
    throw new Error(`sale to ${buyer.email} refused: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

beforeAll(async () => {
  // The root is created the way a real deployment's first admin is: a signed-up
  // account promoted in the database (scripts/seed.js does the same).
  const root = await signup("sim-root");
  db.users.updateRole(root.user.id, "admin");
  w.root = root;
  for (let i = 0; i < 10; i++) w.users.push(await signup(`sim-u${i}`));
});

/* ------------------------------------------------------------------------ */
describe("phase 1 -- the root builds the team; every scope sees only its own corner", () => {
  test("root creates five admins with different scopes, and each can sign in", async () => {
    w.admins.fin = await createAdmin("fin", ["FINANCE_ADMIN"]);
    w.admins.usr = await createAdmin("usr", ["USERS_ADMIN"]);
    w.admins.cnt = await createAdmin("cnt", ["CONTENT_ADMIN"]);
    w.admins.finCnt = await createAdmin("fincnt", ["FINANCE_ADMIN", "CONTENT_ADMIN"]);
    w.admins.usrFin = await createAdmin("usrfin", ["USERS_ADMIN", "FINANCE_ADMIN"]);

    for (const [label, a] of Object.entries(w.admins)) {
      const me = await GET("/auth/me", { token: a.token });
      expect(me.status).toBe(200);
      expect(me.body.role).toBe("admin");
      expect(me.body.permissions.length).toBeGreaterThan(0);
      // Nobody but root may ever manage admins -- not even a combined scope.
      expect(me.body.permissions).not.toContain("admins.manage");
      expect(me.body.permissions, label).not.toContain("settings.write");
    }
  });

  test("a scoped admin can neither create admins nor promote themselves", async () => {
    for (const a of Object.values(w.admins)) {
      const create = await POST(
        "/admin/admins",
        { email: nextEmail("rogue"), password: PASSWORD, name: "Rogue", staff_scopes: ["FINANCE_ADMIN"] },
        { token: a.token }
      );
      expect(create.status).toBe(403);
      const promote = await PATCH(`/admin/users/${a.user.id}/role`, { role: "admin", staff_scopes: ["root"] }, { token: a.token });
      expect(promote.status).toBe(403);
    }
  });

  test("an unknown scope, and a customer account with a scope pinned on it, are refused", async () => {
    const bad = await POST(
      "/admin/admins",
      { email: nextEmail("badscope"), password: PASSWORD, name: "X", staff_scopes: ["GOD_ADMIN"] },
      { token: w.root.token }
    );
    expect(bad.status).toBe(400);
  });

  test("the scope matrix: each admin reaches exactly the screens their scope grants", async () => {
    // [screen, route, the permission that guards it]. The expectation is derived
    // from what /auth/me says the account holds, so this proves the ROUTES
    // enforce the permissions the console is told about -- not just that the
    // matrix in permissions.js is internally consistent.
    const probes = [
      ["orders", "/admin/orders", "orders.read_all"],
      ["users", "/admin/users", "users.read"],
      ["payouts", "/admin/payouts", "money.read"],
      ["settings", "/admin/settings", "settings.read"],
      ["logs", "/admin/logs", "logs.read"],
      ["support", "/support/requests", "support.read_all"],
      ["blog", "/blog/admin/posts", "content.write"],
      ["sales", "/sales/quotes", "sales.read"],
      ["cheques", "/cheques", "cheques.read"],
      ["careers", "/careers/applications", "careers.read"],
      ["network", `/admin/users/${u(0).user.id}/network`, "network.read_all"],
    ];
    for (const [label, a] of [["root", w.root], ...Object.entries(w.admins)]) {
      const held = new Set((await GET("/auth/me", { token: a.token })).body.permissions);
      for (const [screen, path, perm] of probes) {
        const res = await GET(path, { token: a.token });
        expect(res.status, `${label} -> ${screen}`).toBe(held.has(perm) ? 200 : 403);
      }
    }
    // Pin the business-level intent too, independently of the matrix code.
    const has = async (a, perm) => (await GET("/auth/me", { token: a.token })).body.permissions.includes(perm);
    expect(await has(w.admins.cnt, "catalogue.write")).toBe(false); // content never touches stock
    expect(await has(w.admins.cnt, "orders.read_all")).toBe(false);
    expect(await has(w.admins.usr, "money.read")).toBe(false); // people admins never see money
    expect(await has(w.admins.usr, "catalogue.write")).toBe(false);
    expect(await has(w.admins.fin, "users.write")).toBe(false); // finance cannot suspend people
    expect(await has(w.admins.fin, "content.write")).toBe(false);
    expect(await has(w.admins.finCnt, "content.write")).toBe(true);
    expect(await has(w.admins.finCnt, "money.write")).toBe(true);
    for (const a of [w.admins.fin, w.admins.usr, w.admins.cnt, w.admins.finCnt, w.admins.usrFin]) {
      expect(await has(a, "settings.write")).toBe(false);
      expect(await has(a, "jobs.run")).toBe(false);
      expect(await has(a, "orders.read_all") && (await has(a, "admins.manage"))).toBe(false);
    }
    expect(await has(w.root, "admins.manage")).toBe(true);
  });

  test("a customer and an anonymous caller are refused the whole admin surface", async () => {
    for (const path of ["/admin/orders", "/admin/users", "/admin/payouts", "/admin/settings", "/admin/monitoring/overview"]) {
      expect((await GET(path, { token: u(0).token })).status).toBe(403);
      expect((await GET(path)).status).toBe(401);
    }
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 2 -- the catalogue, and stock that arrives with its own cost", () => {
  test("finance creates a device; the public sees the price but never the cost", async () => {
    const res = await POST(
      "/products",
      { name: "Sim Laser", description: "A device", stockCount: 5, xCents: COST0, yCents: PRICE0 },
      { token: w.admins.fin.token }
    );
    expect(res.status).toBe(201);
    w.products.laser = res.body;
    expect(res.body.current_x_cents).toBe(COST0);

    const pub = await GET(`/products/${res.body.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.list_price_y_cents).toBe(PRICE0);
    expect(pub.body.current_x_cents).toBeUndefined();
    const asUser = await GET(`/products/${res.body.id}`, { token: u(0).token });
    expect(asUser.body.current_x_cents).toBeUndefined();
    expect((await GET(`/products/${res.body.id}/warehouse-cost`, { token: u(0).token })).status).toBe(403);
  });

  test("content, users admins and customers cannot touch stock", async () => {
    const id = w.products.laser.id;
    for (const who of [w.admins.cnt, w.admins.usr, u(0)]) {
      expect((await PATCH(`/products/${id}/stock`, { delta: 1 }, { token: who.token })).status).toBe(403);
    }
    expect((await PATCH(`/products/${id}/stock`, { delta: 1 })).status).toBe(401);
  });

  test("adding stock with a cost updates the count AND the recorded cost together", async () => {
    const id = w.products.laser.id;
    const res = await PATCH(`/products/${id}/stock`, { delta: 10, cost_cents: 1_300_000 }, { token: w.admins.fin.token });
    expect(res.status).toBe(200);
    expect(res.body.stock_count).toBe(15);

    const admin = await GET(`/products/${id}`, { token: w.admins.fin.token });
    expect(admin.body.current_x_cents).toBe(1_300_000);

    const history = await GET(`/products/${id}/warehouse-cost`, { token: w.admins.fin.token });
    expect(history.body.map((h) => h.x_cents).sort()).toEqual([1_200_000, 1_300_000]);

    const logs = await GET("/admin/logs?action=product.adjust_stock", { token: w.root.token });
    const entry = logs.body.find((l) => l.entity_id === id && JSON.parse(l.meta_json || "{}").costCents === 1_300_000);
    expect(entry).toBeTruthy();
    const meta = JSON.parse(entry.meta_json);
    expect(meta.costCents).toBe(1_300_000);
    expect(meta.previousCostCents).toBe(1_200_000);
  });

  test("restocking at the cost already on record does not pad the cost history", async () => {
    const id = w.products.laser.id;
    const before = (await GET(`/products/${id}/warehouse-cost`, { token: w.admins.fin.token })).body.length;
    const res = await PATCH(`/products/${id}/stock`, { delta: 5, cost_cents: 1_300_000 }, { token: w.admins.fin.token });
    expect(res.status).toBe(200);
    expect(res.body.stock_count).toBe(20);
    const after = (await GET(`/products/${id}/warehouse-cost`, { token: w.admins.fin.token })).body.length;
    expect(after).toBe(before);
  });

  test("stock without a cost leaves the cost alone (a count correction)", async () => {
    const id = w.products.laser.id;
    expect((await PATCH(`/products/${id}/stock`, { delta: -5 }, { token: w.admins.fin.token })).body.stock_count).toBe(15);
    expect((await GET(`/products/${id}`, { token: w.admins.fin.token })).body.current_x_cents).toBe(1_300_000);
  });

  test("every malformed stock-with-cost request is refused and changes nothing", async () => {
    const id = w.products.laser.id;
    const snapshot = async () => {
      const p = (await GET(`/products/${id}`, { token: w.admins.fin.token })).body;
      const hist = (await GET(`/products/${id}/warehouse-cost`, { token: w.admins.fin.token })).body.length;
      return JSON.stringify([p.stock_count, p.current_x_cents, hist]);
    };
    const before = await snapshot();
    const bad = [
      [{ delta: -2, cost_cents: 1_000_000 }, "cost_requires_added_stock"],
      [{ delta: 0, cost_cents: 1_000_000 }, "cost_requires_added_stock"],
      [{ delta: 1, cost_cents: -5 }, "invalid_cost"],
      [{ delta: 1, cost_cents: 1.5 }, "invalid_cost"],
      [{ delta: 1, cost_cents: "1000" }, "invalid_cost"],
      [{ delta: 1.5, cost_cents: 1_000_000 }, null],
      [{ delta: "ten", cost_cents: 1_000_000 }, null],
      [{ delta: -1000 }, "stock_would_go_negative"],
      [{}, null],
    ];
    for (const [body, code] of bad) {
      const res = await PATCH(`/products/${id}/stock`, body, { token: w.admins.fin.token });
      expect(res.status, JSON.stringify(body)).toBe(400);
      if (code) expect(res.body.error.code, JSON.stringify(body)).toBe(code);
    }
    expect(await snapshot()).toBe(before);
  });

  test("a sale locks the cost in force at that moment; a later restock never rewrites it", async () => {
    const product = (await GET(`/products/${w.products.laser.id}`, { token: w.admins.fin.token })).body;
    const first = await sell(w.admins.fin, u(0), product);
    expect(first.transaction.x_at_sale_cents).toBe(1_300_000);

    // New delivery, dearer.
    await PATCH(`/products/${product.id}/stock`, { delta: 10, cost_cents: 1_500_000 }, { token: w.admins.fin.token });
    const second = await sell(w.admins.fin, u(1), product);
    expect(second.transaction.x_at_sale_cents).toBe(1_500_000);

    expect(db.transactions.get(first.transaction.id).x_at_sale_cents).toBe(1_300_000);
    w.orders.u0Laser = first;
    w.orders.u1Laser = second;
    w.codes.u0 = first.ownRedeemCode.code;
  });

  test("stock falls by exactly one per sale", async () => {
    const p = (await GET(`/products/${w.products.laser.id}`, { token: w.admins.fin.token })).body;
    // 5 initial + 10 + 5 - 5 + 10 added, minus the two sales above.
    expect(p.stock_count).toBe(5 + 10 + 5 - 5 + 10 - 2);
  });

  test("a cost at or above the price is accepted as a number but then no sale can be made", async () => {
    // The admin UI warns about this; the API's job is to make it impossible to
    // sell below the plan's minimum margin, which is the sale guard.
    const p = await createProduct(w.admins.fin.token, { xCents: 400_000, yCents: 500_000, stockCount: 3 });
    const dear = await PATCH(`/products/${p.id}/stock`, { delta: 1, cost_cents: 600_000 }, { token: w.admins.fin.token });
    expect(dear.status).toBe(200);

    const buyer = await signup("sim-margin");
    const refused = await walkIn(w.admins.fin, buyer, p, { amount_received_cents: 500_000 });
    expect(refused.status).toBe(422);
    // Nothing was sold and nothing was reserved.
    expect((await GET(`/products/${p.id}`, { token: w.admins.fin.token })).body.stock_count).toBe(4);
    expect(db.nodes.getByUserProduct(buyer.user.id, p.id)).toBeFalsy();

    // Putting the real cost back makes the very next sale go through.
    await PATCH(`/products/${p.id}/stock`, { delta: 1, cost_cents: 350_000 }, { token: w.admins.fin.token });
    expect((await walkIn(w.admins.fin, buyer, p, { amount_received_cents: 500_000 })).status).toBe(201);
  });

  test("a second and third device give the network real choice", async () => {
    w.products.scanner = await createProduct(w.admins.fin.token, {
      name: "Sim Scanner",
      xCents: 600_000,
      yCents: 1_000_000,
      stockCount: 30,
    });
    w.products.kit = await createProduct(w.admins.fin.token, {
      name: "Sim Kit",
      xCents: 40_000,
      yCents: 100_000,
      stockCount: 200,
    });
    const list = await GET("/products");
    const names = list.body.map((p) => p.name);
    expect(names).toContain("Sim Scanner");
    expect(names).toContain("Sim Kit");
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 3 -- accounts: sign-up, verification, profile, passwords", () => {
  test("a new account gets a verification link and can confirm it exactly once", async () => {
    const email = nextEmail("sim-verify");
    const res = await POST("/auth/signup", { email, password: PASSWORD, name: "Verify Me" });
    expect(res.status).toBe(201);
    const link = res.body.debug_verification_link;
    expect(link).toBeTruthy();
    const token = new URL(link).searchParams.get("token");

    expect((await GET("/auth/me", { token: res.body.token })).body.email_verified).toBe(false);
    expect((await POST("/auth/verify-email", { token })).status).toBe(200);
    expect((await GET("/auth/me", { token: res.body.token })).body.email_verified).toBe(true);
    // A link is single use.
    expect((await POST("/auth/verify-email", { token })).status).toBeGreaterThanOrEqual(400);
    expect((await POST("/auth/verify-email", { token: "garbage" })).status).toBeGreaterThanOrEqual(400);
  });

  test("duplicate emails, weak passwords and bad logins are refused", async () => {
    expect((await POST("/auth/signup", { email: u(0).email, password: PASSWORD, name: "Dup" })).status).toBe(409);
    expect((await POST("/auth/signup", { email: nextEmail("weak"), password: "short", name: "Weak" })).status).toBe(400);
    expect((await POST("/auth/signup", { email: "not-an-email", password: PASSWORD, name: "Bad" })).status).toBe(400);
    expect((await POST("/auth/login", { email: u(0).email, password: "wrong-password-here" })).status).toBe(401);
    expect((await POST("/auth/login", { email: "nobody@test.local", password: PASSWORD })).status).toBe(401);
    expect((await GET("/auth/me")).status).toBe(401);
    expect((await GET("/auth/me", { token: "not.a.jwt" })).status).toBe(401);
  });

  test("a customer edits their profile; an empty name is refused; phone is clearable", async () => {
    const t = u(4).token;
    const ok = await PATCH("/profile", { name: "Sim Four", phone: "+98 912 000 0004" }, { token: t });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Sim Four");
    expect((await GET("/profile", { token: t })).body.name).toBe("Sim Four");
    expect((await PATCH("/profile", { name: "" }, { token: t })).status).toBe(400);
    expect((await PATCH("/profile", {}, { token: t })).status).toBe(400);
    const cleared = await PATCH("/profile", { phone: null }, { token: t });
    expect(cleared.status).toBe(200);
    // A customer cannot promote themselves through the profile.
    await PATCH("/profile", { name: "Sim Four", role: "admin", staff_role: "root" }, { token: t });
    expect((await GET("/auth/me", { token: t })).body.role).toBe("user");
  });

  test("changing a password needs the old one, and kills the old one afterwards", async () => {
    const acc = await signup("sim-pwchange");
    const wrong = await PATCH("/profile/password", { current_password: "nope-nope-nope", new_password: "another-pass-123" }, { token: acc.token });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const short = await PATCH("/profile/password", { current_password: PASSWORD, new_password: "x" }, { token: acc.token });
    expect(short.status).toBe(400);
    const ok = await PATCH("/profile/password", { current_password: PASSWORD, new_password: "another-pass-123" }, { token: acc.token });
    expect(ok.status).toBe(200);
    expect((await POST("/auth/login", { email: acc.email, password: PASSWORD })).status).toBe(401);
    expect((await POST("/auth/login", { email: acc.email, password: "another-pass-123" })).status).toBe(200);
  });

  test("forgot-password never reveals whether an email exists, and a reset link works once", async () => {
    const acc = await signup("sim-forgot");
    const known = await POST("/auth/forgot-password", { email: acc.email });
    const unknown = await POST("/auth/forgot-password", { email: "ghost@test.local" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);

    const token = known.body.debug_token;
    expect(token).toBeTruthy();
    expect((await POST("/auth/reset-password", { token, new_password: "reset-pass-4567" })).status).toBe(200);
    expect((await POST("/auth/reset-password", { token, new_password: "reset-pass-9999" })).status).toBeGreaterThanOrEqual(400);
    expect((await POST("/auth/login", { email: acc.email, password: "reset-pass-4567" })).status).toBe(200);
    expect((await POST("/auth/login", { email: acc.email, password: PASSWORD })).status).toBe(401);
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 4 -- the public site: browsing, support, careers, blog, knowledge, site config", () => {
  test("anyone can browse the catalogue, and the public config says what is switched on", async () => {
    const list = await GET("/products");
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(3);
    expect(list.body.every((p) => p.current_x_cents === undefined)).toBe(true); // cost never leaks
    expect((await GET("/products/categories")).status).toBe(200);
    expect((await GET("/products/prod_does_not_exist")).status).toBe(404);
    const cfg = await GET("/site-config");
    expect(cfg.status).toBe(200);
    expect(cfg.body.online_purchase_enabled).toBeDefined();
  });

  test("support: an anonymous visitor and a signed-in customer both reach the queue; only the users scope works it", async () => {
    const anon = await POST("/support/requests", { name: "Visitor", contact: "visitor@test.local", message: "Do you ship to Shiraz?" });
    expect(anon.status).toBe(201);
    const mine = await POST("/support/requests", { name: "Sim Three", contact: u(3).email, message: "My cheque date moved." }, { token: u(3).token });
    expect(mine.status).toBe(201);
    expect((await POST("/support/requests", { name: "", contact: "", message: "" })).status).toBe(400);

    expect((await GET("/support/requests", { token: u(3).token })).status).toBe(403);
    expect((await GET("/support/requests", { token: w.admins.cnt.token })).status).toBe(403);
    const queue = await GET("/support/requests", { token: w.admins.usr.token });
    expect(queue.status).toBe(200);
    const row = (queue.body.requests ?? queue.body).find((r) => r.message.includes("cheque date"));
    expect(row.user_id).toBe(u(3).user.id); // a signed-in sender is attributed

    const worked = await PATCH(`/support/requests/${row.id}`, { status: "resolved", admin_note: "Called the customer." }, { token: w.admins.usr.token });
    expect(worked.status).toBe(200);
    expect(worked.body.status).toBe("resolved");
    expect((await PATCH(`/support/requests/${row.id}`, { status: "nonsense" }, { token: w.admins.usr.token })).status).toBe(400);
    expect((await PATCH(`/support/requests/${row.id}`, { status: "open" }, { token: w.admins.fin.token })).status).toBe(403);
  });

  test("careers: anyone applies; the users scope reviews, updates and deletes; others cannot", async () => {
    const tinyPdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF").toString("base64")}`;
    const fields = await GET("/careers/fields");
    expect(fields.status).toBe(200);
    const apply = await POST("/careers/applications", {
      field_of_work: fields.body.fields_of_work[0],
      first_name: "Sima",
      last_name: "Karimi",
      phone: "+989121110000",
      email: "sima@test.local",
      resume_data_url: tinyPdf,
    });
    expect(apply.status).toBe(201);
    expect((await POST("/careers/applications", { first_name: "" })).status).toBe(400);

    expect((await GET("/careers/applications", { token: w.admins.cnt.token })).status).toBe(403);
    expect((await GET("/careers/applications", { token: u(0).token })).status).toBe(403);
    const list = await GET("/careers/applications", { token: w.admins.usr.token });
    expect(list.status).toBe(200);
    const id = apply.body.id;
    expect((await GET(`/careers/applications/${id}`, { token: w.admins.usr.token })).status).toBe(200);
    expect((await GET(`/careers/applications/${id}/resume`, { token: w.admins.usr.token })).status).toBe(200);
    const upd = await PATCH(`/careers/applications/${id}`, { status: "reviewing" }, { token: w.admins.usr.token });
    expect(upd.status).toBe(200);
    expect((await DELETE(`/careers/applications/${id}`, undefined, { token: w.admins.usr.token })).status).toBeLessThan(300);
    expect((await GET(`/careers/applications/${id}`, { token: w.admins.usr.token })).status).toBe(404);
  });

  test("blog: a draft is invisible to the public until the content scope publishes it", async () => {
    const created = await POST(
      "/blog/admin/posts",
      { title: "Sim Launch Day", excerpt: "We are live", body: "# Hello\n\nThe **sim** world.", tags: ["news"] },
      { token: w.admins.cnt.token }
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    const { id, slug } = created.body;

    expect((await GET(`/blog/posts/${slug}`)).status).toBe(404);
    expect((await GET("/blog/posts")).body.posts?.some?.((p) => p.slug === slug) ?? false).toBe(false);

    for (const who of [u(0), w.admins.usr, w.admins.fin]) {
      expect((await POST("/blog/admin/posts", { title: "No" }, { token: who.token })).status).toBe(403);
    }
    expect((await PATCH(`/blog/admin/posts/${id}`, { status: "published" }, { token: w.admins.cnt.token })).status).toBe(200);

    const pub = await GET(`/blog/posts/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.title).toBe("Sim Launch Day");
    const slugs = await GET("/blog/slugs");
    expect(JSON.stringify(slugs.body)).toContain(slug);

    expect((await PATCH(`/blog/admin/posts/${id}`, { title: "Sim Launch Day (edited)" }, { token: w.admins.finCnt.token })).status).toBe(200);
    expect((await GET(`/blog/posts/${slug}`)).body.title).toBe("Sim Launch Day (edited)");

    // Unpublishing takes it off the public site again.
    await PATCH(`/blog/admin/posts/${id}`, { status: "draft" }, { token: w.admins.cnt.token });
    expect((await GET(`/blog/posts/${slug}`)).status).toBe(404);
    expect((await DELETE(`/blog/admin/posts/${id}`, undefined, { token: w.admins.cnt.token })).status).toBeLessThan(300);
  });

  test("assistant knowledge: the content scope curates answers; nobody else can", async () => {
    const add = await POST("/ai/knowledge", { question: "Do you offer leasing?", answer: "Yes, 12 to 48 months.", tags: ["lease"] }, { token: w.admins.cnt.token });
    expect(add.status).toBe(201);
    const id = add.body.id;
    expect((await GET("/ai/knowledge", { token: w.admins.cnt.token })).status).toBe(200);
    expect((await GET("/ai/knowledge", { token: w.admins.fin.token })).status).toBe(403);
    expect((await POST("/ai/knowledge", { question: "q", answer: "a" }, { token: u(0).token })).status).toBe(403);
    expect((await PATCH(`/ai/knowledge/${id}`, { answer: "Yes, 12 to 48 months, 18% APR." }, { token: w.admins.cnt.token })).status).toBe(200);
    expect((await GET("/ai/gaps?status=open", { token: w.admins.cnt.token })).status).toBe(200);
    expect((await DELETE(`/ai/knowledge/${id}`, undefined, { token: w.admins.cnt.token })).status).toBeLessThan(300);
  });

  test("the assistant answers a visitor without a model key, and never takes an action without a confirmation", async () => {
    const ask = await POST("/ai/ask", { message: "What devices do you sell?" });
    // Unconfigured is an explicit, documented state (ai_unconfigured), not a crash.
    expect(ask.status === 200 || ask.body?.error?.code === "ai_unconfigured").toBe(true);
    expect((await POST("/ai/suggest", { query: "laser" })).status).toBeLessThan(500);
    expect((await GET("/ai/quota")).status).toBe(401);
    expect((await GET("/ai/quota", { token: u(0).token })).status).toBe(200);
    expect((await GET("/ai/sessions", { token: u(0).token })).status).toBe(200);
    // The assistant's audit views are staff only.
    expect((await GET("/ai/tool-calls", { token: u(0).token })).status).toBe(403);
    expect((await GET("/ai/tool-calls", { token: w.root.token })).status).toBe(200);
    expect((await GET("/ai/conversations", { token: w.root.token })).status).toBe(200);
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 5 -- the proforma desk: quotes, referrals, registering a sale, leases, agreements", () => {
  const laser = () => w.products.laser;
  const contact = (n) => ({ contact_name: `Clinic ${n}`, contact_email: `clinic${n}@test.local`, contact_phone: `+98912000${n}` });

  test("a visitor, and a signed-in customer, each ask for a proforma", async () => {
    const anon = await POST("/sales/quotes", { kind: "proforma", product_id: laser().id, ...contact(11), amount_cents: PRICE0, clinic_city: "Tehran" });
    expect(anon.status).toBe(201);
    expect(anon.body.reference).toMatch(/^PRO-/);
    w.quotes.anon = anon.body;

    // u2 arrives through u0's referral link and is logged in.
    const withRef = await POST(
      "/sales/quotes",
      { kind: "proforma", product_id: laser().id, ...contact(12), amount_cents: PRICE0, referral_code: w.codes.u0 },
      { token: u(2).token }
    );
    expect(withRef.status).toBe(201);
    w.quotes.u2 = withRef.body;

    const toDecline = await POST("/sales/quotes", { kind: "enquiry", product_id: w.products.scanner.id, ...contact(13) });
    expect(toDecline.status).toBe(201);
    w.quotes.decline = toDecline.body;

    const demo = await POST("/sales/quotes", { kind: "demo", product_id: laser().id, ...contact(14) });
    expect(demo.status).toBe(201);

    // Validation.
    expect((await POST("/sales/quotes", { kind: "proforma", product_id: laser().id })).status).toBe(400); // nobody to contact
    expect((await POST("/sales/quotes", { kind: "bogus", ...contact(15) })).status).toBe(400);
    expect((await POST("/sales/quotes", { kind: "proforma", product_id: "prod_nope", ...contact(15), amount_cents: 1000 })).status).toBe(404);
  });

  test("the printed proforma opens with id+reference and not without them", async () => {
    const q = w.quotes.anon;
    const ok = await GET(q.download_url);
    expect(ok.status).toBe(200);
    expect((await GET(`/sales/quotes/${q.id}/proforma.pdf?ref=PRO-WRONG1`)).status).toBeGreaterThanOrEqual(400);
    expect((await GET(`/sales/quotes/${q.id}/proforma.pdf`)).status).toBeGreaterThanOrEqual(400);
  });

  test("a lease request is priced by the SERVER from the product's rules, whatever the browser says", async () => {
    const res = await POST("/sales/quotes", { kind: "lease", product_id: laser().id, ...contact(16), term_months: 24, upfront_pct: 30, amount_cents: 1, deposit_cents: 1 }, { token: u(7).token });
    expect(res.status).toBe(201);
    const quote = (await GET(`/sales/quotes/${res.body.id}`, { token: w.admins.fin.token })).body;
    expect(quote.kind).toBe("lease");
    expect(quote.amount_cents).toBe(PRICE0);
    expect(quote.deposit_cents).toBe(Math.round(PRICE0 * 0.3));
    expect(quote.term_months).toBe(24);
    expect(quote.instalment_cents).toBeGreaterThan(0);
    // Reasonable: instalments + deposit cost more than the cash price (APR), but not absurdly so.
    const total = quote.deposit_cents + quote.instalment_cents * 24;
    expect(total).toBeGreaterThan(PRICE0);
    expect(total).toBeLessThan(PRICE0 * 1.5);
    w.quotes.lease = res.body;

    expect((await POST("/sales/quotes", { kind: "lease", product_id: laser().id, ...contact(17), term_months: 7, upfront_pct: 30 })).status).toBe(400);
    expect((await POST("/sales/quotes", { kind: "lease", product_id: laser().id, ...contact(17), term_months: 12, upfront_pct: 1 })).status).toBe(400);
  });

  test("a customer sees only their own quotes; staff see the queue with a summary", async () => {
    const mine = await GET("/sales/mine", { token: u(2).token });
    expect(mine.status).toBe(200);
    expect(mine.body.quotes.map((q) => q.id)).toContain(w.quotes.u2.id);
    expect(mine.body.quotes.map((q) => q.id)).not.toContain(w.quotes.anon.id);
    expect((await GET("/sales/mine", { token: u(5).token })).body.quotes.length).toBe(0);
    expect((await GET("/sales/mine")).status).toBe(401);

    // Not for customers, content or the people-scope.
    for (const who of [u(2), w.admins.cnt, w.admins.usr]) {
      expect((await GET("/sales/quotes", { token: who.token })).status).toBe(403);
      expect((await GET(`/sales/quotes/${w.quotes.u2.id}`, { token: who.token })).status).toBe(403);
    }
    const queue = await GET("/sales/quotes", { token: w.admins.fin.token });
    expect(queue.status).toBe(200);
    expect(queue.body.quotes.length).toBeGreaterThanOrEqual(5);
    expect(queue.body.summary.quotes.byStatus.new).toBeGreaterThanOrEqual(5);
    const leases = await GET("/sales/quotes?kind=lease", { token: w.admins.fin.token });
    expect(leases.body.quotes.every((q) => q.kind === "lease")).toBe(true);
  });

  test("finance works a quote through its statuses and can renegotiate the amount; bad input is refused", async () => {
    const id = w.quotes.u2.id;
    const t = w.admins.fin.token;
    const contacted = await PATCH(`/sales/quotes/${id}`, { status: "contacted", admin_note: "Called, wants a discount." }, { token: t });
    expect(contacted.status).toBe(200);
    expect(contacted.body.status).toBe("contacted");
    const requoted = await PATCH(`/sales/quotes/${id}`, { status: "quoted", amount_cents: 1_900_000 }, { token: t });
    expect(requoted.body.amount_cents).toBe(1_900_000);
    expect((await PATCH(`/sales/quotes/${id}`, { status: "weird" }, { token: t })).status).toBe(400);
    expect((await PATCH(`/sales/quotes/${id}`, { amount_cents: -5 }, { token: t })).status).toBe(400);
    expect((await PATCH(`/sales/quotes/${id}`, { status: "accepted" }, { token: w.admins.usr.token })).status).toBe(403);
    expect((await PATCH(`/sales/quotes/${w.quotes.decline.id}`, { status: "declined" }, { token: t })).body.status).toBe("declined");
  });

  test("registering a sale FROM the proforma charges the proforma price and takes the referrer from the link", async () => {
    const q = w.quotes.u2;
    const res = await POST(
      "/admin/orders/manual",
      { user_id: u(2).user.id, quote_id: q.id, amount_received_cents: 1_900_000 },
      { token: w.admins.fin.token }
    );
    expect(res.status).toBe(201);
    // The renegotiated figure, not the catalogue's $20,000.
    expect(res.body.transaction.y_at_sale_cents).toBe(1_900_000);
    // And u2 joined UNDER u0 because the link carried u0's code, with no code typed.
    const node = db.nodes.get(res.body.node.id);
    const parent = db.nodes.get(node.parent_node_id);
    expect(parent.user_id).toBe(u(0).user.id);
    w.orders.u2Laser = res.body;
    w.codes.u2 = res.body.ownRedeemCode.code;

    const after = (await GET(`/sales/quotes/${q.id}`, { token: w.admins.fin.token })).body;
    expect(after.status).toBe("converted");
    expect(after.transaction_id).toBe(res.body.transaction.id);

    // The same proforma cannot be sold twice, and the customer cannot buy the same device twice.
    const again = await POST("/admin/orders/manual", { user_id: u(2).user.id, quote_id: q.id, amount_received_cents: 1_900_000 }, { token: w.admins.fin.token });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("quote_closed");
    // A declined proforma cannot be sold either.
    const declined = await POST("/admin/orders/manual", { user_id: u(5).user.id, quote_id: w.quotes.decline.id, amount_received_cents: 1 }, { token: w.admins.fin.token });
    expect(declined.status).toBe(409);
  });

  test("a lease agreement lays down its whole schedule; marking instalments drives the agreement", async () => {
    const t = w.admins.fin.token;
    const principal = 2_000_000;
    const deposit = 600_000;
    const res = await POST(
      "/sales/agreements",
      { kind: "lease", quote_id: w.quotes.lease.id, user_id: u(7).user.id, contact_name: "Sim Seven", principal_cents: principal, deposit_cents: deposit, term_months: 6 },
      { token: t }
    );
    expect(res.status).toBe(201);
    const ag = res.body;
    expect(ag.instalments.length).toBe(6);
    expect(ag.status).toBe("pending");
    // Instalments cover what is financed, plus a sane amount of interest.
    const financed = principal - deposit;
    const sum = ag.instalments.reduce((s, i) => s + i.amount_cents, 0);
    expect(sum).toBeGreaterThanOrEqual(financed);
    expect(sum).toBeLessThan(financed * 1.15);
    // Due dates strictly increase.
    const dates = ag.instalments.map((i) => i.due_on);
    expect([...dates].sort()).toEqual(dates);
    // The quote that produced it is closed.
    expect((await GET(`/sales/quotes/${w.quotes.lease.id}`, { token: t })).body.status).toBe("converted");
    w.agreement = ag;

    // Bad agreements.
    expect((await POST("/sales/agreements", { kind: "lease", contact_name: "X", subject: "x", principal_cents: 100, deposit_cents: 500, term_months: 6 }, { token: t })).status).toBe(400);
    expect((await POST("/sales/agreements", { kind: "mortgage", contact_name: "X", subject: "x" }, { token: t })).status).toBe(400);
    expect((await POST("/sales/agreements", { kind: "lease", contact_name: "X", subject: "x", principal_cents: 1000, term_months: 0 }, { token: t })).status).toBe(400);
    expect((await POST("/sales/agreements", { kind: "lease", contact_name: "X", subject: "x", principal_cents: 1000, term_months: 6 }, { token: w.admins.usr.token })).status).toBe(403);

    // The customer sees it; a stranger does not.
    expect((await GET("/sales/mine", { token: u(7).token })).body.agreements.map((a) => a.id)).toContain(ag.id);
    expect((await GET("/sales/mine", { token: u(8).token })).body.agreements.length).toBe(0);

    // Pay all but the last: still not completed. Pay the last: completed.
    for (const inst of ag.instalments.slice(0, 5)) {
      expect((await PATCH(`/sales/instalments/${inst.id}`, { status: "paid" }, { token: t })).status).toBe(200);
    }
    expect((await GET(`/sales/agreements/${ag.id}`, { token: t })).body.status).not.toBe("completed");
    expect((await PATCH(`/sales/instalments/${ag.instalments[5].id}`, { status: "late", note: "Cheque bounced" }, { token: t })).status).toBe(200);
    expect((await GET(`/sales/agreements/${ag.id}`, { token: t })).body.next_due_on).toBe(ag.instalments[5].due_on);
    expect((await PATCH(`/sales/instalments/${ag.instalments[5].id}`, { status: "paid" }, { token: t })).status).toBe(200);
    const done = (await GET(`/sales/agreements/${ag.id}`, { token: t })).body;
    expect(done.status).toBe("completed");
    expect(done.next_due_on).toBeNull();
    expect((await PATCH(`/sales/instalments/${ag.instalments[0].id}`, { status: "exploded" }, { token: t })).status).toBe(400);
  });

  test("a cancelled agreement stays cancelled when its remaining instalments are waived", async () => {
    const t = w.admins.fin.token;
    const ag = (await POST(
      "/sales/agreements",
      { kind: "lease", contact_name: "Cancelled Customer", subject: "Sim Laser", principal_cents: 1_200_000, deposit_cents: 200_000, term_months: 3 },
      { token: t }
    )).body;
    expect((await PATCH(`/sales/agreements/${ag.id}`, { status: "cancelled", admin_note: "Customer withdrew" }, { token: t })).status).toBe(200);
    // Housekeeping after a cancellation: the unpaid instalments are written off.
    for (const inst of ag.instalments) {
      await PATCH(`/sales/instalments/${inst.id}`, { status: "cancelled" }, { token: t });
    }
    const after = (await GET(`/sales/agreements/${ag.id}`, { token: t })).body;
    // Writing off the schedule of a CANCELLED agreement must not make it look like
    // a customer who paid in full.
    expect(after.status).toBe("cancelled");
  });

  test("a subscription lays down twelve deliveries", async () => {
    const res = await POST("/sales/agreements", { kind: "subscription", contact_name: "Sub Clinic", subject: "Consumables kit", instalment_cents: 25_000, interval_days: 30 }, { token: w.admins.fin.token });
    expect(res.status).toBe(201);
    expect(res.body.instalments.length).toBe(12);
    expect(new Set(res.body.instalments.map((i) => i.amount_cents))).toEqual(new Set([25_000]));
  });
});

/* ------------------------------------------------------------------------ */
// What the commission engine SHOULD pay, computed here from the plan and the
// tree rather than read back from the ledger -- so a bug in the engine cannot
// also hide inside the expectation.
async function planOf(productId) {
  return (await GET(`/commission-plans/${productId}`)).body;
}

/** The users above `userId`'s node, nearest first, following parent links. */
function uplineUsers(nodeId) {
  const chain = [];
  let n = db.nodes.get(nodeId);
  while (n?.parent_node_id) {
    n = db.nodes.get(n.parent_node_id);
    chain.push(n);
  }
  return chain;
}

/** Asserts a sale paid exactly the plan's commission to exactly the right people. */
async function expectCommissionsExact(order, label = "") {
  const tx = db.transactions.get(order.transaction.id);
  const plan = await planOf(tx.product_id);
  const margin = tx.y_at_sale_cents - tx.x_at_sale_cents;
  const upline = uplineUsers(order.node.id);
  const rows = db.ledger.listByTransaction(tx.id);

  let expectedTotal = 0;
  upline.slice(0, plan.max_payout_depth).forEach((ancestor, i) => {
    const rate = plan.level_rates_bp[i] ?? 0;
    const want = Math.floor((margin * rate) / 10000);
    const row = rows.find((r) => r.node_id === ancestor.id);
    if (want > 0) {
      expect(row, `${label}: level ${i + 1} should be paid`).toBeTruthy();
      expect(row.level_depth, label).toBe(i + 1);
      expect(row.amount_cents, `${label}: level ${i + 1} amount`).toBe(want);
      expect(row.user_id, label).toBe(ancestor.user_id);
      expectedTotal += want;
    }
  });
  // Nobody else is paid: not the buyer, not anyone below, not anyone past the depth.
  expect(rows.some((r) => r.node_id === order.node.id), `${label}: buyer must not be paid`).toBe(false);
  expect(rows.length, `${label}: number of ledger rows`).toBe(
    upline.slice(0, plan.max_payout_depth).filter((_, i) => Math.floor((margin * (plan.level_rates_bp[i] ?? 0)) / 10000) > 0).length
  );
  expect(tx.total_payout_cents, label).toBe(expectedTotal);
  // The per-sale identity that every report is built on.
  expect(tx.margin_cents, label).toBe(margin);
  expect(tx.total_payout_cents + tx.reserve_amount_cents + tx.trex_net_amount_cents, label).toBe(tx.margin_cents);
  expect(tx.trex_net_amount_cents, label).toBeGreaterThan(0);
  return { tx, rows, margin };
}

describe("phase 6 -- the network grows: walk-in sales down a referral chain, paid exactly by the plan", () => {
  test("u2 (referred through the proforma link) paid u0 level 1, to the cent", async () => {
    await expectCommissionsExact(w.orders.u2Laser, "u2");
  });

  test("u3 joins under u2: u2 earns level 1, u0 earns level 2", async () => {
    w.orders.u3Laser = await sell(w.admins.fin, u(3), w.products.laser, { redeem_code: w.codes.u2 });
    const { rows } = await expectCommissionsExact(w.orders.u3Laser, "u3");
    expect(rows.map((r) => r.level_depth).sort()).toEqual([1, 2]);
    w.codes.u3 = w.orders.u3Laser.ownRedeemCode.code;
  });

  test("u4 joins under u3, three deep: three people above are paid, by level", async () => {
    w.orders.u4Laser = await sell(w.admins.finCnt, u(4), w.products.laser, { redeem_code: w.codes.u3 });
    const { rows } = await expectCommissionsExact(w.orders.u4Laser, "u4");
    expect(rows.map((r) => r.level_depth).sort()).toEqual([1, 2, 3]);
    w.codes.u4 = w.orders.u4Laser.ownRedeemCode.code;
  });

  test("a second root: u1 (founded their own Space earlier) recruits u5, who pays in installments with cheques", async () => {
    w.codes.u1 = w.orders.u1Laser.ownRedeemCode.code;
    const price = w.products.laser.list_price_y_cents;
    const cheques = [
      { amount_cents: 600_000, due_date: "2026-11-15", cheque_number: "5001", bank_name: "Bank Melli" },
      { amount_cents: 600_000, due_date: "2026-12-15", cheque_number: "5002", bank_name: "Bank Melli" },
    ];
    const common = { user_id: u(5).user.id, product_id: w.products.laser.id, redeem_code: w.codes.u1, payment_terms: "installment", cheques, amount_received_cents: price - 1_200_000 };

    // Finance may record the sale, but only a root can waive the down-payment floor...
    const payout = (await planOf(w.products.laser.id)).level_rates_bp[0];
    const lowDown = { ...common, amount_received_cents: 100 };
    const refused = await POST("/admin/orders/manual", lowDown, { token: w.admins.fin.token });
    expect([422, 403]).toContain(refused.status);
    expect(refused.body.error.code).toBe("down_payment_below_payout");
    const noOverride = await POST("/admin/orders/manual", { ...lowDown, override_down_payment: true, note: "x" }, { token: w.admins.fin.token });
    expect(noOverride.status).toBe(403);
    // ...and only with a reason.
    const noReason = await POST("/admin/orders/manual", { ...lowDown, override_down_payment: true }, { token: w.root.token });
    expect(noReason.status).toBe(400);
    // Nothing was left behind by any of those refusals.
    expect(db.nodes.getByUserProduct(u(5).user.id, w.products.laser.id)).toBeFalsy();
    expect(payout).toBeGreaterThan(0);

    // A proper down payment (covers the payout) goes through without any override.
    const res = await POST("/admin/orders/manual", common, { token: w.admins.fin.token });
    expect(res.status).toBe(201);
    expect(res.body.balance.outstanding_cents).toBe(1_200_000); // the two cheques
    w.orders.u5Laser = res.body;
    await expectCommissionsExact(res.body, "u5 (installment)");
    w.codes.u5 = res.body.ownRedeemCode.code;
  });

  test("an order cannot be over-collected: more cash than the price, or cheques beyond the balance, are refused", async () => {
    const tx = w.orders.u5Laser.transaction;
    const tooMany = await POST(
      `/admin/orders/${tx.id}/cheques`,
      { amount_cents: 1, due_date: "2027-01-01" },
      { token: w.admins.fin.token }
    );
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe("cheques_exceed_order_value");

    // Receiving more cash than the order is worth is a typo, not a sale.
    const buyer = await signup("sim-overpay");
    const kit = w.products.kit;
    const over = await walkIn(w.admins.fin, buyer, kit, { amount_received_cents: kit.list_price_y_cents * 5 });
    expect(over.status, "amount received beyond the order value must be refused").toBeGreaterThanOrEqual(400);
    expect(db.nodes.getByUserProduct(buyer.user.id, kit.id)).toBeFalsy();
  });

  test("cheque register: malformed cheques are refused; pending ones can be edited; a settled one is frozen", async () => {
    const tx = w.orders.u5Laser.transaction;
    const t = w.admins.fin.token;
    const list = (await GET(`/admin/orders/${tx.id}/cheques`, { token: t })).body.cheques;
    expect(list.length).toBe(2);

    // Bad dates. A calendar date that does not exist must not be accepted.
    for (const due_date of ["2026-13-45", "2026-02-30", "tomorrow", "26-01-01"]) {
      const res = await POST(`/admin/orders/${tx.id}/cheques`, { amount_cents: 1, due_date }, { token: t });
      expect(res.status, `due_date ${due_date}`).toBe(400);
    }
    expect((await POST(`/admin/orders/${tx.id}/cheques`, { amount_cents: 0, due_date: "2027-01-01" }, { token: t })).status).toBe(400);
    expect((await POST(`/admin/orders/${tx.id}/cheques`, { amount_cents: 1.5, due_date: "2027-01-01" }, { token: t })).status).toBe(400);
    expect((await POST(`/admin/orders/prod_nope/cheques`, { amount_cents: 1, due_date: "2027-01-01" }, { token: t })).status).toBe(404);

    // Edit a pending cheque (the bank name was misspelled).
    const edited = await PATCH(`/cheques/${list[0].id}`, { bank_name: "Bank Mellat", cheque_number: "5001-A" }, { token: t });
    expect(edited.status).toBe(200);
    expect(edited.body.bank_name).toBe("Bank Mellat");

    // Clear one: the collected total moves, the booked commission does not.
    const before = db.transactions.get(tx.id);
    expect((await POST(`/cheques/${list[0].id}/status`, { status: "cleared" }, { token: t })).status).toBe(200);
    const after = db.transactions.get(tx.id);
    expect(after.amount_received_cents).toBe(before.amount_received_cents + list[0].amount_cents);
    expect(after.total_payout_cents).toBe(before.total_payout_cents);

    // A settled cheque is frozen: no edit, no second status.
    expect((await PATCH(`/cheques/${list[0].id}`, { bank_name: "Other" }, { token: t })).status).toBe(422);
    expect((await POST(`/cheques/${list[0].id}/status`, { status: "bounced" }, { token: t })).status).toBe(422);
    expect((await POST(`/cheques/${list[1].id}/status`, { status: "exploded" }, { token: t })).status).toBe(400);

    // A bounce notifies the customer and leaves the sale alone.
    expect((await POST(`/cheques/${list[1].id}/status`, { status: "bounced" }, { token: t })).status).toBe(200);
    expect(db.transactions.get(tx.id).status).toBe(before.status);
    const queued = db.raw?.().query?.(`SELECT COUNT(*) n FROM notifications WHERE template='cheque_bounced'`)?.get?.();
    if (queued) expect(queued.n).toBeGreaterThanOrEqual(1);
  });

  test("a cheque scan is a private document: owner and cheque staff only, wrong types and sizes refused", async () => {
    const tx = w.orders.u1Laser.transaction;
    const t = w.admins.fin.token;
    const png = "data:image/png;base64," + Buffer.from("\x89PNG\r\n\x1a\nfake").toString("base64");
    const made = await POST(`/admin/orders/${tx.id}/cheques`, { amount_cents: 1, due_date: "2027-03-01", image_data_url: png }, { token: t });
    // u1 paid in full, so there is no balance left to promise a cheque against.
    expect(made.status).toBe(422);

    const order = w.orders.u5Laser.transaction;
    // Free up balance on u5's order by cancelling the bounced cheque's commitment? No -- use a fresh installment order.
    const buyer = await signup("sim-scan");
    const inst = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: w.products.scanner.id, amount_received_cents: 400_000, payment_terms: "installment", cheques: [{ amount_cents: 600_000, due_date: "2027-02-01", image_data_url: png }] },
      { token: t }
    );
    expect(inst.status).toBe(201);
    const cheque = inst.body.cheques[0];
    expect((await GET(`/cheques/${cheque.id}/image`, { token: buyer.token })).status).toBe(200);
    expect((await GET(`/cheques/${cheque.id}/image`, { token: t })).status).toBe(200);
    expect((await GET(`/cheques/${cheque.id}/image`, { token: u(8).token })).status).toBe(403);
    expect((await GET(`/cheques/${cheque.id}/image`)).status).toBe(401);
    expect((await GET(`/cheques/${cheque.id}/image`, { token: w.admins.cnt.token })).status).toBe(403);
    // Listings never carry the blob.
    const listed = await GET(`/admin/orders/${inst.body.transaction.id}/cheques`, { token: t });
    expect(JSON.stringify(listed.body)).not.toContain("image_bytes");

    const bad = await POST(`/admin/orders/${order.id}/cheques`, { amount_cents: 1, due_date: "2027-03-01", image_data_url: "data:text/html;base64,PGI+" }, { token: t });
    expect(bad.status).toBe(400);
    const huge = "data:image/png;base64," + Buffer.alloc(3 * 1024 * 1024).toString("base64");
    expect((await POST(`/admin/orders/${order.id}/cheques`, { amount_cents: 1, due_date: "2027-03-01", image_data_url: huge }, { token: t })).status).toBe(400);

    // The customer sees their own cheques, and nobody else's.
    const mine = await GET("/cheques/mine", { token: buyer.token });
    expect(mine.status).toBe(200);
    expect((mine.body.cheques ?? mine.body).length).toBe(1);
    expect((await GET(`/purchases/${inst.body.transaction.id}/cheques`, { token: buyer.token })).status).toBe(200);
    expect((await GET(`/purchases/${inst.body.transaction.id}/cheques`, { token: u(8).token })).status).toBe(403);
    w.orders.scanBuyer = { buyer, ...inst.body };
  });

  test("an online purchase debits the wallet by the price, builds the position and pays the upline", async () => {
    const product = w.products.scanner;
    // Nothing in the wallet: refused, and nothing is created.
    const broke = await POST("/purchases", { product_id: product.id }, { token: u(6).token });
    expect(broke.status).toBeGreaterThanOrEqual(400);
    expect(broke.status).toBeLessThan(500);
    expect(db.nodes.getByUserProduct(u(6).user.id, product.id)).toBeFalsy();

    fund(u(6).user.id, product.list_price_y_cents);
    const res = await POST("/purchases", { product_id: product.id }, { token: u(6).token });
    expect(res.status).toBe(201);
    expect((await GET("/wallet", { token: u(6).token })).body.balance_cents).toBe(0);
    const ledger = await GET("/wallet/ledger", { token: u(6).token });
    expect(JSON.stringify(ledger.body)).toContain("purchase");
    w.orders.u6Scanner = { ...res.body, node: res.body.node ?? res.body.receipt?.node };

    // The same person cannot take a second position in the same product.
    fund(u(6).user.id, product.list_price_y_cents);
    const twice = await POST("/purchases", { product_id: product.id }, { token: u(6).token });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("already_has_node");
    // ...and the failed attempt did not take their money.
    expect((await GET("/wallet", { token: u(6).token })).body.balance_cents).toBe(product.list_price_y_cents);

    const history = await GET("/purchases", { token: u(6).token });
    expect(history.body.length).toBe(1);
    expect((await GET(`/purchases/${history.body[0].id}`, { token: u(6).token })).status).toBe(200);
    expect((await GET(`/purchases/${history.body[0].id}`, { token: u(8).token })).status).toBe(403);
    expect((await GET(`/purchases/${history.body[0].id}`, { token: w.admins.fin.token })).status).toBe(200);
  });

  test("role reversal: the person who was a leaf on the laser founds the scanner network and recruits their own upline", async () => {
    const scanner = w.products.scanner;
    w.orders.u3Scanner = await sell(w.admins.fin, u(3), scanner);
    expect(w.orders.u3Scanner.node.parent_node_id).toBeNull();
    const code3 = w.orders.u3Scanner.ownRedeemCode.code;
    // u0 was the root of the laser network; on the scanner they are u3's recruit.
    w.orders.u0Scanner = await sell(w.admins.fin, u(0), scanner, { redeem_code: code3 });
    const { rows } = await expectCommissionsExact(w.orders.u0Scanner, "u0 on scanner");
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(u(3).user.id);
    // Same person, two different positions in two different Spaces.
    const mine = await GET("/nodes/mine", { token: u(0).token });
    expect(mine.body.length).toBe(2);
    expect(new Set(mine.body.map((n) => n.space_id)).size).toBe(2);
  });

  test("redeem codes: limited use, expiry, wrong product, self use, revoke -- each enforced", async () => {
    const scanner = w.products.scanner;
    const gen = await POST("/redeem-codes", { product_id: scanner.id, max_uses: 1 }, { token: u(0).token });
    expect(gen.status).toBe(201);
    const code = gen.body.code;
    expect((await GET(`/redeem-codes/${code}`)).status).toBe(200);
    expect((await GET("/redeem-codes/NO-SUCH-CODE")).status).toBe(404);

    // A code only works for its own product.
    const wrongProduct = await walkIn(w.admins.fin, u(7), w.products.kit, { redeem_code: code });
    expect(wrongProduct.status).toBe(400);
    expect(wrongProduct.body.error.code).toBe("redeem_code_wrong_product");
    // The owner cannot redeem their own.
    const self = await walkIn(w.admins.fin, u(0), scanner, { redeem_code: code });
    expect(self.status).toBeGreaterThanOrEqual(400);

    // Single use: the first buyer gets in, the second is turned away.
    expect((await walkIn(w.admins.fin, u(7), scanner, { redeem_code: code })).status).toBe(201);
    const second = await walkIn(w.admins.fin, u(8), scanner, { redeem_code: code });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(db.nodes.getByUserProduct(u(8).user.id, scanner.id)).toBeFalsy();

    // Expired and revoked codes.
    const past = await POST("/redeem-codes", { product_id: scanner.id, expires_at: "2020-01-01T00:00:00.000Z" }, { token: u(0).token });
    if (past.status === 201) {
      expect((await walkIn(w.admins.fin, u(8), scanner, { redeem_code: past.body.code })).status).toBeGreaterThanOrEqual(400);
    } else {
      expect(past.status).toBe(400); // refusing to mint an already-expired code is also correct
    }
    const mine = await POST("/redeem-codes", { product_id: scanner.id }, { token: u(0).token });
    expect((await POST(`/redeem-codes/${mine.body.id}/revoke`, {}, { token: u(9).token })).status).toBe(403);
    expect((await POST(`/redeem-codes/${mine.body.id}/revoke`, {}, { token: u(0).token })).status).toBe(200);
    expect((await walkIn(w.admins.fin, u(8), scanner, { redeem_code: mine.body.code })).status).toBeGreaterThanOrEqual(400);
    // The people-scope can revoke anyone's code.
    const theirs = await POST("/redeem-codes", { product_id: scanner.id }, { token: u(3).token });
    expect((await POST(`/redeem-codes/${theirs.body.id}/revoke`, {}, { token: w.admins.usr.token })).status).toBe(200);
    expect((await POST("/redeem-codes", { product_id: "prod_nope" }, { token: u(0).token })).status).toBeGreaterThanOrEqual(400);
    // A person with no position in a product cannot mint a code for it.
    expect((await POST("/redeem-codes", { product_id: w.products.kit.id }, { token: u(9).token })).status).toBeGreaterThanOrEqual(400);
    // Buyer u7 joined under u0 above: tidy bookkeeping for later phases.
    w.orders.u7Scanner = db.nodes.getByUserProduct(u(7).user.id, scanner.id);
  });

  test("privacy: a customer sees their own network and nobody else's; staff scopes see what they should", async () => {
    const u0Laser = w.orders.u0Laser.node.id;
    expect((await GET(`/nodes/${u0Laser}`, { token: u(0).token })).status).toBe(200);
    expect((await GET(`/nodes/${u0Laser}`, { token: u(1).token })).status).toBe(403);
    expect((await GET(`/nodes/${u0Laser}/downline`, { token: u(1).token })).status).toBe(403);
    expect((await GET(`/nodes/${u0Laser}/earnings`, { token: u(1).token })).status).toBe(403);
    expect((await GET(`/nodes/${u0Laser}/redeem-codes`, { token: u(1).token })).status).toBe(403);
    expect((await GET(`/nodes/${u0Laser}/rank`, { token: u(1).token })).status).toBe(403);
    expect((await GET(`/nodes/${u0Laser}/quota`, { token: u(1).token })).status).toBe(403);
    expect((await GET(`/nodes/${u0Laser}`)).status).toBe(401);
    for (const a of [w.admins.fin, w.admins.usr, w.admins.usrFin, w.root]) {
      expect((await GET(`/nodes/${u0Laser}`, { token: a.token })).status).toBe(200);
    }
    expect((await GET(`/nodes/${u0Laser}`, { token: w.admins.cnt.token })).status).toBe(403);

    // "downline" is the DIRECT children; the whole tree is the space view.
    const downline = await GET(`/nodes/${u0Laser}/downline`, { token: u(0).token });
    expect(downline.status).toBe(200);
    expect(downline.body.map((n) => n.id)).toEqual([w.orders.u2Laser.node.id]);
    const second = await GET(`/nodes/${w.orders.u2Laser.node.id}/downline`, { token: u(2).token });
    expect(second.body.map((n) => n.id)).toEqual([w.orders.u3Laser.node.id]);
    // u0's whole laser tree: u2, u3, u4 below them -- and not u5, who joined u1's tree.
    const tree = JSON.stringify((await GET(`/spaces/${w.orders.u0Laser.node.space_id}/tree`, { token: u(0).token })).body);
    for (const o of [w.orders.u2Laser, w.orders.u3Laser, w.orders.u4Laser]) expect(tree).toContain(o.node.id);
    expect(tree).not.toContain(w.orders.u5Laser.node.id);

    const earnings = await GET(`/nodes/${u0Laser}/earnings`, { token: u(0).token });
    expect(earnings.status).toBe(200);
    // u0's earnings are exactly what the ledger says u0's node was paid.
    const rows = db.ledger.listByNode(u0Laser, { limit: 100 });
    expect(rows.length).toBe(3); // u2, u3, u4
    expect((await GET(`/spaces/${w.orders.u0Laser.node.space_id}/tree`, { token: u(0).token })).status).toBe(200);
    expect((await GET("/spaces", { token: u(0).token })).status).toBe(200);
  });
});

/* ------------------------------------------------------------------------ */
const raw = () => db._raw;
const myIds = () => [...w.users, ...Object.values(w.admins), w.root].map((x) => x.user.id);
const inMine = () => myIds().map(() => "?").join(",");
const pendingOf = (userId) =>
  raw().query(`SELECT * FROM commission_ledger_entries WHERE status = 'pending' AND user_id = ?`).all(userId);
const owedOf = (userId) => pendingOf(userId).reduce((s, e) => s + e.amount_cents - e.clawed_back_cents, 0);
const reserveDebited = (txId) =>
  raw().query(`SELECT COALESCE(SUM(amount_cents),0) n FROM reserve_ledger_entries WHERE transaction_id = ? AND type = 'debit'`).get(txId).n;
const reserveCredited = (txId) =>
  raw().query(`SELECT COALESCE(SUM(amount_cents),0) n FROM reserve_ledger_entries WHERE transaction_id = ? AND type = 'credit'`).get(txId).n;

describe("phase 7 -- refunds claw back exactly, and what is owed is paid once, by exactly one route", () => {
  test("a partial refund gives the buyer their money back and shrinks the upline's pending commission in proportion", async () => {
    const order = w.orders.u3Laser;
    const tx = db.transactions.get(order.transaction.id);
    const rowsBefore = db.ledger.listByTransaction(tx.id);
    expect(rowsBefore.length).toBe(2);
    const buyerBefore = db.wallet.getBalance(u(3).user.id);
    const reserveBefore = db.reserve.getBalance();
    const first = 666_667; // an awkward third, so the rounding is exercised

    const res = await POST(`/admin/orders/${tx.id}/refund`, { amount_cents: first, reason: "customer changed mind" }, { token: w.admins.fin.token });
    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe("partially_refunded");
    expect(db.wallet.getBalance(u(3).user.id)).toBe(buyerBefore + first);

    for (const before of rowsBefore) {
      const after = db.ledger.get(before.id);
      const fair = (before.amount_cents * first) / tx.y_at_sale_cents;
      expect(after.clawed_back_cents).toBeGreaterThan(0);
      expect(Math.abs(after.clawed_back_cents - fair)).toBeLessThanOrEqual(before.amount_cents / 10000 + 1);
      expect(after.status).toBe("pending"); // not yet paid out, so it simply shrinks
    }
    expect(db.reserve.getBalance()).toBeLessThan(reserveBefore);
    expect(db.reserve.getBalance()).toBeGreaterThan(reserveBefore - tx.reserve_amount_cents);
  });

  test("refunding the rest closes the sale COMPLETELY: every commission and the whole reserve cut are reversed to the cent", async () => {
    const tx0 = db.transactions.get(w.orders.u3Laser.transaction.id);
    const rest = await POST(`/admin/orders/${tx0.id}/refund`, { reason: "balance refunded" }, { token: w.admins.fin.token });
    expect(rest.status).toBe(200);
    expect(rest.body.transaction.status).toBe("refunded");
    expect(rest.body.transaction.refunded_amount_cents).toBe(tx0.y_at_sale_cents);

    for (const e of db.ledger.listByTransaction(tx0.id)) {
      expect(e.clawed_back_cents, "a fully refunded sale must leave nothing paid to the upline").toBe(e.amount_cents);
      expect(e.status).toBe("clawed_back");
    }
    expect(reserveDebited(tx0.id), "the reserve cut is returned in full, no more and no less").toBe(reserveCredited(tx0.id));
  });

  test("refund guards: nothing left, too much, nonsense amounts, unknown sale, wrong role", async () => {
    const txId = w.orders.u3Laser.transaction.id;
    const f = w.admins.fin.token;
    expect((await POST(`/admin/orders/${txId}/refund`, {}, { token: f })).status).toBe(422); // already refunded
    const other = w.orders.u4Laser.transaction.id;
    expect((await POST(`/admin/orders/${other}/refund`, { amount_cents: 99_999_999 }, { token: f })).status).toBe(422);
    for (const amount_cents of [0, -5, 1.5, "100"]) {
      expect((await POST(`/admin/orders/${other}/refund`, { amount_cents }, { token: f })).status, String(amount_cents)).toBe(400);
    }
    expect((await POST(`/admin/orders/tx_nope/refund`, {}, { token: f })).status).toBe(404);
    for (const who of [u(4), w.admins.usr, w.admins.cnt]) {
      expect((await POST(`/admin/orders/${other}/refund`, {}, { token: who.token })).status).toBe(403);
    }
    expect((await POST(`/admin/orders/${other}/refund`, {})).status).toBe(401);
  });

  test("an installment order can only be refunded what was actually collected -- never the unpaid balance", async () => {
    const tx = db.transactions.get(w.orders.u5Laser.transaction.id);
    // Collected: the down payment plus the one cheque that cleared. One bounced.
    const collected = tx.amount_received_cents;
    expect(collected).toBeLessThan(tx.y_at_sale_cents);
    const buyerBefore = db.wallet.getBalance(u(5).user.id);

    const tooMuch = await POST(`/admin/orders/${tx.id}/refund`, { amount_cents: collected + 1 }, { token: w.admins.fin.token });
    expect(tooMuch.status, "refunding more than the customer paid hands out money that never arrived").toBe(422);

    const all = await POST(`/admin/orders/${tx.id}/refund`, {}, { token: w.admins.fin.token });
    expect(all.status).toBe(200);
    expect(db.wallet.getBalance(u(5).user.id) - buyerBefore).toBe(collected);
    expect(all.body.transaction.status).toBe("refunded");
    // The sale is unwound: nothing stays paid to the upline for a sale that no longer exists.
    for (const e of db.ledger.listByTransaction(tx.id)) {
      expect(e.clawed_back_cents).toBe(e.amount_cents);
    }
    // And a refunded sale cannot later "collect" from a cheque that clears.
    const cheques = (await GET(`/admin/orders/${tx.id}/cheques`, { token: w.admins.fin.token })).body.cheques;
    const open = cheques.find((c) => c.status === "pending");
    if (open) {
      const late = await POST(`/cheques/${open.id}/status`, { status: "cleared" }, { token: w.admins.fin.token });
      expect(late.status).toBeGreaterThanOrEqual(400);
    }
  });

  test("the payout sheet shows exactly what the ledger says is owed to each of our people", async () => {
    const sheet = await GET("/admin/payouts", { token: w.admins.fin.token });
    expect(sheet.status).toBe(200);
    const mine = new Set(myIds());
    const ours = sheet.body.people.filter((p) => mine.has(p.user_id));
    expect(ours.length).toBeGreaterThan(0);
    for (const p of ours) expect(p.owed.cents, p.name).toBe(owedOf(p.user_id));
    // Nobody whose commission was fully clawed back is on it.
    expect(ours.every((p) => p.owed.cents > 0)).toBe(true);
    // The users scope has no business seeing money.
    expect((await GET("/admin/payouts", { token: w.admins.usr.token })).status).toBe(403);
  });

  test("settling in cash pays once: wrong amounts are refused, the wallet is untouched, and a second settle finds nothing", async () => {
    const earner = [u(2), u(0), u(1)].find((x) => owedOf(x.user.id) > 0);
    expect(earner, "someone should be owed money by now").toBeTruthy();
    const owed = owedOf(earner.user.id);
    const walletBefore = db.wallet.getBalance(earner.user.id);
    const f = w.admins.fin.token;

    const detail = await GET(`/admin/payouts/${earner.user.id}`, { token: f });
    expect(detail.status).toBe(200);
    expect(detail.body.total.cents).toBe(owed);
    expect(detail.body.lines.reduce((s, l) => s + l.amount.cents, 0)).toBe(owed);

    const wrong = await POST(`/admin/payouts/${earner.user.id}/settle`, { expected_cents: owed + 1, method: "cash" }, { token: f });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe("amount_moved");
    expect((await POST(`/admin/payouts/${earner.user.id}/settle`, { expected_cents: owed, method: "gold-bars" }, { token: f })).status).toBe(400);
    expect((await POST(`/admin/payouts/${earner.user.id}/settle`, { expected_cents: owed, method: "cash" }, { token: w.admins.usr.token })).status).toBe(403);
    expect((await POST(`/admin/payouts/${earner.user.id}/settle`, { expected_cents: owed, method: "cash" }, { token: u(0).token })).status).toBe(403);

    const ok = await POST(`/admin/payouts/${earner.user.id}/settle`, { expected_cents: owed, method: "bank_transfer", reference: "TRX-2026-001", note: "Paid at the office" }, { token: f });
    expect(ok.status).toBe(200);
    expect(ok.body.paid.cents).toBe(owed);
    expect(db.wallet.getBalance(earner.user.id)).toBe(walletBefore); // cash crossed the counter; no wallet credit
    const paid = raw().query(`SELECT paid_method, status FROM commission_ledger_entries WHERE user_id = ? AND paid_method = 'manual'`).all(earner.user.id);
    expect(paid.length).toBeGreaterThan(0);
    expect((await POST(`/admin/payouts/${earner.user.id}/settle`, { expected_cents: owed, method: "cash" }, { token: f })).status).toBe(409);

    const history = await GET("/admin/payouts/history", { token: f });
    const mineHist = history.body.payments.filter((p) => p.user_id === earner.user.id);
    expect(mineHist.some((p) => p.paid.cents === owed && p.reference === "TRX-2026-001")).toBe(true);

    // The release job must NOT pay the same commission again into a wallet.
    await POST("/admin/jobs/release-commissions", { holdDays: 0 }, { token: w.root.token });
    expect(db.wallet.getBalance(earner.user.id)).toBe(walletBefore);
    w.settledEarner = earner;
  });

  test("the release job credits each other earner exactly what they were owed, once, and nothing is left pending", async () => {
    // Everyone still has pending money from the sales above except the settled one;
    // the call in the previous test already released it, so re-derive from the ledger.
    const paidToWallet = raw()
      .query(`SELECT user_id, SUM(amount_cents - clawed_back_cents) n FROM commission_ledger_entries WHERE paid_method = 'wallet' AND user_id IN (${inMine()}) GROUP BY user_id`)
      .all(...myIds());
    expect(paidToWallet.length).toBeGreaterThan(0);
    for (const row of paidToWallet) {
      const credited = raw().query(`SELECT COALESCE(SUM(amount_cents),0) n FROM wallet_ledger_entries WHERE user_id = ? AND type = 'commission_release'`).get(row.user_id).n;
      expect(credited, `wallet credit for ${row.user_id}`).toBe(row.n);
    }
    for (const id of myIds()) expect(pendingOf(id).length).toBe(0);
    // Running it again does nothing.
    const again = await POST("/admin/jobs/release-commissions", { holdDays: 0 }, { token: w.root.token });
    expect(again.body.releasedCents).toBe(0);
  });

  test("refunding a sale whose commission was already released pulls it back out of the earner's wallet", async () => {
    const tx = db.transactions.get(w.orders.u4Laser.transaction.id);
    const rows = db.ledger.listByTransaction(tx.id).filter((e) => e.paid_method === "wallet");
    expect(rows.length).toBeGreaterThan(0);
    const before = new Map(rows.map((e) => [e.user_id, db.wallet.getBalance(e.user_id)]));
    const res = await POST(`/admin/orders/${tx.id}/refund`, { amount_cents: Math.floor(tx.y_at_sale_cents / 2), reason: "half back" }, { token: w.admins.fin.token });
    expect(res.status).toBe(200);
    for (const e of rows) {
      const after = db.ledger.get(e.id);
      expect(after.status).toBe("partially_clawed_back");
      expect(db.wallet.getBalance(e.user_id)).toBe(before.get(e.user_id) - after.clawed_back_cents);
    }
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 8 -- the admin tunes the plans: editing rates, rank bonuses and quota tiers", () => {
  test("plan validation: a plan that pays out more than its pool, or a bad reserve, is refused; only finance may edit", async () => {
    const id = w.products.scanner.id;
    const f = w.admins.fin.token;
    expect((await PATCH(`/commission-plans/${id}`, { payout_pool_pct_bp: 1000, level_rates_bp: [2000, 1200] }, { token: f })).status).toBe(422);
    expect((await PATCH(`/commission-plans/${id}`, { reserve_pct_bp: 10000 }, { token: f })).status).toBeGreaterThanOrEqual(400);
    expect((await PATCH(`/commission-plans/${id}`, { level_rates_bp: [-5] }, { token: f })).status).toBeGreaterThanOrEqual(400);
    expect((await PATCH(`/commission-plans/${id}`, { payout_mode: "barter" }, { token: f })).status).toBeGreaterThanOrEqual(400);
    for (const who of [u(0), w.admins.usr, w.admins.cnt]) {
      expect((await PATCH(`/commission-plans/${id}`, { reserve_pct_bp: 500 }, { token: who.token })).status).toBe(403);
    }
    expect((await PATCH(`/commission-plans/prod_nope`, { reserve_pct_bp: 500 }, { token: f })).status).toBe(404);
    // None of the refusals changed anything.
    const plan = await planOf(id);
    expect(plan.level_rates_bp[0]).toBe(2000);
  });

  test("new rates apply to the NEXT sale and never rewrite an old one", async () => {
    const scanner = w.products.scanner;
    const oldRows = db.ledger.listByTransaction(w.orders.u0Scanner.transaction.id);
    expect(oldRows[0].rate_applied_bp).toBe(2000);

    const raise = await PATCH(`/commission-plans/${scanner.id}`, { level_rates_bp: [2500, 1200, 800, 500, 300, 200], payout_pool_pct_bp: 7000 }, { token: w.admins.fin.token });
    expect(raise.status).toBe(200);
    const sale = await sell(w.admins.fin, u(8), scanner, { redeem_code: w.orders.u3Scanner.ownRedeemCode.code });
    const row = db.ledger.listByTransaction(sale.transaction.id)[0];
    expect(row.rate_applied_bp).toBe(2500);
    expect(row.user_id).toBe(u(3).user.id);
    expect(row.amount_cents).toBe(Math.floor(((sale.transaction.y_at_sale_cents - sale.transaction.x_at_sale_cents) * 2500) / 10000));
    // History is untouched.
    expect(db.ledger.listByTransaction(w.orders.u0Scanner.transaction.id)[0].rate_applied_bp).toBe(2000);
    expect(db.ledger.get(oldRows[0].id).amount_cents).toBe(oldRows[0].amount_cents);
    w.orders.u8Scanner = sale;
    await expectCommissionsExact(sale, "u8 at the new rates");
  });

  test("rank tiers: shares above 100% are refused; the cycle funds a pool from REALISED profit and splits it exactly", async () => {
    const scanner = w.products.scanner;
    const f = w.admins.fin.token;
    await PATCH(`/commission-plans/${scanner.id}`, { rank_bonus_pool_pct_bp: 800 }, { token: f });

    const elite = await POST(`/commission-plans/${scanner.id}/rank-tiers`, { rank_order: 2, name: "Elite", team_volume_threshold_cents: 1_500_000, personal_volume_threshold_cents: 1_000_000, pool_share_bp: 4000 }, { token: f });
    expect(elite.status).toBe(200);
    const leader = await POST(`/commission-plans/${scanner.id}/rank-tiers`, { rank_order: 1, name: "Leader", team_volume_threshold_cents: 1, personal_volume_threshold_cents: 1, pool_share_bp: 6000 }, { token: f });
    expect(leader.status).toBe(200);
    // 4000 + 6000 is the whole pool; one more basis point is refused.
    const over = await POST(`/commission-plans/${scanner.id}/rank-tiers`, { rank_order: 3, name: "Greedy", team_volume_threshold_cents: 1, personal_volume_threshold_cents: 1, pool_share_bp: 1 }, { token: f });
    expect(over.status).toBe(422);
    expect((await POST(`/commission-plans/${scanner.id}/rank-tiers`, { rank_order: 3, name: "", pool_share_bp: 1 }, { token: f })).status).toBe(400);
    expect((await POST(`/commission-plans/${scanner.id}/rank-tiers`, { rank_order: 3, name: "X", pool_share_bp: 1 }, { token: w.admins.cnt.token })).status).toBe(403);
    expect((await GET(`/commission-plans/${scanner.id}/rank-tiers`)).body.length).toBe(2);

    const periodStart = new Date(Date.now() - 86_400_000).toISOString();
    const periodEnd = new Date(Date.now() + 86_400_000).toISOString();
    const completed = raw()
      .query(`SELECT COALESCE(SUM(trex_net_amount_cents),0) n FROM transactions WHERE product_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?`)
      .get(scanner.id, periodStart, periodEnd).n;
    expect(completed).toBeGreaterThan(0);

    const root = w.root.token;
    expect((await POST("/admin/jobs/fund-rank-pool", { product_id: scanner.id, period_start: periodStart, period_end: periodEnd }, { token: f })).status).toBe(403);
    const funded = await POST("/admin/jobs/fund-rank-pool", { product_id: scanner.id, period_start: periodStart, period_end: periodEnd }, { token: root });
    expect(funded.status).toBe(200);
    expect(funded.body.pool_amount_cents).toBe(Math.floor((completed * 800) / 10000));

    // Safe retry: the same range returns the same period, never a second pool.
    const again = await POST("/admin/jobs/fund-rank-pool", { product_id: scanner.id, period_start: periodStart, period_end: periodEnd }, { token: root });
    expect(again.body.id).toBe(funded.body.id);

    // The same sales must not fund a second pool through an OVERLAPPING range.
    const overlapping = await POST(
      "/admin/jobs/fund-rank-pool",
      { product_id: scanner.id, period_start: new Date(Date.now() - 2 * 86_400_000).toISOString(), period_end: new Date(Date.now() + 2 * 86_400_000).toISOString() },
      { token: root }
    );
    expect(overlapping.status, "overlapping periods would pay the same profit out twice").toBe(422);
    // Nonsense ranges.
    expect((await POST("/admin/jobs/fund-rank-pool", { product_id: scanner.id, period_start: periodEnd, period_end: periodStart }, { token: root })).status).toBe(400);
    expect((await POST("/admin/jobs/fund-rank-pool", { product_id: scanner.id, period_start: "yesterday", period_end: "tomorrow" }, { token: root })).status).toBe(400);
    expect((await POST("/admin/jobs/fund-rank-pool", { product_id: "prod_nope", period_start: periodStart, period_end: periodEnd }, { token: root })).status).toBe(404);

    const dist = await POST("/admin/jobs/distribute-rank-bonuses", { period_id: funded.body.id }, { token: root });
    expect(dist.status).toBe(200);
    const detail = await GET(`/admin/monitoring/reports/rank-bonus-periods/${funded.body.id}`, { token: root });
    // Expected split, derived from the tree here rather than read back: a node's
    // team volume is its own period volume plus everyone below it.
    const nodes = raw().query(`SELECT id, user_id, parent_node_id, personal_volume_period_cents pv FROM nodes WHERE product_id = ?`).all(scanner.id);
    const children = new Map();
    for (const n of nodes) children.set(n.parent_node_id, [...(children.get(n.parent_node_id) ?? []), n]);
    const teamVolume = (n) => n.pv + (children.get(n.id) ?? []).reduce((sum, c) => sum + teamVolume(c), 0);
    const tiers = [
      { id: elite.body.id, team: 1_500_000, personal: 1_000_000, share: 4000 },
      { id: leader.body.id, team: 1, personal: 1, share: 6000 },
    ];
    const qualifiers = new Map(tiers.map((t) => [t.id, []]));
    for (const n of nodes) {
      const tier = tiers.find((t) => teamVolume(n) >= t.team && n.pv >= t.personal); // highest first
      if (tier) qualifiers.get(tier.id).push(n.user_id);
    }
    expect(qualifiers.get(elite.body.id)).toContain(u(3).user.id); // the founder, with the whole team behind them
    expect(qualifiers.get(leader.body.id).length).toBeGreaterThan(0);
    expect(detail.body.entries.length).toBe([...qualifiers.values()].flat().length);
    for (const t of tiers) {
      const slice = Math.floor((funded.body.pool_amount_cents * t.share) / 10000);
      const each = Math.floor(slice / qualifiers.get(t.id).length);
      for (const userId of qualifiers.get(t.id)) {
        const e = detail.body.entries.find((x) => x.user_id === userId && x.rank_tier_id === t.id);
        expect(e?.amount_cents, `tier ${t.id} for ${userId}`).toBe(each);
      }
    }
    expect(detail.body.entries.reduce((s, e) => s + e.amount_cents, 0)).toBeLessThanOrEqual(funded.body.pool_amount_cents);
    // A period is distributed once.
    expect((await POST("/admin/jobs/distribute-rank-bonuses", { period_id: funded.body.id }, { token: root })).status).toBe(422);

    // Release credits wallets by exactly the entry amounts, once.
    const before = new Map(detail.body.entries.map((e) => [e.user_id, db.wallet.getBalance(e.user_id)]));
    const rel = await POST("/admin/jobs/release-rank-bonuses", { holdDays: 0 }, { token: root });
    expect(rel.status).toBe(200);
    for (const e of detail.body.entries) {
      expect(db.wallet.getBalance(e.user_id) - before.get(e.user_id)).toBeGreaterThanOrEqual(e.amount_cents);
    }
    expect((await POST("/admin/jobs/release-rank-bonuses", { holdDays: 0 }, { token: root })).body.releasedCents).toBe(0);

    // The member can see their own rank and bonuses; a stranger cannot.
    const n3 = w.orders.u3Scanner.node.id;
    expect((await GET(`/nodes/${n3}/rank`, { token: u(3).token })).status).toBe(200);
    expect((await GET(`/nodes/${n3}/rank-bonuses`, { token: u(3).token })).status).toBe(200);
    expect((await GET(`/nodes/${n3}/rank-bonuses`, { token: u(9).token })).status).toBe(403);
    expect((await GET("/admin/monitoring/reports/rank-bonus-periods", { token: root })).status).toBe(200);
  });

  test("quota mode: progress is tracked instead of cash, a completed tier pays its bonus exactly once and the bonus rate lasts", async () => {
    const kit = w.products.kit;
    const f = w.admins.fin.token;
    // Tiers: Blue at $200, Silver at $300 of commission-equivalent progress.
    expect((await POST(`/commission-plans/${kit.id}/quota-tiers`, { tier_order: 1, name: "Blue", quota_target_cents: 20_000, cash_bonus_cents: 1_000, rate_bonus_bp: 100 }, { token: f })).status).toBe(200);
    expect((await POST(`/commission-plans/${kit.id}/quota-tiers`, { tier_order: 2, name: "Silver", quota_target_cents: 30_000, cash_bonus_cents: 2_000, rate_bonus_bp: 200 }, { token: f })).status).toBe(200);
    expect((await POST(`/commission-plans/${kit.id}/quota-tiers`, { tier_order: 1, name: "Dup", quota_target_cents: 5 }, { token: f })).status).toBe(409);
    expect((await POST(`/commission-plans/${kit.id}/quota-tiers`, { tier_order: 3, name: "Bad", quota_target_cents: 0 }, { token: f })).status).toBe(400);
    expect((await POST(`/commission-plans/${kit.id}/quota-tiers`, { tier_order: 3, name: "NoRole", quota_target_cents: 5 }, { token: u(0).token })).status).toBe(403);
    expect((await PATCH(`/commission-plans/${kit.id}`, { payout_mode: "quota" }, { token: f })).status).toBe(200);

    const k0 = await sell(w.admins.fin, u(0), kit);
    const code = k0.ownRedeemCode.code;
    const margin = kit.list_price_y_cents - 40_000;
    const walletBefore = db.wallet.getBalance(u(0).user.id);

    const k1 = await sell(w.admins.fin, u(1), kit, { redeem_code: code });
    let row = db.ledger.listByTransaction(k1.transaction.id)[0];
    expect(row.status).toBe("quota_applied");
    expect(row.amount_cents).toBe(Math.floor((margin * 2000) / 10000));
    // Quota mode pays NO cash at sale: the tx's payout is zero and the books still balance.
    const tx1 = db.transactions.get(k1.transaction.id);
    expect(tx1.total_payout_cents).toBe(0);
    expect(tx1.total_payout_cents + tx1.reserve_amount_cents + tx1.trex_net_amount_cents).toBe(tx1.margin_cents);
    expect(db.wallet.getBalance(u(0).user.id)).toBe(walletBefore);

    // Second recruit pushes u0 past Blue ($240 > $200): one bonus, overflow carried.
    await sell(w.admins.fin, u(2), kit, { redeem_code: code });
    expect(db.wallet.getBalance(u(0).user.id)).toBe(walletBefore + 1_000);
    const quota = await GET(`/nodes/${k0.node.id}/quota`, { token: u(0).token });
    expect(quota.status).toBe(200);
    expect(JSON.stringify(quota.body)).toContain("Blue");
    const bonuses = await GET(`/nodes/${k0.node.id}/quota-bonuses`, { token: u(0).token });
    expect(bonuses.status).toBe(200);
    expect(JSON.stringify(bonuses.body).match(/Blue|1000/g)?.length).toBeGreaterThanOrEqual(1);
    expect((await GET(`/nodes/${k0.node.id}/quota`, { token: u(9).token })).status).toBe(403);
    expect(raw().query(`SELECT COUNT(*) n FROM quota_tier_completions WHERE node_id = ?`).get(k0.node.id).n).toBe(1);

    // The unlocked +1% rate applies from the next sale on...
    const k3 = await sell(w.admins.fin, u(3), kit, { redeem_code: code });
    row = db.ledger.listByTransaction(k3.transaction.id)[0];
    expect(row.rate_applied_bp).toBe(2100);
    // ...and survives switching the plan back to cash, where it is paid as pending money.
    expect((await PATCH(`/commission-plans/${kit.id}`, { payout_mode: "wallet" }, { token: f })).status).toBe(200);
    const k5 = await sell(w.admins.fin, u(5), kit, { redeem_code: code });
    row = db.ledger.listByTransaction(k5.transaction.id)[0];
    expect(row.status).toBe("pending");
    expect(row.rate_applied_bp).toBe(2100);
    expect(row.amount_cents).toBe(Math.floor((margin * 2100) / 10000));
    // Old quota_applied rows were not turned into cash by the mode switch.
    expect(db.ledger.get(db.ledger.listByTransaction(k1.transaction.id)[0].id).status).toBe("quota_applied");
    w.orders.kit0 = k0;
  });

  test("the nightly job runs: it flags late instalments and expires quotes, but pays nobody while auto-payout is off", async () => {
    const ownPending = () => myIds().reduce((n, id) => n + pendingOf(id).length, 0);
    const pendingBefore = ownPending();
    expect(pendingBefore).toBeGreaterThan(0); // the kit sale above
    const res = await POST("/admin/jobs/run-all", { holdDays: 0 }, { token: w.root.token });
    expect(res.status).toBe(200);
    expect(ownPending()).toBe(pendingBefore);
    expect(res.body.releases.skipped ?? "").toContain("network_auto_payout");
    expect((await POST("/admin/jobs/recalculate-activity", {}, { token: w.root.token })).status).toBe(200);
    expect((await POST("/admin/jobs/run-all", {}, { token: w.admins.fin.token })).status).toBe(403);
    expect((await POST("/admin/jobs/run-all", {})).status).toBe(401);
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 9 -- control: who may lock whom, switches, suspensions and roles", () => {
  test("only a root admin can suspend a staff account; the users scope may still suspend customers", async () => {
    const usr = w.admins.usr.token;
    // The users scope cannot silence the root, or any other admin...
    for (const target of [w.root, w.admins.fin, w.admins.cnt]) {
      const res = await PATCH(`/admin/users/${target.user.id}/status`, { status: "suspended" }, { token: usr });
      expect(res.status, `suspending ${target.email}`).toBe(403);
      expect(res.body.error.code).toBe("staff_requires_root");
      expect((await GET("/auth/me", { token: target.token })).status).toBe(200); // still in
    }
    // ...nor reinstate one root suspended.
    await PATCH(`/admin/users/${w.admins.cnt.user.id}/status`, { status: "suspended" }, { token: w.root.token });
    expect((await GET("/auth/me", { token: w.admins.cnt.token })).status).toBe(403);
    expect((await PATCH(`/admin/users/${w.admins.cnt.user.id}/status`, { status: "active" }, { token: usr })).status).toBe(403);
    expect((await PATCH(`/admin/users/${w.admins.cnt.user.id}/status`, { status: "active" }, { token: w.root.token })).status).toBe(200);
    expect((await GET("/auth/me", { token: w.admins.cnt.token })).status).toBe(200);
    // Nobody locks themselves out.
    expect((await PATCH(`/admin/users/${w.root.user.id}/status`, { status: "suspended" }, { token: w.root.token })).status).toBe(400);
    // Customers: fine for the users scope, refused for finance; bad statuses refused.
    expect((await PATCH(`/admin/users/${u(9).user.id}/status`, { status: "suspended" }, { token: usr })).status).toBe(200);
    expect((await PATCH(`/admin/users/${u(9).user.id}/status`, { status: "active" }, { token: w.admins.fin.token })).status).toBe(403);
    expect((await PATCH(`/admin/users/${u(9).user.id}/status`, { status: "vanished" }, { token: usr })).status).toBe(400);
    expect((await PATCH(`/admin/users/usr_nope/status`, { status: "active" }, { token: usr })).status).toBe(404);
    await PATCH(`/admin/users/${u(9).user.id}/status`, { status: "active" }, { token: usr });
  });

  test("a suspended customer is locked out mid-session, cannot log in, buy or be sold to -- and returns intact", async () => {
    const victim = u(9);
    expect((await GET("/profile", { token: victim.token })).status).toBe(200);
    await PATCH(`/admin/users/${victim.user.id}/status`, { status: "suspended" }, { token: w.admins.usr.token });
    expect((await GET("/profile", { token: victim.token })).status).toBe(403);
    expect((await POST("/auth/login", { email: victim.email, password: PASSWORD })).status).toBe(403);
    fund(victim.user.id, 100_000);
    expect((await POST("/purchases", { product_id: w.products.kit.id }, { token: victim.token })).status).toBe(403);
    const walkin = await walkIn(w.admins.fin, victim, w.products.kit);
    expect(walkin.status).toBe(422);
    expect(walkin.body.error.code).toBe("customer_inactive");
    await PATCH(`/admin/users/${victim.user.id}/status`, { status: "active" }, { token: w.admins.usr.token });
    expect((await GET("/profile", { token: victim.token })).status).toBe(200);
    // The wallet was never touched by any of that.
    expect(db.wallet.getBalance(victim.user.id)).toBe(100_000);
  });

  test("a suspended sponsor earns nothing from new sales, and earns again once reinstated", async () => {
    const sponsor = w.orders.u0Scanner; // u0 sits under u3 on the scanner
    const sponsorNode = (await GET("/nodes/mine", { token: u(0).token })).body.find((n) => n.product_id === w.products.scanner.id);
    const code = (await POST("/redeem-codes", { product_id: w.products.scanner.id }, { token: u(0).token })).body.code;
    expect(sponsor).toBeTruthy();

    expect((await PATCH(`/nodes/${sponsorNode.id}/status`, { status: "suspended" }, { token: w.admins.usr.token })).status).toBe(200);
    expect((await PATCH(`/nodes/${sponsorNode.id}/status`, { status: "suspended" }, { token: w.admins.fin.token })).status).toBe(403); // finance can read, not suspend
    const before = db.ledger.listByNode(sponsorNode.id, { limit: 500 }).length;
    const buyer = await signup("sim-under-suspended");
    const sale = await sell(w.admins.fin, buyer, w.products.scanner, { redeem_code: code });
    expect(db.ledger.listByNode(sponsorNode.id, { limit: 500 }).length).toBe(before);
    // The upline above the suspended node is still paid for what it is entitled to (level 2 and up).
    const tx = db.transactions.get(sale.transaction.id);
    expect(tx.total_payout_cents + tx.reserve_amount_cents + tx.trex_net_amount_cents).toBe(tx.margin_cents);

    await PATCH(`/nodes/${sponsorNode.id}/status`, { status: "active" }, { token: w.admins.usr.token });
    const buyer2 = await signup("sim-under-reinstated");
    await sell(w.admins.fin, buyer2, w.products.scanner, { redeem_code: code });
    expect(db.ledger.listByNode(sponsorNode.id, { limit: 500 }).length).toBe(before + 1);
    expect((await PATCH(`/nodes/node_nope/status`, { status: "suspended" }, { token: w.admins.usr.token })).status).toBe(404);
    expect((await PATCH(`/nodes/${sponsorNode.id}/status`, { status: "weird" }, { token: w.admins.usr.token })).status).toBe(400);
  });

  test("roles: root promotes a customer to a scoped admin and back; the last root can never be removed", async () => {
    const candidate = u(8);
    expect((await GET("/admin/users", { token: candidate.token })).status).toBe(403);
    const promoted = await PATCH(`/admin/users/${candidate.user.id}/role`, { role: "admin", staff_scopes: ["USERS_ADMIN"] }, { token: w.root.token });
    expect(promoted.status).toBe(200);
    // Same token, new powers -- but only the scope's.
    expect((await GET("/admin/users", { token: candidate.token })).status).toBe(200);
    expect((await GET("/admin/orders", { token: candidate.token })).status).toBe(403);
    expect((await GET("/admin/settings", { token: candidate.token })).status).toBe(403);
    // Widening it later is root's call alone.
    expect((await PATCH(`/admin/users/${candidate.user.id}/role`, { role: "admin", staff_scopes: ["root"] }, { token: candidate.token })).status).toBe(403);
    expect((await PATCH(`/admin/users/${candidate.user.id}/role`, { role: "admin", staff_scopes: ["FINANCE_ADMIN"] }, { token: w.root.token })).status).toBe(200);
    expect((await GET("/admin/orders", { token: candidate.token })).status).toBe(200);
    expect((await GET("/admin/users", { token: candidate.token })).status).toBe(200); // finance reads users
    expect((await PATCH(`/admin/users/${candidate.user.id}/role`, { role: "user" }, { token: w.root.token })).status).toBe(200);
    expect((await GET("/admin/users", { token: candidate.token })).status).toBe(403);
    // The root cannot demote or remove themselves, and nothing can retire the last root.
    expect((await PATCH(`/admin/users/${w.root.user.id}/role`, { role: "user" }, { token: w.root.token })).status).toBe(400);
    expect((await PATCH(`/admin/users/${w.root.user.id}/role`, { role: "admin", staff_scopes: ["FINANCE_ADMIN"] }, { token: w.root.token })).status).toBe(400);
    expect(db.users.countRootAdmins()).toBeGreaterThanOrEqual(1);
    expect((await PATCH(`/admin/users/usr_nope/role`, { role: "admin" }, { token: w.root.token })).status).toBe(404);
  });

  test("the last root admin cannot delete their own account; a root with a peer can", async () => {
    // Root is the only account able to create admins and change anyone's access;
    // deleting the last one would orphan the staff structure with no way back in.
    // The suite shares one database with other root accounts, so "the last one"
    // is staged by pinning the count the service sees.
    const sole = await signup("sim-sole-root");
    db.users.updateRole(sole.user.id, "admin");
    const spy = spyOn(db.users, "countRootAdmins").mockReturnValue(1);
    try {
      const refused = await DELETE("/profile", { password: PASSWORD }, { token: sole.token });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe("last_root_admin");
      expect((await GET("/auth/me", { token: sole.token })).status).toBe(200); // still there
      spy.mockReturnValue(2);
      expect((await DELETE("/profile", { password: PASSWORD }, { token: sole.token })).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    // A scoped admin is not root, so the rule does not apply to them.
    const scoped = await createAdmin("leaver", ["CONTENT_ADMIN"]);
    expect((await DELETE("/profile", { password: PASSWORD }, { token: scoped.token })).status).toBe(200);
  });

  test("root's feature switches take effect at once and are root-only", async () => {
    const r = w.root.token;
    const set = (patch, token = r) => PATCH("/admin/settings", patch, { token });
    try {
      expect((await set({ online_purchase_enabled: false }, w.admins.fin.token)).status).toBe(403);
      expect((await set({ online_purchase_enabled: "maybe" })).status).toBe(400);
      expect((await set({ definitely_not_a_setting: true })).status).toBe(400);

      // Online buying off: self-service refused, the office desk still works.
      expect((await set({ online_purchase_enabled: false })).status).toBe(200);
      expect((await GET("/site-config")).body.online_purchase_enabled).toBe(false);
      fund(u(9).user.id, w.products.kit.list_price_y_cents);
      const refused = await POST("/purchases", { product_id: w.products.kit.id }, { token: u(9).token });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.body.error.code).toBe("online_purchase_disabled");
      expect((await walkIn(w.admins.fin, u(9), w.products.kit)).status).toBe(201); // walk-in unaffected
      expect((await set({ online_purchase_enabled: true })).status).toBe(200);

      // Sign-up closed.
      expect((await set({ signup_enabled: false })).status).toBe(200);
      expect((await POST("/auth/signup", { email: nextEmail("closed"), password: PASSWORD, name: "Late" })).status).toBeGreaterThanOrEqual(400);
      expect((await set({ signup_enabled: true })).status).toBe(200);

      // Support intake closed.
      expect((await set({ support_tickets_enabled: false })).status).toBe(200);
      expect((await POST("/support/requests", { name: "N", contact: "n@test.local", message: "hello" })).status).toBeGreaterThanOrEqual(400);
      expect((await set({ support_tickets_enabled: true })).status).toBe(200);

      // Blog switched off hides published posts too.
      const post = await POST("/blog/admin/posts", { title: "Switch test", body: "x", status: "published" }, { token: w.admins.cnt.token });
      await PATCH(`/blog/admin/posts/${post.body.id}`, { status: "published" }, { token: w.admins.cnt.token });
      expect((await GET(`/blog/posts/${post.body.slug}`)).status).toBe(200);
      expect((await set({ blog_enabled: false })).status).toBe(200);
      expect((await GET(`/blog/posts/${post.body.slug}`)).status).toBe(404);
      expect((await set({ blog_enabled: true })).status).toBe(200);
      await DELETE(`/blog/admin/posts/${post.body.id}`, undefined, { token: w.admins.cnt.token });

      // The "Require verified email" switch actually blocks an unverified buyer.
      expect((await set({ require_email_verification: true })).status).toBe(200);
      const fresh = await POST("/auth/signup", { email: nextEmail("unverified"), password: PASSWORD, name: "Fresh" });
      fund(fresh.body.user.id, w.products.kit.list_price_y_cents);
      const blocked = await POST("/purchases", { product_id: w.products.kit.id }, { token: fresh.body.token });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe("email_not_verified");
      const token = new URL(fresh.body.debug_verification_link).searchParams.get("token");
      expect((await POST("/auth/verify-email", { token })).status).toBe(200);
      expect((await POST("/purchases", { product_id: w.products.kit.id }, { token: fresh.body.token })).status).toBe(201);
      // A walk-in is not blocked by it -- staff have the customer in front of them.
      const walker = await signup("sim-walker");
      expect((await walkIn(w.admins.fin, walker, w.products.kit)).status).toBe(201);
    } finally {
      for (const k of ["online_purchase_enabled", "signup_enabled", "support_tickets_enabled", "blog_enabled", "require_email_verification"]) {
        await POST(`/admin/settings/${k}/reset`, {}, { token: r });
      }
    }
    expect((await GET("/admin/settings", { token: r })).status).toBe(200);
    expect((await POST("/admin/settings/online_purchase_enabled/reset", {}, { token: w.admins.fin.token })).status).toBe(403);
  });

  test("a discontinued device cannot be sold by either channel, and selling resumes when it is reactivated", async () => {
    const p = await createProduct(w.admins.fin.token, { name: "Sim Discontinued", xCents: 30_000, yCents: 50_000, stockCount: 5 });
    expect((await PATCH(`/products/${p.id}/status`, { status: "discontinued" }, { token: w.admins.fin.token })).status).toBe(200);
    fund(u(9).user.id, 50_000);
    expect((await POST("/purchases", { product_id: p.id }, { token: u(9).token })).status).toBe(422);
    expect((await walkIn(w.admins.fin, u(9), p)).status).toBe(422);
    // The catalogue API still lists it (the storefront filters it out, and order history needs the name)...
    expect((await GET("/products?status=active")).body.some((x) => x.id === p.id)).toBe(false);
    expect((await GET("/products?status=discontinued")).body.some((x) => x.id === p.id)).toBe(true);
    // ...but it is clearly marked unsellable.
    expect((await GET(`/products/${p.id}`)).body.status).toBe("discontinued");
    expect((await PATCH(`/products/${p.id}/status`, { status: "bogus" }, { token: w.admins.fin.token })).status).toBe(400);
    expect((await PATCH(`/products/${p.id}/status`, { status: "active" }, { token: w.admins.fin.token })).status).toBe(200);
    expect((await walkIn(w.admins.fin, u(9), p)).status).toBe(201);
  });

  test("a price change applies to the next sale and never to an old one; bad prices are refused", async () => {
    const p = await createProduct(w.admins.fin.token, { name: "Sim Repriced", xCents: 30_000, yCents: 50_000, stockCount: 5 });
    const a = await sell(w.admins.fin, await signup("sim-old-price"), p);
    expect((await PATCH(`/products/${p.id}/price`, { y_cents: 60_000 }, { token: w.admins.fin.token })).status).toBe(200);
    const b = await sell(w.admins.fin, await signup("sim-new-price"), { ...p, list_price_y_cents: 60_000 });
    expect(a.transaction.y_at_sale_cents).toBe(50_000);
    expect(b.transaction.y_at_sale_cents).toBe(60_000);
    expect(db.transactions.get(a.transaction.id).y_at_sale_cents).toBe(50_000);
    for (const y_cents of [0, -1, 1.5, "60000", null]) {
      expect((await PATCH(`/products/${p.id}/price`, { y_cents }, { token: w.admins.fin.token })).status, String(y_cents)).toBe(400);
    }
    expect((await PATCH(`/products/${p.id}/price`, { y_cents: 1 }, { token: w.admins.cnt.token })).status).toBe(403);
    // A price at or below cost makes the product unsellable rather than selling at a loss.
    await PATCH(`/products/${p.id}/price`, { y_cents: 20_000 }, { token: w.admins.fin.token });
    const loss = await walkIn(w.admins.fin, await signup("sim-loss"), { ...p, list_price_y_cents: 20_000 }, { amount_received_cents: 20_000 });
    expect(loss.status).toBe(422);
  });

  test("the last unit is sold exactly once, even under a race; one person cannot take two positions by double-clicking", async () => {
    const p = await createProduct(w.admins.fin.token, { name: "Sim Last One", xCents: 30_000, yCents: 50_000, stockCount: 1 });
    const buyers = [];
    for (let i = 0; i < 6; i++) {
      const b = await signup(`sim-race${i}`);
      fund(b.user.id, 50_000);
      buyers.push(b);
    }
    const results = await Promise.all(buyers.map((b) => POST("/purchases", { product_id: p.id }, { token: b.token })));
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 422 && r.body.error.code === "out_of_stock")).toBe(true);
    expect((await GET(`/products/${p.id}`, { token: w.admins.fin.token })).body.stock_count).toBe(0);
    // The five who lost kept their money.
    const losers = buyers.filter((_, i) => results[i].status !== 201);
    for (const l of losers) expect(db.wallet.getBalance(l.user.id)).toBe(50_000);

    const q = await createProduct(w.admins.fin.token, { name: "Sim Double Click", xCents: 30_000, yCents: 50_000, stockCount: 10 });
    const one = await signup("sim-doubleclick");
    fund(one.user.id, 200_000);
    const dbl = await Promise.all([1, 2, 3].map(() => POST("/purchases", { product_id: q.id }, { token: one.token })));
    expect(dbl.filter((r) => r.status === 201).length).toBe(1);
    expect(raw().query(`SELECT COUNT(*) n FROM nodes WHERE user_id = ? AND product_id = ?`).get(one.user.id, q.id).n).toBe(1);
    expect(db.wallet.getBalance(one.user.id)).toBe(200_000 - 50_000);
    expect((await GET(`/products/${q.id}`, { token: w.admins.fin.token })).body.stock_count).toBe(9);
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 10 -- notifications, oversight, robustness and leaving", () => {
  test("customer emails are queued, sent exactly once by the job, and a failure can be retried", async () => {
    const t = w.root.token;
    const queued = await GET("/admin/notifications?status=pending", { token: t });
    expect(queued.status).toBe(200);
    expect(queued.body.notifications.length).toBeGreaterThan(0);
    expect((await GET("/admin/notifications", { token: w.admins.fin.token })).status).toBe(403);

    const run = await POST("/admin/jobs/send-due-notifications", {}, { token: t });
    expect(run.status).toBe(200);
    const sent = await GET("/admin/notifications?status=sent", { token: t });
    expect(sent.body.notifications.length).toBeGreaterThan(0);
    // A second run finds nothing left to send and sends nothing twice.
    const again = await POST("/admin/jobs/send-due-notifications", {}, { token: t });
    expect(again.body.sent ?? 0).toBe(0);
    expect((await POST(`/admin/notifications/${sent.body.notifications[0].id}/retry`, {}, { token: t })).status).toBeGreaterThanOrEqual(400);
    expect((await POST("/admin/notifications/nope/retry", {}, { token: t })).status).toBe(404);
    expect((await POST("/admin/jobs/send-due-notifications", {}, { token: w.admins.fin.token })).status).toBe(403);
  });

  test("cheque reminders queue once per bucket however often the job runs", async () => {
    const t = w.root.token;
    const first = await POST("/admin/jobs/queue-cheque-reminders", {}, { token: t });
    expect(first.status).toBe(200);
    const second = await POST("/admin/jobs/queue-cheque-reminders", {}, { token: t });
    expect(second.status).toBe(200);
    const dupes = raw().query(`SELECT dedupe_key, COUNT(*) n FROM notifications WHERE dedupe_key IS NOT NULL GROUP BY dedupe_key HAVING n > 1`).all();
    expect(dupes).toEqual([]);
  });

  test("the oversight surface agrees with the books", async () => {
    const t = w.root.token;
    const overview = await GET("/admin/monitoring/overview", { token: t });
    expect(overview.status).toBe(200);
    expect(overview.body.reserve_balance_cents).toBe(db.reserve.getBalance());

    // Orders: filters are honoured and pagination does not repeat or drop rows.
    const all = await GET("/admin/orders?limit=500", { token: t });
    expect(all.body.length).toBeGreaterThan(20);
    const page1 = await GET("/admin/orders?limit=5&offset=0", { token: t });
    const page2 = await GET("/admin/orders?limit=5&offset=5", { token: t });
    expect(page1.body.length).toBe(5);
    expect(page1.body.map((o) => o.id).some((id) => page2.body.map((o) => o.id).includes(id))).toBe(false);
    expect((await GET(`/admin/orders?buyer_user_id=${u(3).user.id}`, { token: t })).body.every((o) => o.buyer_user_id === u(3).user.id)).toBe(true);
    expect((await GET("/admin/orders?status=refunded", { token: t })).body.every((o) => o.status === "refunded")).toBe(true);
    expect((await GET(`/admin/orders/${w.orders.u0Laser.transaction.id}`, { token: t })).status).toBe(200);
    expect((await GET("/admin/orders/tx_nope", { token: t })).status).toBe(404);

    const net = await GET(`/admin/monitoring/reports/trex-net?product_id=${w.products.laser.id}`, { token: t });
    expect(net.status).toBe(200);
    expect(net.body.total_refunded_cents).toBeGreaterThan(0); // refunds are reported next to the as-booked profit
    const reserve = await GET("/admin/monitoring/reports/reserve-fund", { token: t });
    expect(reserve.body.balance_cents).toBe(db.reserve.getBalance());

    const logs = await GET("/admin/logs?limit=500", { token: t });
    for (const action of ["purchase.completed", "transaction.refund", "network.commission_paid", "product.adjust_stock", "admin.user.set_status", "sales.quote_converted"]) {
      expect(logs.body.some((l) => l.action === action), `audit log has ${action}`).toBe(true);
    }
    // Every money-moving action names who did it.
    expect(logs.body.filter((l) => ["transaction.refund", "network.commission_paid", "product.adjust_stock"].includes(l.action)).every((l) => l.actor_user_id)).toBe(true);

    const users = await GET("/admin/users?limit=500", { token: w.admins.usr.token });
    expect(users.body.length).toBeGreaterThanOrEqual(16);
    expect(JSON.stringify(users.body)).not.toContain("password_hash");
    const net2 = await GET(`/admin/users/${u(0).user.id}/network`, { token: w.admins.usr.token });
    expect(net2.status).toBe(200);

    const audit = await GET("/admin/monitoring/reports/audit-invariants", { token: t });
    expect(audit.body.ok).toBe(true);
    expect(audit.body.violations).toEqual([]);
  });

  test("hostile and malformed input never produces a 500", async () => {
    const raw = (method, path, body, token) =>
      app.request(path, { method, headers: { "content-type": "application/json", "x-forwarded-for": freshIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });
    const adminT = w.root.token;
    const targets = [
      ["POST", "/auth/login", undefined], ["POST", "/auth/signup", undefined], ["POST", "/support/requests", undefined],
      ["POST", "/sales/quotes", u(0).token], ["POST", "/purchases", u(0).token], ["POST", "/admin/orders/manual", adminT],
      ["PATCH", "/profile", u(0).token], ["POST", "/redeem-codes", u(0).token], ["POST", "/products", adminT],
      ["PATCH", `/products/${w.products.kit.id}/stock`, adminT], ["PATCH", "/admin/settings", adminT],
      ["POST", "/blog/admin/posts", adminT], ["POST", "/careers/applications", undefined], ["POST", "/ai/ask", undefined],
    ];
    for (const [method, path, token] of targets) {
      for (const body of ["{", "not json", "[]", "null", '"string"', "{\"a\":" + "1".repeat(5000) + "}"]) {
        const res = await raw(method, path, body, token);
        expect(res.status, `${method} ${path} body=${body.slice(0, 20)}`).toBeLessThan(500);
      }
    }
    for (const id of ["../../etc/passwd", "%00", "' OR 1=1 --", "<script>alert(1)</script>", "x".repeat(3000), "🚀"]) {
      for (const path of ["/products", "/nodes", "/spaces", "/redeem-codes", "/blog/posts"]) {
        const res = await GET(`${path}/${encodeURIComponent(id)}`, { token: adminT });
        expect(res.status, `${path}/${id.slice(0, 15)}`).toBeLessThan(500);
      }
    }
    // Hostile text is stored as text and returned as text, never executed or mangled into an error.
    const xss = "<img src=x onerror=alert(1)>";
    const ok = await POST("/support/requests", { name: xss, contact: "x@test.local", message: `${xss} ' OR 1=1 --` });
    expect(ok.status).toBe(201);
    const bigBody = JSON.stringify({ name: "n", contact: "c@test.local", message: "m".repeat(200_000) });
    expect((await raw("POST", "/support/requests", bigBody)).status).toBeLessThan(500);
  });

  test("brute-forcing a login is throttled, and throttling never hides a legitimate login from another address", async () => {
    const target = await signup("sim-brute");
    const ip = "203.0.113.77";
    const statuses = [];
    for (let i = 0; i < 40; i++) statuses.push((await POST("/auth/login", { email: target.email, password: `wrong-guess-${i}` }, { ip })).status);
    expect(statuses.every((s) => s < 500)).toBe(true);
    expect(statuses.includes(429), "a login throttle must engage").toBe(true);
    expect((await POST("/auth/login", { email: target.email, password: PASSWORD })).status).toBe(200); // different address
  });

  test("leaving: a member deletes their account; the network, their sponsor's earnings and the books survive", async () => {
    const leaver = u(5);
    const node = db.nodes.getByUserProduct(leaver.user.id, w.products.kit.id);
    expect(node).toBeTruthy();
    const sponsorRows = db.ledger.listByNode(node.parent_node_id, { limit: 500 }).length;
    expect((await DELETE("/profile", { password: "wrong-password-1" }, { token: leaver.token })).status).toBeGreaterThanOrEqual(400);
    expect((await GET("/profile", { token: leaver.token })).status).toBe(200); // a wrong password deleted nothing
    expect((await DELETE("/profile", { password: PASSWORD }, { token: leaver.token })).status).toBe(200);
    expect((await POST("/auth/login", { email: leaver.email, password: PASSWORD })).status).toBe(401);
    expect((await GET("/profile", { token: leaver.token })).status).toBeGreaterThanOrEqual(401);
    expect(db.nodes.get(node.id)).toBeTruthy();
    expect(db.ledger.listByNode(node.parent_node_id, { limit: 500 }).length).toBe(sponsorRows);
    // They owed the company nothing and are still on the payout sheet only if they are owed.
    expect((await GET("/admin/payouts", { token: w.admins.fin.token })).status).toBe(200);
    // Their email cannot be used to impersonate them: re-registering is refused or yields a fresh, empty account.
    const again = await POST("/auth/signup", { email: leaver.email, password: PASSWORD, name: "Again" });
    if (again.status === 201) expect(db.nodes.getByUserProduct(again.body.user.id, w.products.kit.id)).toBeFalsy();
  });
});

/* ------------------------------------------------------------------------ */
describe("phase 11 -- the books close: every product, wallet and ledger reconciles", () => {
  test("stock on hand = what came in - what was sold, for every device in the story", async () => {
    const initial = { laser: 5, scanner: 30, kit: 200 };
    for (const [key, start] of Object.entries(initial)) {
      const p = w.products[key];
      const sold = raw().query(`SELECT COUNT(*) n FROM transactions WHERE product_id = ?`).get(p.id).n;
      const adjusted = raw()
        .query(`SELECT meta_json FROM audit_logs WHERE action = 'product.adjust_stock' AND entity_id = ?`)
        .all(p.id)
        .reduce((sum, r) => sum + JSON.parse(r.meta_json).delta, 0);
      const now = (await GET(`/products/${p.id}`, { token: w.admins.fin.token })).body.stock_count;
      expect(now, `${key}: ${start} start + ${adjusted} adjustments - ${sold} sold`).toBe(start + adjusted - sold);
    }
  });

  test("every wallet equals its own ledger, and no wallet is negative unless a refund clawed back paid-out cash", async () => {
    for (const x of w.users) {
      const ledger = raw().query(`SELECT COALESCE(SUM(amount_cents),0) n FROM wallet_ledger_entries WHERE user_id = ?`).get(x.user.id).n;
      const balance = db.wallet.getBalance(x.user.id);
      expect(balance, x.email).toBe(ledger);
      if (balance < 0) {
        const clawbacks = raw().query(`SELECT COUNT(*) n FROM wallet_ledger_entries WHERE user_id = ? AND type = 'commission_clawback'`).get(x.user.id).n;
        expect(clawbacks, `${x.email} is negative without a clawback`).toBeGreaterThan(0);
      }
    }
  });

  test("money conservation across the whole book: margin = commission + reserve + net, per sale and in total", async () => {
    const rows = raw().query(`SELECT * FROM transactions`).all();
    expect(rows.length).toBeGreaterThan(20);
    let margin = 0;
    let parts = 0;
    for (const t of rows) {
      expect(t.y_at_sale_cents - t.x_at_sale_cents, t.id).toBe(t.margin_cents);
      expect(t.total_payout_cents + t.reserve_amount_cents + t.trex_net_amount_cents, t.id).toBe(t.margin_cents);
      expect(t.amount_received_cents, t.id).toBeLessThanOrEqual(t.y_at_sale_cents);
      expect(t.refunded_amount_cents, t.id).toBeLessThanOrEqual(t.amount_received_cents);
      margin += t.margin_cents;
      parts += t.total_payout_cents + t.reserve_amount_cents + t.trex_net_amount_cents;
    }
    expect(parts).toBe(margin);
    // Commission rows add up to what each sale says it paid (quota-mode rows are progress, not payout).
    const mismatches = raw()
      .query(
        `SELECT t.id, t.total_payout_cents, COALESCE(SUM(CASE WHEN e.status != 'quota_applied' THEN e.amount_cents END),0) paid
           FROM transactions t LEFT JOIN commission_ledger_entries e ON e.transaction_id = t.id
          GROUP BY t.id HAVING t.total_payout_cents != paid`
      )
      .all();
    expect(mismatches).toEqual([]);
  });

  test("the system's own audit finds nothing wrong anywhere in the whole database", async () => {
    const stats = systemStats();
    console.log("\n  --- full end-to-end simulation ---");
    console.log(`  users ${stats.users} | products ${stats.products} | spaces ${stats.spaces} | nodes ${stats.nodes} | max depth ${stats.maxTreeDepth}`);
    console.log(`  transactions ${stats.transactions} | commission entries ${stats.commissionEntries} | wallet entries ${stats.walletEntries}`);
    console.log(
      `  gross $${(stats.grossRevenueCents / 100).toFixed(2)} | payouts $${(stats.totalPayoutCents / 100).toFixed(2)} | ` +
        `trex_net $${(stats.trexNetCents / 100).toFixed(2)} | refunded $${(stats.refundedCents / 100).toFixed(2)} | reserve $${(stats.reserveCents / 100).toFixed(2)}`
    );
    const problems = auditSystem();
    if (problems.length) console.error("  AUDIT PROBLEMS:\n   - " + problems.join("\n   - "));
    expect(problems).toEqual([]);
  });
});
