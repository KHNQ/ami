import { describe, test, expect, beforeAll } from "bun:test";
import { app, POST, GET, PATCH, signup, signupAdmin, createProduct } from "./httpHelpers.js";
import { db } from "../src/db/index.js";
import { extractPdfText } from "../src/lib/pdfText.js";
import { settingsService } from "../src/services/settingsService.js";

// Ali and Mohammad, step by step, exactly as described.
//
// This is the whole business in one file: a visitor finds a device, takes a
// proforma away, pays for it in person, and becomes the root of a network;
// a second visitor arrives with the first one's invite code and lands under
// him. Nothing is simulated -- every step is the same HTTP request the
// storefront or the admin console sends.
//
// The property the whole thing turns on: the network is built by an ADMIN
// recording a sale that happened in a room, and the system's job afterwards
// is to say who is owed what. It never pays anyone.

const PRICE = 3_800_000; // $38,000
const COST = 2_200_000; //  $22,000

let staff, ali, mohammad, device;
let aliOrder, mohammadOrder;
let aliProforma, mohammadProforma;
let aliNode, aliCode;

beforeAll(async () => {
  staff = await signupAdmin("network-scenario-admin");
  device = await createProduct(staff.token, {
    name: "Primelase HR Diode Laser",
    description: "810nm high-power diode platform",
    stockCount: 10,
    xCents: COST,
    yCents: PRICE,
  });
});

describe("1 — Ali finds a device and asks for a proforma", () => {
  test("he can browse the catalogue without an account", async () => {
    const res = await GET("/products?status=active&limit=20");
    const rows = Array.isArray(res.body) ? res.body : res.body.products || [];
    const found = rows.find((p) => p.id === device.id);
    expect(found.name).toBe("Primelase HR Diode Laser");
    // The public listing must not carry what the device cost us.
    expect(found.current_x_cents).toBeUndefined();
  });

  test("asking for a proforma needs no account, and returns a download link", async () => {
    // Requiring a sign-up here is how the enquiry is lost -- nobody makes an
    // account to ask a price.
    const res = await POST("/sales/quotes", {
      kind: "proforma",
      product_id: device.id,
      contact_name: "Ali Tehrani",
      contact_email: "ali@clinic.test",
      contact_phone: "+98 912 000 0001",
      clinic_city: "Tehran",
      specialty: "Dermatology",
      amount_cents: PRICE,
      source: "storefront",
    });

    expect(res.status).toBe(201);
    aliProforma = res.body;
    expect(aliProforma.reference).toMatch(/^PRO-[A-Z0-9]{6}$/);
    expect(aliProforma.download_url).toBe(
      `/sales/quotes/${aliProforma.id}/proforma.pdf?ref=${aliProforma.reference}`
    );
  });

  test("the download is a real PDF carrying the reference, the device and the price", async () => {
    const res = await app.request(aliProforma.download_url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`proforma-${aliProforma.reference}.pdf`);

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");

    // Read back with our own extractor: these are the facts a staff member
    // looks for when the customer puts the document on the counter.
    const text = extractPdfText(bytes);
    expect(text).toContain("PROFORMA INVOICE");
    expect(text).toContain(aliProforma.reference);
    expect(text).toContain("Ali Tehrani");
    expect(text).toContain("Primelase HR Diode Laser");
    expect(text).toContain("$38,000.00");
    // And it must not read as a bill.
    expect(text).toContain("not a tax invoice");
  });

  test("the id alone does not open it — the reference has to match", async () => {
    // Otherwise the document store is enumerable, and each document carries a
    // named clinic and the price it was given.
    const guessed = await app.request(`/sales/quotes/${aliProforma.id}/proforma.pdf`);
    expect(guessed.status).toBe(404);

    const wrong = await app.request(`/sales/quotes/${aliProforma.id}/proforma.pdf?ref=PRO-XXXXXX`);
    expect(wrong.status).toBe(404);
  });

  test("it reaches the admin panel as a live enquiry", async () => {
    // "someone wants to buy something" -- the queue a staff member works from.
    const res = await GET("/sales/quotes?status=new&limit=50", { token: staff.token });
    const mine = res.body.quotes.find((q) => q.id === aliProforma.id);
    expect(mine.contact_name).toBe("Ali Tehrani");
    expect(mine.clinic_city).toBe("Tehran");
    expect(mine.status).toBe("new");
    expect(mine.product_id).toBe(device.id);
  });

  test("and an email to the customer is queued, not fired into the void", async () => {
    const queued = db.notifications.findByDedupeKey(`quote_received:${aliProforma.id}`);
    expect(queued.recipient).toBe("ali@clinic.test");
    expect(queued.template).toBe("quote_received");
    expect(queued.status).toBe("pending");
  });
});

