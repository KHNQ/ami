import { newId } from "../../../../lib/id.js";

export function makeTransactionsRepo(raw) {
  return {
    create({
      productId,
      spaceId,
      buyerNodeId,
      buyerUserId,
      redeemCodeId,
      xAtSaleCents,
      yAtSaleCents,
      discountCents,
      marginCents,
      payoutPoolAmountCents,
      totalPayoutCents,
      reserveAmountCents,
      trexNetAmountCents,
      // Sales-channel fields (migration 011). Defaulted so every existing
      // caller keeps producing an ordinary online, paid-in-full order.
      channel = "online",
      recordedByAdminId = null,
      amountReceivedCents = null,
      paymentTerms = "full",
    }) {
      const id = newId("tx");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO transactions (
             id, product_id, space_id, buyer_node_id, buyer_user_id, redeem_code_id,
             x_at_sale_cents, y_at_sale_cents, discount_cents, margin_cents,
             payout_pool_amount_cents, total_payout_cents, reserve_amount_cents, trex_net_amount_cents,
             refunded_amount_cents, status, created_at,
             channel, recorded_by_admin_id, amount_received_cents, payment_terms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'completed', ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          productId,
          spaceId,
          buyerNodeId,
          buyerUserId,
          redeemCodeId || null,
          xAtSaleCents,
          yAtSaleCents,
          discountCents || 0,
          marginCents,
          payoutPoolAmountCents,
          totalPayoutCents,
          reserveAmountCents,
          trexNetAmountCents,
          now,
          channel,
          recordedByAdminId,
          amountReceivedCents === null ? yAtSaleCents : amountReceivedCents,
          paymentTerms
        );
      return this.get(id);
    },

    /** Records further cash collected against an instalment order. */
    addAmountReceived(id, deltaCents) {
      raw
        .query(`UPDATE transactions SET amount_received_cents = amount_received_cents + ? WHERE id = ?`)
        .run(deltaCents, id);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM transactions WHERE id = ?`).get(id) || null;
    },
    list({ productId, spaceId, buyerUserId, status, limit = 50, offset = 0 } = {}) {
      const clauses = [];
      const params = [];
      if (productId) {
        clauses.push("product_id = ?");
        params.push(productId);
      }
      if (spaceId) {
        clauses.push("space_id = ?");
        params.push(spaceId);
      }
      if (buyerUserId) {
        clauses.push("buyer_user_id = ?");
        params.push(buyerUserId);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      return raw.query(`SELECT * FROM transactions ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params);
    },
    listAll() {
      return raw.query(`SELECT * FROM transactions ORDER BY created_at ASC, rowid ASC`).all();
    },
    applyPayoutTotals(id, { totalPayoutCents, reserveAmountCents, trexNetAmountCents }) {
      raw
        .query(
          `UPDATE transactions SET total_payout_cents = ?, reserve_amount_cents = ?, trex_net_amount_cents = ? WHERE id = ?`
        )
        .run(totalPayoutCents, reserveAmountCents, trexNetAmountCents, id);
      return this.get(id);
    },
    applyRefund(id, { refundedAmountCents, status }) {
      raw.query(`UPDATE transactions SET refunded_amount_cents = ?, status = ? WHERE id = ?`).run(refundedAmountCents, status, id);
      return this.get(id);
    },
    aggregateNet({ productId, spaceId, fromDate, toDate, status } = {}) {
      const clauses = [];
      const params = [];
      if (productId) {
        clauses.push("product_id = ?");
        params.push(productId);
      }
      if (spaceId) {
        clauses.push("space_id = ?");
        params.push(spaceId);
      }
      if (fromDate) {
        clauses.push("created_at >= ?");
        params.push(fromDate);
      }
      if (toDate) {
        clauses.push("created_at <= ?");
        params.push(toDate);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const row = raw
        .query(
          `SELECT
             COUNT(*) as tx_count,
             COALESCE(SUM(margin_cents),0) as total_margin_cents,
             COALESCE(SUM(payout_pool_amount_cents),0) as total_payout_pool_cents,
             COALESCE(SUM(total_payout_cents),0) as total_payout_cents,
             COALESCE(SUM(reserve_amount_cents),0) as total_reserve_cents,
             COALESCE(SUM(trex_net_amount_cents),0) as total_trex_net_cents,
             COALESCE(SUM(y_at_sale_cents),0) as total_revenue_cents,
             -- trex_net/payout/revenue above are all as-booked at sale time
             -- and are deliberately NOT rewritten by a refund (refundService
             -- claws back the commissions and the reserve cut, but leaves
             -- the original sale row intact as an audit record). Reporting
             -- them without this column let an operator read a gross figure
             -- as money kept, so the refunded total travels with them.
             COALESCE(SUM(refunded_amount_cents),0) as total_refunded_cents
           FROM transactions ${where}`
        )
        .get(...params);
      return row;
    },
  };
}

