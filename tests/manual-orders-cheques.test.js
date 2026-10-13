import { describe, test, expect, afterEach } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, signupStaff, createProduct, fund } from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import { FINANCE_ADMIN, CONTENT_ADMIN } from "../src/lib/permissions.js";

const touched = new Set();
afterEach(() => {
  for (const key of touched) db.siteSettings.clear(key);
  touched.clear();
});
async function setFlag(token, key, value) {
  touched.add(key);
  return PATCH("/admin/settings", { [key]: value }, { token });
}

// A 1x1 png, enough to prove the upload/serve path end to end.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function futureDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400_000).toISOString().slice(0, 10);
}

describe("manual orders -- a walk-in sale is a first-class sale", () => {
  test("it builds exactly the same tree a web purchase would", async () => {
    // The single most important property of this feature. If a walk-in sale
    // produced a subtly different node/commission shape, the network maths
    // would quietly diverge for every customer who bought in person.
    const root = await signupAdmin("mroot");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });

    // Reference: an ordinary storefront purchase.
    const online = await signup("online-buyer");
    fund(online.user.id, 30_000);
    const onlineReceipt = await POST("/purchases", { product_id: product.id }, { token: online.token });
    expect(onlineReceipt.status).toBe(201);

    // The same sale, recorded at the office.
    const walkIn = await signup("walkin-buyer");
    const manual = await POST(
      "/admin/orders/manual",
      { user_id: walkIn.user.id, product_id: product.id, amount_received_cents: 30_000 },
      { token: root.token }
    );
    expect(manual.status).toBe(201);

    const a = onlineReceipt.body.transaction;
    const b = manual.body.transaction;

    // Every money field identical.
    for (const field of [
      "x_at_sale_cents",
      "y_at_sale_cents",
      "margin_cents",
      "payout_pool_amount_cents",
      "total_payout_cents",
      "reserve_amount_cents",
      "trex_net_amount_cents",
    ]) {
      expect(`${field}=${b[field]}`).toBe(`${field}=${a[field]}`);
    }

    // Both became the root of their own Space with their own referral code.
    expect(manual.body.node.parent_node_id).toBe(null);
    expect(manual.body.ownRedeemCode.code).toBeTruthy();
    expect(db.spaces.get(manual.body.node.space_id).root_node_id).toBe(manual.body.node.id);

    // ...and the channel is the only thing that distinguishes them.
    expect(a.channel).toBe("online");
    expect(b.channel).toBe("in_person");
    expect(b.recorded_by_admin_id).toBe(root.user.id);
  });

  test("a walk-in buyer joins an existing Space through a redeem code and pays the upline", async () => {
    const root = await signupAdmin("mroot2");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });

    const sponsor = await signup("sponsor");
    fund(sponsor.user.id, 30_000);
    const sponsorReceipt = await POST("/purchases", { product_id: product.id }, { token: sponsor.token });
    const code = sponsorReceipt.body.ownRedeemCode.code;

    const walkIn = await signup("walkin2");
    const manual = await POST(
      "/admin/orders/manual",
      { user_id: walkIn.user.id, product_id: product.id, redeem_code: code, amount_received_cents: 30_000 },
      { token: root.token }
    );
    expect(manual.status).toBe(201);

    // Attached under the sponsor, in the sponsor's Space.
    expect(manual.body.node.parent_node_id).toBe(sponsorReceipt.body.node.id);
    expect(manual.body.node.space_id).toBe(sponsorReceipt.body.node.space_id);

    // And the sponsor actually earned from it -- the commission engine ran.
    const earned = db.ledger
      .listByTransaction(manual.body.transaction.id)
      .filter((e) => e.user_id === sponsor.user.id);
    expect(earned.length).toBe(1);
    expect(earned[0].amount_cents).toBeGreaterThan(0);
  });

  test("no wallet is debited -- the money arrived at the office", async () => {
    const root = await signupAdmin("mroot3");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const walkIn = await signup("walkin3");

    // Deliberately zero balance: a walk-in buyer has no reason to have funded
    // a wallet, and requiring it would make the feature useless.
    expect(db.wallet.getBalance(walkIn.user.id)).toBe(0);
    const manual = await POST(
      "/admin/orders/manual",
      { user_id: walkIn.user.id, product_id: product.id, amount_received_cents: 30_000 },
      { token: root.token }
    );
    expect(manual.status).toBe(201);
    expect(db.wallet.getBalance(walkIn.user.id)).toBe(0);
  });

  test("recording a walk-in works even with online purchasing switched off", async () => {
    // This is the whole scenario the feature exists for: the storefront shows
    // "Visit us", and the sale happens at the counter.
    const root = await signupAdmin("mroot4");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const walkIn = await signup("walkin4");
    await setFlag(root.token, "online_purchase_enabled", false);

    fund(walkIn.user.id, 30_000);
    expect((await POST("/purchases", { product_id: product.id }, { token: walkIn.token })).status).toBe(403);

    const manual = await POST(
      "/admin/orders/manual",
      { user_id: walkIn.user.id, product_id: product.id, amount_received_cents: 30_000 },
      { token: root.token }
    );
    expect(manual.status).toBe(201);
  });

  test("creating a manual order is permission-gated", async () => {
    const root = await signupAdmin("mroot5");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const sales = await signupStaff(FINANCE_ADMIN, "msales");
    const inventory = await signupStaff(CONTENT_ADMIN, "minv");
    const customer = await signup("mcust");

    const body = (uid) => ({ user_id: uid, product_id: product.id, amount_received_cents: 30_000 });

    expect((await POST("/admin/orders/manual", body((await signup("t1")).user.id), { token: customer.token })).status).toBe(403);
    expect((await POST("/admin/orders/manual", body((await signup("t2")).user.id), { token: inventory.token })).status).toBe(403);
    // Booking walk-ins is precisely the finance admin's job.
    expect((await POST("/admin/orders/manual", body((await signup("t3")).user.id), { token: sales.token })).status).toBe(201);
  });

  test("an unknown or inactive customer is refused", async () => {
    const root = await signupAdmin("mroot6");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });

    expect(
      (await POST("/admin/orders/manual", { user_id: "usr_nope", product_id: product.id, amount_received_cents: 1 }, { token: root.token })).status
    ).toBe(404);

    const banned = await signup("banned");
    db.users.updateStatus(banned.user.id, "suspended");
    const res = await POST(
      "/admin/orders/manual",
      { user_id: banned.user.id, product_id: product.id, amount_received_cents: 30_000 },
      { token: root.token }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("customer_inactive");
  });
});

