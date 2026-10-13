// Puts money in a user's wallet by writing the ledger directly.
//
// Wallet top-ups were removed from the product (payment is collected in
// person), so there is no longer a route a spec could drive to get a balance.
// A test fixture is allowed to reach underneath that: this opens the e2e
// database the way the API would and credits the account through the same
// repo, so the ledger and the balance stay consistent.
//
// Usage (run by bun, from the repo root): bun run frontend/e2e/fund-wallet.js <email> <cents>
import { db } from "../../src/db/index.js";

const [email, cents] = process.argv.slice(2);
const user = db.users.findByEmail(email);
if (!user) {
  console.error(`no such user: ${email}`);
  process.exit(1);
}
db.wallet.credit(user.id, Number(cents), { type: "adjustment", note: "e2e fixture" });
console.log(`credited ${cents} to ${email}`);
