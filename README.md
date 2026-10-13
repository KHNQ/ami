# Trex Backend

Multi-space MLM platform backend, implementing the full model in `idea.md`:
Products, warehouse-cost history, per-product commission plans, Spaces
(independent MLM trees), Nodes, redeem codes, purchases, commission
distribution, refunds/clawback, a dev/reserve fund cut, wallets, a support
intake queue, a Markdown blog, per-product lease terms, and a full
admin/monitoring surface with scoped admin roles.

**Stack:** [Bun](https://bun.sh) + [Hono](https://hono.dev), SQLite via
`bun:sqlite` today, behind a swappable DB interface (see below). Plain
JavaScript (ESM), no TypeScript, no ORM.

## Running it

```bash
bun install
bun run seed     # creates an admin user + a demo product
bun run dev      # http://localhost:3000
```

Seeded admin login: `admin@trex.local` / `admin12345` (override via
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

```bash
bun test         # full invariant + quarter-simulation test suite
```

Config is entirely env-var driven (`src/config.js`): `PORT`, `JWT_SECRET`,
`SQLITE_FILE`, `DEFAULT_PAYOUT_POOL_PCT_BP`, `DEFAULT_RESERVE_PCT_BP`, etc.

## Architecture

```
src/
  config.js            all tunables, env-driven
  db/
    index.js            picks the storage engine (DB_ENGINE env var)
    adapters/sqlite/     the only engine implemented today
      schema.sql
      repos/*.js         one file per entity group
  lib/                  money (integer-cents math), auth (jwt/bcrypt), errors, ids
  services/              all business logic + invariant enforcement lives here
  middleware/            requireAuth / requireAdmin / error handler
  routes/                thin Hono handlers, one file per resource
  app.js / index.js      wiring + entrypoint
scripts/                 seed.js, migrate.js
tests/                   bun:test suite
```

### Why the DB layer is structured this way

Every service imports a single object, `db`, from `src/db/index.js`. `db`
exposes named repos (`db.users`, `db.products`, `db.nodes`, `db.wallet`,
...) plus `db.transaction(fn)` for atomic multi-step writes. Nothing
outside `src/db/` ever touches `bun:sqlite` directly.

To swap the storage engine later (Mongo, LevelDB, Postgres, whatever):
write a new adapter under `src/db/adapters/<engine>/` that exports a
`createXAdapter()` returning an object with **the same top-level keys and
method signatures** as `src/db/adapters/sqlite/index.js`, then add a case
for it in `src/db/index.js`'s `buildDb()`. No service or route changes.

## The financial model, in code

All money is integer cents. All percentages are integer basis points
(10000 = 100%) to avoid float drift (Invariant 6).

- `src/services/purchaseService.js` — the full purchase flow: space/node
  creation (root vs. redeem-code join), atomic redeem-code use-count
  increment, wallet debit, transaction + ledger writes, all in one
  `db.transaction()`.
- `src/services/commissionService.js` — `distributeCommission()` (Section 6
  algorithm) and `releaseMaturedCommissions()` (Invariant 5's hold window).
- `src/services/commissionPlanService.js` — validates
  `sum(level_rates) <= payout_pool_pct` and `reserve_pct < 100%` at
  **save time**, never per-transaction (Invariant 2).
- `src/services/refundService.js` — clawback walks the ledger rows that
  were actually written for a transaction, never a live tree re-walk
  (Invariant 5).
- `src/services/activityService.js` — the PV activity gate and the
  inactivity decay curve (Section 6/7).
- `src/services/reportService.js` — `auditInvariants()` is a standing
  regression check that every historical transaction still has
  `trex_net_amount_cents > 0` (Section 10 item 8).

Every transaction satisfies, by construction and re-asserted defensively:

```
margin_cents == total_payout_cents + reserve_amount_cents + trex_net_amount_cents
total_payout_cents <= payout_pool_amount_cents == margin_cents * payout_pool_pct
trex_net_amount_cents > 0
```

The dev/reserve fund cut (idea.md: "reserve some profit... for reserve/dev")
is taken only from realized `trex_net` post-commission — never from margin
directly and never from fees (Invariant 7) — and `reserve_pct_bp` is
validated `< 10000` at plan-save time so `trex_net_final` is guaranteed
positive whenever pre-reserve `trex_net` is positive.

## API surface

All bodies/responses are JSON. Authenticated routes take
`Authorization: Bearer <jwt>` (returned from signup/login).

```
POST   /auth/signup                       { email, password, name }
POST   /auth/login                        { email, password }
GET    /auth/me
POST   /auth/forgot-password              { email }                  -> always generic response, see Security
POST   /auth/reset-password               { token, new_password }

GET    /profile
PATCH  /profile                           { name }

GET    /wallet                            read-only: top-ups and withdrawals no longer exist
GET    /wallet/ledger

GET    /products                          public storefront listing
GET    /products/:id
POST   /products                          catalogue.write  { name, xCents, yCents, specs?, lease_rules? }
                                                   every product gets a unique public slug (specs.slug)
PATCH  /products/:id                      catalogue.write  (lease_rules: null resets to the standard terms)
PATCH  /products/:id/price                admin  { y_cents }
PATCH  /products/:id/status               admin  { status }
POST   /products/:id/warehouse-cost       admin  { x_cents }
GET    /products/:id/warehouse-cost
PATCH  /products/:id/stock                catalogue.write  { delta, cost_cents? }
                                                   cost_cents = per-unit cost of the batch being ADDED (delta > 0 only);
                                                   it becomes the product's warehouse cost in the same step, and is
                                                   appended to the cost history unless it equals the current cost.
                                                   A negative delta (count correction) takes no cost.

POST   /purchases                         { product_id, redeem_code?, discount_cents? }
GET    /purchases                         your own purchase history
GET    /purchases/:id

GET    /spaces?product_id=
GET    /spaces/:id
GET    /spaces/:id/tree                   full tree, for visualization

POST   /redeem-codes                      { product_id, max_uses?, expires_at? }
GET    /redeem-codes/mine?product_id=
GET    /redeem-codes/:code                validate
POST   /redeem-codes/:id/revoke

GET    /nodes/mine
GET    /nodes/:id
GET    /nodes/:id/downline
GET    /nodes/:id/earnings
GET    /nodes/:id/redeem-codes
PATCH  /nodes/:id/status                  admin

GET    /commission-plans/:productId
PATCH  /commission-plans/:productId       admin, validates Invariant 2 server-side

POST   /support/requests                  public  { name, contact, message }   -> the intake form; rate limited
GET    /support/requests?status=          support.read_all
GET    /support/requests/:id              support.read_all
PATCH  /support/requests/:id              support.write   { status?, admin_note? }

POST   /sales/quotes                      public  proforma / enquiry / lease request
                                                   (lease: kind "lease" + term_months + upfront_pct; the server
                                                    validates both against the product's lease rules and computes
                                                    the instalment itself)
GET    /sales/quotes/:id/proforma.pdf?ref=
GET    /sales/quotes?status=&kind=        sales.read    the sales queue
PATCH  /sales/quotes/:id                  sales.write

GET    /blog/posts                        public, published only
GET    /blog/posts/:slug
GET    /blog/slugs                        public, for the sitemap
GET    /blog/admin/posts                  content.write
POST   /blog/admin/posts                  content.write  { body }  -- one Markdown document with front matter
PATCH  /blog/admin/posts/:id              content.write
DELETE /blog/admin/posts/:id              content.write

-- admin only --
GET    /admin/orders
GET    /admin/orders/:id
POST   /admin/orders/:id/refund           { amount_cents?, reason? }  -> clawback + net recompute

GET    /admin/users
PATCH  /admin/users/:id/status            { status }
PATCH  /admin/users/:id/role              admins.manage (root only)  { role, staff_scopes? }
POST   /admin/admins                      admins.manage (root only)  { email, password, name, staff_scopes }
GET    /admin/users/:id/network           network.read_all  the person's sponsor chain and downline tree
GET    /admin/roles                       the scope -> permission matrix
POST   /admin/jobs/recalculate-activity   period-reset job (Section 10 item 7)
POST   /admin/jobs/release-commissions    { hold_days?, as_of? }
POST   /admin/jobs/run-all

GET    /admin/monitoring/overview
GET    /admin/monitoring/reports/trex-net?product_id=&space_id=&from=&to=
GET    /admin/monitoring/reports/reserve-fund
GET    /admin/monitoring/reports/audit-invariants

GET    /admin/logs?actor_user_id=&action=&entity_type=

POST   /ai/chat                           { message, session_id?, product_id?, attachment_ids? } -> SSE
POST   /ai/ask                            same, one JSON answer instead of a stream
POST   /ai/suggest                        { query }  retrieval only, no model call
POST   /ai/confirm                        { proposal_id, decision }  answers a confirmation card
GET    /ai/quota                          today's allowance for the signed-in visitor
GET    /ai/sessions                       the visitor's own conversations
GET    /ai/sessions/:id
PATCH  /ai/sessions/:id                   { title }
DELETE /ai/sessions/:id
POST   /ai/attachments                    { data_url, filename?, session_id? }
GET    /ai/attachments/:id                owner (or logs.read) only; never served statically
GET    /ai/tool-calls?status=&user_id=    admin: what the assistant did or proposed
GET    /ai/conversations?session_id=      admin: what the assistant said
GET    /ai/knowledge                      content.write
POST   /ai/knowledge                      content.write  { question, answer, tags?, gap_id? }
GET    /ai/gaps?status=open               content.write: questions it could not answer
```

## Staff access (RBAC)

An account is staff when `users.role = 'admin'`; what it may do comes from
`users.staff_role`, which is either `root` or a comma-separated list of
**scopes** (`src/lib/permissions.js`):

| Role / scope | May |
|---|---|
| **root** | everything, including creating admins and changing anyone's access. Any number of root admins may exist; the last one cannot be demoted. |
| **FINANCE_ADMIN** | money: orders, refunds, walk-in sales, cheques, network payouts, proformas and lease requests, pricing, lease terms, commission plans, reports |
| **USERS_ADMIN** | people: accounts (suspend/reinstate), referral networks, job applications, the support queue |
| **CONTENT_ADMIN** | the public site: blog posts and the assistant's answers. Not Stock (finance) and not Settings & SEO (root only). |

Scopes combine (`FINANCE_ADMIN,CONTENT_ADMIN` holds the union). Only the
`admins.manage` permission can create an admin or change a role, and it is in
no scope's grant list -- so a sub-admin can never widen their own access.
Migration `021` maps the old single roles onto the closest scope
(`sales_agent` → FINANCE, `inventory_admin` → CONTENT, `support_agent` → USERS).
The console's **Admins & access** page (root only) manages all of this.

## Lease terms

A product's lease rules are set when it is created (and editable later) and are
stored in `specs.lease_rules`: whether leasing is offered, an optional lease
base price, the minimum/maximum upfront percentage, and the list of durations,
each with its own APR. `src/lib/leaseRules.js` is the single definition of the
maths; `frontend/src/b2b/lib/finance.js` mirrors it and
`frontend/tests/leaseParity.test.js` fails if the two disagree. The device page
builds its lease tab from the rules, and **Request Proforma Invoice** sends the
chosen term and upfront percentage -- the server re-checks both against the
rules and records the instalment it computes, never the browser's figure.
A product with no rules gets 12/24/36/48 months at the `lease_apr_bp` setting.

## Blog and SEO

Posts are Markdown, written in the console as one document with an optional
front-matter block (`title`, `slug`, `excerpt`, `description`, `tags`, `cover`,
`status`). The server lifts the block into the post's fields
(`src/lib/frontmatter.js`); the document wins over any form field. Bodies are
stored and returned as Markdown source, never HTML, and rendered by
`frontend/src/components/ui/Markdown.jsx` (react-markdown + remark-gfm +
rehype-sanitize; raw HTML is dropped, only http(s)/mailto/tel/relative URLs
survive). `/blog` and `/blog/:slug` are server-rendered so crawlers get the
article, its meta tags and `BlogPosting` JSON-LD.

Devices (bundled or created in the console) carry `MedicalDevice`/`Product`
JSON-LD, canonical and hreflang links, Open Graph and Twitter tags.
`GET /sitemap.xml` is built per request from the live catalogue and published
posts. Site name, default description, default share image and Twitter handle
are the `seo_*` settings (Settings & SEO is root only). The SSR server answers a
real `404` for any path the client router does not know
(`frontend/src/lib/knownRoutes.js`, held in step with `App.jsx` by a test).

## Upgrading an existing database

Migrations `021`-`025` run on boot. Take a copy of `trex.sqlite` first (`bun run
backup`): `022` migrates contact leads and support tickets into the new
`support_requests` table and then **drops** `contact_leads`, `support_tickets`,
`support_messages` and the live-chat tables. `deposit_requests` and
`withdraw_requests` are kept as a read-only archive. `025` gives every existing
product a public slug.

## The network

One programme, not two. A customer who buys a device opens a position in that
device's network; a colleague who quotes their invite code when they buy joins
it underneath them, and commission flows up the chain at the rates on that
product's plan. There is no separate single-tier referral scheme — it was
removed, because two affiliate programmes meant two sets of numbers to explain
to the same doctor.

The whole flow is recorded by staff, because it happens in a room:

```
visitor browses /devices
  → POST /sales/quotes                     proforma issued, PDF downloadable,
                                           customer emailed, sales inbox pinged
  → the customer visits the office and pays in person
  → POST /admin/orders/manual              staff record it, with the invite
                                           code if the buyer brought one
  → no code  → they FOUND the network for that product, as its root
    with code → they are placed under the code's owner, in that same network
  → GET /admin/payouts                     what the company now owes, per person
  → POST /admin/payouts/:id/settle         records that it was paid, by hand
```

**The system never pays anyone.** `network_auto_payout` is off by default, so
commission is recorded as owed and settled by an admin who hands over cash or
makes a transfer; `paid_method` on each ledger row says which way it went.
Turning the setting on restores the old behaviour, where the scheduled job
credits the earner's wallet instead. Running both is how the same commission
gets paid twice, which is why the payout sheet states which mode it is in.

Rates are per product and editable at any time
(`PATCH /commission-plans/:productId`, or the plan editor on the admin's
product page): payout pool, per-level rates, depth, reserve cut, activity and
decay. A change applies to the **next** sale only — what a node already earned
was agreed at the moment of that sale, and `rate_applied_bp` on the ledger row
is the proof.

`tests/scenario-network.test.js` walks the whole thing end to end: Ali finds a
device, downloads the proforma, pays in person and founds the network;
Mohammad arrives with Ali's code and lands under him; the payout sheet says
what Ali is owed; an admin settles it in cash.

## The assistant

**It ships switched off.** `AI_ENABLED` is false by default, and while it is:
`/ai/*` answers `503 {"code":"ai_disabled"}` from a stub router, nothing under
`src/services/ai*` or `src/services/agent/` is imported at boot (the tool
registry is empty — `tests/ai-disabled.test.js` asserts it), `/site-config`
reports `ai_chat_enabled: false`, and the storefront renders no launcher and
downloads no chat bundle. Set `AI_ENABLED=true` and restart to bring it back;
nothing is deleted while it is off, so conversations, attachments and the tool
audit trail survive the pause.

The env var beats the `ai_chat_enabled` setting in the admin console, which is
the point of having both: the setting is how an operator pauses the feature,
the env var is how a deployment refuses to run it. The console shows "off in
this deployment" on the toggle rather than letting someone flip a switch that
does nothing.

With it on, a signed-in visitor gets a tool-calling agent: it reads the catalogue and
their own account, searches the web, raises quotes and support requests, and
drives the storefront's own dialogs. Anything it does, a customer could have
done by clicking — and the result is the same row in the same table, because
the tools call the same services the HTTP routes do.

Three rules hold it together, and they are worth knowing before changing
anything under `src/services/agent/`:

1. **No tool takes an identity from the model.** Whose data it is comes from
   `ctx.userId`, built in the route from the request's own token.
2. **Tools call services, never `db.*` repos.** The repos have no
   authorization; the services do. Passing a `node_id` the model invented is
   safe precisely because `nodeService` throws for someone else's node.
3. **Anything irreversible is a proposal, not an action.** It is previewed,
   shown to the visitor as a card, and executed only by a later request with
   its own freshly-checked auth — guarded by a single
   `UPDATE … WHERE status='proposed'`, which is the whole double-spend defence.

An anonymous visitor gets the retrieval assistant unchanged, with no `tools`
array sent upstream — the teaser is the same code path, not a second one.

Configuration (all optional except the model key; see `.env.example` for the
full commentary):

| Variable | Default | What it decides |
|---|---|---|
| `AI_ENABLED` | `false` | The whole feature. Off = no routes, no imports, no UI, no bundle. |
| `DEEPSEEK_API_KEY` | — | Without it the assistant cannot answer at all. |
| `AI_AGENT_MAX_STEPS` | 5 | model → tools → model rounds. The last is forced to answer. |
| `AI_AGENT_TIMEOUT_MS` | 60000 | Wall clock for one turn, tools included. |
| `AI_TOOL_TIMEOUT_MS` | 8000 | A tool that hangs loses its result, not the turn. |
| `AI_DAILY_PROMPT_LIMIT` | 20 | Messages per signed-in customer per day. |
| `AI_QUOTA_TIMEZONE` | `UTC` | Which calendar "today" is. **Set `Asia/Tehran` in production.** |
| `AI_ANON_HOURLY_LIMIT` | 5 | The anonymous teaser, per IP per hour. |
| `AI_WEB_SEARCH_DAILY_MAX` | 40 | Exa is metered; this is the per-customer ceiling. |
| `EXA_API_KEYS` | — | Comma-separated, rotated on failure. Unset = no web tools registered, no error. |
| `AI_MAX_ATTACHMENT_BYTES` | 5000000 | Decoded bytes. Images are downscaled in the browser first. |
| `AI_MAX_ATTACHMENTS_PER_MESSAGE` | 4 | |
| `AI_ATTACHMENT_HISTORY_TURNS` | 2 | How many turns back an image is re-sent in full. |

`bun run scripts/check-assistant.js` reports what is configured and exits
non-zero if something a deploy should have set is missing.

## Tests

`bun test` runs against a single in-memory SQLite instance (see
`bunfig.toml` + `tests/setup.js`) and covers:

- **`tests/invariants.test.js`** — Invariant 1 (margin floor + discount
  rejection), Invariant 2 (plan-save validation), Invariant 3 (positive
  trex_net through a deep chain, exact margin accounting), Invariant 4
  (locked x/y), Invariant 6 (floor rounding), and the Section 8 edge cases
  (duplicate node, self-referral, max-uses, expired code, insufficient
  funds).
- **`tests/refund.test.js`** — Invariant 5: clawback on pending vs. already
  -paid commissions, partial refunds, over-refund rejection.
- **`tests/scenario.test.js`** — a 3-month (quarter) simulation building
  multiple independent Spaces on one Product, branching downlines, a
  mid-quarter refund, end-of-month job runs, and a per-month + per-quarter
  trex-net report, asserting the books balance exactly every month and a
  standing invariant audit passes across the whole dataset. Also checks a
  chain twice as deep as `max_payout_depth` still holds Invariant 2/3.

## Security

- **Auth**: Bearer JWT (`hono/jwt`, HS256), `Bun.password` bcrypt hashing.
  `JWT_SECRET` **must** be set to a strong, unique value before running with
  `NODE_ENV=production` — the process refuses to boot in production with the
  checked-in dev default, since anyone who knows the signing secret can forge
  admin tokens.
- **Authorization**: every route that reads or mutates a specific resource
  checks ownership (or admin) server-side, not just client-side route guards.
  In particular: a Space's tree/detail and a Node's detail/downline/earnings/
  redeem-codes are restricted to that Space's participants / that Node's
  owner (plus admins) — they are *not* visible to arbitrary authenticated
  users. `GET /spaces` returns only the caller's own Spaces unless the caller
  is an admin.
- **Rate limiting**: in-memory per-IP limiter on `/auth/login`,
  `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password`,
  `POST /support/requests`, `POST /sales/quotes`, `POST /purchases`, and
  `GET /redeem-codes/:code` (the one unauthenticated, brute-forceable
  lookup). Single-process only — a multi-instance deployment needs this
  backed by shared state instead.
- **Password reset**: `/auth/forgot-password` always returns the same
  generic message whether or not the email exists (no user-enumeration via
  response shape), and stores only a SHA-256 hash of a 256-bit token, never
  the raw value. No real email provider is wired up yet — same stopgap
  stopgap: the token is always logged
  server-side, and only echoed back in the HTTP response
  (`debug_token`/`debug_reset_link`) when `NODE_ENV` is not `production`, so
  the flow is fully testable today and silently inert once a real provider
  is plugged into `authService.forgotPassword`.
- **CORS**: explicit origin allowlist via `CORS_ORIGINS` (comma-separated),
  defaulting to the Vite dev origin only. Set it to your real frontend
  origin(s) in production.
- **Before going to production**, also: replace the seed admin credentials
  (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, default `admin@trex.local` /
  `admin12345`).

## Languages

Five: English (unprefixed), and `/fa`, `/ar`, `/fr`, `/it`. The locale is the
router's `basename`, read once from the URL at boot, which is why the language
switcher does a full page load rather than a `navigate()` — see
`components/ui/LanguageSwitcher.jsx`.

Persian and Arabic are right-to-left. `dir` goes on `<html>`, not a wrapper,
because scrollbars, text selection and native form controls all read it from
the root element.

**Typefaces follow the language** (`src/index.css`): Inter for English, French
and Italian (full Latin-extended coverage), Vazirmatn for Persian, IBM Plex Sans
Arabic for Arabic. They are self-hosted (`@fontsource`), not fetched from Google
Fonts, so they load where third-party font hosts are unreliable. `:root[lang="fa"]`
and `:root[lang="ar"]` swap `--font-sans`, and switch off letter-spacing
(it breaks the joins in cursive scripts) and raise line-height.

**Copy lives in `src/i18n/locales/*.json`, never in a component.** A route's
name, a hero headline and a dropdown option are all content, and content that
is spelled inline is content that exists in one language. Where a list has to
be enumerated in code — the storefront sections, the footer columns, the RFQ
dropdowns — the code holds a stable `key` and the catalog holds the words:

```js
// src/b2b/data/sections.js — the registry of WHERE you can go
{ to: "/devices", key: "devices", icon: Boxes, group: "Buying", nav: true }
// read with the helpers, which take the `t` from useT()
sectionLabel(t, section)   // store.section.devices.label
```

Two rules that are easy to get wrong:

- **A form sends English, not the visitor's language.** The RFQ dropdowns are
  keys on screen and stable English labels on the wire (`asEnglish` in
  RfqModal) — a quote whose specialty field says "پوست" cannot be searched by
  an English-speaking colleague.
- **Numbers that are identifiers stay Latin.** `LOCALES[x].numerals` applies to
  formatted money and dates only. "1470nm" and "MX_7000" are model numbers, not
  quantities.

Three places hold catalogue vocabulary that is *stored* in English and has to
be looked up rather than printed:

- `b2b/lib/labels.js` — `countryName(t, …)` and `cityName(t, …)`. A device
  record's `country` comes from the API, written in English by an admin, so
  the screen resolves it through `store.country.*`. Both helpers fall back to
  the raw value: a country we have no key for reads as "Portugal", not as a
  key path or a blank.
- `components/ui/Badge.jsx` — `StatusBadge` resolves `status.*`. A status the
  backend adds later has no key, and the translator degrades to the final key
  segment with its underscores stripped, which is the humanised id this used
  to print anyway.
- `lib/finance.js` — `priceLabel(device, pricesVisible, t)` and
  `formatCountdown(ms, t)` take `t` as an OPTIONAL last argument, so the
  module stays pure and unit-testable without the provider while every call
  site that renders into the page passes it.

A sentence with a value in the middle is one catalog string with a
placeholder, never fragments concatenated around a `<span>`: where the number
lands differs by language. Where a clause is conditional — "the instalment is
24 % of revenue" vs "…, and the clinic has traded for 1 year" — that is two
whole strings (`ratioOnly` / `ratioWithYears`), not one with a splice.

`tests/i18n.test.js` fails if a key exists in one catalog and not the others,
so all five move in the same commit. It also compares `{{placeholders}}`
per key, which catches the nastiest failure mode: a translation that drops
`{{price}}` and renders a button reading "Buy for" with no number, in one
language only.