describe("the down-payment floor", () => {
  // A sponsor is required for any of this to bite: the first buyer in a
  // Space has no upline, so nothing is paid out and any down payment clears
  // the floor trivially. The exposure only exists once there is somebody
  // above the buyer to pay.
  async function orderUnderSponsor(root, product, buyerPrefix) {
    const sponsor = await signup(`${buyerPrefix}-sponsor`);
    fund(sponsor.user.id, 30_000);
    const code = (await POST("/purchases", { product_id: product.id }, { token: sponsor.token })).body.ownRedeemCode.code;
    const buyer = await signup(buyerPrefix);
    return { sponsor, code, buyer };
  }

  test("a down payment below the commission payable is refused", async () => {
    // $30,000 order at $10,000 cost -> $20,000 margin, a large slice of which
    // is payable to the upline. $100 down would mean paying out thousands
    // against a hundred dollars actually collected.
    const root = await signupAdmin("dproot");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const { code, buyer } = await orderUnderSponsor(root, product, "dpbuyer");

    const res = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: product.id, redeem_code: code, amount_received_cents: 100, payment_terms: "installment" },
      { token: root.token }
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("down_payment_below_payout");
    expect(res.body.error.details.totalPayoutCents).toBeGreaterThan(100);
  });

  test("a refusal leaves nothing behind -- no node, no stock loss, no code use", async () => {
    const root = await signupAdmin("dproot2");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000, stockCount: 5 });
    const { code, buyer } = await orderUnderSponsor(root, product, "dpbuyer2");

    // The sponsor's purchase already consumed one unit.
    const stockBefore = (await GET(`/products/${product.id}`, { token: root.token })).body.stock_count;
    const codeUsesBefore = db.redeemCodes.getByCode(code).uses_count;

    const res = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: product.id, redeem_code: code, amount_received_cents: 1 },
      { token: root.token }
    );
    expect(res.status).toBe(422);

    // The check runs inside the order's transaction, so everything written
    // before it -- the node, the stock decrement, the redeem-code use --
    // unwinds together.
    expect(db.nodes.getByUserProduct(buyer.user.id, product.id)).toBe(null);
    expect((await GET(`/products/${product.id}`, { token: root.token })).body.stock_count).toBe(stockBefore);
    expect(db.redeemCodes.getByCode(code).uses_count).toBe(codeUsesBefore);
  });

  test("a down payment that covers the payout is accepted", async () => {
    const root = await signupAdmin("dproot3");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const walkIn = await signup("dpbuyer3");

    // Root has no upline above them, so a first-in-space sale pays nothing
    // out -- meaning even a small down payment clears the floor. Prove the
    // floor scales with actual commission rather than with price.
    const res = await POST(
      "/admin/orders/manual",
      { user_id: walkIn.user.id, product_id: product.id, amount_received_cents: 500, payment_terms: "installment" },
      { token: root.token }
    );
    expect(res.status).toBe(201);
    expect(res.body.transaction.total_payout_cents).toBe(0);
    expect(res.body.transaction.amount_received_cents).toBe(500);
  });

  test("the floor can be switched off entirely", async () => {
    const root = await signupAdmin("dproot4");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const sponsor = await signup("dpsponsor");
    fund(sponsor.user.id, 30_000);
    const code = (await POST("/purchases", { product_id: product.id }, { token: sponsor.token })).body.ownRedeemCode.code;

    const buyer = await signup("dpbuyer4");
    const blocked = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: product.id, redeem_code: code, amount_received_cents: 100 },
      { token: root.token }
    );
    expect(blocked.status).toBe(422);

    await setFlag(root.token, "require_down_payment_covers_payout", false);
    const allowed = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: product.id, redeem_code: code, amount_received_cents: 100 },
      { token: root.token }
    );
    expect(allowed.status).toBe(201);
  });

  test("only a root admin can override it, and only with a reason", async () => {
    const root = await signupAdmin("dproot5");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const sales = await signupStaff(FINANCE_ADMIN, "dpsales");
    const sponsor = await signup("dpsponsor2");
    fund(sponsor.user.id, 30_000);
    const code = (await POST("/purchases", { product_id: product.id }, { token: sponsor.token })).body.ownRedeemCode.code;

    const base = (uid) => ({
      user_id: uid,
      product_id: product.id,
      redeem_code: code,
      amount_received_cents: 100,
      override_down_payment: true,
    });

    // A sales agent must not be able to waive it -- the entire value of the
    // floor is that whoever is at the counter cannot shrug it off.
    const bySales = await POST("/admin/orders/manual", { ...base((await signup("o1")).user.id), note: "customer insisted" }, { token: sales.token });
    expect(bySales.status).toBe(403);
    expect(bySales.body.error.code).toBe("override_not_permitted");

    // Root can, but must say why.
    const noReason = await POST("/admin/orders/manual", base((await signup("o2")).user.id), { token: root.token });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe("override_reason_required");

    const withReason = await POST(
      "/admin/orders/manual",
      { ...base((await signup("o3")).user.id), note: "long-standing client, board approved" },
      { token: root.token }
    );
    expect(withReason.status).toBe(201);

    // ...and the reason is on the record.
    const logged = db.logs.list({ action: "order.manual_recorded", limit: 5 });
    expect(JSON.parse(logged[0].meta_json).note).toContain("board approved");
  });
});

