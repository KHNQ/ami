# Trex — Multi-Space MLM Platform: Full Model Specification

## 2. Core Concepts & Terminology

| Term | Definition |
|---|---|
| **Trex** | The parent company/platform. Owns all inventory, sets prices, and is the ultimate payer/receiver of every transaction. |
| **Product** | A sellable item with metadata: name, specs, description, warehouse cost `x`, market price `y`, stock count. A product can have many independent Spaces. |
| **Space** | One independent MLM tree, scoped to exactly one Product. A Space is created the moment someone buys that product **without** a redeem code. That buyer becomes the space's **root**. |
| **Node** | A single position inside a Space's tree — one user, one place in that tree. A node has at most one parent (its "sponsor") and any number of children (its "downline"). |
| **Root node** | The node with no parent — the person who originated the Space by buying without a redeem code. |
| **Redeem code** | A unique invite code generated per node, scoped to one (Space, Product). Giving this code to a new buyer places that buyer as a child node under the code owner, inside that same Space. |
| **Upline** | All ancestor nodes above a given node, up to the root. |
| **Downline** | All descendant nodes below a given node. |
| **x (warehouse price)** | Trex's internal cost basis for one unit of a product (what Trex effectively "pays" to have the unit ready to sell). Can change over time (restocks, supplier changes) — always resolved per transaction, not per product-lifetime. |
| **y (market price)** | The price the end buyer actually pays for one unit in a given transaction. May vary by promo/discount, but is bounded (see invariants). |
| **Margin** | `margin = y - x` for a given transaction. This is the pool from which all commissions are paid, and from which Trex keeps its net profit. |
| **Commission pool / payout pool** | The portion of `margin` set aside to be distributed across the upline chain for a transaction. Strictly less than 100% of margin. |
| **Trex net** | What Trex keeps from a transaction after paying out the commission pool: `margin - total_payout`. Must always be > 0. |

---

## 3. Structural Rules (Spaces & Trees)

1. **One product → many spaces.** Any number of independent Spaces can exist for the same Product,
   because any buyer without a redeem code starts a brand-new Space.

2. **Space creation rule:**
   - Buyer purchases Product **with no redeem code** → a **new Space** is created for that product,
     with the buyer as the **root node**. The buyer receives their own personal redeem code, scoped to
     this new Space, which they can now give out.
   - Buyer purchases Product **with a valid redeem code** → the buyer becomes a **new node**, attached
     as a child of the node that owns that redeem code, inside that code's existing Space (no new
     Space is created). The buyer also receives their own redeem code, scoped to this same Space, so
     they can recruit further down.

3. **One space per user per product.** A given `(user_id, product_id)` pair may occupy **at most one
   node**, across all Spaces of that product. This prevents a user from re-joining multiple times
   under themselves or gaming their own downline for the same product. (A user *can* have separate
   nodes in Spaces for *different* products — the constraint is per-product, not global.)

4. **A redeem code is scoped to exactly one (Space, Node, Product) triple.** It cannot be reused to
   join a different Space, even for the same product.

5. **Tree shape per Space:** unbounded branching factor (a node can sponsor any number of direct
   children), but see Section 6 for the **payout depth cap**, which is a commission-plan limit, not a
   structural limit — the tree itself can grow deeper than what gets paid.

6. **Products are independent of each other.** Each Product has its own metadata, its own `x`, its own
   set of Spaces, and its own commission-plan configuration (rates/caps can differ per product).

### 3.1 Data Model (reference schema)

