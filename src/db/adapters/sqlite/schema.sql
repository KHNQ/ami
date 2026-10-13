-- Trex platform schema (SQLite adapter).
-- All money columns are integer minor units (cents). All percentage/rate
-- columns are integer basis points (10000 = 100%). See idea.md Section 5
-- Invariant 6 (rounding) and the "currency/decimal precision" edge case.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  -- Bumped whenever credentials change. Tokens carry the value they were
  -- minted with, so every session issued before a password change/reset
  -- stops verifying (see requireAuth / lib/auth.js).
  token_version   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Password reset flow. Stores only a hash of the raw token (a DB leak
-- shouldn't hand out usable tokens). `status` distinguishes 'used' (this
-- exact token completed a reset) from 'revoked' (invalidated because a
-- newer request superseded it) -- an audit-trail distinction, not just a
-- boolean.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','revoked')),
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id),
  balance_cents   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Append-only ledger. balance_cents on wallet_accounts is a cache; this
-- table is the source of truth (mirrors WarehouseCostHistory's role for x).
CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  type            TEXT NOT NULL CHECK (type IN (
                    'deposit','withdraw','purchase','commission_release',
                    'refund','commission_clawback','withdraw_reject_refund','adjustment'
                  )),
  amount_cents    INTEGER NOT NULL, -- signed: positive credits, negative debits
  balance_after   INTEGER NOT NULL,
  ref_type        TEXT,             -- 'transaction' | 'deposit_request' | 'withdraw_request' | 'ledger_entry'
  ref_id          TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger_entries(user_id);

-- deposit_requests and withdraw_requests are a read-only archive. The
-- wallet top-up and withdrawal flows (routes, services, admin screens) were
-- removed, but the rows are financial history -- see systemAudit -- so the
-- tables stay. Nothing writes to them any more.
CREATE TABLE IF NOT EXISTS deposit_requests (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL,
  method          TEXT NOT NULL DEFAULT 'manual',
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','rejected')),
  created_at      TEXT NOT NULL,
  processed_at    TEXT
);

CREATE TABLE IF NOT EXISTS withdraw_requests (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  admin_note      TEXT,
  created_at      TEXT NOT NULL,
  processed_at    TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT,
  specs_json            TEXT NOT NULL DEFAULT '{}',
  stock_count           INTEGER NOT NULL DEFAULT 0,
  current_x_cents       INTEGER NOT NULL,
  list_price_y_cents    INTEGER NOT NULL,
  commission_plan_id    TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','discontinued')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouse_cost_history (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  x_cents         INTEGER NOT NULL,
  effective_from  TEXT NOT NULL,
  created_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_wch_product ON warehouse_cost_history(product_id);

CREATE TABLE IF NOT EXISTS commission_plans (
  id                          TEXT PRIMARY KEY,
  product_id                  TEXT NOT NULL UNIQUE REFERENCES products(id),
  min_margin_threshold_cents  INTEGER NOT NULL,
  payout_pool_pct_bp          INTEGER NOT NULL,     -- P_max, e.g. 6500 = 65%
  level_rates_bp_json         TEXT NOT NULL,         -- JSON array, index0 = level1
  max_payout_depth            INTEGER NOT NULL,
  activity_min_pv_cents       INTEGER NOT NULL,
  activity_period_days        INTEGER NOT NULL,
  decay_inactive_days         INTEGER NOT NULL,
  decay_pct_per_period_bp     INTEGER NOT NULL,
  reserve_pct_bp              INTEGER NOT NULL,      -- % of trex_net routed to dev/reserve fund
  compression_enabled         INTEGER NOT NULL DEFAULT 0,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spaces (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  root_user_id    TEXT NOT NULL REFERENCES users(id),
  root_node_id    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spaces_product ON spaces(product_id);

CREATE TABLE IF NOT EXISTS nodes (
  id                          TEXT PRIMARY KEY,
  space_id                    TEXT NOT NULL REFERENCES spaces(id),
  product_id                  TEXT NOT NULL REFERENCES products(id),
  user_id                     TEXT NOT NULL REFERENCES users(id),
  parent_node_id              TEXT REFERENCES nodes(id),
  own_redeem_code_id          TEXT,
  personal_volume_period_cents INTEGER NOT NULL DEFAULT 0,
  lifetime_volume_cents        INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  last_active_at              TEXT NOT NULL,
  last_period_reset_at        TEXT NOT NULL,
  joined_at                   TEXT NOT NULL,
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_nodes_space ON nodes(space_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_user ON nodes(user_id);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  owner_node_id   TEXT NOT NULL REFERENCES nodes(id),
  product_id      TEXT NOT NULL REFERENCES products(id),
  space_id        TEXT NOT NULL REFERENCES spaces(id),
  max_uses        INTEGER,          -- null = unlimited
  uses_count      INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_owner ON redeem_codes(owner_node_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                      TEXT PRIMARY KEY,
  product_id              TEXT NOT NULL REFERENCES products(id),
  space_id                TEXT NOT NULL REFERENCES spaces(id),
  buyer_node_id           TEXT NOT NULL REFERENCES nodes(id),
  buyer_user_id           TEXT NOT NULL REFERENCES users(id),
  redeem_code_id          TEXT,
  x_at_sale_cents         INTEGER NOT NULL,
  y_at_sale_cents         INTEGER NOT NULL,
  discount_cents          INTEGER NOT NULL DEFAULT 0,
  margin_cents            INTEGER NOT NULL,
  payout_pool_amount_cents INTEGER NOT NULL,
  total_payout_cents      INTEGER NOT NULL,
  reserve_amount_cents    INTEGER NOT NULL,
  trex_net_amount_cents   INTEGER NOT NULL,
  refunded_amount_cents   INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','refunded','partially_refunded')),
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_space ON transactions(space_id);
CREATE INDEX IF NOT EXISTS idx_tx_product ON transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_tx_buyer ON transactions(buyer_node_id);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);

CREATE TABLE IF NOT EXISTS commission_ledger_entries (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id),
  node_id         TEXT NOT NULL REFERENCES nodes(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  level_depth     INTEGER NOT NULL,
  rate_applied_bp INTEGER NOT NULL,
  amount_cents    INTEGER NOT NULL,
  clawed_back_cents INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','clawed_back','partially_clawed_back')),
  paid_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cle_tx ON commission_ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_cle_node ON commission_ledger_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_cle_status ON commission_ledger_entries(status);

-- idea.md Section 7 item 4: rank/leadership bonus pool. Scoped per-product
-- (like commission_plans) because "team volume" is only meaningful within
-- one tree (one Space per product per root) -- it's computed by walking
-- parent_node_id, which never crosses products/spaces.
CREATE TABLE IF NOT EXISTS rank_tiers (
  id                              TEXT PRIMARY KEY,
  product_id                      TEXT NOT NULL REFERENCES products(id),
  rank_order                      INTEGER NOT NULL, -- higher = better rank
  name                            TEXT NOT NULL,
  team_volume_threshold_cents     INTEGER NOT NULL,
  personal_volume_threshold_cents INTEGER NOT NULL,
  pool_share_bp                   INTEGER NOT NULL, -- this tier's slice of a period's pool
  status                          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL,
  UNIQUE (product_id, rank_order)
);
CREATE INDEX IF NOT EXISTS idx_rank_tiers_product ON rank_tiers(product_id);

-- One funded pool per product per period. `pool_amount_cents` is a fixed
-- cap computed once (mirrors transactions.payout_pool_amount_cents) -- every
-- rank_bonus_ledger_entries row for this period only ever subtracts from it.
CREATE TABLE IF NOT EXISTS rank_bonus_periods (
  id                    TEXT PRIMARY KEY,
  product_id            TEXT NOT NULL REFERENCES products(id),
  period_start          TEXT NOT NULL,
  period_end            TEXT NOT NULL,
  trex_net_base_cents   INTEGER NOT NULL,
  funded_pct_bp         INTEGER NOT NULL,
  pool_amount_cents     INTEGER NOT NULL,
  distributed_cents     INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'funded' CHECK (status IN ('funded','distributed','closed')),
  created_at            TEXT NOT NULL,
  UNIQUE (product_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_rbp_product ON rank_bonus_periods(product_id);

CREATE TABLE IF NOT EXISTS rank_bonus_ledger_entries (
  id                    TEXT PRIMARY KEY,
  period_id             TEXT NOT NULL REFERENCES rank_bonus_periods(id),
  node_id               TEXT NOT NULL REFERENCES nodes(id),
  user_id               TEXT NOT NULL REFERENCES users(id),
  rank_tier_id          TEXT NOT NULL REFERENCES rank_tiers(id),
  team_volume_cents     INTEGER NOT NULL,
  personal_volume_cents INTEGER NOT NULL,
  amount_cents          INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','clawed_back')),
  paid_at               TEXT,
  created_at            TEXT NOT NULL,
  UNIQUE (period_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_rble_period ON rank_bonus_ledger_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_rble_node ON rank_bonus_ledger_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_rble_status ON rank_bonus_ledger_entries(status);

-- Quota/tier progression mode (idea.md Section 7, admin-toggleable per
-- product via commission_plans.payout_mode). When a plan's payout_mode is
-- 'quota', a purchase's per-ancestor direct/indirect margin share -- the
-- same amount that would otherwise become a pending wallet payout -- is
-- redirected into the ancestor's progress toward their next tier instead of
-- being credited to their wallet. Tiers are ordered (Blue < Silver < Gold <
-- Platinum < Diamond by convention, but names/order/targets are fully
-- admin-configurable per product). Completing a tier pays a one-time cash
-- bonus immediately (not subject to the commission hold window) and
-- permanently raises the node's effective commission rate on this product
-- via unlocked_rate_bonus_bp -- that bonus applies in BOTH quota and wallet
-- mode going forward, so it isn't wasted once a node maxes out its tiers.
CREATE TABLE IF NOT EXISTS quota_tiers (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES products(id),
  tier_order          INTEGER NOT NULL, -- 1=Blue,2=Silver,3=Gold,4=Platinum,5=Diamond by convention
  name                TEXT NOT NULL,
  quota_target_cents  INTEGER NOT NULL,
  cash_bonus_cents    INTEGER NOT NULL DEFAULT 0,
  rate_bonus_bp       INTEGER NOT NULL DEFAULT 0,
  perks_json          TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (product_id, tier_order)
);
CREATE INDEX IF NOT EXISTS idx_quota_tiers_product ON quota_tiers(product_id);

-- One row per node per product: current progress toward the next tier.
-- completed_tier_order is the highest tier_order fully completed (0 = none
-- yet); accumulated_cents is progress banked toward tier_order+1.
CREATE TABLE IF NOT EXISTS node_quota_state (
  id                      TEXT PRIMARY KEY,
  node_id                 TEXT NOT NULL REFERENCES nodes(id),
  product_id              TEXT NOT NULL REFERENCES products(id),
  completed_tier_order    INTEGER NOT NULL DEFAULT 0,
  accumulated_cents       INTEGER NOT NULL DEFAULT 0,
  unlocked_rate_bonus_bp  INTEGER NOT NULL DEFAULT 0,
  updated_at              TEXT NOT NULL,
  UNIQUE (node_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_nqs_node ON node_quota_state(node_id);

-- Append-only history of tier completions, independent of node_quota_state
-- (which only holds current progress) -- this is what a node's "quota
-- bonuses" history view reads from.
CREATE TABLE IF NOT EXISTS quota_tier_completions (
  id                TEXT PRIMARY KEY,
  node_id           TEXT NOT NULL REFERENCES nodes(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  product_id        TEXT NOT NULL REFERENCES products(id),
  quota_tier_id     TEXT NOT NULL REFERENCES quota_tiers(id),
  tier_order        INTEGER NOT NULL,
  cash_bonus_cents  INTEGER NOT NULL,
  rate_bonus_bp     INTEGER NOT NULL,
  completed_at      TEXT NOT NULL,
  UNIQUE (node_id, quota_tier_id)
);
CREATE INDEX IF NOT EXISTS idx_qtc_node ON quota_tier_completions(node_id);

-- Global dev/reserve fund. Section: "reserve some profit money ... for
-- reserve/dev". Funded only out of trex_net (post-commission), per
-- transaction, never out of margin directly (keeps Invariant 3 intact).
CREATE TABLE IF NOT EXISTS reserve_fund (
  id              TEXT PRIMARY KEY DEFAULT 'singleton',
  balance_cents   INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reserve_ledger_entries (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('credit','debit')),
  amount_cents    INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  transaction_id  TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL
);

-- Support / contact intake. One row per request: who is asking, how to reach
-- them, and what they need. Not a conversation -- admins follow up using the
-- contact details, and track progress with `status` and `admin_note`.
-- (Replaces support_tickets, support_messages and contact_leads; see
-- migration 022.) `user_id` is set when the person was signed in.
CREATE TABLE IF NOT EXISTS support_requests (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id),
  name            TEXT NOT NULL,
  contact         TEXT NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','closed')),
  admin_note      TEXT,
  handled_by      TEXT REFERENCES users(id),
  ip              TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id              TEXT PRIMARY KEY,
  actor_user_id   TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  meta_json       TEXT NOT NULL DEFAULT '{}',
  ip              TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);

-- Runtime, admin-editable site configuration. Everything else in this app is
-- configured either by env var (src/config.js, needs a redeploy) or per-product
-- (commission_plans). This table is for switches an operator flips while the
-- service is running: turning off online purchasing when the sales team wants
-- walk-ins only, hiding prices, disabling wallet top-ups, and the contact
-- details rendered in the storefront footer.
--
-- Values are always JSON-encoded so booleans, numbers, strings and objects all
-- round-trip through one column. The authoritative list of keys, their types,
-- defaults and whether they are safe to expose publicly lives in code
-- (src/services/settingsService.js) -- a row here is an *override*, and its
-- absence means "use the coded default". That way a fresh database is already
-- correctly configured and no seeding step can be forgotten.
CREATE TABLE IF NOT EXISTS site_settings (
  key             TEXT PRIMARY KEY,
  value_json      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT REFERENCES users(id)
);

-- Outbound notifications (email and SMS), queued rather than sent inline.
--
-- Queued because the things that generate them run inside db.transaction(),
-- which bun:sqlite requires to be synchronous -- an inline `await fetch` to a
-- mail or SMS provider is impossible there, and doing it after the commit
-- would mean a crash between the two loses the message with nothing to
-- replay from. A row here is the durable record; a job drains it.
--
-- `dedupe_key` is the idempotency guarantee. Reminder jobs are re-run (by
-- cron, by an admin, after a deploy), and a customer who gets texted three
-- times about the same cheque will not trust the next message. A UNIQUE
-- index means the second insert is refused by the database rather than by
-- application logic that might one day be refactored away.
CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id),
  channel         TEXT NOT NULL CHECK (channel IN ('email','sms')),
  recipient       TEXT NOT NULL,
  template        TEXT NOT NULL,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  dedupe_key      TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','cancelled')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  scheduled_for   TEXT,
  sent_at         TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

-- Post-dated cheques backing an instalment ("leasing") order.
--
-- Deliberately a record-keeping ledger, NOT an input to the commission
-- engine. A manual order books its full margin at signing exactly like a web
-- sale (see the note in purchaseService.placeOrder); these rows track what
-- the customer has promised to pay and when, so the office can chase them and
-- so reminders can go out. Marking one 'cleared' records reality; it does not
-- move money or trigger a payout.
--
-- Cheque images live here as BLOBs rather than as base64 inside a JSON column
-- (the way product images do). A cheque carries a bank account number: it is
-- served only to the owner and to staff holding cheques.read, never publicly
-- and never cached.
CREATE TABLE IF NOT EXISTS lease_cheques (
  id                    TEXT PRIMARY KEY,
  transaction_id        TEXT NOT NULL REFERENCES transactions(id),
  user_id               TEXT NOT NULL REFERENCES users(id),
  sequence_no           INTEGER NOT NULL,
  cheque_number         TEXT,
  bank_name             TEXT,
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  due_date              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','cleared','bounced','cancelled')),
  image_mime            TEXT,
  image_bytes           BLOB,
  note                  TEXT,
  recorded_by_admin_id  TEXT REFERENCES users(id),
  cleared_at            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (transaction_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_cheques_tx ON lease_cheques(transaction_id);
CREATE INDEX IF NOT EXISTS idx_cheques_user ON lease_cheques(user_id);
CREATE INDEX IF NOT EXISTS idx_cheques_due ON lease_cheques(status, due_date);

-- Job applications from the careers page.
--
-- Résumé files are written to disk (config.uploadDir) with only a pointer
-- stored here, rather than as BLOBs. A cheque scan is ~100KB and is read
-- constantly by the people chasing payment; a CV is up to 5MB and is read
-- once. Putting them in SQLite would inflate the database -- and therefore
-- every VACUUM INTO backup -- by hundreds of megabytes of files nobody
-- queries.
CREATE TABLE IF NOT EXISTS job_applications (
  id                  TEXT PRIMARY KEY,
  field_of_work       TEXT NOT NULL,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT,
  date_of_birth       TEXT,
  gender              TEXT,
  education_level     TEXT,
  field_of_study      TEXT,
  place_of_education  TEXT,
  company_name        TEXT,
  job_title           TEXT,
  start_date          TEXT,
  end_date            TEXT,
  additional_info     TEXT,
  resume_path         TEXT,
  resume_filename     TEXT,
  resume_bytes        INTEGER,
  status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','reviewing','interviewed','rejected','hired')),
  admin_note          TEXT,
  handled_by          TEXT REFERENCES users(id),
  ip                  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON job_applications(status, created_at);

-- ---------------------------------------------------------------------------
-- Storefront sales
--
-- Everything the public storefront can start -- a proforma, a 1% reservation,
-- a lease application, a rent-to-own, a consumables subscription, a referral,
-- a trade-in -- lands in these tables. Before them the storefront's flows all
-- collapsed into contact_leads with a `source` string, which meant a €55,000
-- lease application and a newsletter signup were the same row shape and
-- neither could be tracked to completion.
--
-- Two levels on purpose:
--
--   sales_quotes       an ASK. Someone wants a price, a unit held, or terms.
--                      Has a reference, a subject, a locked rate, and an
--                      outcome. Short-lived: it is accepted, declined or it
--                      expires.
--
--   sales_agreements   a COMMITMENT that then runs for months or years --
--                      a lease, a rental, a subscription. Has a schedule
--                      (sales_instalments) the office chases.
--
-- Amounts are integer minor units (cents) throughout, matching the rest of
-- the app -- see lib/money. `currency` is stored per row because the
-- storefront quotes in EUR while the commerce app settles in the wallet's
-- own currency, and a single implicit currency is how those get silently
-- mixed.

CREATE TABLE IF NOT EXISTS sales_quotes (
  id                  TEXT PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,
  kind                TEXT NOT NULL
                        CHECK (kind IN ('proforma','enquiry','reservation','lease',
                                        'rental','subscription','demo','trade_in','lead_program')),
  -- The catalogue product, when the subject is something we list. NULL for a
  -- machine printed in the brochure that has no product row -- the name then
  -- carries it, which is the whole point of an enquiry.
  product_id          TEXT REFERENCES products(id),
  subject             TEXT NOT NULL,
  -- Who asked. user_id is set when they were signed in; the contact columns
  -- are always filled, because most storefront visitors are not.
  user_id             TEXT REFERENCES users(id),
  contact_name        TEXT NOT NULL,
  contact_phone       TEXT,
  contact_email       TEXT,
  clinic_city         TEXT,
  specialty           TEXT,
  timeline            TEXT,
  financing           TEXT,
  -- What was quoted. amount_cents is the headline; deposit_cents is what the
  -- customer pays now on a reservation.
  currency            TEXT NOT NULL DEFAULT 'EUR',
  amount_cents        INTEGER,
  deposit_cents       INTEGER,
  bundle              TEXT,
  -- The Rial lock. rate is minor-units-per-unit-currency at issue, so the
  -- figure on the printed proforma can always be reproduced.
  locked_rate         REAL,
  locked_until        TEXT,
  status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','contacted','quoted','accepted','declined','expired','converted')),
  source              TEXT NOT NULL DEFAULT 'storefront',
  notes               TEXT,
  admin_note          TEXT,
  handled_by          TEXT REFERENCES users(id),
  ip                  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_status ON sales_quotes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_kind ON sales_quotes(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_user ON sales_quotes(user_id, created_at);

CREATE TABLE IF NOT EXISTS sales_agreements (
  id                  TEXT PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,
  quote_id            TEXT REFERENCES sales_quotes(id),
  kind                TEXT NOT NULL CHECK (kind IN ('lease','rental','subscription')),
  product_id          TEXT REFERENCES products(id),
  subject             TEXT NOT NULL,
  user_id             TEXT REFERENCES users(id),
  contact_name        TEXT NOT NULL,
  contact_phone       TEXT,
  contact_email       TEXT,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  -- Lease/rental: the financed principal and the agreed instalment.
  principal_cents     INTEGER,
  deposit_cents       INTEGER,
  instalment_cents    INTEGER,
  term_months         INTEGER,
  apr_bp              INTEGER,
  -- Subscription: how often, and what it ships.
  interval_days       INTEGER,
  item                TEXT,
  -- Rent-to-own transfers title at the end of the term; a plain rental does
  -- not. Stored rather than inferred so changing the product rule later
  -- cannot rewrite what an existing customer was sold.
  transfers_ownership INTEGER NOT NULL DEFAULT 0,
  starts_on           TEXT,
  ends_on             TEXT,
  next_due_on         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','paused','completed','cancelled','defaulted')),
  admin_note          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_agreements_status ON sales_agreements(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_agreements_kind ON sales_agreements(kind, status);
CREATE INDEX IF NOT EXISTS idx_sales_agreements_user ON sales_agreements(user_id, created_at);

-- The schedule behind an agreement: lease instalments, rental months,
-- subscription deliveries. One row per expected event, created up front so
-- "what is owed and when" is a query rather than a calculation repeated in
-- three places.
CREATE TABLE IF NOT EXISTS sales_instalments (
  id                  TEXT PRIMARY KEY,
  agreement_id        TEXT NOT NULL REFERENCES sales_agreements(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL,
  due_on              TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  status              TEXT NOT NULL DEFAULT 'due'
                        CHECK (status IN ('due','paid','late','waived','cancelled')),
  paid_at             TEXT,
  note                TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (agreement_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_sales_instalments_due ON sales_instalments(status, due_on);

-- Single-tier physician referral. Deliberately NOT part of the MLM network
-- tables: there is no tree here, no downline and no recursion -- one doctor
-- names one clinic, once, and earns credit if that clinic buys.
CREATE TABLE IF NOT EXISTS sales_referrals (
  id                  TEXT PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,
  referrer_user_id    TEXT REFERENCES users(id),
  referrer_name       TEXT NOT NULL,
  referrer_contact    TEXT,
  referred_clinic     TEXT NOT NULL,
  referred_city       TEXT,
  referred_contact    TEXT,
  quote_id            TEXT REFERENCES sales_quotes(id),
  rebate_bp           INTEGER NOT NULL DEFAULT 200,
  credit_cents        INTEGER,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','attributed','credited','rejected')),
  admin_note          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_status ON sales_referrals(status, created_at);