describe("cheque register", () => {
  async function orderWithCheques(chequeSpecs = []) {
    const root = await signupAdmin(`chqroot-${Math.random().toString(36).slice(2, 7)}`);
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("chqbuyer");
    const res = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: chequeSpecs,
      },
      { token: root.token }
    );
    return { root, product, buyer, res };
  }

  test("cheques are registered with the order and numbered in sequence", async () => {
    const { res } = await orderWithCheques([
      { amount_cents: 10_000, due_date: futureDate(30), cheque_number: "101", bank_name: "Bank Melli" },
      { amount_cents: 10_000, due_date: futureDate(60), cheque_number: "102", bank_name: "Bank Melli" },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.cheques.length).toBe(2);
    expect(res.body.cheques.map((c) => c.sequence_no)).toEqual([1, 2]);
    expect(res.body.rejected_cheques).toEqual([]);

    // $10,000 down + $20,000 in cheques == the $30,000 order.
    expect(res.body.balance).toMatchObject({
      order_value_cents: 30_000,
      amount_received_cents: 10_000,
      cheques_total_cents: 20_000,
      outstanding_cents: 20_000,
    });
  });

  test("cheques totalling more than the order are refused", async () => {
    // Catches a misplaced decimal at entry time, which is far likelier than
    // anything adversarial.
    const { res } = await orderWithCheques([{ amount_cents: 25_000, due_date: futureDate(30) }]);
    expect(res.status).toBe(201);
    expect(res.body.cheques.length).toBe(0);
    expect(res.body.rejected_cheques.length).toBe(1);
    expect(res.body.rejected_cheques[0].error).toBe("cheques_exceed_order_value");
  });

  test("a bad cheque does not undo an order already paid for in the room", async () => {
    const { res } = await orderWithCheques([
      { amount_cents: 10_000, due_date: futureDate(30) },
      { amount_cents: 999_999, due_date: futureDate(60) }, // over-commits
      { amount_cents: 10_000, due_date: futureDate(90) },
    ]);
    expect(res.status).toBe(201);
    // The good ones stuck, the bad one is reported back so the person at the
    // counter can fix it while the customer is still there.
    expect(res.body.cheques.length).toBe(2);
    expect(res.body.rejected_cheques.length).toBe(1);
  });

  test("clearing a cheque updates the collected total but moves no money", async () => {
    const { root, buyer, res } = await orderWithCheques([{ amount_cents: 20_000, due_date: futureDate(30) }]);
    const cheque = res.body.cheques[0];
    const walletBefore = db.wallet.getBalance(buyer.user.id);

    const cleared = await POST(`/cheques/${cheque.id}/status`, { status: "cleared" }, { token: root.token });
    expect(cleared.status).toBe(200);
    expect(cleared.body.status).toBe("cleared");
    expect(cleared.body.cleared_at).toBeTruthy();

    // Bookkeeping only: the order shows the money collected...
    const tx = db.transactions.get(res.body.transaction.id);
    expect(tx.amount_received_cents).toBe(30_000);
    // ...and no wallet moved, because commission booked at signing.
    expect(db.wallet.getBalance(buyer.user.id)).toBe(walletBefore);
  });

  test("a bounced cheque notifies the customer and leaves the sale alone", async () => {
    const { root, res } = await orderWithCheques([{ amount_cents: 20_000, due_date: futureDate(30) }]);
    const cheque = res.body.cheques[0];

    const bounced = await POST(`/cheques/${cheque.id}/status`, { status: "bounced" }, { token: root.token });
    expect(bounced.status).toBe(200);

    // The customer hears about it...
    expect(db.notifications.findByDedupeKey(`cheque_bounced:${cheque.id}`)).toBeTruthy();
    // ...but unwinding the sale stays a human decision via the refund route.
    const tx = db.transactions.get(res.body.transaction.id);
    expect(tx.status).toBe("completed");
    expect(tx.amount_received_cents).toBe(10_000);
  });

  test("a settled cheque cannot be re-settled", async () => {
    const { root, res } = await orderWithCheques([{ amount_cents: 20_000, due_date: futureDate(30) }]);
    const cheque = res.body.cheques[0];
    await POST(`/cheques/${cheque.id}/status`, { status: "cleared" }, { token: root.token });

    const again = await POST(`/cheques/${cheque.id}/status`, { status: "bounced" }, { token: root.token });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("cheque_already_settled");
    // Double-clearing would otherwise double-count the collected total.
    expect(db.transactions.get(res.body.transaction.id).amount_received_cents).toBe(30_000);
  });

  test("listings never carry the image blob", async () => {
    const { root, res } = await orderWithCheques([
      { amount_cents: 20_000, due_date: futureDate(30), image_data_url: TINY_PNG },
    ]);
    const listing = await GET(`/admin/orders/${res.body.transaction.id}/cheques`, { token: root.token });
    expect(listing.status).toBe(200);
    // A page of 20 cheque scans would otherwise be several megabytes of JSON.
    expect(listing.body.cheques[0].image_bytes).toBeUndefined();
    expect(listing.body.cheques[0].has_image).toBe(1);
  });
});

