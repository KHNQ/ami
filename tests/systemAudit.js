import { db } from "../src/db/index.js";

// Whole-database consistency audit.
//
// The scenario tests below drive the system through thousands of real
// operations and then run this over everything that ended up on disk. It is
// deliberately independent of the code that wrote the data: it re-derives
// what must be true from the rows themselves, so a bug in a service can't
// hide behind the same bug in the check.
//
// Returns an array of human-readable problems; empty means the database is
// internally consistent.

const raw = () => db._raw;

function all(sql, ...params) {
  return raw().query(sql).all(...params);
}

/** Every Space is a single well-formed tree rooted at its root node. */
function auditTrees(problems) {
  const spaces = all(`SELECT * FROM spaces`);
  const nodes = all(`SELECT * FROM nodes`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bySpace = new Map();
  for (const n of nodes) {
    if (!bySpace.has(n.space_id)) bySpace.set(n.space_id, []);
    bySpace.get(n.space_id).push(n);
  }

  for (const space of spaces) {
    const members = bySpace.get(space.id) || [];
    if (!members.length) {
      problems.push(`space ${space.id} has no nodes at all`);
      continue;
    }

    if (!space.root_node_id) {
      problems.push(`space ${space.id} has no root_node_id`);
      continue;
    }
    const root = byId.get(space.root_node_id);
    if (!root) {
      problems.push(`space ${space.id} root_node_id ${space.root_node_id} does not exist`);
      continue;
    }
    if (root.space_id !== space.id) problems.push(`space ${space.id} root node belongs to space ${root.space_id}`);
    if (root.parent_node_id !== null) problems.push(`space ${space.id} root node ${root.id} has a parent`);
    if (root.user_id !== space.root_user_id) {
      problems.push(`space ${space.id} root_user_id ${space.root_user_id} != root node's user ${root.user_id}`);
    }

    // Exactly one root per space.
    const roots = members.filter((n) => n.parent_node_id === null);
    if (roots.length !== 1) {
      problems.push(`space ${space.id} has ${roots.length} parentless nodes (expected exactly 1)`);
    }

    for (const node of members) {
      if (node.product_id !== space.product_id) {
        problems.push(`node ${node.id} product ${node.product_id} != its space's product ${space.product_id}`);
      }
      if (node.parent_node_id) {
        const parent = byId.get(node.parent_node_id);
        if (!parent) {
          problems.push(`node ${node.id} parent ${node.parent_node_id} does not exist`);
        } else if (parent.space_id !== node.space_id) {
          problems.push(`node ${node.id} is parented across spaces (${parent.space_id} -> ${node.space_id})`);
        } else if (parent.id === node.id) {
          problems.push(`node ${node.id} is its own parent`);
        }
      }

      // Walk to the root: must terminate, must not cycle, must arrive at
      // this space's declared root.
      const seen = new Set();
      let cursor = node;
      let depth = 0;
      while (cursor && cursor.parent_node_id) {
        if (seen.has(cursor.id)) {
          problems.push(`node ${node.id} sits on an upline cycle at ${cursor.id}`);
          break;
        }
        seen.add(cursor.id);
        cursor = byId.get(cursor.parent_node_id);
        if (++depth > members.length + 1) {
          problems.push(`node ${node.id} upline walk exceeded the space's node count -- cycle or corruption`);
          break;
        }
      }
      if (cursor && cursor.parent_node_id === null && cursor.id !== space.root_node_id) {
        problems.push(`node ${node.id} climbs to ${cursor.id}, not the space root ${space.root_node_id}`);
      }
    }
  }
}

/** One position per user per product, and no orphaned rows. */
function auditNodeIdentity(problems) {
  const dupes = all(
    `SELECT user_id, product_id, COUNT(*) AS n FROM nodes GROUP BY user_id, product_id HAVING n > 1`
  );
  for (const d of dupes) {
    problems.push(`user ${d.user_id} has ${d.n} nodes for product ${d.product_id} (must be exactly 1)`);
  }

  const orphanSpaces = all(`SELECT n.id FROM nodes n LEFT JOIN spaces s ON s.id = n.space_id WHERE s.id IS NULL`);
  for (const o of orphanSpaces) problems.push(`node ${o.id} references a space that does not exist`);

  const orphanUsers = all(`SELECT n.id FROM nodes n LEFT JOIN users u ON u.id = n.user_id WHERE u.id IS NULL`);
  for (const o of orphanUsers) problems.push(`node ${o.id} references a user that does not exist`);
}

/** Every wallet balance is exactly the sum of its own ledger. */
function auditWallets(problems) {
  const accounts = all(`SELECT * FROM wallet_accounts`);
  for (const acct of accounts) {
    const entries = all(
      `SELECT * FROM wallet_ledger_entries WHERE user_id = ? ORDER BY created_at ASC, rowid ASC`,
      acct.user_id
    );
    const summed = entries.reduce((a, e) => a + e.amount_cents, 0);
    if (summed !== acct.balance_cents) {
      problems.push(
        `wallet ${acct.user_id}: balance ${acct.balance_cents} != ledger sum ${summed} (${entries.length} entries)`
      );
    }
    // The running balance recorded on each entry must match too, otherwise
    // the user's statement disagrees with their balance.
    let running = 0;
    for (const e of entries) {
      running += e.amount_cents;
      if (e.balance_after !== running) {
        problems.push(`wallet ${acct.user_id}: entry ${e.id} balance_after ${e.balance_after} != running ${running}`);
        break;
      }
    }
    if (acct.balance_cents < 0) {
      // Only a refund clawback is allowed to push a wallet negative.
      const clawed = entries.some((e) => e.type === "commission_clawback");
      if (!clawed) problems.push(`wallet ${acct.user_id} is negative (${acct.balance_cents}) with no clawback to explain it`);
    }
  }
}

/** Per-transaction financial invariants (idea.md Section 5/6). */
function auditTransactions(problems) {
  const txs = all(`SELECT * FROM transactions`);
  for (const tx of txs) {
    if (tx.margin_cents !== tx.y_at_sale_cents - tx.x_at_sale_cents) {
      problems.push(`tx ${tx.id}: margin ${tx.margin_cents} != y-x (${tx.y_at_sale_cents}-${tx.x_at_sale_cents})`);
    }
    if (tx.margin_cents <= 0) problems.push(`tx ${tx.id}: margin ${tx.margin_cents} is not positive`);
    if (tx.total_payout_cents > tx.payout_pool_amount_cents) {
      problems.push(
        `tx ${tx.id}: Invariant 2 -- payout ${tx.total_payout_cents} exceeds pool ${tx.payout_pool_amount_cents}`
      );
    }
    if (tx.trex_net_amount_cents <= 0) {
      problems.push(`tx ${tx.id}: Invariant 3 -- trex_net ${tx.trex_net_amount_cents} is not positive`);
    }
    if (tx.reserve_amount_cents < 0) problems.push(`tx ${tx.id}: negative reserve cut`);
    if (tx.refunded_amount_cents > tx.y_at_sale_cents) {
      problems.push(`tx ${tx.id}: refunded ${tx.refunded_amount_cents} exceeds sale price ${tx.y_at_sale_cents}`);
    }
    const expectedStatus =
      tx.refunded_amount_cents === 0
        ? "completed"
        : tx.refunded_amount_cents >= tx.y_at_sale_cents
          ? "refunded"
          : "partially_refunded";
    if (tx.status !== expectedStatus) {
      problems.push(`tx ${tx.id}: status ${tx.status} disagrees with refunded ${tx.refunded_amount_cents}`);
    }
  }
}

/** Commission only ever flows upline, never to the buyer. */
function auditCommissionLedger(problems) {
  const nodes = new Map(all(`SELECT * FROM nodes`).map((n) => [n.id, n]));
  const txs = new Map(all(`SELECT * FROM transactions`).map((t) => [t.id, t]));
  const entries = all(`SELECT * FROM commission_ledger_entries`);

  for (const e of entries) {
    const tx = txs.get(e.transaction_id);
    if (!tx) {
      problems.push(`ledger entry ${e.id} references a missing transaction`);
      continue;
    }
    const earner = nodes.get(e.node_id);
    if (!earner) {
      problems.push(`ledger entry ${e.id} references a missing node`);
      continue;
    }
    if (e.node_id === tx.buyer_node_id) {
      problems.push(`ledger entry ${e.id}: buyer node ${e.node_id} earned commission on its own purchase`);
    }
    if (earner.user_id !== e.user_id) {
      problems.push(`ledger entry ${e.id}: user ${e.user_id} does not own node ${e.node_id}`);
    }
    if (earner.space_id !== tx.space_id) {
      problems.push(`ledger entry ${e.id}: earner is in space ${earner.space_id}, sale was in ${tx.space_id}`);
    }

    // The earner must be a genuine ancestor of the buyer, at the recorded depth.
    let cursor = nodes.get(tx.buyer_node_id);
    let depth = 0;
    let found = false;
    while (cursor && cursor.parent_node_id && depth < 200) {
      cursor = nodes.get(cursor.parent_node_id);
      depth += 1;
      if (cursor && cursor.id === e.node_id) {
        found = true;
        break;
      }
    }
    if (!found) {
      problems.push(`ledger entry ${e.id}: node ${e.node_id} is not upline of buyer ${tx.buyer_node_id}`);
    } else if (e.level_depth !== depth) {
      problems.push(`ledger entry ${e.id}: recorded depth ${e.level_depth} but actual distance is ${depth}`);
    }

    if (e.amount_cents < 0) problems.push(`ledger entry ${e.id}: negative amount`);
    if (e.clawed_back_cents > e.amount_cents) {
      problems.push(`ledger entry ${e.id}: clawed back ${e.clawed_back_cents} > earned ${e.amount_cents}`);
    }
  }

  // What actually reached a wallet for each entry must equal what the
  // entry says is owed. This is order-independent and so covers both
  // sequences: released-then-clawed-back (credit, then debit) and
  // clawed-back-while-pending-then-released (one reduced credit). It is
  // the check that catches a release job paying out the pre-clawback
  // amount and silently undoing a refund.
  const movements = all(
    `SELECT ref_id, type, SUM(amount_cents) AS net, SUM(CASE WHEN type = 'commission_release' THEN 1 ELSE 0 END) AS releases
     FROM wallet_ledger_entries
     WHERE ref_type = 'commission_ledger_entry'
     GROUP BY ref_id`
  );
  const movementByEntry = new Map(movements.map((m) => [m.ref_id, m]));
  for (const e of entries) {
    const moved = movementByEntry.get(e.id);
    const owed = e.amount_cents - e.clawed_back_cents;
    if (!moved) {
      // Never released. Nothing should have reached a wallet -- UNLESS it was
      // settled by hand, which is the normal way this business pays its
      // network: cash across the counter, recorded on the payout sheet, with
      // `paid_method = 'manual'` on the row saying so. Without that
      // distinction a deliberate cash settlement and a wallet payout that
      // silently failed look identical, which is what this check exists to
      // catch.
      if (e.status === "paid" && e.paid_method !== "manual") {
        problems.push(`ledger entry ${e.id} is marked paid but never credited a wallet`);
      }
      continue;
    }
    if (moved.net !== owed) {
      problems.push(
        `ledger entry ${e.id}: wallet received ${moved.net} but the entry owes ${owed} ` +
          `(earned ${e.amount_cents}, clawed back ${e.clawed_back_cents}, status ${e.status})`
      );
    }
  }

  // Per transaction, the sum of what was credited must respect the pool.
  const byTx = new Map();
  for (const e of entries) byTx.set(e.transaction_id, (byTx.get(e.transaction_id) || 0) + e.amount_cents);
  for (const [txId, total] of byTx) {
    const tx = txs.get(txId);
    if (tx && total > tx.payout_pool_amount_cents) {
      problems.push(`tx ${txId}: ledger entries total ${total} exceed pool ${tx.payout_pool_amount_cents}`);
    }
  }
}

/** Stock, reserve fund and redeem codes. */
function auditCatalogueAndCodes(problems) {
  for (const p of all(`SELECT id, name, stock_count FROM products WHERE stock_count < 0`)) {
    problems.push(`product ${p.name} (${p.id}) has negative stock ${p.stock_count}`);
  }

  const reserve = raw().query(`SELECT * FROM reserve_fund WHERE id = 'singleton'`).get();
  if (reserve) {
    const movements = all(`SELECT * FROM reserve_ledger_entries ORDER BY created_at ASC, rowid ASC`);
    const summed = movements.reduce((a, m) => a + (m.type === "credit" ? m.amount_cents : -m.amount_cents), 0);
    if (summed !== reserve.balance_cents) {
      problems.push(`reserve fund: balance ${reserve.balance_cents} != ledger sum ${summed}`);
    }
    if (reserve.balance_cents < 0) problems.push(`reserve fund is negative (${reserve.balance_cents})`);
  }

  const nodes = new Map(all(`SELECT * FROM nodes`).map((n) => [n.id, n]));
  for (const code of all(`SELECT * FROM redeem_codes`)) {
    const owner = nodes.get(code.owner_node_id);
    if (!owner) {
      problems.push(`redeem code ${code.code} has no owner node`);
      continue;
    }
    if (owner.space_id !== code.space_id) {
      problems.push(`redeem code ${code.code}: space ${code.space_id} != owner node's space ${owner.space_id}`);
    }
    if (owner.product_id !== code.product_id) {
      problems.push(`redeem code ${code.code}: product mismatch with its owner node`);
    }
    if (code.max_uses !== null && code.uses_count > code.max_uses) {
      problems.push(`redeem code ${code.code}: used ${code.uses_count} times, max is ${code.max_uses}`);
    }
  }

  // Every referred purchase must have attached the buyer under the code's owner.
  const txs = all(`SELECT * FROM transactions WHERE redeem_code_id IS NOT NULL`);
  const codes = new Map(all(`SELECT * FROM redeem_codes`).map((c) => [c.id, c]));
  for (const tx of txs) {
    const code = codes.get(tx.redeem_code_id);
    const buyer = nodes.get(tx.buyer_node_id);
    if (!code || !buyer) continue;
    if (buyer.parent_node_id !== code.owner_node_id) {
      problems.push(`tx ${tx.id}: buyer's parent ${buyer.parent_node_id} != redeem code owner ${code.owner_node_id}`);
    }
    if (buyer.space_id !== code.space_id) {
      problems.push(`tx ${tx.id}: buyer joined space ${buyer.space_id} but the code belongs to ${code.space_id}`);
    }
  }
}

/** Rank bonuses: never over-distributed, and paid exactly once. */
function auditRankBonuses(problems) {
  const periods = all(`SELECT * FROM rank_bonus_periods`);
  for (const period of periods) {
    const entries = all(`SELECT * FROM rank_bonus_ledger_entries WHERE period_id = ?`, period.id);
    const total = entries.reduce((a, e) => a + e.amount_cents, 0);
    if (total > period.pool_amount_cents) {
      problems.push(`rank period ${period.id}: distributed ${total} exceeds pool ${period.pool_amount_cents}`);
    }
    if (period.pool_amount_cents < 0) problems.push(`rank period ${period.id} has a negative pool`);
  }

  const paid = all(`SELECT * FROM rank_bonus_ledger_entries WHERE status = 'paid'`);
  const credited = new Map(
    all(
      `SELECT ref_id, SUM(amount_cents) AS net FROM wallet_ledger_entries
       WHERE ref_type = 'rank_bonus_ledger_entry' GROUP BY ref_id`
    ).map((r) => [r.ref_id, r.net])
  );
  for (const e of paid) {
    const net = credited.get(e.id);
    if (net === undefined) {
      problems.push(`rank bonus ${e.id} is marked paid but never credited a wallet`);
    } else if (net !== e.amount_cents) {
      problems.push(`rank bonus ${e.id}: wallet received ${net} but the entry is for ${e.amount_cents}`);
    }
  }
}

/** Deposits/withdrawals that were approved must have moved money. */
function auditMoneyRequests(problems) {
  const ledgerRefs = new Set(all(`SELECT ref_id FROM wallet_ledger_entries WHERE ref_id IS NOT NULL`).map((r) => r.ref_id));

  for (const d of all(`SELECT * FROM deposit_requests WHERE status = 'completed'`)) {
    if (!ledgerRefs.has(d.id)) problems.push(`deposit ${d.id} is completed but never credited a wallet`);
  }
  for (const w of all(`SELECT * FROM withdraw_requests WHERE status = 'completed'`)) {
    if (!ledgerRefs.has(w.id)) problems.push(`withdrawal ${w.id} is completed but never debited a wallet`);
  }
  for (const d of all(`SELECT * FROM deposit_requests WHERE status = 'rejected'`)) {
    if (ledgerRefs.has(d.id)) problems.push(`deposit ${d.id} was rejected but still moved money`);
  }
  for (const w of all(`SELECT * FROM withdraw_requests WHERE status = 'rejected'`)) {
    if (ledgerRefs.has(w.id)) problems.push(`withdrawal ${w.id} was rejected but still moved money`);
  }
}

/**
 * Cheques and the walk-in orders they belong to.
 *
 * Re-derived from the rows, like everything else here: a cheque register that
 * quietly disagrees with its order is exactly the kind of thing nobody
 * notices until a customer disputes a balance.
 */
function auditChequesAndChannels(problems) {
  const txById = new Map(all(`SELECT * FROM transactions`).map((t) => [t.id, t]));

  for (const c of all(`SELECT * FROM lease_cheques`)) {
    const tx = txById.get(c.transaction_id);
    if (!tx) {
      problems.push(`cheque ${c.id} references a transaction that does not exist`);
      continue;
    }
    // A cheque must belong to the person who placed the order it backs --
    // otherwise the owner-scoped image route would expose one customer's
    // bank details to another.
    if (c.user_id !== tx.buyer_user_id) {
      problems.push(`cheque ${c.id} belongs to user ${c.user_id} but its order was placed by ${tx.buyer_user_id}`);
    }
    if (c.amount_cents <= 0) problems.push(`cheque ${c.id} has a non-positive amount (${c.amount_cents})`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.due_date || "")) {
      problems.push(`cheque ${c.id} has a malformed due_date (${c.due_date})`);
    }
    // cleared_at and status must agree, in both directions.
    if (c.status === "cleared" && !c.cleared_at) problems.push(`cheque ${c.id} is cleared with no cleared_at`);
    if (c.status !== "cleared" && c.cleared_at) {
      problems.push(`cheque ${c.id} is ${c.status} but carries a cleared_at`);
    }
  }

  // Nothing may promise more than the order is worth.
  const committed = all(
    `SELECT transaction_id,
            COALESCE(SUM(amount_cents), 0) AS total_cents,
            COALESCE(SUM(CASE WHEN status = 'cleared' THEN amount_cents ELSE 0 END), 0) AS cleared_cents
     FROM lease_cheques WHERE status != 'cancelled' GROUP BY transaction_id`
  );
  for (const row of committed) {
    const tx = txById.get(row.transaction_id);
    if (!tx) continue;
    // amount_received_cents already includes any cleared cheques, so adding
    // the cleared total back would double-count it.
    const promised = tx.amount_received_cents - row.cleared_cents + row.total_cents;
    if (promised > tx.y_at_sale_cents) {
      problems.push(
        `order ${tx.id}: down payment plus cheques total ${promised} but the order is only worth ${tx.y_at_sale_cents}`
      );
    }
  }

  for (const tx of txById.values()) {
    if (tx.amount_received_cents < 0) {
      problems.push(`tx ${tx.id} has collected a negative amount (${tx.amount_received_cents})`);
    }
    if (tx.amount_received_cents > tx.y_at_sale_cents) {
      problems.push(`tx ${tx.id} collected ${tx.amount_received_cents}, more than its value ${tx.y_at_sale_cents}`);
    }
    if (!["online", "in_person"].includes(tx.channel)) {
      problems.push(`tx ${tx.id} has an unknown channel '${tx.channel}'`);
    }
    // An online sale is paid by wallet debit at the till, in full and by the
    // buyer -- there is no way for one to be partially collected or to carry
    // a recording admin.
    if (tx.channel === "online") {
      if (tx.amount_received_cents !== tx.y_at_sale_cents) {
        problems.push(`online tx ${tx.id} collected ${tx.amount_received_cents} of ${tx.y_at_sale_cents}`);
      }
      if (tx.recorded_by_admin_id) problems.push(`online tx ${tx.id} claims to have been recorded by an admin`);
    }
  }
}

