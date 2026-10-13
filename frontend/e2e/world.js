// A populated world for the end-to-end tours, built entirely through the HTTP API
// the two apps themselves use: a root admin, five scoped admins, ten customers, a
// referral network on three devices, proformas, cheques, refunds, payouts, blog
// posts, support requests. Every admin and storefront page then has real data to
// render, which is the whole point -- an empty page proves nothing about its table.
//
// Built once per database. The result is cached in e2e/.tmp/world.json, and reused
// only if its credentials still work against the running backend (the e2e database
// is wiped at the start of every run, which makes a stale cache fail the check
// rather than silently describe a world that no longer exists).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { API_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from "../playwright.config.js";

const CACHE = resolve(import.meta.dirname, ".tmp", "world.json");
const SQLITE_PATH = resolve(import.meta.dirname, "..", process.env.E2E_SQLITE_FILE || "./e2e/.tmp/e2e.sqlite");
export const PASSWORD = "world-pass-12345";

let ipN = 0;
async function call(method, path, body, token) {
  ipN += 1;
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.9.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function ok(method, path, body, token, expected = [200, 201]) {
  const res = await call(method, path, body, token);
  if (!expected.includes(res.status)) throw new Error(`world: ${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function fundWallet(email, cents) {
  execFileSync("bun", ["run", resolve(import.meta.dirname, "fund-wallet.js"), email, String(cents)], {
    cwd: resolve(import.meta.dirname, "..", ".."),
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", SQLITE_FILE: SQLITE_PATH },
  });
}

async function build() {
  const w = { password: PASSWORD, admins: {}, users: [], products: {}, orders: {}, codes: {} };

  const rootLogin = await ok("POST", "/auth/login", { email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD });
  w.root = { email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD, token: rootLogin.token, id: rootLogin.user.id };

  // --- staff --------------------------------------------------------------
  const staff = {
    fin: ["FINANCE_ADMIN"],
    usr: ["USERS_ADMIN"],
    cnt: ["CONTENT_ADMIN"],
    finCnt: ["FINANCE_ADMIN", "CONTENT_ADMIN"],
    usrFin: ["USERS_ADMIN", "FINANCE_ADMIN"],
  };
  for (const [label, scopes] of Object.entries(staff)) {
    const email = `e2e-${label.toLowerCase()}@e2e.local`;
    await ok("POST", "/admin/admins", { email, password: PASSWORD, name: `E2E Admin ${label}`, staff_scopes: scopes }, w.root.token);
    const login = await ok("POST", "/auth/login", { email, password: PASSWORD });
    w.admins[label] = { email, password: PASSWORD, token: login.token, id: login.user.id, scopes };
  }
  const fin = w.admins.fin.token;

  // --- catalogue ----------------------------------------------------------
  const mk = (name, x, y, stock) => ok("POST", "/products", { name, description: `${name} for the end-to-end world`, stockCount: stock, xCents: x, yCents: y }, fin);
  w.products.laser = await mk("E2E Laser", 1_200_000, 2_000_000, 12);
  w.products.scanner = await mk("E2E Scanner", 600_000, 1_000_000, 30);
  w.products.kit = await mk("E2E Kit", 40_000, 100_000, 200);

  // --- people -------------------------------------------------------------
  for (let i = 0; i < 10; i++) {
    const email = `e2e-u${i}@e2e.local`;
    const res = await ok("POST", "/auth/signup", { email, password: PASSWORD, name: `E2E User ${i}` });
    w.users.push({ email, password: PASSWORD, token: res.token, id: res.user.id, name: `E2E User ${i}` });
  }

  // --- sales: a referral chain, an installment order, a second device -------
  const sell = (user, product, extra = {}) =>
    ok("POST", "/admin/orders/manual", { user_id: user.id, product_id: product.id, amount_received_cents: product.list_price_y_cents, ...extra }, fin);

  const l0 = await sell(w.users[0], w.products.laser);
  const l1 = await sell(w.users[1], w.products.laser, { redeem_code: l0.ownRedeemCode.code });
  const l2 = await sell(w.users[2], w.products.laser, { redeem_code: l1.ownRedeemCode.code });
  w.orders.l0 = l0;
  w.orders.l1 = l1;
  w.orders.l2 = l2;
  w.codes.u0Laser = l0.ownRedeemCode.code;

  const inst = await sell(w.users[3], w.products.laser, {
    redeem_code: l0.ownRedeemCode.code,
    amount_received_cents: 800_000,
    payment_terms: "installment",
    override_down_payment: undefined,
    cheques: [
      { amount_cents: 400_000, due_date: "2026-11-15", cheque_number: "7001", bank_name: "Bank Melli" },
      { amount_cents: 400_000, due_date: "2026-12-15", cheque_number: "7002", bank_name: "Bank Melli" },
      { amount_cents: 400_000, due_date: "2027-01-15", cheque_number: "7003", bank_name: "Bank Melli" },
    ],
  });
  w.orders.inst = inst;
  const cheques = (await ok("GET", `/admin/orders/${inst.transaction.id}/cheques`, undefined, fin)).cheques;
  await ok("POST", `/cheques/${cheques[0].id}/status`, { status: "cleared" }, fin);
  await ok("POST", `/cheques/${cheques[1].id}/status`, { status: "bounced" }, fin);
  w.cheques = cheques;

  const s0 = await sell(w.users[4], w.products.scanner);
  w.orders.s0 = s0;
  w.codes.u4Scanner = s0.ownRedeemCode.code;
  fundWallet(w.users[5].email, 1_000_000);
  await ok("POST", "/purchases", { product_id: w.products.scanner.id, redeem_code: s0.ownRedeemCode.code }, w.users[5].token);
  await sell(w.users[6], w.products.kit);

  // One sale is refunded in part, so refunds, clawbacks and the report all have a row.
  await ok("POST", `/admin/orders/${l2.transaction.id}/refund`, { amount_cents: 500_000, reason: "world: partial refund" }, fin);

  // --- the proforma desk -----------------------------------------------------
  const quote = (b, token) => ok("POST", "/sales/quotes", b, token);
  w.quotes = {
    anon: await quote({ kind: "proforma", product_id: w.products.laser.id, contact_name: "Anon Clinic", contact_email: "anon@clinic.test", contact_phone: "+98 912 111 0000", amount_cents: 2_000_000, clinic_city: "Tehran" }),
    user: await quote({ kind: "proforma", product_id: w.products.scanner.id, contact_name: "E2E User 7", contact_email: w.users[7].email, contact_phone: "+98 912 222 0000", amount_cents: 1_000_000, referral_code: w.codes.u4Scanner }, w.users[7].token),
    lease: await quote({ kind: "lease", product_id: w.products.laser.id, contact_name: "Lease Clinic", contact_email: "lease@clinic.test", contact_phone: "+98 912 333 0000", term_months: 24, upfront_pct: 30 }),
    enquiry: await quote({ kind: "enquiry", product_id: w.products.kit.id, contact_name: "Kit Enquirer", contact_email: "kit@clinic.test" }),
  };
  await ok("PATCH", `/sales/quotes/${w.quotes.user.id}`, { status: "contacted", admin_note: "Called back, wants the scanner." }, fin);

  // --- people-side and content ----------------------------------------------
  await ok("POST", "/support/requests", { name: "Visitor", contact: "visitor@e2e.local", message: "Do you install devices in Shiraz?" });
  await ok("POST", "/support/requests", { name: w.users[8].name, contact: w.users[8].email, message: "How do I use my redeem code?" }, w.users[8].token);
  await ok("POST", "/careers/applications", { field_of_work: "Technical", first_name: "Sima", last_name: "Karimi", phone: "+989121110000", email: "sima@e2e.local" });
  const cnt = w.admins.cnt.token;
  const post = await ok("POST", "/blog/admin/posts", { title: "E2E world: launch day", excerpt: "We are live", body: "# Hello\n\nThe **world** is built.", tags: ["news"] }, cnt);
  await ok("PATCH", `/blog/admin/posts/${post.id}`, { status: "published" }, cnt);
  await ok("POST", "/blog/admin/posts", { title: "E2E world: a draft", body: "Not yet.", tags: [] }, cnt);
  w.post = post;
  // The e2e backend ships with the assistant switched off (as production does), so
  // its knowledge base is simply not there; 503 is the expected answer, not a fault.
  await ok("POST", "/ai/knowledge", { question: "Do you offer leasing?", answer: "Yes, 12 to 48 months.", tags: ["lease"] }, cnt, [200, 201, 503]);

  // --- money: one person is settled in cash, the rest stay owed ----------------
  const sheet = await ok("GET", "/admin/payouts", undefined, fin);
  const first = sheet.people[0];
  if (first) await ok("POST", `/admin/payouts/${first.user_id}/settle`, { expected_cents: first.owed.cents, method: "cash", reference: "WORLD-001" }, fin);

  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(w, null, 2));
  return w;
}

let memo = null;
/** The populated world, building it on first use for this database. */
export async function getWorld() {
  if (memo) return memo;
  if (existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, "utf8"));
    const probe = await call("POST", "/auth/login", { email: cached.users[0].email, password: cached.password });
    if (probe.status === 200) {
      memo = cached;
      return memo;
    }
  }
  memo = await build();
  return memo;
}
