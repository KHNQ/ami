import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { config } from "../config.js";
import { commissionPlanService } from "./commissionPlanService.js";
import { settingsService } from "./settingsService.js";
import { normalizeLeaseRules } from "../lib/leaseRules.js";
import { slugify } from "../lib/slug.js";

export const productService = {
  create({ name, description, specs, stockCount, xCents, yCents, leaseRules }, actorUserId) {
    if (!name) throw Errors.badRequest("name is required");
    if (!Number.isInteger(xCents) || xCents < 0) throw Errors.badRequest("xCents must be a non-negative integer");
    if (!Number.isInteger(yCents) || yCents <= 0) throw Errors.badRequest("yCents must be a positive integer");

    // Lease terms are chosen when the product is created, and live in specs
    // beside everything else the storefront reads about it.
    const lease = normalizeLeaseRules(leaseRules ?? specs?.lease_rules);
    // Every product gets a public slug. The storefront's /devices/:id page
    // is keyed on it, so a product created in the admin console has to
    // carry one to appear in the public catalogue at all.
    const storedSpecs = { ...specs, slug: this.uniqueSlug(specs?.slug || name) };
    if (lease) storedSpecs.lease_rules = lease;

    const product = db.transaction(() => {
      const p = db.products.create({ name, description, specs: storedSpecs, stockCount, xCents, yCents });
      db.warehouseCost.append({ productId: p.id, xCents, createdBy: actorUserId });
      // Every product gets a sane default commission plan immediately, so it's
      // always sellable; admins can PATCH it later (validated the same way).
      const plan = commissionPlanService.upsert(p.id, {
        minMarginThresholdCents: config.defaults.minMarginThresholdCents,
        payoutPoolPctBp: config.defaults.payoutPoolPctBp,
        levelRatesBp: config.defaults.levelRatesBp,
        maxPayoutDepth: config.defaults.maxPayoutDepth,
        activityMinPvCents: config.defaults.activityMinPvCents,
        activityPeriodDays: config.defaults.activityPeriodDays,
        decayInactiveDays: config.defaults.decayInactiveDaysThreshold,
        decayPctPerPeriodBp: config.defaults.decayPctPerPeriodBp,
        reservePctBp: config.defaults.reservePctBp,
        rankBonusPoolPctBp: config.defaults.rankBonusPoolPctBp,
      });
      db.products.setCommissionPlan(p.id, plan.id);
      return db.products.get(p.id);
    });
    db.logs.record({ actorUserId, action: "product.create", entityType: "product", entityId: product.id, meta: { xCents, yCents } });
    return this.hydrate(product);
  },

  /** A slug no other product is using, derived from `base`. */
  uniqueSlug(base, ignoreId = null) {
    const root = slugify(base) || "product";
    const taken = new Set();
    for (const row of db.products.list({ limit: 10_000 })) {
      if (row.id === ignoreId) continue;
      try {
        const slug = JSON.parse(row.specs_json).slug;
        if (slug) taken.add(slug);
      } catch {
        /* a malformed row cannot hold a slug */
      }
    }
    let candidate = root;
    for (let n = 2; taken.has(candidate); n++) candidate = `${root}-${n}`;
    return candidate;
  },

  hydrate(product) {
    if (!product) return null;
    // `specs_json` is the raw stored string and `specs` is the parsed form
    // of the same data -- shipping the row verbatim sent BOTH, so every
    // response carried the payload twice over. Consumers only ever read
    // `specs`.
    const { specs_json: rawSpecs, ...row } = product;
    const specs = JSON.parse(rawSpecs);
    // Product images are stored as base64 data URLs inside specs. That one
    // field is ~120KB -- 99% of a product's entire JSON -- so listing 16
    // products used to ship 3.4MB before any of it could be rendered.
    // Reads advertise a URL instead and the bytes are fetched once, from
    // GET /products/:id/image, where they cache like any other image.
    if (specs.image_data_url) {
      const { image_data_url: _omitted, ...rest } = specs;
      return { ...row, specs: { ...rest, image_url: `/products/${product.id}/image` } };
    }
    return { ...row, specs };
  },

  // What an unauthenticated storefront visitor is allowed to see.
  //
  // `current_x_cents` is the warehouse cost -- what the company pays per unit.
  // It was previously included in every public product response, which told
  // any visitor the exact per-device margin. Only the admin pages have ever
  // read it, so it comes out of the public shape unconditionally.
  //
  // The list price additionally drops when the show_prices flag is off:
  // B2B medical equipment is usually quoted rather than listed, and the
  // source site never displays prices at all. Purchases are unaffected --
  // purchaseService reads the price from the database, not from this view.
  publicView(product) {
    if (!product) return null;
    const { current_x_cents: _cost, ...rest } = product;
    if (settingsService.isEnabled("show_prices")) return rest;
    const { list_price_y_cents: _price, ...noPrice } = rest;
    return { ...noPrice, price_on_request: true };
  },

  getPublic(id) {
    return this.publicView(this.get(id));
  },

  listPublic(opts) {
    return this.list(opts).map((p) => this.publicView(p));
  },

  // The stored data URL, decoded. Only the image route needs this.
  image(id) {
    const p = db.products.get(id);
    if (!p) throw Errors.notFound("Product not found");
    const dataUrl = JSON.parse(p.specs_json).image_data_url;
    const match = dataUrl && /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) return null;
    const [, mime, base64] = match;
    return {
      mime,
      bytes: Buffer.from(base64, "base64"),
      // Weak but sufficient and cheap: the stored payload is immutable
      // until someone uploads a replacement, and any replacement changes
      // both the length and the leading bytes.
      etag: `W/"${base64.length.toString(36)}-${base64.slice(0, 16).replace(/\W/g, "")}"`,
    };
  },

  get(id) {
    const p = db.products.get(id);
    if (!p) throw Errors.notFound("Product not found");
    return this.hydrate(p);
  },

  list(opts = {}) {
    const { category, ...rest } = opts;
    const rows = db.products.list(rest).map((p) => this.hydrate(p));
    if (!category) return rows;
    // Filtered in JS rather than SQL: category membership lives inside the
    // specs JSON blob (many-to-many, set by the content import), and with a
    // catalogue this size the difference is unmeasurable. If it ever grows to
    // thousands, promote category_slugs to its own table and join instead.
    return rows.filter((p) => (p.specs?.category_slugs || []).includes(category));
  },

  /** Distinct category slugs currently represented in the catalogue. */
  categories() {
    const counts = new Map();
    for (const p of db.products.list({ limit: 1000, status: "active" })) {
      for (const slug of JSON.parse(p.specs_json).category_slugs || []) {
        counts.set(slug, (counts.get(slug) || 0) + 1);
      }
    }
    return [...counts.entries()].map(([slug, count]) => ({ slug, count })).sort((a, b) => a.slug.localeCompare(b.slug));
  },

  update(id, fields, actorUserId) {
    const existing = db.products.get(id);
    if (!existing) throw Errors.notFound("Product not found");

    // `specs` is stored as one JSON blob, so a caller sending a partial
    // specs object would otherwise wipe every key it didn't mention --
    // including the image, which reads no longer return and so can't be
    // echoed back. Merge over the stored object instead of replacing it.
    const { lease_rules: leaseRules, ...rest } = fields;
    const nextSpecs = { ...JSON.parse(existing.specs_json), ...fields.specs };
    if (leaseRules !== undefined) {
      // null resets to the defaults rather than storing a null that every
      // reader would have to special-case.
      const lease = normalizeLeaseRules(leaseRules);
      if (lease) nextSpecs.lease_rules = lease;
      else delete nextSpecs.lease_rules;
    } else if (fields.specs?.lease_rules !== undefined) {
      nextSpecs.lease_rules = normalizeLeaseRules(fields.specs.lease_rules) ?? undefined;
      if (nextSpecs.lease_rules === undefined) delete nextSpecs.lease_rules;
    }
    const patch = fields.specs === undefined && leaseRules === undefined ? rest : { ...rest, specs: nextSpecs };

    const p = db.products.update(id, patch);
    // Never log the base64 blob -- it would bloat the audit table by ~120KB
    // per edit for no diagnostic value.
    const loggedMeta = patch.specs ? { ...patch, specs: Object.keys(patch.specs) } : patch;
    db.logs.record({ actorUserId, action: "product.update", entityType: "product", entityId: id, meta: loggedMeta });
    return this.hydrate(p);
  },

  setStatus(id, status, actorUserId) {
    this.get(id);
    if (!["active", "discontinued"].includes(status)) throw Errors.badRequest("invalid status");
    const p = db.products.setStatus(id, status);
    db.logs.record({ actorUserId, action: "product.set_status", entityType: "product", entityId: id, meta: { status } });
    return this.hydrate(p);
  },

  updatePrice(id, yCents, actorUserId) {
    this.get(id);
    if (!Number.isInteger(yCents) || yCents <= 0) throw Errors.badRequest("yCents must be a positive integer");
    let p = db.products.updatePrice(id, yCents);
    // A price an operator types in is, by definition, no longer a
    // placeholder. Leaving the flag set made the storefront keep showing its
    // own indicative figure and ignore the one just entered -- so the admin
    // console, the walk-in desk and the customer's proforma each quoted a
    // different number for the same machine.
    const specs = JSON.parse(p.specs_json);
    if (specs.placeholder_pricing) {
      delete specs.placeholder_pricing;
      p = db.products.update(id, { specs });
    }
    db.logs.record({ actorUserId, action: "product.update_price", entityType: "product", entityId: id, meta: { yCents } });
    return this.hydrate(p);
  },

  appendWarehouseCost(id, xCents, actorUserId) {
    this.get(id);
    if (!Number.isInteger(xCents) || xCents < 0) throw Errors.badRequest("xCents must be a non-negative integer");
    const row = db.transaction(() => {
      const entry = db.warehouseCost.append({ productId: id, xCents, createdBy: actorUserId });
      db.products.setCurrentX(id, xCents);
      return entry;
    });
    db.logs.record({ actorUserId, action: "product.warehouse_cost", entityType: "product", entityId: id, meta: { xCents } });
    return row;
  },

  warehouseCostHistory(id, opts) {
    this.get(id);
    return db.warehouseCost.listByProduct(id, opts);
  },

  adjustStock(id, delta, actorUserId) {
    const current = this.get(id);
    if (!Number.isInteger(delta)) throw Errors.badRequest("delta must be an integer");
    // Stock is a physical count -- a negative one is never meaningful, and
    // silently allowing it would let the storefront keep selling a product
    // the warehouse has already run out of.
    if (current.stock_count + delta < 0) {
      throw Errors.badRequest(
        `delta ${delta} would take stock below zero (current ${current.stock_count})`,
        "stock_would_go_negative",
        { stock_count: current.stock_count, delta }
      );
    }
    const p = db.products.adjustStock(id, delta);
    db.logs.record({ actorUserId, action: "product.adjust_stock", entityType: "product", entityId: id, meta: { delta } });
    return this.hydrate(p);
  },
};