```text
Product
  id
  name
  description
  specs (json)
  stock_count
  current_x            // current warehouse cost; see WarehouseCostHistory for the true source of truth
  commission_plan_id    // FK -> CommissionPlan (see Section 6)
  status: active | discontinued

WarehouseCostHistory      // append-only log; "current_x" is a cache of the latest row
  id
  product_id
  x_value
  effective_from (timestamp)

Space
  id
  product_id
  root_user_id
  root_node_id
  created_at

Node
  id
  space_id
  product_id            // denormalized for the uniqueness constraint below
  user_id
  parent_node_id (nullable — null only for root)
  own_redeem_code_id
  personal_volume_period (rolling counter, resets per commission period)
  lifetime_volume
  status: active | inactive | suspended
  joined_at
  UNIQUE (user_id, product_id)     -- enforces "one space per user per product"

RedeemCode
  id
  code (unique string)
  owner_node_id
  product_id
  space_id
  max_uses (nullable = unlimited)
  uses_count
  expires_at (nullable)
  status: active | expired | revoked

Transaction
  id
  product_id
  space_id
  buyer_node_id
  x_at_sale             // locked warehouse cost at time of sale
  y_at_sale             // locked sale price at time of sale
  margin = y_at_sale - x_at_sale
  payout_pool_amount
  trex_net_amount
  status: completed | refunded | partially_refunded
  created_at

CommissionLedgerEntry
  id
  transaction_id
  node_id                // which ancestor got paid
  level_depth            // 1 = direct sponsor, 2 = sponsor's sponsor, etc.
  rate_applied
  amount
  status: pending | paid | clawed_back
  paid_at

CommissionPlan            // per-product configuration
  id
  product_id
  min_margin_threshold    // hard floor, e.g. margin must be >= this
  payout_pool_pct (P_max) // e.g. 0.65  -> at most 65% of margin ever leaves as commissions
  level_rates: [r1, r2, ..., rN]   // sum(level_rates) MUST be <= payout_pool_pct
  max_payout_depth: N
  activity_requirement: { min_personal_volume_per_period, period_days }
  decay_rule: { inactive_days_threshold, decay_pct_per_period }
```

---

## 4. Lifecycle Walkthrough (concrete example)

1. Product **P1** exists: `x = 40` (warehouse cost), listed at `y = 100`.
2. **Alice** buys P1 with no redeem code → new **Space S1** created, Alice = root node of S1. Alice
   gets redeem code `ALICE-P1-XYZ`.
3. **Bob** buys P1 using `ALICE-P1-XYZ` → Bob becomes a node inside S1, child of Alice. Bob gets his
   own code `BOB-P1-ABC`, scoped to S1.
4. **Carol** buys P1 using `BOB-P1-ABC` → Carol becomes a node inside S1, child of Bob (grandchild of
   Alice).
5. **Dave** buys P1 with **no** redeem code → new **Space S2** created (separate tree, same product),
   Dave = root of S2.
6. Now P1 has two independent Spaces: S1 (Alice → Bob → Carol) and S2 (Dave alone so far).
7. Every purchase inside S1 or S2 triggers the commission-distribution algorithm (Section 6), paying
   Alice/Bob (for S1 sales) or Dave (for S2 sales) according to the CommissionPlan for P1 — always
   bounded by the invariants in Section 5.

---

## 5. Financial Invariants (MUST be enforced in code, not just documented)

These are the non-negotiable rules. **Every transaction must be validated against all of them before
it is allowed to complete.** If any check fails, reject or clamp the transaction — never let it
silently violate an invariant.

### Invariant 1 — Positive margin, always
```
margin = y_at_sale - x_at_sale
REQUIRE margin >= min_margin_threshold > 0
```
Enforced at checkout time, using the **locked-in** `x_at_sale` (see Invariant 4) and the actual final
`y_at_sale` (after any discount/promo code is applied). If a discount would push `y` below
`x + min_margin_threshold`, the discount must be capped/rejected — never silently applied.

### Invariant 2 — Payout pool never exceeds a fixed fraction of margin
```
payout_pool_amount = margin * payout_pool_pct        // payout_pool_pct is a constant < 1, e.g. 0.65
REQUIRE sum(level_rates) <= payout_pool_pct           // validated at CommissionPlan save-time, not per-tx
```

### Invariant 3 — Trex net is always strictly positive
```
trex_net_amount = margin - total_actual_payout
total_actual_payout <= payout_pool_amount   (fewer qualifying ancestors than max_payout_depth => less paid out, never more)
=> trex_net_amount >= margin * (1 - payout_pool_pct) > 0
```
This holds **regardless of tree depth or shape**, because payout is capped as a percentage of margin,
not as a fixed sum per level. A deep tree just means more levels *share* the same bounded pool (or
levels beyond `max_payout_depth` simply get nothing) — it can never cause Trex to pay out more than
`payout_pool_pct` of margin.

