import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { auditSystem } from "./systemAudit.js";
import { signup, signupAdmin, createProduct, buy, POST } from "./httpHelpers.js";

// The scenario simulations are only as trustworthy as this audit. An audit
// that has never once fired is indistinguishable from an audit that cannot
// fire, so each check here is proven by deliberately corrupting the
// database, confirming the specific problem is reported, and then putting
// the row back exactly as it was.
//
// Every case restores its damage before finishing -- the audit runs over
// the whole database, so anything left broken here would fail every other
// suite's final consistency check.

const raw = () => db._raw;

/** Runs the audit and returns only the lines mentioning `needle`. */
function problemsAbout(needle) {
  return auditSystem().filter((p) => p.includes(needle));
}

async function makeTree() {
  const admin = await signupAdmin("auditfix-admin");
  const root = await signup("auditfix-root");
  const child = await signup("auditfix-child");
  const product = await createProduct(admin.token);
  const rootBuy = await buy(root, product);
  const childBuy = await buy(child, product, { redeemCode: rootBuy.body.ownRedeemCode.code });
  return {
    space: rootBuy.body.space,
    rootNode: rootBuy.body.node,
    childNode: childBuy.body.node,
    childTx: childBuy.body.transaction,
    rootUser: root.user,
    childUser: child.user,
  };
}

