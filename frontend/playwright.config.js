import { defineConfig, devices } from "@playwright/test";
import seedDatabase from "./e2e/seed-database.js";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Falls back to a locally-installed full Chromium when Playwright's expected
 * headless-shell build is missing.
 *
 * Playwright pins an exact browser revision and refuses to launch without it.
 * On an OS its installer no longer supports (`playwright install` answers
 * "does not support chromium on mac12") that pin cannot be satisfied, and the
 * entire e2e suite fails before the first assertion with an error about a
 * missing executable -- which reads like a broken test rather than a missing
 * download.
 *
 * If a full Chromium from any revision is already in the cache, it runs these
 * tests perfectly well. This looks for one and points Playwright at it.
 * Returns undefined when the expected build IS present, so a correctly
 * provisioned machine and CI are completely unaffected.
 */
function fallbackChromium() {
  const cache = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;

  // Only step in if the headless shell Playwright wants is genuinely absent.
  const hasShell = readdirSync(cache).some(
    (d) => d.startsWith("chromium_headless_shell-") &&
      existsSync(path.join(cache, d, "chrome-headless-shell-mac-x64", "chrome-headless-shell"))
  );
  if (hasShell) return undefined;

  for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    const bin = path.join(cache, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

const CHROMIUM_PATH = fallbackChromium();
if (CHROMIUM_PATH) {
  console.log(`[playwright] headless shell not installed -- using ${CHROMIUM_PATH}`);
}

// Ports/paths deliberately don't collide with `bun run dev` (5173) or a
// developer's own trex.sqlite, so `bunx playwright test` is safe to run
// alongside a normal dev session.
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT || "5183";
// The admin console is a separate Vite app (see admin/). It needs its own
// server here, or specs that drive it silently land on the storefront's
// catch-all 404 instead -- which is exactly what happened to the deposit
// specs after the admin was split out.
const ADMIN_PORT = process.env.E2E_ADMIN_PORT || "5184";
const BACKEND_PORT = process.env.E2E_BACKEND_PORT || "3033";
const SQLITE_FILE = process.env.E2E_SQLITE_FILE || "./e2e/.tmp/e2e.sqlite";

export const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;
export const API_URL = `http://localhost:${BACKEND_PORT}`;

// Both the seeded admin (scripts/seed.js) and the test-only backend secrets
// below -- never real credentials, this stack only ever talks to
// E2E_SQLITE_FILE.
export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@trex.local";
export const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin12345";

// Reset the database HERE rather than in `globalSetup`. This module is
// evaluated before Playwright launches the web servers; globalSetup is not.
// See e2e/seed-database.js for what went wrong when it was the other way.
seedDatabase();

export default defineConfig({
  testDir: "./e2e",
  // Every spec shares one backend process and one sqlite file (WAL, but a
  // single bun:sqlite writer) -- run serially so purchases/deposits/admin
  // approvals from one spec can't interleave with another's.
  fullyParallel: false,
  workers: 1,
  // Playwright's 30s default assumes a fast single-page assertion. Almost
  // nothing here is that: these specs drive real journeys against a Vite dev
  // server that compiles on first request, and several cross two apps on two
  // origins. Measured single page loads reach 28s at 1920px under the load of
  // a full serial run, so 30s was failing tests for being slow rather than
  // wrong -- and it moved between specs from run to run, which is worse than
  // a consistent failure because it reads as flakiness. Specs that legitimately
  // need longer still say so themselves.
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "bun run --hot ../src/index.js",
      url: `${API_URL}/products`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        NODE_ENV: "test",
        PORT: BACKEND_PORT,
        SQLITE_FILE,
        JWT_SECRET: "e2e-test-secret-not-for-production",
        // Both origins: the admin console is a separate app on its own port,
        // so leaving it out makes every admin request fail CORS.
        CORS_ORIGINS: `${BASE_URL},${ADMIN_URL}`,
        FRONTEND_BASE_URL: BASE_URL,
        // Without a proxy there is no x-forwarded-for, so the limiter keys
        // every request in the run to the same "unknown" client. The suite's
        // own ~10 sign-ups and repeated admin logins then eat the real budgets
        // and 429 whichever spec runs last -- which is why specs passed alone
        // and failed together. The limiter itself stays on; only the ceiling
        // moves, and only for this process.
        RATE_LIMIT_MULTIPLIER: "100",
      },
    },
    {
      command: `bun run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_API_BASE_URL: API_URL,
      },
    },
    {
      command: `bun run dev -- --port ${ADMIN_PORT} --strictPort`,
      cwd: new URL("../admin", import.meta.url).pathname,
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_API_BASE_URL: API_URL,
      },
    },
  ],
});