### Invariant 4 — Cost/price are locked per transaction, not looked up live post-hoc
- `x_at_sale` and `y_at_sale` are snapshotted onto the `Transaction` row at the moment of sale.
- Later changes to a Product's `current_x` or list price must never retroactively alter historical
  transactions, ledger entries, or already-paid commissions.

### Invariant 5 — Refund/clawback consistency
- If a `Transaction` is refunded (fully or partially), all `CommissionLedgerEntry` rows tied to it must
  be proportionally clawed back (status → `clawed_back`), before or in the same operation as the
  refund, so paid-out commissions can never exceed a margin that no longer exists.
- Recommended: hold commissions in a `pending` state for a configurable return-window (e.g. 14 days)
  before flipping to `paid` and releasing to the node's withdrawable balance.

### Invariant 6 — Rounding always favors Trex
- All commission amounts are rounded **down** to the smallest currency unit; residual fractions
  accumulate to `trex_net_amount`, never to the payout pool.

### Invariant 7 — No commission funded by fees, only by margin
- Any platform/service fees (space activation fee, redeem-code issuance fee, listing fee, etc.) are
  booked as **separate revenue lines**, and must **never** be used as the source of commission payouts.
  Commissions are only ever paid from realized product margin (Invariant 1–3). This keeps the system on
  the legitimate side of the MLM/pyramid-scheme line (see Section 1).

---

## 6. Commission Distribution Algorithm

Given a completed `Transaction` on `buyer_node`:

```
function distribute_commission(transaction):
    margin = transaction.y_at_sale - transaction.x_at_sale
    assert margin >= plan.min_margin_threshold        // Invariant 1, should already be pre-validated

    payout_pool = margin * plan.payout_pool_pct        // Invariant 2 cap
    remaining = payout_pool

    ancestor = buyer_node.parent
    depth = 1
    while ancestor is not null and depth <= plan.max_payout_depth:
        if ancestor.status == "active" and ancestor.meets_activity_requirement(plan):
            rate = plan.level_rates[depth]             // may be decayed, see below
            amount = floor(margin * rate)               // Invariant 6: round down
            create CommissionLedgerEntry(
                transaction = transaction,
                node = ancestor,
                level_depth = depth,
                rate_applied = rate,
                amount = amount,
                status = "pending"
            )
            remaining -= amount
        // else: ancestor is inactive/suspended or fails activity requirement -> gets 0,
        //       and (per plan config) that unpaid share either:
        //         (a) stays with Trex (recommended, safest), or
        //         (b) rolls up to the next active ancestor ("compression") — optional feature
        ancestor = ancestor.parent
        depth += 1

    transaction.payout_pool_amount = payout_pool
    transaction.trex_net_amount = margin - (payout_pool - remaining)
    save(transaction)
```

Notes:
- **Activity requirement** (`meets_activity_requirement`): a node only qualifies for override
  commissions in the current period if its `personal_volume_period >= activity_requirement.min_personal_volume_per_period`.
  This is what keeps commissions tied to real, ongoing selling/buying activity rather than pure
  recruitment — and it is a standard feature regulators look for as evidence of a legitimate model.
- **Decay rule** (optional): if a node has been inactive longer than `inactive_days_threshold`, its
  effective `rate_applied` at each level is multiplied down by `decay_pct_per_period` per period of
  continued inactivity, asymptotically toward 0. This discourages "squatting" on a tree position
  without ever engaging.
- **Compression** (optional, advanced): if you choose option (b) above, be careful — compression must
  still respect Invariant 2/3 (the compressed amount comes out of the *same* bounded `payout_pool`, it
  never adds a new pool).

---

## 7. Motivation / Incentive Layer (bonuses, fees)

To keep nodes and trees actually active (not just structurally present), layer these on top of the
base per-transaction commission, **all funded only from already-realized `trex_net`, paid out
periodically — never advanced or promised ahead of realized margin**:

1. **Direct retail margin** — every node keeps a cut of margin on units they personally sell to brand
   new (non-network) customers, separate from override commissions. Reinforces genuine retail sales.
2. **Level override commissions** — as defined in Section 6.
3. **Personal Volume (PV) activity gate** — a node must hit a minimum personal purchase/sale volume in
   a period to remain "active" and keep earning overrides; falling below suspends override eligibility
   (but the node keeps direct retail margin on anything they still sell).
