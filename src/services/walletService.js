import { db } from "../db/index.js";

export const walletService = {
  getWallet(userId) {
    const acct = db.wallet.ensureAccount(userId);
    return { balance_cents: acct.balance_cents };
  },

  listLedger(userId, opts) {
    return db.wallet.listLedger(userId, opts);
  },
};