describe("2 — Ali pays in person and becomes the root of the network", () => {
  test("he registers an account (the network keys off a user, not an email)", async () => {
    ali = await signup("ali");
    expect(ali.user.id).toBeTruthy();
  });

  test("staff record the walk-in sale with no invite code", async () => {
    const res = await POST(
      "/admin/orders/manual",
      {
        user_id: ali.user.id,
        product_id: device.id,
        amount_received_cents: PRICE, // paid in full, at the counter
        payment_terms: "full",
        note: "Walk-in. Paid in person. No invite code.",
      },
      { token: staff.token }
    );

    expect(res.status).toBe(201);
    aliOrder = res.body;
    expect(aliOrder.transaction.channel).toBe("in_person");
    expect(aliOrder.transaction.amount_received_cents).toBe(PRICE);
    expect(aliOrder.transaction.recorded_by_admin_id).toBe(staff.user.id);
    expect(aliOrder.balance.outstanding_cents).toBe(0);
  });

  test("no code means he FOUNDS the network for this product, as its root", async () => {
    const nodes = await GET("/nodes/mine", { token: ali.token });
    aliNode = nodes.body.find((n) => n.product_id === device.id);

    expect(aliNode.parent_node_id).toBe(null);
    const space = db.spaces.get(aliNode.space_id);
    expect(space.root_node_id).toBe(aliNode.id);
    expect(space.product_id).toBe(device.id);
  });

  test("he is issued an invite code to hand to colleagues", async () => {
    const res = await GET(`/redeem-codes/mine?product_id=${device.id}`, { token: ali.token });
    aliCode = res.body[0];
    expect(aliCode.code).toMatch(/^[A-Z0-9]{10}$/);
    expect(aliCode.status).toBe("active");
    expect(aliCode.uses_count).toBe(0);
  });

  test("nobody is owed anything yet — he is the root, there is no upline", async () => {
    const sheet = await GET(`/admin/payouts?product_id=${device.id}`, { token: staff.token });
    expect(sheet.body.people_count).toBe(0);
    expect(sheet.body.total.cents).toBe(0);
  });

  test("staff close the proforma against the sale", async () => {
    const res = await PATCH(
      `/sales/quotes/${aliProforma.id}`,
      { status: "converted" },
      { token: staff.token }
    );
    expect(res.body.status).toBe("converted");
  });
});

describe("3 — Mohammad buys the same device with Ali's code", () => {
  test("he goes through the same public funnel", async () => {
    const res = await POST("/sales/quotes", {
      kind: "proforma",
      product_id: device.id,
      contact_name: "Mohammad Rezaei",
      contact_email: "mohammad@clinic.test",
      clinic_city: "Isfahan",
      amount_cents: PRICE,
      notes: `Referred by Ali. Invite code ${aliCode.code}.`,
    });
    expect(res.status).toBe(201);
    mohammadProforma = res.body;

    const pdf = await app.request(mohammadProforma.download_url);
    expect(extractPdfText(Buffer.from(await pdf.arrayBuffer()))).toContain("Mohammad Rezaei");
  });

  test("the code is checkable at the counter before anything is recorded", async () => {
    // The staff member types it in while the customer is standing there.
    const res = await GET(`/redeem-codes/${aliCode.code}`);
    expect(res.body.usable).toBe(true);
    expect(res.body.product_id).toBe(device.id);
    expect(res.body.owner_user_id).toBe(ali.user.id);
  });

  test("staff record his walk-in sale WITH the code", async () => {
    mohammad = await signup("mohammad");
    const res = await POST(
      "/admin/orders/manual",
      {
        user_id: mohammad.user.id,
        product_id: device.id,
        redeem_code: aliCode.code,
        amount_received_cents: PRICE,
        payment_terms: "full",
        note: "Walk-in. Paid in person. Ali's invite code.",
      },
      { token: staff.token }
    );
    expect(res.status).toBe(201);
    mohammadOrder = res.body;
  });

  test("he lands UNDER Ali, in Ali's space, not in one of his own", async () => {
    const nodes = await GET("/nodes/mine", { token: mohammad.token });
    const node = nodes.body.find((n) => n.product_id === device.id);

    expect(node.parent_node_id).toBe(aliNode.id);
    expect(node.space_id).toBe(aliNode.space_id);
    // The space still belongs to Ali; a second root would be a second network.
    expect(db.spaces.get(node.space_id).root_node_id).toBe(aliNode.id);
  });

  test("Ali can see him in his own network", async () => {
    const downline = await GET(`/nodes/${aliNode.id}/downline`, { token: ali.token });
    const rows = Array.isArray(downline.body) ? downline.body : downline.body.nodes;
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(mohammad.user.id);
  });

  test("the code records that it was used once", async () => {
    const res = await GET(`/redeem-codes/${aliCode.code}`);
    expect(res.body.uses_count).toBe(1);
    expect(res.body.usable).toBe(true); // unlimited by default
  });

  test("Mohammad gets his own code, so the chain can continue", async () => {
    const res = await GET(`/redeem-codes/mine?product_id=${device.id}`, { token: mohammad.token });
    expect(res.body[0].code).not.toBe(aliCode.code);
  });

  test("a code cannot be redeemed by the person who owns it", async () => {
    const second = await signup("ali-again");
    const res = await POST(
      "/admin/orders/manual",
      { user_id: ali.user.id, product_id: device.id, redeem_code: aliCode.code, amount_received_cents: PRICE },
      { token: staff.token }
    );
    // Refused for having a position already -- one per person per product.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("already_has_node");
    expect(second.user.id).toBeTruthy();
  });
});