4. **Rank / leadership bonus pool** — a small, fixed % of Trex's *already-collected* net profit for a
   period, split among nodes that hit team-volume + personal-volume thresholds for that rank. Funded
   from `trex_net`, not from margin pool, and not promised in advance.
5. **Space health decay** — as in Section 6, inactive nodes' commission rates taper toward zero over
   time, freeing up "headroom" under the payout cap and discouraging inactive tree squatting.
6. **Redeem-code governance** — codes can have `max_uses` / `expires_at` to prevent spam recruiting;
   consider a small, transparent issuance fee for extra codes beyond a free allotment (booked as
   platform fee revenue, per Invariant 7 — never as commission funding).
7. **Buy-back / return policy** — nodes can return unsold personal inventory to Trex within a window
   for a partial refund. This is the single most important anti-pyramid-scheme feature: it removes the
   incentive to over-recruit purely to force "inventory loading" on downline members.
8. **Depth cap (`max_payout_depth`)** — hard limit (recommend 5–7 levels) so payout pools can't be
   diluted across an unbounded tree; also keeps compute for commission distribution bounded per
   transaction.

---

## 8. Edge Cases & Validation Rules to Implement

- **Reject** any purchase attempt where `(user_id, product_id)` already has a Node (enforce via unique
  constraint + application-level check with a clear error, e.g. "You already have a position for this
  product").
- **Reject** redeem codes that are expired, revoked, or at `max_uses`.
- **Reject** a transaction if computed `margin < min_margin_threshold` after all discounts — do this
  check server-side at the final checkout step, not just at cart-display time.
- **Self-referral prevention:** a redeem code's owner cannot redeem their own code (would violate the
  one-node-per-product rule anyway, but validate explicitly with a clear error message).
- **Circular parentage:** structurally impossible given the creation flow (nodes only ever attach as a
  *new* child, never re-parented), but if you ever add a "move node" admin feature, explicitly guard
  against creating a cycle.
- **Concurrent redeem-code use at `max_uses` boundary:** use a DB-level atomic increment / row lock on
  `RedeemCode.uses_count` to avoid race conditions letting more than `max_uses` redemptions through.
- **Refund after downline has already been paid multi-level:** clawback must walk the same ancestor
  chain that was originally paid (stored explicitly in `CommissionLedgerEntry`, not recomputed later —
  tree shape could theoretically change conceptually even if not in practice, so always clawback based
  on the ledger, not a live tree walk).
- **Warehouse cost change mid-flight:** always use `x_at_sale` locked at transaction time; never
  recompute margin for historical transactions when `current_x` changes later.
- **Currency/decimal precision:** use integer minor units (e.g. cents) internally for all money math to
  avoid floating point drift; only format to decimal at display time.

---

## 9. Suggested API Surface (for implementation scaffolding)

```
POST   /products                         create product (admin)
GET    /products/:id                     product detail incl. metadata, current x/y, active plan
PATCH  /products/:id/price                update y (list price)
POST   /products/:id/warehouse-cost       append new x to WarehouseCostHistory

POST   /spaces                            (internal) create a space — invoked by purchase flow, not directly by users
GET    /spaces/:id/tree                   fetch full tree structure of a space (for visualization)

POST   /redeem-codes                      generate a redeem code for the caller's node (per product/space)
GET    /redeem-codes/:code                validate a code (product, space, owner, remaining uses)

POST   /purchases                         body: { product_id, redeem_code (optional), payment_info }
                                           -> runs full flow: validate code (or create space), create Node,
                                              create Transaction, run distribute_commission, return receipt

POST   /transactions/:id/refund           triggers clawback + Trex net recompute

GET    /nodes/:id                         node detail: status, PV, lifetime volume, upline chain, own code
GET    /nodes/:id/downline                 paginated downline listing (for the user's dashboard)
GET    /nodes/:id/earnings                 ledger of commission entries for this node

GET    /commission-plans/:product_id       view active plan
PATCH  /commission-plans/:product_id       update plan — MUST validate sum(level_rates) <= payout_pool_pct
                                            server-side before saving (Invariant 2)

GET    /admin/reports/trex-net             aggregate trex_net over a period, per product/space, for auditing
```

---

## 10. Implementation Priorities (suggested build order)

