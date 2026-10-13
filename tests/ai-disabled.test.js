import { describe, test, expect, afterEach } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config.js";
import { settingsService } from "../src/services/settingsService.js";
import { jobsService } from "../src/services/jobsService.js";
import { aiDisabledRoutes } from "../src/routes/aiDisabled.js";
import { db } from "../src/db/index.js";

// The off switch.
//
// The assistant ships disabled and is turned back on with AI_ENABLED. What
// has to hold while it is off is not "the UI is hidden" -- that is a
// consequence -- but that the deployment flag beats everything downstream of
// it, including an operator toggling the setting in the admin console.
//
// The suite itself runs with the feature ON (tests/setup.js), so each test
// here puts the flag back where it found it.

const withAiOff = (fn) => {
  const was = config.aiEnabled;
  config.aiEnabled = false;
  try {
    return fn();
  } finally {
    config.aiEnabled = was;
  }
};

afterEach(() => {
  // Belt and braces: a thrown assertion must not leave the rest of the run
  // with the assistant switched off.
  config.aiEnabled = true;
});

describe("the deployment switch beats the setting", () => {
  test("ai_chat_enabled reads false however the setting is stored", () => {
    // The operator's stored preference is ON here, which is the case that
    // matters: a kill switch an admin can undo from a web form is not a kill
    // switch.
    //
    // Reset afterwards rather than left behind: the whole run shares one
    // in-memory database, and an override row that outlives this test fails
    // the "a fresh database is already configured from coded defaults" case
    // in tests/site-settings.test.js -- which is exactly the kind of
    // cross-file ordering bug that test exists to notice.
    settingsService.update({ ai_chat_enabled: true }, null);
    try {
      expect(settingsService.isEnabled("ai_chat_enabled")).toBe(true);

      withAiOff(() => {
        expect(settingsService.isEnabled("ai_chat_enabled")).toBe(false);
        expect(settingsService.get("ai_chat_enabled")).toBe(false);
        expect(settingsService.all().ai_chat_enabled).toBe(false);
      });
    } finally {
      settingsService.reset("ai_chat_enabled", null);
    }
  });

  test("every browser is told it is off, through the same field it already reads", () => {
    // No new contract: the storefront has always gated on this one key, so
    // turning the deployment switch off hides the UI everywhere at once
    // rather than needing each component to learn a second flag.
    withAiOff(() => {
      expect(settingsService.publicConfig().ai_chat_enabled).toBe(false);
    });
  });

  test("the admin console is told WHY the toggle is inert", () => {
    // Otherwise an operator flips the switch, sees nothing happen, and files
    // a bug against the chat instead of setting AI_ENABLED.
    const row = () => settingsService.adminConfig().find((s) => s.key === "ai_chat_enabled");
    expect(row().env_disabled).toBe(false);
    withAiOff(() => expect(row().env_disabled).toBe(true));
  });

  test("settings that are not the assistant are untouched by it", () => {
    withAiOff(() => {
      expect(settingsService.isEnabled("support_tickets_enabled")).toBe(true);
      expect(settingsService.adminConfig().find((s) => s.key === "show_prices").env_disabled).toBe(false);
    });
  });
});

describe("the routes while it is off", () => {
  test("every /ai path answers 503 with a code a client can act on", async () => {
    // Mounted instead of routes/ai.js, which is never imported in that case.
    // A plain 404 would fall through to the SPA handler and hand a browser
    // HTML where it expected JSON.
    const app = new Hono();
    app.route("/ai", aiDisabledRoutes);

    for (const [method, path] of [
      ["POST", "/ai/chat"],
      ["POST", "/ai/ask"],
      ["POST", "/ai/attachments"],
      ["GET", "/ai/sessions"],
      ["GET", "/ai/quota"],
      ["GET", "/ai/knowledge"],
    ]) {
      const res = await app.request(path, { method });
      expect(`${method} ${path} -> ${res.status}`).toBe(`${method} ${path} -> 503`);
      expect((await res.json()).error.code).toBe("ai_disabled");
    }
  });
});

describe("nothing of it runs in the background", () => {
  test("the proposal sweep is a no-op rather than a query", () => {
    withAiOff(() => expect(jobsService.expireStaleProposals()).toBe(0));
    // And still does its job when the feature is on, so the guard cannot
    // quietly become a permanent off switch.
    expect(typeof jobsService.expireStaleProposals()).toBe("number");
  });

  test("runAll still reports every job, including the skipped one", () => {
    // A job that vanishes from the result is a job nobody notices stopped.
    const result = withAiOff(() => jobsService.runAll({ holdDays: 0 }));
    expect(Object.keys(result)).toContain("expiredProposals");
    expect(result.expiredProposals).toBe(0);
  });
});

describe("the data survives being switched off", () => {
  test("the tables are still there, so turning it back on loses nothing", () => {
    // Deliberately NOT dropped by the migration. Someone's conversation
    // history and the audit trail of what the agent did outlive the feature
    // being paused -- and a migration that dropped them would make this
    // switch a one-way door.
    withAiOff(() => {
      expect(() => db.aiToolCalls.list({ limit: 1 })).not.toThrow();
      expect(() => db.aiSessions.list({ userId: "nobody", limit: 1 })).not.toThrow();
    });
  });
});