describe("the consistency audit actually detects the things it claims to", () => {
  test("starts clean", async () => {
    await makeTree();
    expect(auditSystem()).toEqual([]);
  });

  test("catches a broken tree: a node parented into a different Space", async () => {
    const a = await makeTree();
    const b = await makeTree();

    raw().query(`UPDATE nodes SET parent_node_id = ? WHERE id = ?`).run(b.rootNode.id, a.childNode.id);
    const found = problemsAbout(a.childNode.id);
    expect(found.some((p) => p.includes("parented across spaces"))).toBe(true);

    raw().query(`UPDATE nodes SET parent_node_id = ? WHERE id = ?`).run(a.rootNode.id, a.childNode.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches an upline cycle", async () => {
    const a = await makeTree();
    // Point the root at its own child: the tree now loops forever.
    raw().query(`UPDATE nodes SET parent_node_id = ? WHERE id = ?`).run(a.childNode.id, a.rootNode.id);
    const found = problemsAbout(a.space.id).concat(problemsAbout(a.childNode.id), problemsAbout(a.rootNode.id));
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((p) => /cycle|parentless nodes/.test(p))).toBe(true);

    raw().query(`UPDATE nodes SET parent_node_id = NULL WHERE id = ?`).run(a.rootNode.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches a wallet balance that disagrees with its own ledger", async () => {
    const a = await makeTree();
    const before = db.wallet.getBalance(a.rootUser.id);

    raw().query(`UPDATE wallet_accounts SET balance_cents = ? WHERE user_id = ?`).run(before + 5_000, a.rootUser.id);
    const found = problemsAbout(a.rootUser.id);
    expect(found.some((p) => p.includes("!= ledger sum"))).toBe(true);

    raw().query(`UPDATE wallet_accounts SET balance_cents = ? WHERE user_id = ?`).run(before, a.rootUser.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches commission paid to someone who is not upline of the buyer", async () => {
    const a = await makeTree();
    const outsider = await makeTree();
    const entries = db.ledger.listByTransaction(a.childTx.id);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];

    raw()
      .query(`UPDATE commission_ledger_entries SET node_id = ?, user_id = ? WHERE id = ?`)
      .run(outsider.rootNode.id, outsider.rootUser.id, entry.id);
    const found = problemsAbout(entry.id);
    expect(found.some((p) => p.includes("is not upline of buyer") || p.includes("space"))).toBe(true);

    raw()
      .query(`UPDATE commission_ledger_entries SET node_id = ?, user_id = ? WHERE id = ?`)
      .run(entry.node_id, entry.user_id, entry.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches a buyer earning commission on their own purchase", async () => {
    const a = await makeTree();
    const entry = db.ledger.listByTransaction(a.childTx.id)[0];

    raw()
      .query(`UPDATE commission_ledger_entries SET node_id = ?, user_id = ? WHERE id = ?`)
      .run(a.childNode.id, a.childUser.id, entry.id);
    expect(problemsAbout(entry.id).some((p) => p.includes("own purchase"))).toBe(true);

    raw()
      .query(`UPDATE commission_ledger_entries SET node_id = ?, user_id = ? WHERE id = ?`)
      .run(entry.node_id, entry.user_id, entry.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches a transaction whose payout exceeds its pool (Invariant 2)", async () => {
    const a = await makeTree();
    const tx = db.transactions.get(a.childTx.id);

    raw()
      .query(`UPDATE transactions SET total_payout_cents = ? WHERE id = ?`)
      .run(tx.payout_pool_amount_cents + 1, tx.id);
    expect(problemsAbout(tx.id).some((p) => p.includes("Invariant 2"))).toBe(true);

    raw().query(`UPDATE transactions SET total_payout_cents = ? WHERE id = ?`).run(tx.total_payout_cents, tx.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches non-positive trex_net (Invariant 3)", async () => {
    const a = await makeTree();
    const tx = db.transactions.get(a.childTx.id);

    raw().query(`UPDATE transactions SET trex_net_amount_cents = 0 WHERE id = ?`).run(tx.id);
    expect(problemsAbout(tx.id).some((p) => p.includes("Invariant 3"))).toBe(true);

    raw().query(`UPDATE transactions SET trex_net_amount_cents = ? WHERE id = ?`).run(tx.trex_net_amount_cents, tx.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches negative stock", async () => {
    const admin = await signupAdmin("auditfix-stock");
    const product = await createProduct(admin.token, { stockCount: 3 });

    raw().query(`UPDATE products SET stock_count = -1 WHERE id = ?`).run(product.id);
    expect(problemsAbout(product.id).some((p) => p.includes("negative stock"))).toBe(true);

    raw().query(`UPDATE products SET stock_count = 3 WHERE id = ?`).run(product.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches a referred buyer attached under the wrong sponsor", async () => {
    const a = await makeTree();
    const other = await makeTree();

    // Keep the tree itself valid but make the redeem code on the sale
    // disagree with where the buyer actually landed. Re-read the node: the
    // receipt's copy predates setOwnRedeemCode, so its code id is still null.
    const otherCode = db.redeemCodes.get(db.nodes.get(other.rootNode.id).own_redeem_code_id);
    raw().query(`UPDATE transactions SET redeem_code_id = ? WHERE id = ?`).run(otherCode.id, a.childTx.id);
    expect(problemsAbout(a.childTx.id).some((p) => p.includes("redeem code owner") || p.includes("code belongs to"))).toBe(true);

    const original = db.redeemCodes.get(db.nodes.get(a.rootNode.id).own_redeem_code_id);
    raw().query(`UPDATE transactions SET redeem_code_id = ? WHERE id = ?`).run(original.id, a.childTx.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches an approved deposit that never credited a wallet", async () => {
    const a = await makeTree();
    // The deposit flow is gone, but archived rows are still money history and
    // the audit still holds them to account.
    const deposit = { id: `dep_audit_${Date.now()}` };
    raw()
      .query(
        `INSERT INTO deposit_requests (id, user_id, amount_cents, method, status, created_at, processed_at)
         VALUES (?, ?, 1234, 'manual', 'completed', ?, ?)`
      )
      .run(deposit.id, a.rootUser.id, new Date().toISOString(), new Date().toISOString());

    expect(problemsAbout(deposit.id).some((p) => p.includes("never credited"))).toBe(true);

    raw().query(`DELETE FROM deposit_requests WHERE id = ?`).run(deposit.id);
    expect(auditSystem()).toEqual([]);
  });

  test("the database itself refuses two positions for one user on one product", async () => {
    const a = await makeTree();
    // The audit carries a duplicate-position check as a safety net for a
    // future non-SQL adapter, but on SQLite the state is unreachable: the
    // schema's UNIQUE(user_id, product_id) rejects it outright. Proving the
    // constraint is live is the stronger assertion, so that is what this
    // does -- corrupting past it isn't possible, which is the point.
    expect(() =>
      raw().query(`UPDATE nodes SET user_id = ? WHERE id = ?`).run(a.rootUser.id, a.childNode.id)
    ).toThrow();

    // Untouched: the failed write rolled back.
    expect(db.nodes.get(a.childNode.id).user_id).toBe(a.childUser.id);
    expect(auditSystem()).toEqual([]);
  });

  test("finishes with the database exactly as consistent as it started", () => {
    expect(auditSystem()).toEqual([]);
  });
});

// --- Cheques, sales channels, and the message queue -------------------------
// Same discipline as above: corrupt, confirm the audit names the problem,
// put it back.

describe("the audit detects cheque and channel corruption", () => {
  async function makeChequedOrder() {
    const admin = await signupAdmin("chqaudit-admin");
    const buyer = await signup("chqaudit-buyer");
    const product = await createProduct(admin.token, { xCents: 10_000, yCents: 30_000 });
    const order = await POST(
      "/admin/orders/manual",
      {
        user_id: buyer.user.id,
        product_id: product.id,
        amount_received_cents: 10_000,
        payment_terms: "installment",
        cheques: [{ amount_cents: 20_000, due_date: "2030-01-01" }],
      },
      { token: admin.token }
    );
    return { tx: order.body.transaction, cheque: order.body.cheques[0], buyer, admin };
  }

  test("starts clean", async () => {
    await makeChequedOrder();
    expect(auditSystem()).toEqual([]);
  });

  test("catches a cheque whose owner is not the person who placed the order", async () => {
    const { cheque } = await makeChequedOrder();
    const stranger = await signup("chqaudit-stranger");
    const before = raw().query(`SELECT user_id FROM lease_cheques WHERE id = ?`).get(cheque.id).user_id;

    // This is the one that matters most: the image route is owner-scoped, so
    // a mis-owned cheque means one customer can fetch another's bank details.
    raw().query(`UPDATE lease_cheques SET user_id = ? WHERE id = ?`).run(stranger.user.id, cheque.id);
    expect(problemsAbout(`cheque ${cheque.id} belongs to user`).length).toBe(1);

    raw().query(`UPDATE lease_cheques SET user_id = ? WHERE id = ?`).run(before, cheque.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches cheques promising more than the order is worth", async () => {
    const { tx, cheque } = await makeChequedOrder();
    raw().query(`UPDATE lease_cheques SET amount_cents = 999999 WHERE id = ?`).run(cheque.id);
    expect(problemsAbout(`order ${tx.id}: down payment plus cheques`).length).toBe(1);

    raw().query(`UPDATE lease_cheques SET amount_cents = 20000 WHERE id = ?`).run(cheque.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches a cleared cheque with no cleared_at, and the reverse", async () => {
    const { cheque } = await makeChequedOrder();

    raw().query(`UPDATE lease_cheques SET status = 'cleared' WHERE id = ?`).run(cheque.id);
    expect(problemsAbout(`cheque ${cheque.id} is cleared with no cleared_at`).length).toBe(1);

    raw().query(`UPDATE lease_cheques SET status = 'pending', cleared_at = '2030-01-01T00:00:00.000Z' WHERE id = ?`).run(cheque.id);
    expect(problemsAbout(`cheque ${cheque.id} is pending but carries a cleared_at`).length).toBe(1);

    raw().query(`UPDATE lease_cheques SET cleared_at = NULL WHERE id = ?`).run(cheque.id);
    expect(auditSystem()).toEqual([]);
  });

  test("catches an online order that was only partly collected", async () => {
    // Storefront sales are paid in full by wallet debit at the till. One
    // showing a partial collection means either the debit or the bookkeeping
    // went wrong.
    const buyer = await signup("chanaudit-buyer");
    const admin = await signupAdmin("chanaudit-admin");
    const product = await createProduct(admin.token);
    const receipt = await buy(buyer, product);
    const txId = receipt.body.transaction.id;
    const before = raw().query(`SELECT amount_received_cents FROM transactions WHERE id = ?`).get(txId).amount_received_cents;

    raw().query(`UPDATE transactions SET amount_received_cents = 1 WHERE id = ?`).run(txId);
    expect(problemsAbout(`online tx ${txId} collected 1 of`).length).toBe(1);

    raw().query(`UPDATE transactions SET amount_received_cents = ? WHERE id = ?`).run(before, txId);
    expect(auditSystem()).toEqual([]);
  });

  test("catches an unknown sales channel", async () => {
    const { tx } = await makeChequedOrder();
    raw().query(`UPDATE transactions SET channel = 'carrier_pigeon' WHERE id = ?`).run(tx.id);
    expect(problemsAbout(`tx ${tx.id} has an unknown channel`).length).toBe(1);

    raw().query(`UPDATE transactions SET channel = 'in_person' WHERE id = ?`).run(tx.id);
    expect(auditSystem()).toEqual([]);
  });

  test("duplicate dedupe keys are impossible, which is why the audit checks for them", () => {
    // Unlike the cases above, this damage cannot be injected: the UNIQUE
    // constraint on notifications.dedupe_key physically refuses the second
    // row, and SQLite will not let you drop an implicit unique index to get
    // around it. So the reachable property is asserted here instead.
    //
    // The audit still checks for duplicates, and that is not dead code:
    // migrations 003, 006 and 007 in this codebase all rebuild a table to
    // widen a CHECK constraint, and a rebuild that forgot to carry the
    // constraint across would silently start double-sending reminders with
    // nothing else in the system noticing.
    const now = new Date().toISOString();
    const key = `audit-dupe-${Date.now()}`;
    const insert = (suffix) =>
      raw()
        .query(
          `INSERT INTO notifications (id, channel, recipient, template, payload_json, dedupe_key, status, attempts, created_at)
           VALUES (?, 'email', 'x@y.z', 'request_received', '{}', ?, 'pending', 0, ?)`
        )
        .run(`ntf_audit_${suffix}_${key}`, key, now);

    insert("a");
    expect(() => insert("b")).toThrow(/UNIQUE/i);

    raw().query(`DELETE FROM notifications WHERE dedupe_key = ?`).run(key);
    expect(auditSystem()).toEqual([]);
  });

  test("catches a support request with no way to contact anybody", async () => {
    const created = await POST("/support/requests", { name: "Auditable", contact: "audit@lead.test", message: "hi" });
    raw().query(`UPDATE support_requests SET contact = '  ' WHERE id = ?`).run(created.body.id);
    expect(problemsAbout(`support request ${created.body.id} has no way to contact`).length).toBe(1);

    raw().query(`UPDATE support_requests SET contact = 'audit@lead.test' WHERE id = ?`).run(created.body.id);
    expect(auditSystem()).toEqual([]);
  });
});