describe("cheque images are private financial documents", () => {
  test("the owner can see their own; a stranger cannot", async () => {
    const root = await signupAdmin("imgroot");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("imgbuyer");
    const stranger = await signup("imgstranger");

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 20_000, due_date: futureDate(30), image_data_url: TINY_PNG }],
      },
      { token: root.token }
    );
    const chequeId = order.body.cheques[0].id;

    // A cheque scan shows a bank account number. Contrast with
    // GET /products/:id/image, which is deliberately public and cached a day.
    expect((await GET(`/cheques/${chequeId}/image`)).status).toBe(401);
    expect((await GET(`/cheques/${chequeId}/image`, { token: stranger.token })).status).toBe(403);

    const asOwner = await GET(`/cheques/${chequeId}/image`, { token: buyer.token });
    expect(asOwner.status).toBe(200);
    expect(asOwner.headers.get("cache-control")).toBe("private, no-store");

    expect((await GET(`/cheques/${chequeId}/image`, { token: root.token })).status).toBe(200);
  });

  test("a customer sees their own cheques but not anyone else's order", async () => {
    const root = await signupAdmin("ownroot");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("ownbuyer");
    const stranger = await signup("ownstranger");

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 20_000, due_date: futureDate(45) }],
      },
      { token: root.token }
    );
    const txId = order.body.transaction.id;

    const mine = await GET(`/purchases/${txId}/cheques`, { token: buyer.token });
    expect(mine.status).toBe(200);
    expect(mine.body.cheques.length).toBe(1);
    expect(mine.body.totals.outstanding_cents).toBe(20_000);

    expect((await GET(`/purchases/${txId}/cheques`, { token: stranger.token })).status).toBe(403);
    expect((await GET("/cheques/mine", { token: buyer.token })).body.cheques.length).toBeGreaterThan(0);
  });

  test("oversized and wrong-typed images are refused", async () => {
    const root = await signupAdmin("badimgroot");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("badimgbuyer");
    const order = await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: product.id, amount_received_cents: 10_000, payment_terms: "installment" },
      { token: root.token }
    );
    const txId = order.body.transaction.id;

    const evil = await POST(
      `/admin/orders/${txId}/cheques`,
      { amount_cents: 1000, due_date: futureDate(30), image_data_url: "data:text/html;base64,PHNjcmlwdD4=" },
      { token: root.token }
    );
    expect(evil.status).toBe(400);
    expect(evil.body.error.code).toBe("invalid_image_type");

    const huge = `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`;
    const tooBig = await POST(
      `/admin/orders/${txId}/cheques`,
      { amount_cents: 1000, due_date: futureDate(30), image_data_url: huge },
      { token: root.token }
    );
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe("image_too_large");
  });
});