1. Product + WarehouseCostHistory + CommissionPlan models, with plan-save validation
   (`sum(level_rates) <= payout_pool_pct`) as a hard server-side check (unit test this explicitly).
2. Space/Node creation flow (no-code → new space+root; with-code → attach as child), enforcing the
   one-node-per-user-per-product constraint.
3. RedeemCode generation + validation + atomic use-count increment.
4. Transaction creation with locked `x_at_sale`/`y_at_sale` and the Invariant 1 checkout guard.
5. `distribute_commission` algorithm (Section 6) + CommissionLedgerEntry writes, with Invariant 2/3
   enforced by construction (payout_pool computed once, entries only subtract from it).
6. Refund/clawback flow (Invariant 5).
7. Activity requirement + decay rule (Section 6/7) as a scheduled job recalculating node status per
   period.
8. Reporting endpoint to continuously audit that `trex_net_amount > 0` on every historical transaction
   (a standing regression check / alarm, not just a one-time test).
9. Buy-back/return feature (Section 7.7).
10. Dashboards: tree visualization per space, node earnings ledger, admin trex-net reporting.

---

## 11. One-paragraph Summary (for quick onboarding)

Trex sells Products, each with a warehouse cost `x` and a market price `y`. Any purchase without a
redeem code spins up a brand-new independent MLM tree ("Space") for that product with the buyer as
root; a purchase with a valid redeem code attaches the buyer as a new child node inside that code's
existing Space. Each user may hold only one node per product. Every transaction's margin (`y - x`) is
locked at sale time and must always be strictly positive; from that margin, a capped percentage
(`payout_pool_pct`, e.g. 65%) is distributed up the buyer's ancestor chain via fixed per-level rates
that are validated at commission-plan configuration time to never sum above the cap — guaranteeing
Trex's net profit per transaction is always strictly positive by construction, regardless of tree depth
or shape. Activity requirements, rank bonuses, decay rules, redeem-code governance, and a buy-back
policy exist to keep participants genuinely engaged and to keep the whole system on the legitimate,
non-pyramid-scheme side of MLM regulation.




plain menaing of financial invarioants
#	Plain meaning	Why you can't skip it
1	Sale price minus warehouse cost must be a positive number, every time	Without this, Trex loses money on the sale itself, before any commissions are even paid
2	You never hand out more than, say, 65% of that margin as commissions, no matter how deep the tree is	Without this, a really deep/lucky tree chain could accidentally eat 100%+ of the margin
3	Whatever's left after paying commissions must be a positive number for Trex	This is the actual "Trex never loses money" guarantee — it's the result of #1 and #2 working together
4	Once a sale happens, lock in that price/cost forever — don't let later price changes rewrite old sales	Without this, changing today's warehouse cost could retroactively make yesterday's sales look like a loss (or a lie)
5	If a sale is refunded, claw back the commissions that were paid on it	Without this, you could pay commission on money that no longer exists in the bank
6	Round commission amounts down, keep the leftover cents for Trex	Tiny rounding errors, multiplied by thousands of transactions, could tip Trex negative over time
7	Commissions can only come from real product margin — never from signup/joining fees	This is what keeps it a legal MLM instead of an illegal pyramid schemek



we need routes for login and signup and auth
we need routes for profile and deposite and purchase and withdraw and wallet stuffs.
routes for orders (admin only)
we need routes for admin for varous controls.
ro8utes for full monitoriong of any section(admin only)
routes for supports ..
routees for logs. (admin only)
and the overal thing is people visit our web app in order to buy products...
routeds related to the products..
our backend routes must conver everything realted to our system. that a cmmercial mlm app needs


stack backend is bun.js , hono for high performance, sqlite for now (but have db layer that we can change easily the engine but ,
the interface never chagned)
write in javascript you can choose mongdb . i think mongodb is better and good for scale we can also use leveldb if so

we also need to reserve some profit money some percentage for a reserve back dev
for dev stuffs and maintaining and other stuffs.
also if we included the reseve profi and dev the total trex net must still be positive


then try to test all the endponts and various scnearios like the combination of endpoints buy and build spaces and join people.. and montiro the trex net and dev net.. for one quarter

means in one month with these amonth of sale for this product with this price we have this net.
so all kinds of test and pass them all.