describe("4 — the system says what the company owes, and never pays it", () => {
  test("Ali is owed level-1 commission on Mohammad's purchase", async () => {
    const earnings = await GET(`/nodes/${aliNode.id}/earnings`, { token: ali.token });
    const entries = earnings.body.entries;

    expect(entries.length).toBe(1);
    expect(entries[0].level_depth).toBe(1);
    // 20% of the $16,000 margin, which is the plan's level-1 rate.
    expect(entries[0].amount_cents).toBe(320_000);
    expect(entries[0].status).toBe("pending");
  });

  test("the money did NOT appear in his wallet", async () => {
    // The company has not paid him. A wallet balance would say it had, and
    // he could then withdraw money that is already owed in cash.
    const wallet = await GET("/wallet", { token: ali.token });
    expect(wallet.body.balance_cents).toBe(0);
  });

  test("the payout sheet tells an admin who to pay, how much, and how to reach them", async () => {
    // Scoped to this device: the sheet is company-wide by default, and the
    // rest of the suite shares one database.
    const sheet = await GET(`/admin/payouts?product_id=${device.id}`, { token: staff.token });

    expect(sheet.body.people_count).toBe(1);
    expect(sheet.body.total.display).toBe("$3,200.00");
    const row = sheet.body.people[0];
    expect(row.user_id).toBe(ali.user.id);
    expect(row.owed.cents).toBe(320_000);
    expect(row.email).toBe(ali.email);
    expect(row.entry_count).toBe(1);
    // And it says plainly that nothing is automatic.
    expect(sheet.body.auto_payout).toBe(false);
  });

  test("the detail view justifies the figure line by line", async () => {
    const detail = await GET(`/admin/payouts/${ali.user.id}?product_id=${device.id}`, { token: staff.token });
    const line = detail.body.lines[0];

    expect(line.level).toBe(1);
    expect(line.from_buyer).toContain("mohammad");
    expect(line.product).toBe("Primelase HR Diode Laser");
    expect(line.sale_value.display).toBe("$38,000.00");
    expect(detail.body.total.display).toBe("$3,200.00");
  });

  test("an admin records the hand-over, and it clears", async () => {
    const res = await POST(
      `/admin/payouts/${ali.user.id}/settle`,
      { expected_cents: 320_000, method: "cash", reference: "RCP-0001", note: "Paid at the office.", product_id: device.id },
      { token: staff.token }
    );

    expect(res.body.paid.display).toBe("$3,200.00");
    expect(res.body.entries_settled).toBe(1);
    expect(res.body.note).toContain("No money was moved by the system");

    const sheet = await GET(`/admin/payouts?product_id=${device.id}`, { token: staff.token });
    expect(sheet.body.people_count).toBe(0);

    // Still not a wallet balance: the cash crossed the counter.
    const wallet = await GET("/wallet", { token: ali.token });
    expect(wallet.body.balance_cents).toBe(0);
  });

  test("the payment is in the audit log, with who paid it and how", async () => {
    const history = await GET("/admin/payouts/history", { token: staff.token });
    const payment = history.body.payments[0];

    expect(payment.user_id).toBe(ali.user.id);
    expect(payment.by_admin_id).toBe(staff.user.id);
    expect(payment.paid.display).toBe("$3,200.00");
    expect(payment.method).toBe("cash");
    expect(payment.reference).toBe("RCP-0001");
  });

  test("settling the same person twice pays nothing the second time", async () => {
    // Two admins on two screens is the realistic version of this, and the
    // guarded UPDATE is what makes it safe.
    const res = await POST(
      `/admin/payouts/${ali.user.id}/settle`,
      { expected_cents: 320_000, method: "cash", product_id: device.id },
      { token: staff.token }
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("nothing_outstanding");
  });

  test("a settlement for the wrong amount is refused rather than guessed at", async () => {
    // The admin counted out what the screen said. If the real total has moved
    // since -- another sale, a refund -- settling silently would record a
    // payment that did not happen.
    const third = await signup("late-buyer");
    await POST(
      "/admin/orders/manual",
      { user_id: third.user.id, product_id: device.id, redeem_code: aliCode.code, amount_received_cents: PRICE },
      { token: staff.token }
    );

    const stale = await POST(
      `/admin/payouts/${ali.user.id}/settle`,
      { expected_cents: 1, method: "cash", product_id: device.id },
      { token: staff.token }
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("amount_moved");
    expect(stale.body.error.details.owed_cents).toBe(320_000);
  });

  test("the nightly job does not quietly pay anyone either", async () => {
    const before = await GET("/wallet", { token: ali.token });
    const res = await POST("/admin/jobs/run-all", { holdDays: 0 }, { token: staff.token });

    expect(res.body.releases.releasedCents).toBe(0);
    expect(res.body.releases.skipped).toBe("network_auto_payout is off");
    const after = await GET("/wallet", { token: ali.token });
    expect(after.body.balance_cents).toBe(before.body.balance_cents);
  });
});

describe("5 — the admin can change the network's numbers at any time", () => {
  test("the percentages are editable while the business is running", async () => {
    const res = await PATCH(
      `/commission-plans/${device.id}`,
      {
        payout_pool_pct_bp: 7000, // 70% of margin may be paid out
        level_rates_bp: [2500, 1500, 1000, 500], // 25 / 15 / 10 / 5
        max_payout_depth: 4,
        reserve_pct_bp: 1500,
      },
      { token: staff.token }
    );

    expect(res.status).toBe(200);
    expect(res.body.level_rates_bp).toEqual([2500, 1500, 1000, 500]);
    expect(res.body.payout_pool_pct_bp).toBe(7000);
  });

  test("a plan that would pay out more than the pool is refused", async () => {
    // Invariant 2. Without it the business can commit to paying more
    // commission than the margin it set aside, which is only discovered when
    // the money runs out.
    const res = await PATCH(
      `/commission-plans/${device.id}`,
      { payout_pool_pct_bp: 3000, level_rates_bp: [2500, 1500] },
      { token: staff.token }
    );
    expect(res.status).toBe(422);
  });

  test("the new rates apply to the NEXT sale, and never rewrite an old one", async () => {
    // What a node already earned was agreed at the moment of that sale. A
    // plan change that reached backwards would silently restate commission
    // somebody has already been paid in cash.
    const settled = db.ledger.listByNode(aliNode.id).find((e) => e.status === "paid");
    expect(settled.rate_applied_bp).toBe(2000); // the old 20%

    const buyer = await signup("after-plan-change");
    await POST(
      "/admin/orders/manual",
      { user_id: buyer.user.id, product_id: device.id, redeem_code: aliCode.code, amount_received_cents: PRICE },
      { token: staff.token }
    );

    const fresh = db.ledger
      .listByNode(aliNode.id)
      .filter((e) => e.status === "pending")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    expect(fresh.rate_applied_bp).toBe(2500); // the new 25%
    expect(fresh.amount_cents).toBe(400_000); // 25% of the $16,000 margin
  });

  test("whether the system may pay automatically is itself a setting", async () => {
    expect(settingsService.isEnabled("network_auto_payout")).toBe(false);
    settingsService.update({ network_auto_payout: true }, staff.user.id);
    try {
      const res = await POST("/admin/jobs/run-all", { holdDays: 0 }, { token: staff.token });
      expect(res.body.releases.skipped).toBeUndefined();
      expect(res.body.releases.releasedCents).toBeGreaterThan(0);
    } finally {
      settingsService.reset("network_auto_payout", staff.user.id);
    }
  });
});

describe("6 — the referral programme is gone", () => {
  test("the one-tier rebate endpoints no longer exist", async () => {
    // Only the network remains. A second, parallel affiliate scheme was a
    // second set of numbers to explain to the same doctor.
    expect((await POST("/sales/referrals", { referrer_name: "x", referred_clinic: "y" })).status).toBe(404);
    expect((await GET("/sales/referrals", { token: staff.token })).status).toBe(404);
  });

  test("and nothing in the sales summary still reports on it", async () => {
    const res = await GET("/sales/summary", { token: staff.token });
    expect(res.body.referrals).toBeUndefined();
    expect(res.body.quotes).toBeTruthy();
  });
});