/** Queued messages point at real people; support requests can be answered. */
function auditNotificationsAndSupport(problems) {
  const users = new Set(all(`SELECT id FROM users`).map((u) => u.id));
  for (const n of all(`SELECT * FROM notifications`)) {
    if (n.user_id && !users.has(n.user_id)) {
      problems.push(`notification ${n.id} references a user that does not exist`);
    }
    if (!n.recipient) problems.push(`notification ${n.id} has no recipient`);
    if (n.status === "sent" && !n.sent_at) problems.push(`notification ${n.id} is sent with no sent_at`);
    if (n.status === "pending" && n.sent_at) problems.push(`notification ${n.id} is pending but has a sent_at`);
  }
  // The dedupe guarantee, checked independently of the UNIQUE index that
  // enforces it -- if that index were ever dropped in a migration, this is
  // what would notice.
  const dupes = all(
    `SELECT dedupe_key, COUNT(*) AS n FROM notifications WHERE dedupe_key IS NOT NULL GROUP BY dedupe_key HAVING n > 1`
  );
  for (const d of dupes) problems.push(`dedupe_key '${d.dedupe_key}' appears ${d.n} times -- reminders will double-send`);

  for (const r of all(`SELECT * FROM support_requests`)) {
    if (!r.contact || !r.contact.trim()) problems.push(`support request ${r.id} has no way to contact the person`);
    if (r.user_id && !users.has(r.user_id)) problems.push(`support request ${r.id} references a user that does not exist`);
  }
}

