// Runs before any test file is loaded (see bunfig.toml [test] preload).
// Forces the whole test run onto a single in-memory SQLite instance so
// tests never touch (or leave behind) a file on disk. config.js reads
// these at first import, so this only works because it's a *preload*,
// evaluated before any test file gets a chance to import config/db.
process.env.SQLITE_FILE = ":memory:";
process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
process.env.DB_ENGINE = "sqlite";

// The assistant ships SWITCHED OFF (config.aiEnabled, AI_ENABLED). The suite
// turns it on for itself, because its job is to test the feature -- a suite
// that silently skipped eight files whenever the deployment flag was off
// would be worse than no suite at all. The "what happens when it is off"
// cases set the flag back themselves; see tests/ai-disabled.test.js.
process.env.AI_ENABLED = "true";

// Bun loads `.env` automatically, which means a developer with a real
// DEEPSEEK_API_KEY on disk would have the test suite make live, billed calls
// to the model provider -- silently, and slowly. This was not hypothetical:
// one prompt-sanitising test started taking three seconds because it had
// begun genuinely calling DeepSeek.
//
// Cleared here rather than stubbed, because "unconfigured" is a state the
// service already handles explicitly and asserts on.
delete process.env.DEEPSEEK_API_KEY;

// Same reasoning for every other outbound provider. A test run must never be
// able to send a real email, a real SMS, or hit a third-party API.
delete process.env.RESEND_API_KEY;
delete process.env.SMS_API_KEY;
delete process.env.INSTAGRAM_ACCESS_TOKEN;