export function makeLedgerRepo(raw) {
  return {
    create({ transactionId, nodeId, userId, levelDepth, rateAppliedBp, amountCents, status = "pending" }) {
      const id = newId("cle");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO commission_ledger_entries (
             id, transaction_id, node_id, user_id, level_depth, rate_applied_bp, amount_cents,
             clawed_back_cents, status, paid_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`
        )
        .run(id, transactionId, nodeId, userId, levelDepth, rateAppliedBp, amountCents, status, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM commission_ledger_entries WHERE id = ?`).get(id) || null;
    },
    listByTransaction(transactionId) {
      return raw.query(`SELECT * FROM commission_ledger_entries WHERE transaction_id = ?`).all(transactionId);
    },
    listByNode(nodeId, { limit = 50, offset = 0, status } = {}) {
      if (status) {
        return raw
          .query(
            `SELECT * FROM commission_ledger_entries WHERE node_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
          )
          .all(nodeId, status, limit, offset);
      }
      return raw
        .query(`SELECT * FROM commission_ledger_entries WHERE node_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(nodeId, limit, offset);
    },
    listPendingOlderThan(cutoffIso) {
      return raw
        .query(`SELECT * FROM commission_ledger_entries WHERE status = 'pending' AND created_at <= ?`)
        .all(cutoffIso);
    },
    /**
     * Everything the company still owes, one row per earner.
     *
     * Grouped in SQL rather than in JavaScript because the whole point of the
     * payout sheet is the total per person -- an admin counting out cash needs
     * "pay Sara $8,320", not forty ledger lines to add up by hand.
     *
     * `clawed_back_cents` is subtracted here, not after: a refunded sale
     * shrinks what is owed in place, and paying `amount_cents` would hand back
     * money the refund had already taken away.
     */
    outstandingByUser({ productId = null } = {}) {
      const where = ["e.status = 'pending'"];
      const args = [];
      if (productId) {
        where.push("t.product_id = ?");
        args.push(productId);
      }
      return raw
        .query(
          `SELECT e.user_id,
                  u.name  AS user_name,
                  u.email AS user_email,
                  u.phone AS user_phone,
                  COUNT(*)                                        AS entry_count,
                  SUM(e.amount_cents - e.clawed_back_cents)       AS owed_cents,
                  MIN(e.created_at)                               AS oldest_at,
                  MAX(e.created_at)                               AS newest_at
             FROM commission_ledger_entries e
             JOIN users u        ON u.id = e.user_id
             JOIN transactions t ON t.id = e.transaction_id
            WHERE ${where.join(" AND ")}
            GROUP BY e.user_id
           HAVING owed_cents > 0
            ORDER BY owed_cents DESC`
        )
        .all(...args);
    },

    /** The lines behind one person's total, so a payment can be explained. */
    outstandingForUser(userId, { productId = null } = {}) {
      const where = ["e.status = 'pending'", "e.user_id = ?"];
      const args = [userId];
      if (productId) {
        where.push("t.product_id = ?");
        args.push(productId);
      }
      return raw
        .query(
          `SELECT e.*,
                  t.product_id,
                  t.y_at_sale_cents,
                  t.created_at AS sale_at,
                  buyer.name   AS buyer_name,
                  p.name       AS product_name
             FROM commission_ledger_entries e
             JOIN transactions t ON t.id = e.transaction_id
             JOIN users buyer    ON buyer.id = t.buyer_user_id
             JOIN products p     ON p.id = t.product_id
            WHERE ${where.join(" AND ")}
            ORDER BY e.created_at ASC`
        )
        .all(...args);
    },

    /**
     * Settles one person's outstanding commission as paid by hand.
     *
     * One guarded UPDATE over the whole set, for the same reason the AI
     * proposals use one: two admins settling the same earner at the same
     * moment must produce one payment, not two. `changes` is how many lines
     * this caller actually claimed -- if it is zero, somebody else got there
     * first and the caller must not hand over any cash.
     */
    settleForUser(userId, { productId = null, paidAtIso = new Date().toISOString() } = {}) {
      const where = ["status = 'pending'", "user_id = ?"];
      const args = [paidAtIso, userId];
      if (productId) {
        where.push("transaction_id IN (SELECT id FROM transactions WHERE product_id = ?)");
        args.push(productId);
      }
      const res = raw
        .query(
          // `paid_method` is what keeps the system-wide audit honest: an
          // entry settled in cash has no wallet credit and never will, and
          // without this column that is indistinguishable from a wallet
          // payout that silently failed.
          `UPDATE commission_ledger_entries
              SET status = 'paid', paid_at = ?, paid_method = 'manual'
            WHERE ${where.join(" AND ")}`
        )
        .run(...args);
      return res.changes;
    },

    /** The wallet path: the release job credited the earner's balance. */
    markPaid(id) {
      raw
        .query(
          `UPDATE commission_ledger_entries SET status = 'paid', paid_at = ?, paid_method = 'wallet' WHERE id = ?`
        )
        .run(new Date().toISOString(), id);
      return this.get(id);
    },
    applyClawback(id, clawbackCents, newStatus) {
      raw
        .query(`UPDATE commission_ledger_entries SET clawed_back_cents = clawed_back_cents + ?, status = ? WHERE id = ?`)
        .run(clawbackCents, newStatus, id);
      return this.get(id);
    },
  };
}

export function makeReserveRepo(raw) {
  function ensureSingleton() {
    let row = raw.query(`SELECT * FROM reserve_fund WHERE id = 'singleton'`).get();
    if (!row) {
      raw.query(`INSERT INTO reserve_fund (id, balance_cents, updated_at) VALUES ('singleton', 0, ?)`).run(new Date().toISOString());
      row = raw.query(`SELECT * FROM reserve_fund WHERE id = 'singleton'`).get();
    }
    return row;
  }
  return {
    getBalance() {
      return ensureSingleton().balance_cents;
    },
    credit(amountCents, { transactionId, note } = {}) {
      const bal = ensureSingleton().balance_cents + amountCents;
      raw.query(`UPDATE reserve_fund SET balance_cents = ?, updated_at = ? WHERE id = 'singleton'`).run(bal, new Date().toISOString());
      const id = newId("rle");
      raw
        .query(
          `INSERT INTO reserve_ledger_entries (id, type, amount_cents, balance_after, transaction_id, note, created_at)
           VALUES (?, 'credit', ?, ?, ?, ?, ?)`
        )
        .run(id, amountCents, bal, transactionId || null, note || null, new Date().toISOString());
      return bal;
    },
    debit(amountCents, { transactionId, note } = {}) {
      const bal = ensureSingleton().balance_cents - amountCents;
      raw.query(`UPDATE reserve_fund SET balance_cents = ?, updated_at = ? WHERE id = 'singleton'`).run(bal, new Date().toISOString());
      const id = newId("rle");
      raw
        .query(
          `INSERT INTO reserve_ledger_entries (id, type, amount_cents, balance_after, transaction_id, note, created_at)
           VALUES (?, 'debit', ?, ?, ?, ?, ?)`
        )
        .run(id, amountCents, bal, transactionId || null, note || null, new Date().toISOString());
      return bal;
    },
    listLedger({ limit = 50, offset = 0 } = {}) {
      return raw.query(`SELECT * FROM reserve_ledger_entries ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(limit, offset);
    },
  };
}