export function auditSystem() {
  const problems = [];
  auditTrees(problems);
  auditNodeIdentity(problems);
  auditWallets(problems);
  auditTransactions(problems);
  auditCommissionLedger(problems);
  auditCatalogueAndCodes(problems);
  auditRankBonuses(problems);
  auditMoneyRequests(problems);
  auditChequesAndChannels(problems);
  auditNotificationsAndSupport(problems);
  return problems;
}

/** Counts used by the scenario tests' end-of-run reports. */
export function systemStats() {
  const one = (sql) => raw().query(sql).get();
  return {
    users: one(`SELECT COUNT(*) AS n FROM users`).n,
    products: one(`SELECT COUNT(*) AS n FROM products`).n,
    spaces: one(`SELECT COUNT(*) AS n FROM spaces`).n,
    nodes: one(`SELECT COUNT(*) AS n FROM nodes`).n,
    transactions: one(`SELECT COUNT(*) AS n FROM transactions`).n,
    commissionEntries: one(`SELECT COUNT(*) AS n FROM commission_ledger_entries`).n,
    walletEntries: one(`SELECT COUNT(*) AS n FROM wallet_ledger_entries`).n,
    redeemCodes: one(`SELECT COUNT(*) AS n FROM redeem_codes`).n,
    grossRevenueCents: one(`SELECT COALESCE(SUM(y_at_sale_cents),0) AS n FROM transactions`).n,
    totalPayoutCents: one(`SELECT COALESCE(SUM(total_payout_cents),0) AS n FROM transactions`).n,
    trexNetCents: one(`SELECT COALESCE(SUM(trex_net_amount_cents),0) AS n FROM transactions`).n,
    refundedCents: one(`SELECT COALESCE(SUM(refunded_amount_cents),0) AS n FROM transactions`).n,
    reserveCents: raw().query(`SELECT balance_cents AS n FROM reserve_fund WHERE id='singleton'`).get()?.n ?? 0,
    maxTreeDepth: one(`
      WITH RECURSIVE chain(id, depth) AS (
        SELECT id, 0 FROM nodes WHERE parent_node_id IS NULL
        UNION ALL
        SELECT n.id, c.depth + 1 FROM nodes n JOIN chain c ON n.parent_node_id = c.id
      ) SELECT COALESCE(MAX(depth),0) AS n FROM chain`).n,
  };
}
