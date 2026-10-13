import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { GET, POST, PATCH, DELETE, signup, signupAdmin, createProduct, buy, fund, nextEmail, PASSWORD } from "./httpHelpers.js";

// End-to-end coverage of the HTTP surface: every route in src/routes/* is
// driven through the real Hono app, so these exercise the middleware stack
// (auth, admin guard, rate limiting, error mapping) that service-level tests
// in the other files skip entirely.

describe("app shell", () => {
  test("GET /health is public and reports the service", async () => {
    const res = await GET("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "trex-backend" });
  });

  test("an unknown path returns a structured 404, not an HTML page", async () => {
    const res = await GET("/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  test("CORS preflight from an allowed origin is answered; secure headers are set", async () => {
    const res = await GET("/products", {
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("a malformed JSON body surfaces as a 4xx/5xx JSON error, never a hang", async () => {
    const res = await POST("/auth/login", undefined, { headers: { "content-type": "application/json" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("auth routes", () => {
  test("signup issues a working token and creates a wallet account", async () => {
    const email = nextEmail("signup");
    const res = await POST("/auth/signup", { email, password: PASSWORD, name: "Signup Person" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe("user");
    expect(res.body.user.password_hash).toBeUndefined();

    const wallet = await GET("/wallet", { token: res.body.token });
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance_cents).toBe(0);
  });

  test("signup rejects duplicates (case-insensitively), short passwords, and missing fields", async () => {
    const email = nextEmail("dupe");
    expect((await POST("/auth/signup", { email, password: PASSWORD, name: "A" })).status).toBe(201);

    const dupe = await POST("/auth/signup", { email: email.toUpperCase(), password: PASSWORD, name: "B" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("email_taken");

    expect((await POST("/auth/signup", { email: nextEmail("short"), password: "abc", name: "C" })).status).toBe(400);
    expect((await POST("/auth/signup", { email: nextEmail("noname"), password: PASSWORD })).status).toBe(400);
  });

  test("login succeeds with the right credentials and fails identically for wrong password vs unknown email", async () => {
    const actor = await signup("login");

    const ok = await POST("/auth/login", { email: actor.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const wrongPass = await POST("/auth/login", { email: actor.email, password: "not-the-password" });
    const unknown = await POST("/auth/login", { email: nextEmail("ghost"), password: PASSWORD });
    // Identical shape both ways -- login must not be a user-enumeration oracle.
    expect(wrongPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPass.body.error.code).toBe(unknown.body.error.code);
    expect(wrongPass.body.error.message).toBe(unknown.body.error.message);
  });

  test("GET /auth/me requires a well-formed bearer token", async () => {
    const actor = await signup("me");

    expect((await GET("/auth/me")).status).toBe(401);
    expect((await GET("/auth/me", { headers: { Authorization: "Basic abc" } })).status).toBe(401);
    expect((await GET("/auth/me", { headers: { Authorization: "Bearer not.a.jwt" } })).status).toBe(401);

    const me = await GET("/auth/me", { token: actor.token });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(actor.user.id);
  });

  test("suspending a user invalidates their live session on the very next request", async () => {
    const actor = await signup("suspendme");
    expect((await GET("/auth/me", { token: actor.token })).status).toBe(200);

    db.users.updateStatus(actor.user.id, "suspended");

    const after = await GET("/auth/me", { token: actor.token });
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe("account_inactive");

    const relogin = await POST("/auth/login", { email: actor.email, password: PASSWORD });
    expect(relogin.status).toBe(403);
  });

  test("forgot/reset password round trip: token works once, then is dead", async () => {
    const actor = await signup("reset");

    const unknown = await POST("/auth/forgot-password", { email: nextEmail("nobody") });
    const known = await POST("/auth/forgot-password", { email: actor.email });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    // Same user-facing message either way (no enumeration), but only the
    // real account gets a token back in non-production.
    expect(unknown.body.message).toBe(known.body.message);
    expect(unknown.body.debug_token).toBeUndefined();
    expect(known.body.debug_token).toBeTruthy();

    const newPassword = "brand-new-passphrase";
    const reset = await POST("/auth/reset-password", { token: known.body.debug_token, new_password: newPassword });
    expect(reset.status).toBe(200);

    expect((await POST("/auth/login", { email: actor.email, password: PASSWORD })).status).toBe(401);
    expect((await POST("/auth/login", { email: actor.email, password: newPassword })).status).toBe(200);

    const replay = await POST("/auth/reset-password", { token: known.body.debug_token, new_password: "yet-another-pass" });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("invalid_reset_token");
  });

  test("reset-password rejects garbage tokens and short passwords", async () => {
    expect((await POST("/auth/reset-password", { token: "garbage", new_password: PASSWORD })).status).toBe(400);
    expect((await POST("/auth/reset-password", { new_password: PASSWORD })).status).toBe(400);
    expect((await POST("/auth/reset-password", { token: "garbage", new_password: "short" })).status).toBe(400);
  });

  test("login is rate limited per client IP", async () => {
    const ip = "203.0.113.7"; // pinned: this test is about the limiter itself
    const email = nextEmail("bruteforce");
    let sawRateLimit = false;
    for (let i = 0; i < 15; i++) {
      const res = await POST("/auth/login", { email, password: "guess" }, { ip });
      if (res.status === 429) {
        expect(res.body.error.code).toBe("rate_limited");
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });
});

describe("profile routes", () => {
  test("read and rename the signed-in profile", async () => {
    const actor = await signup("profile");

    const me = await GET("/profile", { token: actor.token });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(actor.user.id);

    const renamed = await PATCH("/profile", { name: "Renamed Person" }, { token: actor.token });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Renamed Person");

    expect((await PATCH("/profile", {}, { token: actor.token })).status).toBe(400);
    expect((await GET("/profile")).status).toBe(401);
  });

  test("password change requires the current password and invalidates the old one", async () => {
    const actor = await signup("pwchange");

    const wrong = await PATCH("/profile/password", { current_password: "nope", new_password: "a-new-password" }, { token: actor.token });
    expect(wrong.status).toBe(401);
    // Still the old password after a failed attempt.
    expect((await POST("/auth/login", { email: actor.email, password: PASSWORD })).status).toBe(200);

    const tooShort = await PATCH("/profile/password", { current_password: PASSWORD, new_password: "abc" }, { token: actor.token });
    expect(tooShort.status).toBe(400);

    const ok = await PATCH("/profile/password", { current_password: PASSWORD, new_password: "a-new-password" }, { token: actor.token });
    expect(ok.status).toBe(200);
    expect((await POST("/auth/login", { email: actor.email, password: PASSWORD })).status).toBe(401);
    expect((await POST("/auth/login", { email: actor.email, password: "a-new-password" })).status).toBe(200);
  });

  test("account deletion is password-gated, blocks login, and frees the email", async () => {
    const actor = await signup("deleteme");

    expect((await DELETE("/profile", { password: "wrong" }, { token: actor.token })).status).toBe(401);
    expect((await GET("/profile", { token: actor.token })).status).toBe(200);

    const gone = await DELETE("/profile", { password: PASSWORD }, { token: actor.token });
    expect(gone.status).toBe(200);

    expect((await POST("/auth/login", { email: actor.email, password: PASSWORD })).status).toBe(401);
    // The token is dead too -- requireAuth re-reads status on every request.
    expect((await GET("/profile", { token: actor.token })).status).toBe(403);
    // ...and the address is reusable for a fresh account.
    expect((await POST("/auth/signup", { email: actor.email, password: PASSWORD, name: "Reborn" })).status).toBe(201);
  });
});

describe("product routes", () => {
  test("browsing the catalogue needs no auth; writing it needs admin", async () => {
    const admin = await signupAdmin("prodadmin");
    const user = await signup("prodbrowser");
    const product = await createProduct(admin.token, { name: "Public Catalogue Item" });

    const list = await GET("/products");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((p) => p.id === product.id)).toBe(true);

    const detail = await GET(`/products/${product.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.commission_plan).toBeTruthy();
    // specs come back parsed, not as a raw JSON string.
    expect(typeof detail.body.specs).toBe("object");

    expect((await GET("/products/prod_does_not_exist")).status).toBe(404);

    expect((await POST("/products", { name: "x", xCents: 1, yCents: 2 })).status).toBe(401);
    expect((await POST("/products", { name: "x", xCents: 1, yCents: 2 }, { token: user.token })).status).toBe(403);
  });

  test("product creation validates its money fields", async () => {
    const admin = await signupAdmin("prodvalidate");
    expect((await POST("/products", { xCents: 100, yCents: 200 }, { token: admin.token })).status).toBe(400);
    expect((await POST("/products", { name: "n", xCents: -1, yCents: 200 }, { token: admin.token })).status).toBe(400);
    expect((await POST("/products", { name: "n", xCents: 100, yCents: 0 }, { token: admin.token })).status).toBe(400);
    expect((await POST("/products", { name: "n", xCents: 1.5, yCents: 200 }, { token: admin.token })).status).toBe(400);
  });

  test("status filter and pagination on the catalogue listing", async () => {
    const admin = await signupAdmin("prodpage");
    const a = await createProduct(admin.token);
    await createProduct(admin.token);
    await PATCH(`/products/${a.id}/status`, { status: "discontinued" }, { token: admin.token });

    const active = await GET("/products?status=active");
    expect(active.body.every((p) => p.status === "active")).toBe(true);
    expect(active.body.some((p) => p.id === a.id)).toBe(false);

    const discontinued = await GET("/products?status=discontinued");
    expect(discontinued.body.some((p) => p.id === a.id)).toBe(true);

    const onlyOne = await GET("/products?limit=1");
    expect(onlyOne.body.length).toBe(1);
    const page2 = await GET("/products?limit=1&offset=1");
    expect(page2.body[0].id).not.toBe(onlyOne.body[0].id);
  });

  test("admin edits name, price, status, stock and warehouse cost through the API", async () => {
    const admin = await signupAdmin("prodedit");
    const product = await createProduct(admin.token, { stockCount: 3 });

    const renamed = await PATCH(`/products/${product.id}`, { name: "Renamed Device", description: "new copy" }, { token: admin.token });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Renamed Device");

    const repriced = await PATCH(`/products/${product.id}/price`, { y_cents: 12345 }, { token: admin.token });
    expect(repriced.body.list_price_y_cents).toBe(12345);
    expect((await PATCH(`/products/${product.id}/price`, { y_cents: 0 }, { token: admin.token })).status).toBe(400);

    const cost = await POST(`/products/${product.id}/warehouse-cost`, { x_cents: 5555 }, { token: admin.token });
    expect(cost.status).toBe(201);
    // Admin-gated: warehouse cost is the per-unit purchase price, i.e. the
    // company's margin on the device, and has no business being anonymous.
    const history = await GET(`/products/${product.id}/warehouse-cost`, { token: admin.token });
    expect(history.status).toBe(200);
    expect(history.body.some((h) => h.x_cents === 5555)).toBe(true);
    // The append also becomes the product's current x -- visible to an admin,
    // who gets the full row, but not to an anonymous storefront visitor.
    expect((await GET(`/products/${product.id}`, { token: admin.token })).body.current_x_cents).toBe(5555);
    expect((await GET(`/products/${product.id}`)).body.current_x_cents).toBeUndefined();

    const stocked = await PATCH(`/products/${product.id}/stock`, { delta: 7 }, { token: admin.token });
    expect(stocked.body.stock_count).toBe(10);

    expect((await PATCH(`/products/${product.id}/status`, { status: "nonsense" }, { token: admin.token })).status).toBe(400);
  });

  test("product JSON never carries the base64 image, only a URL to it", async () => {
    const admin = await signupAdmin("imgadmin");
    // A 1x1 transparent PNG, same shape the admin ImagePicker uploads.
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const product = await createProduct(admin.token);
    await PATCH(`/products/${product.id}`, { specs: { image_data_url: dataUrl } }, { token: admin.token });

    const detail = await GET(`/products/${product.id}`);
    expect(detail.status).toBe(200);
    // The blob is ~120KB per product in production -- it must never ride
    // along in the JSON, in either the parsed or the raw form.
    expect(detail.body.specs.image_data_url).toBeUndefined();
    expect(detail.body.specs_json).toBeUndefined();
    expect(detail.body.specs.image_url).toBe(`/products/${product.id}/image`);

    const listed = await GET("/products?limit=50");
    const row = listed.body.find((p) => p.id === product.id);
    expect(row.specs.image_data_url).toBeUndefined();
    expect(row.specs_json).toBeUndefined();
  });

  test("the image endpoint serves real bytes, is publicly cacheable, and revalidates", async () => {
    const admin = await signupAdmin("imgbytesadmin");
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const product = await createProduct(admin.token);
    await PATCH(`/products/${product.id}`, { specs: { image_data_url: dataUrl } }, { token: admin.token });

    // Public: the storefront is browsable without an account.
    const res = await GET(`/products/${product.id}/image`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age");
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();

    // Conditional request skips resending the bytes.
    const revalidated = await GET(`/products/${product.id}/image`, { headers: { "if-none-match": etag } });
    expect(revalidated.status).toBe(304);

    // A product with no image is a clean 404, not a broken 200.
    const bare = await createProduct(admin.token);
    const missing = await GET(`/products/${bare.id}/image`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("no_image");
    expect((await GET("/products/prod_nope/image")).status).toBe(404);
  });

  test("a partial specs update merges instead of wiping the stored image", async () => {
    const admin = await signupAdmin("specsmergeadmin");
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const product = await createProduct(admin.token);
    await PATCH(`/products/${product.id}`, { specs: { image_data_url: dataUrl } }, { token: admin.token });

    // Reads no longer echo the image back, so a client editing some other
    // spec field cannot round-trip it -- the merge is what protects it.
    const updated = await PATCH(
      `/products/${product.id}`,
      { specs: { manufacturer: "Ashkan Medical" } },
      { token: admin.token }
    );
    expect(updated.status).toBe(200);
    expect(updated.body.specs.manufacturer).toBe("Ashkan Medical");
    expect(updated.body.specs.image_url).toBeTruthy();
    expect((await GET(`/products/${product.id}/image`)).status).toBe(200);
  });

  test("stock cannot be driven negative by an admin adjustment", async () => {
    const admin = await signupAdmin("prodstock");
    const product = await createProduct(admin.token, { stockCount: 2 });

    const overdraw = await PATCH(`/products/${product.id}/stock`, { delta: -5 }, { token: admin.token });
    expect(overdraw.status).toBe(400);
    expect((await GET(`/products/${product.id}`)).body.stock_count).toBe(2);

    const exact = await PATCH(`/products/${product.id}/stock`, { delta: -2 }, { token: admin.token });
    expect(exact.status).toBe(200);
    expect(exact.body.stock_count).toBe(0);
  });
});

describe("wallet routes", () => {
  test("every wallet route is behind auth", async () => {
    for (const path of ["/wallet", "/wallet/ledger"]) {
      expect((await GET(path)).status).toBe(401, path);
    }
  });

  test("top-ups and withdrawals do not exist", async () => {
    const actor = await signup("nomoneymoves");
    for (const [method, path] of [
      ["POST", "/wallet/deposit"],
      ["POST", "/wallet/withdraw"],
      ["GET", "/wallet/deposits"],
      ["GET", "/wallet/withdrawals"],
    ]) {
      const res = method === "GET" ? await GET(path, { token: actor.token }) : await POST(path, { amount_cents: 100 }, { token: actor.token });
      expect(`${method} ${path}=${res.status}`).toBe(`${method} ${path}=404`);
    }
  });

  test("one user never sees another user's ledger", async () => {
    const a = await signup("walletA");
    const b = await signup("walletB");
    fund(a.user.id, 999);
    const bLedger = await GET("/wallet/ledger", { token: b.token });
    expect(bLedger.body.length).toBe(0);
    expect((await GET("/wallet/ledger", { token: a.token })).body.length).toBe(1);
  });

  test("the ledger records credits and debits with a running balance", async () => {
    const actor = await signup("ledgerwatch");
    fund(actor.user.id, 1000);
    fund(actor.user.id, 500);

    const ledger = await GET("/wallet/ledger", { token: actor.token });
    expect(ledger.status).toBe(200);
    expect(ledger.body.length).toBe(2);
    expect(ledger.body[0].balance_after).toBe(1500);

    const paged = await GET("/wallet/ledger?limit=1", { token: actor.token });
    expect(paged.body.length).toBe(1);
  });
});

describe("purchase, space, node and redeem-code flow", () => {
  test("a first purchase with no code opens a Space and roots the buyer in it", async () => {
    const admin = await signupAdmin("buyadmin");
    const buyer = await signup("rootbuyer");
    const product = await createProduct(admin.token);

    const res = await buy(buyer, product);
    expect(res.status).toBe(201);
    expect(res.body.transaction.buyer_user_id).toBe(buyer.user.id);
    expect(res.body.node.parent_node_id).toBeNull();
    expect(res.body.space.root_node_id).toBe(res.body.node.id);
    expect(res.body.ownRedeemCode.code).toBeTruthy();
    // Paid for out of the wallet.
    expect((await GET("/wallet", { token: buyer.token })).body.balance_cents).toBe(0);
    // ...and it consumed stock.
    expect((await GET(`/products/${product.id}`)).body.stock_count).toBe(499);
  });

  test("buying the same product twice is refused", async () => {
    const admin = await signupAdmin("dupebuyadmin");
    const buyer = await signup("dupebuyer");
    const product = await createProduct(admin.token);

    expect((await buy(buyer, product)).status).toBe(201);
    const second = await buy(buyer, product);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("already_has_node");
  });

  test("a referred purchase attaches the buyer under the code owner in the same Space", async () => {
    const admin = await signupAdmin("refadmin");
    const sponsor = await signup("sponsor");
    const referred = await signup("referred");
    const product = await createProduct(admin.token);

    const sponsorBuy = await buy(sponsor, product);
    const code = sponsorBuy.body.ownRedeemCode.code;

    const check = await GET(`/redeem-codes/${code}`);
    expect(check.status).toBe(200);
    expect(check.body.usable).toBe(true);
    expect(check.body.owner_user_id).toBe(sponsor.user.id);

    const res = await buy(referred, product, { redeemCode: code });
    expect(res.status).toBe(201);
    expect(res.body.node.parent_node_id).toBe(sponsorBuy.body.node.id);
    expect(res.body.space.id).toBe(sponsorBuy.body.space.id);

    // The sponsor earned a pending commission entry from it.
    const earnings = await GET(`/nodes/${sponsorBuy.body.node.id}/earnings`, { token: sponsor.token });
    expect(earnings.status).toBe(200);
    expect(earnings.body.entries.length).toBeGreaterThan(0);
    expect(earnings.body.entries[0].status).toBe("pending");
    expect(earnings.body.totals.total_cents).toBeGreaterThan(0);
  });

  test("redeem codes reject self-referral, the wrong product, and unknown codes", async () => {
    const admin = await signupAdmin("codeadmin");
    const sponsor = await signup("selfref");
    const other = await signup("otherbuyer");
    const productA = await createProduct(admin.token);
    const productB = await createProduct(admin.token);

    const sponsorBuy = await buy(sponsor, productA);
    const code = sponsorBuy.body.ownRedeemCode.code;

    // Own code on the same product -- caught as "already has node" first,
    // which is the stronger guarantee; the self-referral check backstops
    // the case where that isn't true.
    const self = await buy(sponsor, productA, { redeemCode: code });
    expect(self.status).toBe(409);

    const wrongProduct = await buy(other, productB, { redeemCode: code });
    expect(wrongProduct.status).toBe(400);
    expect(wrongProduct.body.error.code).toBe("redeem_code_wrong_product");

    const unknown = await buy(other, productA, { redeemCode: "TREX-NOPE-NOPE" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("redeem_code_not_found");

    expect((await GET("/redeem-codes/TREX-NOPE-NOPE")).status).toBe(404);
  });

  test("an underfunded purchase rolls back completely -- no node, no space, no transaction", async () => {
    const admin = await signupAdmin("brokeadmin");
    const buyer = await signup("brokebuyer");
    const product = await createProduct(admin.token);

    const stockBefore = (await GET(`/products/${product.id}`)).body.stock_count;

    const res = await POST("/purchases", { product_id: product.id }, { token: buyer.token });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_funds");

    expect((await GET("/nodes/mine", { token: buyer.token })).body.length).toBe(0);
    expect((await GET("/purchases", { token: buyer.token })).body.length).toBe(0);
    expect((await GET("/spaces", { token: buyer.token })).body.length).toBe(0);
    expect((await GET(`/products/${product.id}`)).body.stock_count).toBe(stockBefore);
  });

  test("a discontinued product cannot be bought", async () => {
    const admin = await signupAdmin("discadmin");
    const buyer = await signup("discbuyer");
    const product = await createProduct(admin.token);
    await PATCH(`/products/${product.id}/status`, { status: "discontinued" }, { token: admin.token });

    const res = await buy(buyer, product);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("product_inactive");
  });

  test("an out-of-stock product cannot be bought", async () => {
    const admin = await signupAdmin("stockadmin");
    const first = await signup("laststockbuyer");
    const second = await signup("toolatebuyer");
    const product = await createProduct(admin.token, { stockCount: 1 });

    expect((await buy(first, product)).status).toBe(201);
    expect((await GET(`/products/${product.id}`)).body.stock_count).toBe(0);

    const tooLate = await buy(second, product);
    expect(tooLate.status).toBe(422);
    expect(tooLate.body.error.code).toBe("out_of_stock");
    // The refused purchase must not have taken the buyer's money.
    expect((await GET("/wallet", { token: second.token })).body.balance_cents).toBe(product.list_price_y_cents);
    // ...nor pushed stock below zero.
    expect((await GET(`/products/${product.id}`)).body.stock_count).toBe(0);
  });

  test("an over-large discount is refused rather than silently clamped", async () => {
    const admin = await signupAdmin("discountadmin");
    const buyer = await signup("discountbuyer");
    const product = await createProduct(admin.token, { xCents: 9000, yCents: 10000 });

    fund(buyer.user.id, 10000);
    const res = await POST("/purchases", { product_id: product.id, discount_cents: 950 }, { token: buyer.token });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("invariant1_violation");

    const negative = await POST("/purchases", { product_id: product.id, discount_cents: -100 }, { token: buyer.token });
    expect(negative.status).toBe(400);

    const total = await POST("/purchases", { product_id: product.id, discount_cents: 10000 }, { token: buyer.token });
    expect(total.status).toBe(400);
  });

  test("purchase receipts are private to the buyer", async () => {
    const admin = await signupAdmin("receiptadmin");
    const buyer = await signup("receiptbuyer");
    const stranger = await signup("receiptstranger");
    const product = await createProduct(admin.token);

    const res = await buy(buyer, product);
    const txId = res.body.transaction.id;

    const own = await GET(`/purchases/${txId}`, { token: buyer.token });
    expect(own.status).toBe(200);
    expect(Array.isArray(own.body.ledger_entries)).toBe(true);

    expect((await GET(`/purchases/${txId}`, { token: stranger.token })).status).toBe(403);
    expect((await GET(`/purchases/${txId}`, { token: admin.token })).status).toBe(200);
    expect((await GET("/purchases/tx_nope", { token: buyer.token })).status).toBe(404);

    const list = await GET("/purchases", { token: buyer.token });
    expect(list.body.length).toBe(1);
    expect((await GET("/purchases", { token: stranger.token })).body.length).toBe(0);
  });

  test("node detail surfaces are owner-only", async () => {
    const admin = await signupAdmin("nodeadmin");
    const owner = await signup("nodeowner");
    const stranger = await signup("nodestranger");
    const product = await createProduct(admin.token);

    const res = await buy(owner, product);
    const nodeId = res.body.node.id;

    const mine = await GET("/nodes/mine", { token: owner.token });
    expect(mine.body.length).toBe(1);
    expect(mine.body[0].id).toBe(nodeId);

    for (const path of [
      `/nodes/${nodeId}`,
      `/nodes/${nodeId}/downline`,
      `/nodes/${nodeId}/earnings`,
      `/nodes/${nodeId}/redeem-codes`,
      `/nodes/${nodeId}/rank`,
      `/nodes/${nodeId}/rank-bonuses`,
      `/nodes/${nodeId}/quota`,
      `/nodes/${nodeId}/quota-bonuses`,
    ]) {
      expect((await GET(path, { token: owner.token })).status).toBe(200, path);
      expect((await GET(path, { token: stranger.token })).status).toBe(403, path);
      expect((await GET(path)).status).toBe(401, path);
      // Admin reaches every one of them.
      expect((await GET(path, { token: admin.token })).status).toBe(200, path);
    }

    const detail = await GET(`/nodes/${nodeId}`, { token: owner.token });
    expect(detail.body.own_redeem_code.code).toBeTruthy();
    expect(Array.isArray(detail.body.upline)).toBe(true);

    expect((await GET("/nodes/node_nope", { token: owner.token })).status).toBe(404);
  });

  test("node status is admin-only and a suspended node stops earning", async () => {
    const admin = await signupAdmin("nodestatusadmin");
    const sponsor = await signup("suspendedsponsor");
    const referred = await signup("referredunder");
    const product = await createProduct(admin.token);

    const sponsorBuy = await buy(sponsor, product);
    const nodeId = sponsorBuy.body.node.id;

    const denied = await PATCH(`/nodes/${nodeId}/status`, { status: "suspended" }, { token: sponsor.token });
    expect(denied.status).toBe(403);

    const suspended = await PATCH(`/nodes/${nodeId}/status`, { status: "suspended" }, { token: admin.token });
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe("suspended");

    const earningsBefore = (await GET(`/nodes/${nodeId}/earnings`, { token: admin.token })).body.entries.length;
    expect((await buy(referred, product, { redeemCode: sponsorBuy.body.ownRedeemCode.code })).status).toBe(201);
    const earningsAfter = (await GET(`/nodes/${nodeId}/earnings`, { token: admin.token })).body.entries.length;
    expect(earningsAfter).toBe(earningsBefore);
  });

  test("Space listing, detail and tree are restricted to participants", async () => {
    const admin = await signupAdmin("spaceadmin");
    const root = await signup("spaceroot");
    const child = await signup("spacechild");
    const outsider = await signup("spaceoutsider");
    const product = await createProduct(admin.token);

    const rootBuy = await buy(root, product);
    const spaceId = rootBuy.body.space.id;
    await buy(child, product, { redeemCode: rootBuy.body.ownRedeemCode.code });

    expect((await GET(`/spaces/${spaceId}`, { token: root.token })).status).toBe(200);
    expect((await GET(`/spaces/${spaceId}`, { token: child.token })).status).toBe(200);
    expect((await GET(`/spaces/${spaceId}`, { token: outsider.token })).status).toBe(403);
    expect((await GET(`/spaces/${spaceId}`, { token: admin.token })).status).toBe(200);
    expect((await GET(`/spaces/${spaceId}`)).status).toBe(401);

    const tree = await GET(`/spaces/${spaceId}/tree`, { token: root.token });
    expect(tree.status).toBe(200);
    expect(tree.body.root.node_id).toBe(rootBuy.body.node.id);
    expect(tree.body.root.children.length).toBe(1);
    expect((await GET(`/spaces/${spaceId}/tree`, { token: outsider.token })).status).toBe(403);

    // Listing is scoped: participants see theirs, outsiders see none.
    expect((await GET("/spaces", { token: root.token })).body.some((s) => s.id === spaceId)).toBe(true);
    expect((await GET("/spaces", { token: outsider.token })).body.length).toBe(0);
    expect((await GET(`/spaces?product_id=${product.id}`, { token: root.token })).body.length).toBe(1);

    expect((await GET("/spaces/spc_nope", { token: admin.token })).status).toBe(404);
  });

  test("extra redeem codes: generate, list, validate limits, and revoke", async () => {
    const admin = await signupAdmin("extracodeadmin");
    const owner = await signup("extracodeowner");
    const stranger = await signup("extracodestranger");
    const product = await createProduct(admin.token);

    // You need a position before you can hand out invites for it.
    const early = await POST("/redeem-codes", { product_id: product.id }, { token: owner.token });
    expect(early.status).toBe(404);
    expect(early.body.error.code).toBe("no_node_for_product");

    await buy(owner, product);

    const extra = await POST("/redeem-codes", { product_id: product.id, max_uses: 1 }, { token: owner.token });
    expect(extra.status).toBe(201);
    expect(extra.body.max_uses).toBe(1);

    expect((await POST("/redeem-codes", { product_id: product.id, max_uses: 0 }, { token: owner.token })).status).toBe(400);

    const mine = await GET(`/redeem-codes/mine?product_id=${product.id}`, { token: owner.token });
    expect(mine.body.length).toBe(2); // the auto-issued one plus this extra
    expect((await GET(`/redeem-codes/mine?product_id=${product.id}`, { token: stranger.token })).body.length).toBe(0);

    // An expired code validates as unusable rather than 404.
    const expired = await POST(
      "/redeem-codes",
      { product_id: product.id, expires_at: new Date(Date.now() - 60_000).toISOString() },
      { token: owner.token }
    );
    const expiredCheck = await GET(`/redeem-codes/${expired.body.code}`);
    expect(expiredCheck.status).toBe(200);
    expect(expiredCheck.body.usable).toBe(false);

    expect((await POST(`/redeem-codes/${extra.body.id}/revoke`, {}, { token: stranger.token })).status).toBe(403);
    const revoked = await POST(`/redeem-codes/${extra.body.id}/revoke`, {}, { token: owner.token });
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("revoked");
    expect((await GET(`/redeem-codes/${extra.body.code}`)).body.usable).toBe(false);
  });

  test("a code at its max_uses stops working for the next buyer", async () => {
    const admin = await signupAdmin("maxusesadmin");
    const owner = await signup("maxusesowner");
    const first = await signup("maxusesfirst");
    const second = await signup("maxusessecond");
    const product = await createProduct(admin.token);

    await buy(owner, product);
    const single = await POST("/redeem-codes", { product_id: product.id, max_uses: 1 }, { token: owner.token });

    expect((await buy(first, product, { redeemCode: single.body.code })).status).toBe(201);
    const exhausted = await buy(second, product, { redeemCode: single.body.code });
    expect(exhausted.status).toBeGreaterThanOrEqual(400);
    expect((await GET(`/redeem-codes/${single.body.code}`)).body.usable).toBe(false);
  });
});

describe("support routes", () => {
  test("intake: anonymous submit, staff-only triage", async () => {
    const admin = await signupAdmin("supportadmin");
    const user = await signup("supportuser");

    expect((await POST("/support/requests", { name: "n", contact: "c" })).status).toBe(400);
    const created = await POST("/support/requests", {
      name: "Device owner",
      contact: "+98912",
      message: "The screen is cracked.",
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    // A customer cannot read the queue; an admin can, and can move it along.
    expect((await GET("/support/requests", { token: user.token })).status).toBe(403);
    expect((await GET(`/support/requests/${id}`, { token: user.token })).status).toBe(403);
    expect((await PATCH(`/support/requests/${id}`, { status: "closed" }, { token: user.token })).status).toBe(403);

    expect((await GET(`/support/requests/${id}`, { token: admin.token })).body.message).toBe("The screen is cracked.");
    const closed = await PATCH(`/support/requests/${id}`, { status: "closed" }, { token: admin.token });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect((await PATCH(`/support/requests/${id}`, { status: "bogus" }, { token: admin.token })).status).toBe(400);
    expect((await GET("/support/requests/req_nope", { token: admin.token })).status).toBe(404);
  });

  test("the intake is rate limited per client", async () => {
    let last;
    for (let i = 0; i < 12; i++) {
      last = await POST(
        "/support/requests",
        { name: "Spam", contact: "s@x.com", message: `m${i}` },
        { headers: { "x-forwarded-for": "203.0.113.250" } }
      );
    }
    expect(last.status).toBe(429);
  });
});

describe("commission plan, rank tier and quota tier routes", () => {
  test("plans are publicly readable and admin-editable, with Invariant 2 enforced", async () => {
    const admin = await signupAdmin("planadmin");
    const user = await signup("planuser");
    const product = await createProduct(admin.token);

    const plan = await GET(`/commission-plans/${product.id}`);
    expect(plan.status).toBe(200);
    expect(plan.body.payout_pool_pct_bp).toBeGreaterThan(0);
    expect((await GET("/commission-plans/prod_nope")).status).toBe(404);

    expect((await PATCH(`/commission-plans/${product.id}`, { max_payout_depth: 2 })).status).toBe(401);
    expect((await PATCH(`/commission-plans/${product.id}`, { max_payout_depth: 2 }, { token: user.token })).status).toBe(403);

    const ok = await PATCH(
      `/commission-plans/${product.id}`,
      { payout_pool_pct_bp: 5000, level_rates_bp: [2000, 1000, 500], max_payout_depth: 3 },
      { token: admin.token }
    );
    expect(ok.status).toBe(200);
    expect(ok.body.payout_pool_pct_bp).toBe(5000);
    expect(ok.body.max_payout_depth).toBe(3);

    // sum(level_rates) > payout pool -- rejected at save time.
    const bad = await PATCH(
      `/commission-plans/${product.id}`,
      { payout_pool_pct_bp: 1000, level_rates_bp: [900, 900], max_payout_depth: 2 },
      { token: admin.token }
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("invariant2_violation");

    // Depth deeper than the rate table is a config error, not a silent clamp.
    expect(
      (await PATCH(`/commission-plans/${product.id}`, { max_payout_depth: 99 }, { token: admin.token })).status
    ).toBe(400);
    // reserve_pct_bp must stay strictly under 100%.
    expect((await PATCH(`/commission-plans/${product.id}`, { reserve_pct_bp: 10000 }, { token: admin.token })).status).toBe(400);
    // payout_mode is a closed set.
    expect((await PATCH(`/commission-plans/${product.id}`, { payout_mode: "bananas" }, { token: admin.token })).status).toBe(400);
    expect((await PATCH(`/commission-plans/${product.id}`, { payout_mode: "quota" }, { token: admin.token })).status).toBe(200);
  });

  test("rank tiers: create, list, update, and the pool-share ceiling", async () => {
    const admin = await signupAdmin("rankadmin");
    const user = await signup("rankuser");
    const product = await createProduct(admin.token);

    expect((await GET(`/commission-plans/${product.id}/rank-tiers`)).body).toEqual([]);
    expect(
      (await POST(`/commission-plans/${product.id}/rank-tiers`, { rank_order: 1, name: "Bronze" }, { token: user.token })).status
    ).toBe(403);

    const bronze = await POST(
      `/commission-plans/${product.id}/rank-tiers`,
      { rank_order: 1, name: "Bronze", team_volume_threshold_cents: 100_000, personal_volume_threshold_cents: 10_000, pool_share_bp: 4000 },
      { token: admin.token }
    );
    expect(bronze.status).toBe(200);

    const silver = await POST(
      `/commission-plans/${product.id}/rank-tiers`,
      { rank_order: 2, name: "Silver", team_volume_threshold_cents: 500_000, personal_volume_threshold_cents: 25_000, pool_share_bp: 6000 },
      { token: admin.token }
    );
    expect(silver.status).toBe(200);

    // 4000 + 6000 already fills the pool; anything more is refused.
    const overflow = await POST(
      `/commission-plans/${product.id}/rank-tiers`,
      { rank_order: 3, name: "Gold", team_volume_threshold_cents: 1, personal_volume_threshold_cents: 1, pool_share_bp: 1 },
      { token: admin.token }
    );
    expect(overflow.status).toBe(422);
    expect(overflow.body.error.code).toBe("rank_tier_share_exceeded");

    expect(
      (await POST(
        `/commission-plans/${product.id}/rank-tiers`,
        { rank_order: 0, name: "Bad", team_volume_threshold_cents: 1, personal_volume_threshold_cents: 1, pool_share_bp: 100 },
        { token: admin.token }
      )).status
    ).toBe(400);

    const renamed = await PATCH(
      `/commission-plans/${product.id}/rank-tiers/${bronze.body.id}`,
      { name: "Bronze Elite", pool_share_bp: 3000 },
      { token: admin.token }
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Bronze Elite");
    expect(renamed.body.pool_share_bp).toBe(3000);

    const tiers = await GET(`/commission-plans/${product.id}/rank-tiers`);
    expect(tiers.body.length).toBe(2);
  });

  test("quota tiers: create, list, update, disable, and duplicate-order refusal", async () => {
    const admin = await signupAdmin("quotaadmin");
    const user = await signup("quotauser");
    const product = await createProduct(admin.token);

    expect(
      (await POST(`/commission-plans/${product.id}/quota-tiers`, { tier_order: 1, name: "Blue" }, { token: user.token })).status
    ).toBe(403);

    const names = ["Blue", "Silver", "Gold", "Platinum", "Diamond"];
    for (let i = 0; i < names.length; i++) {
      const res = await POST(
        `/commission-plans/${product.id}/quota-tiers`,
        {
          tier_order: i + 1,
          name: names[i],
          quota_target_cents: (i + 1) * 100_000,
          cash_bonus_cents: (i + 1) * 5_000,
          rate_bonus_bp: (i + 1) * 100,
          perks: [`${names[i]} perk`],
        },
        { token: admin.token }
      );
      expect(res.status).toBe(200, names[i]);
      expect(res.body.perks).toEqual([`${names[i]} perk`]);
    }

    const listed = await GET(`/commission-plans/${product.id}/quota-tiers`);
    expect(listed.body.length).toBe(5);
    expect(listed.body.map((t) => t.name)).toEqual(names);

    const duplicate = await POST(
      `/commission-plans/${product.id}/quota-tiers`,
      { tier_order: 1, name: "Blue Again", quota_target_cents: 1000 },
      { token: admin.token }
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("duplicate_tier_order");

    for (const bad of [
      { tier_order: 9, name: "NoTarget" },
      { tier_order: 9, name: "Negative", quota_target_cents: -5 },
      { tier_order: 9, name: "BadPerks", quota_target_cents: 100, perks: [1, 2] },
      { tier_order: 9, name: "BadRate", quota_target_cents: 100, rate_bonus_bp: 99999 },
    ]) {
      expect((await POST(`/commission-plans/${product.id}/quota-tiers`, bad, { token: admin.token })).status).toBe(400, bad.name);
    }

    const blue = listed.body[0];
    const updated = await PATCH(
      `/commission-plans/${product.id}/quota-tiers/${blue.id}`,
      { name: "Blue Tier", quota_target_cents: 150_000, status: "disabled" },
      { token: admin.token }
    );
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Blue Tier");
    expect(updated.body.status).toBe("disabled");

    expect(
      (await PATCH(`/commission-plans/${product.id}/quota-tiers/qt_nope`, { name: "x" }, { token: admin.token })).status
    ).toBe(404);
  });
});

// Session invalidation. A bearer JWT is stateless, so nothing about a token
// changes when the account's password does -- these pin the token_version
// mechanism that closes that gap. Without it a stolen token stayed valid
// for its full 7-day life after the victim reset their password, which
// defeats the entire point of the reset flow.
describe("changing credentials ends existing sessions", () => {
  test("a password change invalidates every token issued before it", async () => {
    const actor = await signup("session-change");
    const oldToken = actor.token;
    expect((await GET("/profile", { token: oldToken })).status).toBe(200);

    const changed = await PATCH(
      "/profile/password",
      { current_password: PASSWORD, new_password: "a-fresh-password" },
      { token: oldToken }
    );
    expect(changed.status).toBe(200);

    const rejected = await GET("/profile", { token: oldToken });
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe("session_expired");

    // ...but the session that made the change is handed a fresh token and
    // stays signed in. Evicting other devices is the point; evicting the
    // person who just proved their password is not.
    expect(changed.body.token).toBeTruthy();
    expect(changed.body.token).not.toBe(oldToken);
    expect((await GET("/profile", { token: changed.body.token })).status).toBe(200);

    // Logging in again works and yields a token that does.
    const relogin = await POST("/auth/login", { email: actor.email, password: "a-fresh-password" });
    expect(relogin.status).toBe(200);
    expect((await GET("/profile", { token: relogin.body.token })).status).toBe(200);
  });

  test("a password reset invalidates every token issued before it", async () => {
    const actor = await signup("session-reset");
    const stolenToken = actor.token;

    const forgot = await POST("/auth/forgot-password", { email: actor.email });
    const reset = await POST("/auth/reset-password", {
      token: forgot.body.debug_token,
      new_password: "recovered-password",
    });
    expect(reset.status).toBe(200);

    // This is the whole point of the reset flow: the attacker is locked out.
    const rejected = await GET("/profile", { token: stolenToken });
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe("session_expired");
  });

  test("one user's password change does not disturb anyone else's session", async () => {
    const a = await signup("session-a");
    const b = await signup("session-b");
    await PATCH("/profile/password", { current_password: PASSWORD, new_password: "only-mine-changed" }, { token: a.token });
    expect((await GET("/profile", { token: b.token })).status).toBe(200);
  });
});

// A quota tier's cash bonus is paid out of the commission that was
// redirected into progress rather than paid -- so a bonus larger than the
// target it unlocks is a guaranteed loss on every completion, with nothing
// downstream to catch it. Validated at save time.
describe("quota tier cash bonuses must be self-funding", () => {
  test("a cash bonus larger than the quota target is refused", async () => {
    const admin = await signupAdmin("quotabound-admin");
    const product = await createProduct(admin.token);

    const absurd = await POST(
      `/commission-plans/${product.id}/quota-tiers`,
      { tier_order: 1, name: "Runaway", quota_target_cents: 1_000, cash_bonus_cents: 5_000_000 },
      { token: admin.token }
    );
    expect(absurd.status).toBe(400);
    expect(absurd.body.error.code).toBe("cash_bonus_exceeds_quota");

    // Equal to the target is the boundary, and is allowed.
    const atLimit = await POST(
      `/commission-plans/${product.id}/quota-tiers`,
      { tier_order: 1, name: "Blue", quota_target_cents: 1_000, cash_bonus_cents: 1_000 },
      { token: admin.token }
    );
    expect(atLimit.status).toBe(200);

    // ...and the same bound holds when editing an existing tier.
    const raised = await PATCH(
      `/commission-plans/${product.id}/quota-tiers/${atLimit.body.id}`,
      { cash_bonus_cents: 2_000 },
      { token: admin.token }
    );
    expect(raised.status).toBe(400);
    expect(raised.body.error.code).toBe("cash_bonus_exceeds_quota");
  });
});
