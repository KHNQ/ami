// schema.sql only ever grows via idempotent `CREATE TABLE IF NOT EXISTS` /
// `CREATE INDEX IF NOT EXISTS`, which is safe to re-run on every boot. That
// trick doesn't work for altering an EXISTING table (adding a column,
// changing a CHECK constraint) -- SQLite has no `ADD COLUMN IF NOT EXISTS`,
// and a second `ALTER TABLE ... ADD COLUMN` against an already-migrated DB
// throws "duplicate column name". This module tracks which of those
// non-idempotent alterations have already been applied, so `runMigrations`
// can stay safe to run on every boot against a DB that already has them.

import { slugify } from "../../../lib/slug.js";

const migrations = [
  {
    id: "002_commission_plans_rank_bonus_pool_pct_bp",
    run(db) {
      const cols = db.query("PRAGMA table_info(commission_plans)").all();
      const hasColumn = cols.some((c) => c.name === "rank_bonus_pool_pct_bp");
      if (!hasColumn) {
        db.exec("ALTER TABLE commission_plans ADD COLUMN rank_bonus_pool_pct_bp INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    // SQLite can't ALTER a CHECK constraint in place -- rebuild the table
    // under the standard "12-step" procedure (create new, copy, drop old,
    // rename) to add 'rank_bonus_release' to the allowed wallet ledger types.
    id: "003_wallet_ledger_rank_bonus_release_type",
    run(db) {
      const tableSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallet_ledger_entries'").get();
      if (tableSql && tableSql.sql.includes("rank_bonus_release")) return;

      db.exec(`
        CREATE TABLE wallet_ledger_entries_new (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id),
          type            TEXT NOT NULL CHECK (type IN (
                            'deposit','withdraw','purchase','commission_release',
                            'refund','commission_clawback','withdraw_reject_refund',
                            'adjustment','rank_bonus_release'
                          )),
          amount_cents    INTEGER NOT NULL,
          balance_after   INTEGER NOT NULL,
          ref_type        TEXT,
          ref_id          TEXT,
          note            TEXT,
          created_at      TEXT NOT NULL
        );
        INSERT INTO wallet_ledger_entries_new SELECT * FROM wallet_ledger_entries;
        DROP TABLE wallet_ledger_entries;
        ALTER TABLE wallet_ledger_entries_new RENAME TO wallet_ledger_entries;
        CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger_entries(user_id);
      `);
    },
  },
  {
    // Deposits move from instant-credit to admin-approved (mirroring
    // withdraw_requests, which already has admin_note) -- give rejected/
    // approved deposits somewhere to record why.
    id: "004_deposit_requests_admin_note",
    run(db) {
      const cols = db.query("PRAGMA table_info(deposit_requests)").all();
      const hasColumn = cols.some((c) => c.name === "admin_note");
      if (!hasColumn) {
        db.exec("ALTER TABLE deposit_requests ADD COLUMN admin_note TEXT");
      }
    },
  },
  {
    // Quota/tier progression mode toggle, per product.
    id: "005_commission_plans_payout_mode",
    run(db) {
      const cols = db.query("PRAGMA table_info(commission_plans)").all();
      const hasColumn = cols.some((c) => c.name === "payout_mode");
      if (!hasColumn) {
        db.exec(
          "ALTER TABLE commission_plans ADD COLUMN payout_mode TEXT NOT NULL DEFAULT 'wallet' CHECK (payout_mode IN ('wallet','quota'))"
        );
      }
    },
  },
  {
    // Rebuild (SQLite can't ALTER a CHECK in place) to add the 'quota_applied'
    // status -- a commission share that was redirected into tier progress
    // instead of becoming a pending wallet payout. Never picked up by
    // releaseMaturedCommissions (which only queries status='pending').
    id: "006_commission_ledger_quota_applied_status",
    run(db) {
      const tableSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='commission_ledger_entries'").get();
      if (tableSql && tableSql.sql.includes("quota_applied")) return;

      db.exec(`
        CREATE TABLE commission_ledger_entries_new (
          id              TEXT PRIMARY KEY,
          transaction_id  TEXT NOT NULL REFERENCES transactions(id),
          node_id         TEXT NOT NULL REFERENCES nodes(id),
          user_id         TEXT NOT NULL REFERENCES users(id),
          level_depth     INTEGER NOT NULL,
          rate_applied_bp INTEGER NOT NULL,
          amount_cents    INTEGER NOT NULL,
          clawed_back_cents INTEGER NOT NULL DEFAULT 0,
          status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','clawed_back','partially_clawed_back','quota_applied')),
          paid_at         TEXT,
          created_at      TEXT NOT NULL
        );
        INSERT INTO commission_ledger_entries_new SELECT * FROM commission_ledger_entries;
        DROP TABLE commission_ledger_entries;
        ALTER TABLE commission_ledger_entries_new RENAME TO commission_ledger_entries;
        CREATE INDEX IF NOT EXISTS idx_cle_tx ON commission_ledger_entries(transaction_id);
        CREATE INDEX IF NOT EXISTS idx_cle_node ON commission_ledger_entries(node_id);
        CREATE INDEX IF NOT EXISTS idx_cle_status ON commission_ledger_entries(status);
      `);
    },
  },
  {
    // Rebuild to add 'quota_tier_bonus' -- the one-time cash bonus paid when
    // a node completes a quota tier.
    id: "007_wallet_ledger_quota_tier_bonus_type",
    run(db) {
      const tableSql = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallet_ledger_entries'").get();
      if (tableSql && tableSql.sql.includes("quota_tier_bonus")) return;

      db.exec(`
        CREATE TABLE wallet_ledger_entries_new (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id),
          type            TEXT NOT NULL CHECK (type IN (
                            'deposit','withdraw','purchase','commission_release',
                            'refund','commission_clawback','withdraw_reject_refund',
                            'adjustment','rank_bonus_release','quota_tier_bonus'
                          )),
          amount_cents    INTEGER NOT NULL,
          balance_after   INTEGER NOT NULL,
          ref_type        TEXT,
          ref_id          TEXT,
          note            TEXT,
          created_at      TEXT NOT NULL
        );
        INSERT INTO wallet_ledger_entries_new SELECT * FROM wallet_ledger_entries;
        DROP TABLE wallet_ledger_entries;
        ALTER TABLE wallet_ledger_entries_new RENAME TO wallet_ledger_entries;
        CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger_entries(user_id);
      `);
    },
  },
  {
    // Self-service account deletion (authService.deleteAccount) is a soft
    // delete: status flips to 'banned' (blocks login via the existing
    // status check, no CHECK constraint change needed) and this timestamp
    // records that it was the user's own request, not an admin ban.
    id: "008_users_deleted_at",
    run(db) {
      const cols = db.query("PRAGMA table_info(users)").all();
      const hasColumn = cols.some((c) => c.name === "deleted_at");
      if (!hasColumn) {
        db.exec("ALTER TABLE users ADD COLUMN deleted_at TEXT");
      }
    },
  },
  {
    // Lets a password change/reset invalidate every session issued before
    // it. Bearer JWTs are stateless, so without a value on the user row to
    // compare against, a stolen token stayed valid for its full 7-day life
    // even after the victim changed their password -- which is precisely
    // the attack password reset exists to stop. Bumped on every credential
    // change; the value is carried in the token as `tv` and checked by
    // requireAuth.
    id: "009_users_token_version",
    run(db) {
      const cols = db.query("PRAGMA table_info(users)").all();
      if (!cols.some((c) => c.name === "token_version")) {
        db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    // Granular staff roles, layered on top of the existing binary
    // users.role rather than widening its CHECK constraint.
    //
    // Widening the CHECK would mean rebuilding `users` under the 12-step
    // procedure, and that is genuinely unsafe here: this connection runs
    // with PRAGMA foreign_keys = ON (connection.js) and `users` is the
    // parent of a dozen foreign keys, so DROP TABLE performs an implicit
    // DELETE FROM and fails -- or worse, succeeds -- against real data.
    // The documented workaround is to toggle PRAGMA foreign_keys = OFF
    // first, but that pragma is a silent no-op inside a transaction, which
    // is exactly where runExtraMigrations executes every migration. The
    // rebuild would therefore run with FK enforcement still on regardless.
    //
    // So: `role` keeps its meaning ("is this account staff at all?") and
    // `staff_role` refines it. Every existing admin is backfilled to 'root',
    // which makes this migration authorization-preserving by construction --
    // nobody silently loses or gains access when it runs.
    id: "010_users_staff_role",
    run(db) {
      const cols = db.query("PRAGMA table_info(users)").all();
      if (!cols.some((c) => c.name === "staff_role")) {
        db.exec("ALTER TABLE users ADD COLUMN staff_role TEXT");
      }
      db.exec("UPDATE users SET staff_role = 'root' WHERE role = 'admin' AND staff_role IS NULL");
    },
  },
  {
    // Walk-in sales: an admin records an order a customer placed in person,
    // paying at the office rather than through the site.
    //
    // Plain ADD COLUMNs with service-level validation, deliberately not
    // CHECK constraints. Adding a CHECK to `transactions` would mean
    // rebuilding it, and it is the most foreign-keyed table in the schema
    // (commission_ledger_entries, reserve_ledger_entries and now
    // lease_cheques all point at it) -- the riskiest rebuild available, for
    // a constraint the service already enforces.
    //
    // amount_received_cents is backfilled to the full price for existing
    // rows: every order booked before this migration was paid up front by
    // wallet debit, so "collected in full" is the historically accurate
    // value and the column means the same thing across all of history.
    id: "011_transactions_manual_orders",
    run(db) {
      const cols = db.query("PRAGMA table_info(transactions)").all();
      const has = (name) => cols.some((c) => c.name === name);

      if (!has("channel")) {
        db.exec("ALTER TABLE transactions ADD COLUMN channel TEXT NOT NULL DEFAULT 'online'");
      }
      if (!has("recorded_by_admin_id")) {
        db.exec("ALTER TABLE transactions ADD COLUMN recorded_by_admin_id TEXT");
      }
      if (!has("payment_terms")) {
        db.exec("ALTER TABLE transactions ADD COLUMN payment_terms TEXT NOT NULL DEFAULT 'full'");
      }
      if (!has("amount_received_cents")) {
        db.exec("ALTER TABLE transactions ADD COLUMN amount_received_cents INTEGER NOT NULL DEFAULT 0");
        db.exec("UPDATE transactions SET amount_received_cents = y_at_sale_cents");
      }
    },
  },
  {
    // A phone number on the account.
    //
    // Needed for cheque reminders to actually be useful: a due-date warning
    // belongs in an SMS, not an email nobody opens, and this is an Iranian
    // customer base where SMS is the norm. Without this column the
    // notification service silently falls back to email every time -- which
    // works, but quietly defeats the point of building the SMS transport.
    id: "012_users_phone",
    run(db) {
      const cols = db.query("PRAGMA table_info(users)").all();
      if (!cols.some((c) => c.name === "phone")) {
        db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
      }
    },
  },
  {
    // Assistant conversation log.
    //
    // A new table rather than columns on anything existing: these rows have
    // no relationship to the money schema and a completely different
    // lifetime (they are operational telemetry, not records anyone is owed).
    //
    // user_id is nullable and ON DELETE SET NULL because the overwhelming
    // majority of these come from anonymous storefront visitors, and a
    // signed-in user closing their account must not be blocked by, or drag
    // away, a support transcript the operator may still need.
    id: "013_ai_conversations",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id           TEXT PRIMARY KEY,
          user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
          session_id   TEXT,
          message      TEXT NOT NULL,
          reply        TEXT,
          sources_json TEXT NOT NULL DEFAULT '[]',
          tokens       INTEGER,
          created_at   TEXT NOT NULL
        );
      `);
      // The admin log view is "most recent first", and the session index
      // backs reconstructing a single visitor's thread.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_conv_created ON ai_conversations(created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_conv_session ON ai_conversations(session_id)`);
    },
  },
  {
    // Live chat between a visitor and a staff member.
    //
    // A session is created by the *visitor* and starts unclaimed. Staff are
    // notified with a one-time invite link; whoever opens it first claims the
    // conversation, and the link burns. That is the whole access model:
    //
    //   * `visitor_token` is the visitor's own bearer for their session --
    //     they are typically anonymous, so there is no account to authorise
    //     against and the token IS the identity.
    //   * `invite_token` is single-use. `invite_claimed_at` being non-null is
    //     what makes it spent; it is kept (rather than nulled) so an admin
    //     can see the link was used and by whom, which is the difference
    //     between "expired" and "someone else got there first".
    //
    // Both tokens are random 32-char strings, never derived from the id --
    // a guessable invite would let anyone join a stranger's support chat.
    id: "014_live_chat",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id                TEXT PRIMARY KEY,
          visitor_token     TEXT NOT NULL UNIQUE,
          visitor_name      TEXT,
          visitor_contact   TEXT,
          topic             TEXT,
          source            TEXT NOT NULL DEFAULT 'contact',
          user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
          status            TEXT NOT NULL DEFAULT 'waiting'
                              CHECK (status IN ('waiting','active','closed')),
          invite_token      TEXT UNIQUE,
          invite_expires_at TEXT,
          invite_claimed_at TEXT,
          agent_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          closed_at         TEXT
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
          sender      TEXT NOT NULL CHECK (sender IN ('visitor','agent','system')),
          sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          body        TEXT NOT NULL,
          created_at  TEXT NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status, created_at DESC)`);
    },
  },
  {
    // Blog posts, authored in the admin console and rendered on /socials.
    //
    // `slug` is the public identity and is UNIQUE; `status` gates visibility
    // so a half-written post is never reachable. Body is markdown-ish plain
    // text rendered as paragraphs -- deliberately no rich-text/HTML column,
    // because storing author-supplied HTML and rendering it is a stored-XSS
    // hole that an internal tool does not need to open.
    id: "015_blog_posts",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS blog_posts (
          id           TEXT PRIMARY KEY,
          slug         TEXT NOT NULL UNIQUE,
          title        TEXT NOT NULL,
          excerpt      TEXT,
          body         TEXT NOT NULL DEFAULT '',
          cover_url    TEXT,
          tags_json    TEXT NOT NULL DEFAULT '[]',
          status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
          author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
          published_at TEXT,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_blog_status ON blog_posts(status, published_at DESC)`);
    },
  },
  {
    // Email verification, link-based (no OTP).
    //
    // Mirrors the existing password_resets table rather than inventing a new
    // shape: a hashed single-use token with an expiry. Storing the raw token
    // would mean a database leak hands an attacker the ability to verify --
    // and later, to trust -- any address in the table.
    id: "016_email_verification",
    run(db) {
      const cols = db.query("PRAGMA table_info(users)").all();
      if (!cols.some((c) => c.name === "email_verified_at")) {
        db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
        // Everyone who already had an account predates verification. Marking
        // them verified is the only sane migration: retroactively locking out
        // existing users for not completing a step that did not exist is a
        // far worse outcome than trusting addresses that were already in use.
        db.exec("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL");
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_verifications (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at    TEXT,
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)`);
    },
  },
  {
    // The assistant's editable knowledge, and the record of what it could not
    // answer.
    //
    // These two tables are one feature. The crawl and the catalogue cover what
    // the website already says; this covers everything a customer actually
    // asks that nobody thought to publish -- lead times, warranty terms, what
    // is on the demo floor this month. Staff add those answers here.
    //
    // `ai_answer_gaps` is what makes it improve rather than merely grow: every
    // time the assistant admits it does not know something, the question is
    // recorded. That turns "our AI is a bit vague" into a ranked list of the
    // exact questions to write answers for, sorted by how often they are
    // asked. Without it, nobody knows what to add.
    id: "017_ai_knowledge",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_knowledge (
          id          TEXT PRIMARY KEY,
          question    TEXT NOT NULL,
          answer      TEXT NOT NULL,
          tags_json   TEXT NOT NULL DEFAULT '[]',
          status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published')),
          -- How often retrieval has selected this entry. Cheap usage feedback:
          -- an entry nobody ever matches is either badly worded or answering a
          -- question nobody asks.
          hit_count   INTEGER NOT NULL DEFAULT 0,
          author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_status ON ai_knowledge(status, updated_at DESC)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_answer_gaps (
          id             TEXT PRIMARY KEY,
          -- Normalised form of the question, so "what is the warranty?" and
          -- "What's the warranty" count as the same gap rather than two.
          question_key   TEXT NOT NULL UNIQUE,
          sample_question TEXT NOT NULL,
          ask_count      INTEGER NOT NULL DEFAULT 1,
          status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','ignored')),
          knowledge_id   TEXT REFERENCES ai_knowledge(id) ON DELETE SET NULL,
          first_asked_at TEXT NOT NULL,
          last_asked_at  TEXT NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_gaps_open ON ai_answer_gaps(status, ask_count DESC)`);
    },
  },

  // The assistant becomes an agent: it holds durable conversations, accepts
  // attachments, calls tools on the visitor's behalf, and is metered per day.
  //
  // Note what is NOT here: `ai_conversations` (013) is untouched. That table
  // is the write-only admin audit log and is read by /ai/conversations; the
  // tables below are the working state the model actually sees. Two different
  // jobs, deliberately not merged.
  {
    id: "018_ai_agent",
    run(db) {
      // A conversation. `user_id` is nullable because anonymous visitors get
      // a teaser conversation that is never persisted -- the column exists so
      // the same repo can serve both without a second code path.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_sessions (
          id              TEXT PRIMARY KEY,
          user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
          -- First 60 characters of the opening question. Deliberately not a
          -- model-generated summary: that is a second API call on the hot
          -- path to name something the visitor is about to read anyway.
          title           TEXT,
          scope_json      TEXT NOT NULL DEFAULT '{}',
          message_count   INTEGER NOT NULL DEFAULT 0,
          last_message_at TEXT,
          archived_at     TEXT,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_sessions(user_id, last_message_at DESC)`
      );

      // One row per message in the array the model sees -- including the
      // assistant turns that only requested tools, and the tool results that
      // answered them. Stored verbatim so rebuilding a conversation
      // reconstructs exactly what was sent, rather than an approximation.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_messages (
          id               TEXT PRIMARY KEY,
          session_id       TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
          seq              INTEGER NOT NULL,
          role             TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
          content          TEXT,
          tool_calls_json  TEXT,
          tool_call_id     TEXT,
          tool_name        TEXT,
          attachments_json TEXT NOT NULL DEFAULT '[]',
          sources_json     TEXT NOT NULL DEFAULT '[]',
          suggestions_json TEXT NOT NULL DEFAULT '[]',
          tokens_prompt     INTEGER,
          tokens_completion INTEGER,
          created_at       TEXT NOT NULL
        );
      `);
      // Unique rather than plain: `seq` is how history is ordered and
      // replayed, so two messages claiming the same position is corruption,
      // not a curiosity.
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_seq ON ai_messages(session_id, seq)`
      );

      // Bytes live on disk under config.uploadDir/ai, never in SQLite -- a
      // 5MB blob per message would bloat every backup of this file.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_attachments (
          id             TEXT PRIMARY KEY,
          user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_id     TEXT REFERENCES ai_sessions(id) ON DELETE CASCADE,
          kind           TEXT NOT NULL CHECK (kind IN ('image','document')),
          mime           TEXT NOT NULL,
          byte_size      INTEGER NOT NULL,
          filename       TEXT NOT NULL,
          original_name  TEXT,
          storage_path   TEXT NOT NULL,
          sha256         TEXT,
          -- Documents only. NULL means extraction found nothing, which is a
          -- fact the model is told rather than left to guess at.
          extracted_text TEXT,
          created_at     TEXT NOT NULL
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_ai_attachments_session ON ai_attachments(session_id, created_at)`
      );

      // The daily meter. Composite primary key so incrementing is a single
      // INSERT ... ON CONFLICT DO UPDATE ... RETURNING -- atomic without a
      // transaction, which matters because db.transaction() here is
      // synchronous-only and this runs inside async middleware.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_usage_daily (
          user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day          TEXT NOT NULL,
          prompts      INTEGER NOT NULL DEFAULT 0,
          tool_calls   INTEGER NOT NULL DEFAULT 0,
          web_searches INTEGER NOT NULL DEFAULT 0,
          tokens       INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day)
        );
      `);

      // Every tool the agent invoked, and every one it merely PROPOSED.
      //
      // A proposal is just a tool call that has not run yet, so it lives in
      // the same table: one query answers "what did the agent do here", and
      // single-use confirmation comes free from a guarded
      // `UPDATE ... WHERE status='proposed'`. A signed token would have been
      // stateless and replayable, which is the wrong trade when the thing
      // being guarded debits a wallet.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_tool_calls (
          id            TEXT PRIMARY KEY,
          session_id    TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
          message_id    TEXT REFERENCES ai_messages(id) ON DELETE SET NULL,
          user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
          tool_name     TEXT NOT NULL,
          args_json     TEXT NOT NULL,
          status        TEXT NOT NULL
                          CHECK (status IN ('proposed','confirmed','executed','failed','rejected','expired')),
          consequential INTEGER NOT NULL DEFAULT 0,
          result_json   TEXT,
          error_code    TEXT,
          duration_ms   INTEGER,
          expires_at    TEXT,
          created_at    TEXT NOT NULL,
          resolved_at   TEXT
        );
      `);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_session ON ai_tool_calls(session_id, created_at DESC)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_pending ON ai_tool_calls(status, expires_at)`
      );
    },
  },
  {
    id: "019_commission_paid_method",
    run(db) {
      // How a commission entry was actually settled.
      //
      // Until now `status = 'paid'` meant one thing: the wallet was credited
      // by the release job. This business pays its network in person, which
      // is a second way for an entry to be genuinely settled and no way at
      // all for a wallet to know about it -- and the system-wide audit check
      // ("paid but never credited a wallet") was right to object, because
      // without this column the two are indistinguishable.
      //
      // Nullable, and null means the old meaning: every row written before
      // this migration was paid through the wallet.
      const columns = db.query(`PRAGMA table_info(commission_ledger_entries)`).all();
      if (!columns.some((c) => c.name === "paid_method")) {
        db.exec(`ALTER TABLE commission_ledger_entries ADD COLUMN paid_method TEXT`);
      }
    },
  },
  {
    id: "020_hot_path_indexes",
    run(db) {
      // Three indexes for queries that were scanning a table that grows
      // forever. Found with EXPLAIN QUERY PLAN rather than guessed: each one
      // below showed a SCAN where the query filters on a single row's worth
      // of data.
      db.exec(`
        -- "My orders", and the agent's get_my_orders. There was an index on
        -- buyer_node_id but none on buyer_user_id, so a customer opening
        -- their own order list read EVERY transaction in the business.
        CREATE INDEX IF NOT EXISTS idx_tx_buyer_user
          ON transactions(buyer_user_id, created_at DESC);

        -- The audit log is the fastest-growing table here and is always read
        -- filtered: the admin log page by action, and the payout history by
        -- action. Without this both scan the whole thing to find a handful of
        -- rows, and it gets slower every day the business runs.
        CREATE INDEX IF NOT EXISTS idx_audit_action_created
          ON audit_logs(action, created_at DESC);

        -- The payout sheet's per-person queries. idx_cle_status alone is
        -- enough today, but the pending set grows with the business while one
        -- person's rows stay few -- which is exactly backwards from what the
        -- index should narrow on first.
        CREATE INDEX IF NOT EXISTS idx_cle_user_status
          ON commission_ledger_entries(user_id, status);
      `);
    },
  },
  {
    // Staff scopes (see src/lib/permissions.js).
    //
    // `staff_role` used to hold exactly one of root | sales_agent |
    // inventory_admin | support_agent. It now holds 'root' or a comma
    // separated list of scopes, so that an admin can be FINANCE_ADMIN and
    // CONTENT_ADMIN at once. The legacy roles map onto the closest scope so
    // nobody keeps access they no longer have a name for, or loses the
    // access they were given:
    //
    //   sales_agent     orders, cheques, quotes      -> FINANCE_ADMIN
    //   inventory_admin catalogue + published copy   -> CONTENT_ADMIN
    //   support_agent   customers + support queue    -> USERS_ADMIN
    //
    // root is untouched.
    id: "021_staff_scopes",
    run(db) {
      db.exec(`
        UPDATE users SET staff_role = 'FINANCE_ADMIN' WHERE role = 'admin' AND staff_role = 'sales_agent';
        UPDATE users SET staff_role = 'CONTENT_ADMIN' WHERE role = 'admin' AND staff_role = 'inventory_admin';
        UPDATE users SET staff_role = 'USERS_ADMIN'   WHERE role = 'admin' AND staff_role = 'support_agent';
      `);
    },
  },
  {
    // Support intake replaces tickets, ticket threads, the contact-leads
    // queue and live chat.
    //
    // The old rows are carried across rather than dropped -- a ticket from
    // last week is still somebody waiting for an answer:
    //   * contact_leads     -> one request each (phone/email becomes `contact`)
    //   * support_tickets   -> one request each, message = the first message
    //                          in the thread (subject is kept as a prefix)
    // Then the old tables, and the live-chat tables (014), are dropped. Chat
    // transcripts are ephemeral conversations with no follow-up queue, so
    // they are not migrated.
    id: "022_support_requests_replace_tickets_leads_chat",
    run(db) {
      const has = (name) =>
        Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));

      if (has("contact_leads")) {
        db.exec(`
          INSERT INTO support_requests (id, user_id, name, contact, message, status, admin_note, handled_by, ip, created_at, updated_at)
          SELECT 'req_' || id, NULL, name,
                 TRIM(COALESCE(phone, '') || CASE WHEN phone IS NOT NULL AND email IS NOT NULL THEN ' / ' ELSE '' END || COALESCE(email, '')),
                 COALESCE(NULLIF(message, ''), '(no message)'),
                 CASE status WHEN 'new' THEN 'new' WHEN 'contacted' THEN 'in_progress'
                             WHEN 'converted' THEN 'resolved' ELSE 'closed' END,
                 admin_note, handled_by, ip, created_at, updated_at
          FROM contact_leads;
          DROP TABLE contact_leads;
        `);
      }

      if (has("support_tickets") && has("support_messages")) {
        db.exec(`
          INSERT INTO support_requests (id, user_id, name, contact, message, status, created_at, updated_at)
          SELECT 'req_' || t.id, t.user_id, u.name, u.email,
                 t.subject || CHAR(10) || CHAR(10) ||
                   COALESCE((SELECT m.message FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at ASC, m.rowid ASC LIMIT 1), ''),
                 CASE t.status WHEN 'open' THEN 'new' WHEN 'pending' THEN 'in_progress' ELSE 'closed' END,
                 t.created_at, t.updated_at
          FROM support_tickets t JOIN users u ON u.id = t.user_id;
          DROP TABLE support_messages;
          DROP TABLE support_tickets;
        `);
      }

      if (has("chat_messages")) db.exec("DROP TABLE chat_messages");
      if (has("chat_sessions")) db.exec("DROP TABLE chat_sessions");

      // Settings that governed removed features. Dropping the override rows
      // keeps the admin console from listing flags that do nothing.
      if (has("site_settings")) {
        db.exec(`
          DELETE FROM site_settings
           WHERE key IN ('live_chat_enabled', 'payments_enabled', 'withdrawals_enabled');
        `);
      }
    },
  },
  {
    // A lease proforma request carries the exact terms the visitor chose, so
    // sales can price it without re-deriving them from free text. The server
    // computes these from the product's lease rules (never trusts the
    // browser's figures) -- see salesService.createQuote.
    id: "023_sales_quotes_lease_terms",
    run(db) {
      const cols = db.query("PRAGMA table_info(sales_quotes)").all().map((c) => c.name);
      if (!cols.includes("term_months")) db.exec("ALTER TABLE sales_quotes ADD COLUMN term_months INTEGER");
      if (!cols.includes("apr_bp")) db.exec("ALTER TABLE sales_quotes ADD COLUMN apr_bp INTEGER");
      if (!cols.includes("instalment_cents")) db.exec("ALTER TABLE sales_quotes ADD COLUMN instalment_cents INTEGER");
      if (!cols.includes("upfront_pct")) db.exec("ALTER TABLE sales_quotes ADD COLUMN upfront_pct REAL");
    },
  },
  {
    // Per-post search metadata for the blog (see frontmatter handling in
    // blogService). Both optional: a post without them falls back to its
    // title and excerpt.
    id: "024_blog_posts_seo",
    run(db) {
      const cols = db.query("PRAGMA table_info(blog_posts)").all().map((c) => c.name);
      if (!cols.includes("seo_title")) db.exec("ALTER TABLE blog_posts ADD COLUMN seo_title TEXT");
      if (!cols.includes("seo_description")) db.exec("ALTER TABLE blog_posts ADD COLUMN seo_description TEXT");
    },
  },
  {
    // Every product needs a public slug: the storefront's /devices/:id page,
    // its sitemap entry and its catalogue card are all keyed on it, and a
    // product without one is invisible there. productService.create now
    // assigns one; this gives the products that predate that the same, so
    // what was created in the admin console before today appears too.
    id: "025_products_slug_backfill",
    run(db) {
      const rows = db.query("SELECT id, name, specs_json FROM products ORDER BY created_at ASC, rowid ASC").all();
      const taken = new Set();
      const parsed = rows.map((r) => {
        let specs = {};
        try {
          specs = JSON.parse(r.specs_json || "{}") || {};
        } catch {
          specs = {};
        }
        if (specs.slug) taken.add(specs.slug);
        return { ...r, specs };
      });
      const update = db.query("UPDATE products SET specs_json = ? WHERE id = ?");
      for (const row of parsed) {
        if (row.specs.slug) continue;
        const root = slugify(row.name) || "product";
        let candidate = root;
        for (let n = 2; taken.has(candidate); n++) candidate = `${root}-${n}`;
        taken.add(candidate);
        update.run(JSON.stringify({ ...row.specs, slug: candidate }), row.id);
      }
    },
  },
  {
    // A proforma can arrive through another member's referral link. The code
    // is kept on the quote so the walk-in desk can attach the buyer under that
    // member without anyone retyping it, and the order a quote turns into is
    // linked back so the queue shows which proformas were actually sold.
    id: "026_sales_quotes_referral_and_order",
    run(db) {
      const cols = db.query("PRAGMA table_info(sales_quotes)").all().map((c) => c.name);
      if (!cols.includes("referral_code")) db.exec("ALTER TABLE sales_quotes ADD COLUMN referral_code TEXT");
      if (!cols.includes("transaction_id")) db.exec("ALTER TABLE sales_quotes ADD COLUMN transaction_id TEXT");
    },
  },
];

export function runExtraMigrations(rawDb) {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    );
  `);
  const applied = new Set(rawDb.query("SELECT id FROM schema_migrations").all().map((r) => r.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    rawDb.transaction(() => {
      migration.run(rawDb);
      rawDb
        .query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(migration.id, new Date().toISOString());
    })();
  }
}