describe("cheque due-date reminders", () => {
  test("reminders queue once per bucket, no matter how often the job runs", async () => {
    const root = await signupAdmin("remroot");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("rembuyer");
    await PATCH("/profile", { name: "Rem Buyer", phone: "+989121234567" }, { token: buyer.token });

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 20_000, due_date: futureDate(7) }],
      },
      { token: root.token }
    );
    const chequeId = order.body.cheques[0].id;

    const first = await POST("/admin/jobs/queue-cheque-reminders", {}, { token: root.token });
    expect(first.status).toBe(200);
    expect(first.body.queued).toBeGreaterThan(0);

    // Re-running is the normal case: cron fires again, an admin clicks it,
    // a deploy replays it. Nobody should be texted twice.
    const second = await POST("/admin/jobs/queue-cheque-reminders", {}, { token: root.token });
    expect(second.body.queued).toBe(0);

    const queued = db.notifications.list({ limit: 500 }).filter((n) => n.dedupe_key?.startsWith(`cheque_due:${chequeId}:`));
    expect(queued.length).toBe(1);
    // A phone number is on file, so it goes by SMS rather than email.
    expect(queued[0].channel).toBe("sms");
    expect(queued[0].recipient).toBe("+989121234567");
  });

  test("each lead bucket fires exactly once as the date approaches", async () => {
    const root = await signupAdmin("remroot2");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("rembuyer2");
    const dueDate = futureDate(7);

    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 20_000, due_date: dueDate }],
      },
      { token: root.token }
    );
    const chequeId = order.body.cheques[0].id;
    const at = (days) => new Date(Date.parse(`${dueDate}T00:00:00Z`) - days * 86400_000).toISOString();

    // 7 days out, then 1 day out, then the day itself.
    await POST("/admin/jobs/queue-cheque-reminders", { asOf: at(7) }, { token: root.token });
    await POST("/admin/jobs/queue-cheque-reminders", { asOf: at(1) }, { token: root.token });
    await POST("/admin/jobs/queue-cheque-reminders", { asOf: at(0) }, { token: root.token });

    const keys = db.notifications
      .list({ limit: 500 })
      .filter((n) => n.dedupe_key?.startsWith(`cheque_due:${chequeId}:`))
      .map((n) => n.dedupe_key)
      .sort();
    expect(keys).toEqual([`cheque_due:${chequeId}:0`, `cheque_due:${chequeId}:1`, `cheque_due:${chequeId}:7`]);
  });

  test("a cleared cheque stops being reminded about", async () => {
    const root = await signupAdmin("remroot3");
    const product = await createProduct(root.token, { xCents: 10_000, yCents: 30_000 });
    const buyer = await signup("rembuyer3");
    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 20_000, due_date: futureDate(3) }],
      },
      { token: root.token }
    );
    const chequeId = order.body.cheques[0].id;
    await POST(`/cheques/${chequeId}/status`, { status: "cleared" }, { token: root.token });

    await POST("/admin/jobs/queue-cheque-reminders", {}, { token: root.token });
    const queued = db.notifications.list({ limit: 500 }).filter((n) => n.dedupe_key?.startsWith(`cheque_due:${chequeId}:`));
    expect(queued.length).toBe(0);
  });
});
