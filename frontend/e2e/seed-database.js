import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SQLITE_FILE = process.env.E2E_SQLITE_FILE || "./e2e/.tmp/e2e.sqlite";
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@trex.local";
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin12345";

// Resets the e2e database to a known state.
//
// MUST run before the backend process starts, and this is not a stylistic
// preference -- it is why the whole suite used to fail.
//
// This was previously wired as Playwright's `globalSetup`, on the assumption
// (stated in a comment here) that it ran before the `webServer` entries. It
// does not: Playwright starts the web servers first. So the backend opened
// the sqlite file, and only then did this function delete and re-create it
// underneath the running process -- leaving the server holding a deleted
// vnode and answering every single request with
// `SQLiteError: disk I/O error (SQLITE_IOERR_VNODE)`.
//
// It is now called from playwright.config.js at module scope, which is
// evaluated before anything is launched. It must NOT also be registered as
// `globalSetup`, or it would run a second time mid-flight and reintroduce
// exactly the failure it was moved to avoid.
export default function seedDatabase() {
  // Runs exactly once per suite, in the runner's main process.
  //
  // Playwright re-imports this config in every worker process, so a bare
  // module-scope call happens once per worker -- and each repeat would delete
  // the database while the backend and earlier workers were using it, which
  // is the very failure this move was meant to fix. Workers inherit the
  // parent's environment, so a flag set here is visible to them and they skip.
  if (process.env.E2E_DB_READY === "1") return;
  process.env.E2E_DB_READY = "1";

  const sqlitePath = resolve(import.meta.dirname, "..", SQLITE_FILE);
  mkdirSync(dirname(sqlitePath), { recursive: true });
  // Safe to delete here and nowhere else: nothing has been launched yet, so
  // no process is holding a handle to these files.
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = sqlitePath + suffix;
    if (existsSync(p)) rmSync(p);
  }

  execFileSync("bun", ["run", resolve(import.meta.dirname, "..", "..", "scripts", "seed.js")], {
    cwd: resolve(import.meta.dirname, "..", ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      SQLITE_FILE: sqlitePath,
      SEED_ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD,
    },
  });
}
