// Central config. Everything overridable via env vars so this can run
// the same way in dev/test/prod with different backing stores/secrets.

function bool(v, fallback) {
  if (v === undefined) return fallback;
  return v === "1" || v === "true";
}

const DEFAULT_JWT_SECRET = "dev-secret-change-me-in-prod";
const isProduction = process.env.NODE_ENV === "production";

// Every JWT is signed with this secret and nothing else authenticates a
// request -- anyone who knows it can forge a valid admin token. Refuse to
// boot in production with the checked-in dev default rather than silently
// running with a publicly-known signing key.
if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET)) {
  throw new Error(
    "Refusing to start: NODE_ENV=production but JWT_SECRET is unset or still the default dev value. " +
      "Set a strong, unique JWT_SECRET before running in production."
  );
}

// Password reset only works end-to-end if the reset link actually reaches
// the user's inbox (see emailService.js / authService.forgotPassword) --
// refuse to boot in production without a real provider key rather than
// silently falling back to a console.log nobody but an operator can see.
if (isProduction && !process.env.RESEND_API_KEY) {
  throw new Error(
    "Refusing to start: NODE_ENV=production but RESEND_API_KEY is unset. " +
      "Set a Resend API key before running in production so password reset emails can actually be delivered."
  );
}

export const config = {
  port: Number(process.env.PORT || 3000),

  // Swappable storage engine. Only "sqlite" is implemented today, but every
  // consumer in this codebase talks to src/db/index.js's `db` object, which
  // is engine-agnostic — adding `mongo` or `leveldb` later means writing a
  // new adapter under src/db/adapters/* with the same method names, nothing
  // else in the app has to change.
  dbEngine: process.env.DB_ENGINE || "sqlite",
  sqliteFile: process.env.SQLITE_FILE || "trex.sqlite",

  // Multiplies every rate-limit budget. Exists for the browser end-to-end
  // suite: `clientIp()` falls back to "unknown" when there is no proxy setting
  // x-forwarded-for, so on localhost every browser context in the run shares a
  // single bucket. The suite legitimately signs up ~10 users and logs the admin
  // in repeatedly, which exhausts a 20-per-hour signup budget partway through
  // and fails whichever spec happens to be running then. Raising the ceiling
  // for that one process is honest; special-casing NODE_ENV=test is not, since
  // the backend tests assert real 429s and must keep the production numbers.
  //
  // Ignored in production so a stray env var can never disarm the limiter.
  rateLimitMultiplier: isProduction ? 1 : Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER || 1)),

  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  jwtExpirySeconds: Number(process.env.JWT_EXPIRY_SECONDS || 60 * 60 * 24 * 7), // 7 days

  // --- Financial defaults (Section 5/6/7 of idea.md) ---
  // All percentages are stored as basis points: 10000 = 100%.
  defaults: {
    payoutPoolPctBp: Number(process.env.DEFAULT_PAYOUT_POOL_PCT_BP || 6500), // 65%
    reservePctBp: Number(process.env.DEFAULT_RESERVE_PCT_BP || 1000), // 10% of trex_net -> dev/reserve fund
    minMarginThresholdCents: Number(process.env.DEFAULT_MIN_MARGIN_CENTS || 100), // $1.00
    maxPayoutDepth: Number(process.env.DEFAULT_MAX_PAYOUT_DEPTH || 6),
    levelRatesBp: [2000, 1200, 800, 500, 300, 200], // sums to 5000bp (50%) <= 6500bp pool, leaves headroom
    activityPeriodDays: Number(process.env.DEFAULT_ACTIVITY_PERIOD_DAYS || 30),
    activityMinPvCents: Number(process.env.DEFAULT_ACTIVITY_MIN_PV_CENTS || 2000),
    decayInactiveDaysThreshold: Number(process.env.DEFAULT_DECAY_INACTIVE_DAYS || 60),
    decayPctPerPeriodBp: Number(process.env.DEFAULT_DECAY_PCT_PER_PERIOD_BP || 1000), // 10% decay per period
    commissionHoldDays: Number(process.env.COMMISSION_HOLD_DAYS || 14),
    // idea.md Section 7 item 4: rank/leadership bonus pool, a % of a
    // period's already-collected trex_net split among nodes hitting
    // rank thresholds. 0 = feature off by default until an admin opts a
    // product's plan in.
    rankBonusPoolPctBp: Number(process.env.DEFAULT_RANK_BONUS_POOL_PCT_BP || 0),
  },

  enableCronJobs: bool(process.env.ENABLE_CRON_JOBS, false),

  // Optional shared key/value store (see src/lib/kv.js). Unset means the
  // in-memory driver, which is correct for a single instance and is what
  // the SQLite engine constrains this deployment to today anyway. Set it
  // when running more than one process, so the rate limiter stops handing
  // out one full allowance per instance.
  redisUrl: process.env.REDIS_URL || null,

  // Where uploaded files land (currently CV attachments from the careers
  // form). Deliberately outside SQLite: a 5MB file per applicant would
  // inflate the database and every VACUUM INTO backup with it. In Docker
  // this should point at the same mounted volume as the database.
  uploadDir: process.env.UPLOAD_DIR || "./data/uploads",

  // Explicit origin allowlist rather than a wide-open "*" -- this is a
  // Bearer-token API (not cookie based), so CORS isn't a CSRF boundary here,
  // but restricting it still keeps random third-party sites from driving
  // this API from a victim's browser. Comma-separated env var; the default
  // covers both dev servers -- the storefront on 5173 and the admin control
  // room on 5174. The admin app is a separate origin, so leaving it out
  // would have every one of its requests fail CORS in development while
  // still passing every test (tests drive Hono in-process, where CORS never
  // applies). Production must set CORS_ORIGINS explicitly for both.
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Used to build the password-reset and email-verification links.
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || "http://localhost:5173",
  // Where the API itself is reachable from outside. Needed because the
  // proforma download link goes in an email: a relative path is useless once
  // it has left the browser that asked for it.
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  // Who gets told that somebody asked for a price. Unset means nobody is
  // emailed and the Proformas queue in the admin console is the only signal --
  // which is a real queue someone watches, not a dropped message.
  salesInboxEmail: process.env.SALES_INBOX_EMAIL || null,
  emailVerificationTtlHours: Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 48),
  passwordResetTokenTtlMinutes: Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30),

  // Transactional email (see emailService.js). No key set = dev/test
  // fallback (log the link instead of sending) -- fine outside production,
  // refused at boot time in production by the guard above.
  resendApiKey: process.env.RESEND_API_KEY || null,
  emailFrom: process.env.EMAIL_FROM || "Trex <no-reply@trex.example.com>",

  // Outbound SMS (see smsService.js). Twilio does not serve Iran, so the
  // supported providers are the domestic ones. No key = log instead of send,
  // mirroring the email fallback.
  smsProvider: process.env.SMS_PROVIDER || null, // 'kavenegar' | 'smsir'
  smsApiKey: process.env.SMS_API_KEY || null,
  smsSender: process.env.SMS_SENDER || null,

  // Used in notification copy so messages identify who is texting you.
  companyName: process.env.COMPANY_NAME || "Ashkan Medical Idea",

  // Instagram Graph API token for the /socials feed. Unset means the feed
  // renders as "not configured" rather than fabricating posts -- there is no
  // key-free way to read an Instagram profile (see services/socialService.js).
  instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || null,

  // --- AI assistant (see src/services/aiService.js) ---
  // The whole feature, as one switch, and it is OFF by default.
  //
  // This is deliberately an env var rather than only the `ai_chat_enabled`
  // setting. The setting says what the operator wants; this says what the
  // deployment will actually run, and it wins. With it off nothing under
  // src/services/ai*/agent* is even imported: `/ai/*` answers 503 from a stub
  // router and the storefront never downloads the chat bundle.
  //
  // To turn the assistant back on: set AI_ENABLED=true (and keep the
  // `ai_chat_enabled` setting on, which is its default).
  aiEnabled: bool(process.env.AI_ENABLED, false),
  // Server-side only. This key must never be exposed to a browser: it is read
  // here, in a Bun process, and every model call is proxied through /ai/*.
  // There is deliberately no VITE_ prefixed equivalent anywhere in the
  // frontend -- Vite inlines any VITE_* var into the client bundle, so one
  // would ship the key to every visitor. tests/ai-assistant.test.js asserts
  // the string never appears in a built client bundle.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || null,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  // Caps a single answer. Long enough for a real product explanation, short
  // enough that a runaway generation can't bill unbounded tokens.
  aiMaxTokens: Number(process.env.AI_MAX_TOKENS || 700),
  // Rolling window kept per session, in *messages* (user+assistant). The
  // retrieved context is rebuilt per turn, so history only needs to carry
  // enough for follow-ups like "and how much is that one?".
  aiHistoryTurns: Number(process.env.AI_HISTORY_TURNS || 8),
  aiSessionTtlMs: Number(process.env.AI_SESSION_TTL_MS || 1000 * 60 * 60 * 2), // 2h

  // How many assistant messages a signed-in customer may send per calendar
  // day. The env var is the deployment default; an operator can override it
  // live through the `ai_daily_prompt_limit` setting without a restart.
  aiDailyPromptLimit: Number(process.env.AI_DAILY_PROMPT_LIMIT || 20),
  // Which calendar the "day" belongs to. Left at UTC by default because that
  // is the only safe guess, but a deployment serving Iranian clinics should
  // set Asia/Tehran -- otherwise everyone's allowance resets at 03:30 in the
  // afternoon, which reads as the quota randomly refilling.
  aiQuotaTimezone: process.env.AI_QUOTA_TIMEZONE || "UTC",
  // The anonymous teaser. Small and hourly rather than daily: it exists to
  // show a visitor what the assistant does, not to serve them indefinitely.
  aiAnonHourlyLimit: Number(process.env.AI_ANON_HOURLY_LIMIT || 5),
  // Exa is metered per request, and a model given a search tool will happily
  // use it four times a turn. This is the ceiling per customer per day.
  aiWebSearchDailyMax: Number(process.env.AI_WEB_SEARCH_DAILY_MAX || 40),

  // --- attachments the visitor sends the assistant ---
  // The cap is on the DECODED bytes, which is what actually reaches the
  // model; a base64 data URL is about a third larger on the wire.
  aiMaxAttachmentBytes: Number(process.env.AI_MAX_ATTACHMENT_BYTES || 5_000_000),
  aiMaxAttachmentsPerMessage: Number(process.env.AI_MAX_ATTACHMENTS_PER_MESSAGE || 4),
  // How many turns back an image is re-sent in full. Each one costs 1-2k
  // tokens every turn it stays in the array, so an old photo degrades to a
  // one-line mention and comes back only if `view_attachment` asks for it.
  aiAttachmentHistoryTurns: Number(process.env.AI_ATTACHMENT_HISTORY_TURNS || 2),

  // --- Exa web search ---
  // An ARRAY of keys, rotated on failure: one key hitting its rate limit or
  // being revoked should degrade to the next rather than taking web search
  // down. Both names are accepted so a single-key deployment does not need to
  // learn the plural one.
  exaApiKeys: [
    ...String(process.env.EXA_API_KEYS || "").split(","),
    String(process.env.EXA_API_KEY || ""),
  ]
    .map((k) => k.trim())
    .filter(Boolean),
  exaBaseUrl: process.env.EXA_BASE_URL || "https://api.exa.ai",

  // Live-read, unlike the `isProduction` const above (captured once at
  // module load, and only ever used for the boot guard). authService needs
  // to branch on this per-request, and tests need to be able to flip
  // NODE_ENV at runtime and see that branch actually change.
  isProduction: () => process.env.NODE_ENV === "production",
};
