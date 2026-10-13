import { newId } from "../../../../lib/id.js";
import { Errors } from "../../../../lib/errors.js";

export function makeUsersRepo(raw) {
  return {
    create({ email, passwordHash, name, role = "user" }) {
      const id = newId("usr");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(id, email.toLowerCase(), passwordHash, name, role, now, now);
      return this.findById(id);
    },
    findById(id) {
      return raw.query(`SELECT * FROM users WHERE id = ?`).get(id) || null;
    },
    findByEmail(email) {
      return raw.query(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) || null;
    },
    updateProfile(id, { name, phone }) {
      const sets = ["updated_at = ?"];
      const params = [new Date().toISOString()];
      if (name !== undefined) {
        sets.push("name = ?");
        params.push(name);
      }
      if (phone !== undefined) {
        sets.push("phone = ?");
        params.push(phone);
      }
      params.push(id);
      raw.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return this.findById(id);
    },
    updateStatus(id, status) {
      raw.query(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
      return this.findById(id);
    },
    // `role` is the coarse gate ('user' | 'admin'); `staffRole` refines what
    // kind of admin (see src/lib/permissions.js). They move together so a
    // row can never be left as an admin with no staff role, or as a
    // non-admin still carrying one.
    updateRole(id, role, staffRole = null) {
      raw
        .query(`UPDATE users SET role = ?, staff_role = ?, updated_at = ? WHERE id = ?`)
        .run(role, role === "admin" ? staffRole || "root" : null, new Date().toISOString(), id);
      return this.findById(id);
    },

    // How many root admins are left. Used to refuse the last one being
    // demoted, which would leave nobody able to grant the role back.
    countRootAdmins() {
      const row = raw
        .query(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND (staff_role IS NULL OR staff_role = 'root')`)
        .get();
      return row ? row.n : 0;
    },
    // Changing the password also retires every token minted before it --
    // see the token_version column. Done in one statement so a session can
    // never survive in the window between the two writes.
    updatePassword(id, passwordHash) {
      raw
        .query(`UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`)
        .run(passwordHash, new Date().toISOString(), id);
      return this.findById(id);
    },
    /**
     * Stamps the address as confirmed.
     *
     * Note it does NOT bump token_version, unlike updatePassword: confirming
     * an address is not a credential change, and signing the user out of the
     * session they were in when they clicked the link would be a baffling
     * reward for completing the step we asked them to complete.
     */
    markEmailVerified(id) {
      const now = new Date().toISOString();
      raw
        .query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`)
        .run(now, now, id);
      return this.findById(id);
    },
    // For logging out other sessions without changing credentials.
    bumpTokenVersion(id) {
      raw
        .query(`UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      return this.findById(id);
    },
    // Used by authService.deleteAccount to free the original email up for
    // reuse (the row itself is never removed -- financial/audit history
    // FKs to it) while blocking any further login with the old address.
    markDeleted(id, anonymizedEmail) {
      raw
        .query(`UPDATE users SET email = ?, status = 'banned', deleted_at = ?, updated_at = ? WHERE id = ?`)
        .run(anonymizedEmail.toLowerCase(), new Date().toISOString(), new Date().toISOString(), id);
      return this.findById(id);
    },
    list({ limit = 50, offset = 0, role, status } = {}) {
      const clauses = [];
      const params = [];
      if (role) {
        clauses.push("role = ?");
        params.push(role);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.push(limit, offset);
      return raw
        .query(`SELECT * FROM users ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(...params);
    },
  };
}

export function makeWalletRepo(raw) {
  function ensureAccount(userId) {
    let acct = raw.query(`SELECT * FROM wallet_accounts WHERE user_id = ?`).get(userId);
    if (!acct) {
      const id = newId("wal");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO wallet_accounts (id, user_id, balance_cents, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`
        )
        .run(id, userId, now, now);
      acct = raw.query(`SELECT * FROM wallet_accounts WHERE user_id = ?`).get(userId);
    }
    return acct;
  }

  function writeLedger({ userId, type, amountCents, balanceAfter, refType, refId, note }) {
    const id = newId("wle");
    raw
      .query(
        `INSERT INTO wallet_ledger_entries (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId, type, amountCents, balanceAfter, refType || null, refId || null, note || null, new Date().toISOString());
    return id;
  }

  return {
    ensureAccount,
    getBalance(userId) {
      return ensureAccount(userId).balance_cents;
    },
    // amountCents must be a positive integer. Credits add, debits subtract (validated against balance).
    credit(userId, amountCents, { type, refType, refId, note } = {}) {
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw Errors.badRequest("credit amount must be a positive integer");
      const acct = ensureAccount(userId);
      const newBalance = acct.balance_cents + amountCents;
      raw.query(`UPDATE wallet_accounts SET balance_cents = ?, updated_at = ? WHERE user_id = ?`).run(newBalance, new Date().toISOString(), userId);
      writeLedger({ userId, type, amountCents, balanceAfter: newBalance, refType, refId, note });
      return newBalance;
    },
    debit(userId, amountCents, { type, refType, refId, note, allowNegative = false } = {}) {
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw Errors.badRequest("debit amount must be a positive integer");
      const acct = ensureAccount(userId);
      if (!allowNegative && acct.balance_cents < amountCents) {
        throw Errors.unprocessable("Insufficient wallet balance", "insufficient_funds", {
          balance_cents: acct.balance_cents,
          requested_cents: amountCents,
        });
      }
      const newBalance = acct.balance_cents - amountCents;
      raw.query(`UPDATE wallet_accounts SET balance_cents = ?, updated_at = ? WHERE user_id = ?`).run(newBalance, new Date().toISOString(), userId);
      writeLedger({ userId, type, amountCents: -amountCents, balanceAfter: newBalance, refType, refId, note });
      return newBalance;
    },
    listLedger(userId, { limit = 50, offset = 0 } = {}) {
      return raw
        .query(`SELECT * FROM wallet_ledger_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
        .all(userId, limit, offset);
    },
  };
}

export function makePasswordResetRepo(raw) {
  return {
    create({ userId, tokenHash, expiresAt }) {
      const id = newId("prst");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, status, expires_at, used_at, created_at)
           VALUES (?, ?, ?, 'active', ?, NULL, ?)`
        )
        .run(id, userId, tokenHash, expiresAt, now);
      return this.get(id);
    },
    get(id) {
      return raw.query(`SELECT * FROM password_reset_tokens WHERE id = ?`).get(id) || null;
    },
    findByHash(tokenHash) {
      return raw.query(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`).get(tokenHash) || null;
    },
    markUsed(id) {
      raw
        .query(`UPDATE password_reset_tokens SET status = 'used', used_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      return this.get(id);
    },
    revokeActiveForUser(userId) {
      raw.query(`UPDATE password_reset_tokens SET status = 'revoked' WHERE user_id = ? AND status = 'active'`).run(userId);
    },
  };
}
