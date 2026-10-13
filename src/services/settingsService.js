import { config } from "../config.js";
import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { publish, Topics } from "../lib/realtime.js";

// Runtime site configuration -- the switches an operator flips while the
// service is running, as opposed to src/config.js (env vars, needs a redeploy)
// or commission_plans (per-product financial policy).
//
// This file is the authority on what a setting *is*: its type, its default,
// and whether it may be handed to an anonymous browser. The site_settings
// table only ever stores overrides, so a fresh database is already correctly
// configured and there is no seed step that can be skipped or forgotten.
//
// Deliberately uncached. SQLite is embedded -- reading these is a primary-key
// lookup over ~a dozen rows in the same process, which is faster than a Redis
// round-trip and far cheaper than the invalidation bugs a cache would invite.
// If profiling ever says otherwise, memoize here and invalidate in write().

const BOOLEAN = "boolean";
const NUMBER = "number";
const OBJECT = "object";
const ARRAY = "array";
const STRING = "string";

export const SETTING_DEFINITIONS = {
  // --- Feature flags -----------------------------------------------------
  // Every one of these is enforced server-side at the route or service that
  // owns the behaviour. A flag that only hides a button in the UI is not a
  // flag -- the API has to refuse too, or anyone with curl ignores it.
  online_purchase_enabled: {
    type: BOOLEAN,
    default: true,
    public: true,
    label: "Online purchasing",
    description: "When off, POST /purchases is refused and the storefront shows a 'Visit us' call to action instead of a buy button.",
  },
  show_prices: {
    type: BOOLEAN,
    default: true,
    public: true,
    label: "Show prices",
    description: "When off, list prices are stripped from public product responses. B2B medical equipment is often quoted rather than listed.",
  },
  signup_enabled: {
    type: BOOLEAN,
    default: true,
    public: true,
    label: "Public sign-up",
    description: "When off, new accounts can only be created by an admin.",
  },
  support_tickets_enabled: {
    type: BOOLEAN,
    default: true,
    public: true,
    label: "Support requests",
    description: "When off, the contact / support request form is closed and POST /support/requests is refused.",
  },
  show_live_activity: {
    type: BOOLEAN,
    default: false,
    public: true,
    label: "Live proforma activity",
    description:
      "When on, the storefront shows a small pop-up of REAL recent proforma and lease requests (\"A clinic requested a proforma for <device> · 2 min ago\"). Only the device and the time are shown -- never a name, phone, email or city. A request you decline disappears from it. Off by default.",
  },
  ai_chat_enabled: {
    type: BOOLEAN,
    default: true,
    public: true,
    label: "AI assistant",
    description: "When off, the storefront chat is hidden and the /ai routes are refused.",
  },
  // --- Storefront sales ---------------------------------------------------
  // These are the numbers the storefront quotes against. They are settings
  // rather than constants because all three move: the central bank rate
  // changes weekly, the leasing partner re-prices, and the rebate is a
  // commercial decision. Each is stamped onto the row at the moment of issue
  // (see salesService), so changing one here never rewrites an agreement a
  // customer has already signed.
  ai_daily_prompt_limit: {
    type: NUMBER,
    default: 20,
    public: true,
    label: "AI messages per day",
    description:
      "How many assistant messages a signed-in customer may send per day. Anonymous visitors get a smaller hourly allowance instead. Public because the composer shows the visitor what they have left before they run out.",
  },
  cbi_eur_irr: {
    type: NUMBER,
    default: 676190,
    public: true,
    label: "CBI EUR→IRR reference rate",
    description:
      "The Central Bank reference rate the storefront converts euro prices at, and the rate written onto a proforma when its 7-day lock is issued.",
  },
  lease_apr_bp: {
    type: NUMBER,
    default: 1800,
    public: true,
    label: "Lease APR (basis points)",
    description:
      "Nominal annual rate used to compute lease instalments. 1800 = 18%. Stamped onto each agreement at signing.",
  },
  // --- The network --------------------------------------------------------
  // The per-product percentages live on the commission plan (one per product,
  // editable at /commission-plans/:productId) because they differ per device.
  // What belongs here is the one decision that is the same for every product:
  // whether the system is allowed to pay anyone by itself.
  network_auto_payout: {
    type: BOOLEAN,
    default: false,
    public: false,
    label: "Pay commission automatically",
    description:
      "OFF (the default): the system records what each node is owed and an admin pays it in " +
      "person, marking it settled on the payout sheet. ON: matured commission is credited to " +
      "the earner's wallet by the scheduled job. Leave it off unless payouts are genuinely " +
      "being made inside the system, or the same commission can be paid twice.",
  },
  product_3d_enabled: {
    type: BOOLEAN,
    // Off by default. The 3D models are procedurally generated
    // approximations of each machine -- good motion for a hero, but on a
    // product page, beside the specification a clinic is about to commit
    // tens of thousands of euros against, the manufacturer's photograph is
    // the honest thing to show. Switch this on to put the interactive
    // model (and its exploded view) back on device pages.
    //
    // Presentation-only, so unlike the flags above there is nothing for the
    // API to refuse: it changes which visual the storefront renders, not
    // what anyone is allowed to do.
    default: false,
    public: true,
    label: "3D product viewer",
    description:
      "When on, device pages show the interactive 3D model instead of the product photograph. Off by default -- the models are approximations, and the photo is what actually ships.",
  },
  blog_enabled: {
    type: BOOLEAN,
    default: true,
    public: true,
    label: "Blog & socials page",
    description: "When off, /blog and /socials are hidden and published posts are no longer served.",
  },
  require_email_verification: {
    type: BOOLEAN,
    default: false,
    public: true,
    label: "Require verified email",
    description:
      "When on, a new account must confirm its email address before it can buy. Sign-up and sign-in still work either way -- this gates purchasing, not access.",
  },

  // --- Commerce policy ---------------------------------------------------
  require_down_payment_covers_payout: {
    type: BOOLEAN,
    default: true,
    public: false,
    label: "Require down payment to cover commission",
    description:
      "Manual orders book commission on the full price at signing, so without this the business can pay out more than it has collected. When on, cash received at signing must be at least the order's total commission payout. A root admin can override per order, with a reason written to the audit log.",
  },
  cheque_reminder_lead_days: {
    type: ARRAY,
    default: [7, 1, 0],
    public: false,
    label: "Cheque reminder schedule",
    description: "Days before a cheque's due date to send a reminder. Each entry sends at most once per cheque.",
  },

  // --- SEO -----------------------------------------------------------------
  // Defaults the storefront falls back to when a page has nothing more
  // specific to say. Maintainable by a CONTENT_ADMIN (the `seo.write`
  // permission covers exactly the seo_* keys -- see routes/admin.js).
  seo_site_name: {
    type: STRING,
    default: "Ashkan Medical Idea",
    public: true,
    label: "SEO: site name",
    description: "Appended to every page title and used as og:site_name.",
  },
  seo_default_description: {
    type: STRING,
    default:
      "Ashkan Medical Idea imports and supports aesthetic and medical laser devices for clinics in Iran -- diode, alexandrite, CO2, picosecond and body-contouring systems.",
    public: true,
    label: "SEO: default description",
    description: "Meta description for pages that do not write their own (max ~160 characters reads best).",
  },
  seo_default_image: {
    type: STRING,
    default: "",
    public: true,
    label: "SEO: default share image",
    description: "Absolute URL of the image used for og:image / twitter:image when a page has none of its own.",
  },
  seo_twitter_handle: {
    type: STRING,
    default: "",
    public: true,
    label: "SEO: Twitter / X handle",
    description: "Used for twitter:site, e.g. @ashkan_medical. Leave empty to omit.",
  },

  // --- Storefront content ------------------------------------------------
  // Public because the 'Visit us' flow is useless without them: if online
  // purchasing is off, this is the only way a customer can reach the company.
  contact: {
    type: OBJECT,
    default: {
      phones: ["021-45242", "+982188665828", "021-88653893"],
      email: "info@ashkan-medical.com",
      address: "Tehran, Vanak Square - Molla Sadra St. - Pardis St. - No. 14, 4th floor, Units 17 & 18",
      support_hours: "24 hours a day, 7 days a week",
      map_lat: 35.7575,
      map_lng: 51.4103,
      map_url: "https://www.openstreetmap.org/?mlat=35.7575&mlon=51.4103#map=17/35.7575/51.4103",
    },
    public: true,
    label: "Contact details",
    description: "Rendered in the site footer and in the 'Visit us' panel shown when online purchasing is off.",
  },
  social: {
    type: OBJECT,
    default: {
      aparat: "https://www.aparat.com/medicalidea/",
      instagram: "https://www.instagram.com/ashkan_medical/",
      linkedin: "https://ir.linkedin.com/in/ashkan-medical-4a31a11a3",
    },
    public: true,
    label: "Social links",
    description: "Footer social icons. An empty string hides that icon.",
  },
};

function decode(key, rawJson) {
  const def = SETTING_DEFINITIONS[key];
  try {
    const parsed = JSON.parse(rawJson);
    // A stored value that no longer matches its definition (someone edited
    // the DB by hand, or a definition's type changed in a deploy) falls back
    // to the default rather than propagating a wrong-typed value into a
    // feature check, where `"false"` would read as truthy.
    if (!typeMatches(def.type, parsed)) return def.default;
    return parsed;
  } catch {
    return def.default;
  }
}

/**
 * Structural equality, for comparing a stored setting against its default.
 *
 * Settings are booleans, numbers, arrays and small objects -- all JSON, with
 * no cycles and no functions -- so serialising with sorted keys is a complete
 * and cheap comparison. Key order differs between a hand-edited row and the
 * coded default, which a naive JSON.stringify comparison would report as a
 * difference.
 */
function sameValue(a, b) {
  const norm = (v) =>
    JSON.stringify(v, (_k, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([x], [y]) => x.localeCompare(y)))
        : val
    );
  return norm(a) === norm(b);
}

function typeMatches(type, value) {
  if (type === BOOLEAN) return typeof value === "boolean";
  if (type === NUMBER) return typeof value === "number" && Number.isFinite(value);
  if (type === ARRAY) return Array.isArray(value);
  if (type === STRING) return typeof value === "string" && value.length <= 2000;
  if (type === OBJECT) return value !== null && typeof value === "object" && !Array.isArray(value);
  return false;
}

// Settings this deployment can veto outright.
//
// A row in the database says what the operator WANTS; an env var says what
// this deployment will actually run, and the env var wins. The assistant is
// off at the deployment level by default, and until AI_ENABLED is set no
// admin toggle can bring it back -- which is the point, because a kill switch
// an operator can undo from a web form is not a kill switch.
//
// Vetoing here rather than at each call site means every consumer sees the
// same answer: the route guard, the services, /site-config, the admin
// console and the storefront all read this one value.
const ENV_VETO = {
  ai_chat_enabled: () => config.aiEnabled,
};

/** The stored value, or `false` if this deployment refuses to run it. */
function veto(key, value) {
  const allowed = ENV_VETO[key];
  return allowed && !allowed() ? false : value;
}

/** Is this setting forced off by the deployment rather than by the operator? */
function vetoed(key) {
  const allowed = ENV_VETO[key];
  return Boolean(allowed) && !allowed();
}

export const settingsService = {
  definitions() {
    return SETTING_DEFINITIONS;
  },

  // Every setting, override-or-default, fully decoded.
  all() {
    const overrides = db.siteSettings.all();
    const out = {};
    for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
      out[key] = veto(key, key in overrides ? decode(key, overrides[key]) : def.default);
    }
    return out;
  },

  get(key) {
    const def = SETTING_DEFINITIONS[key];
    if (!def) throw Errors.badRequest(`Unknown setting '${key}'`, "unknown_setting");
    const stored = db.siteSettings.get(key);
    return veto(key, stored === null ? def.default : decode(key, stored));
  },

  // Boolean flags read through here so a caller can't typo a key into a
  // silently-falsy undefined and accidentally disable something.
  isEnabled(key) {
    const def = SETTING_DEFINITIONS[key];
    if (!def || def.type !== BOOLEAN) throw Errors.badRequest(`'${key}' is not a boolean feature flag`, "unknown_setting");
    return this.get(key) === true;
  },

  // What an anonymous browser is allowed to see. Anything not explicitly
  // marked public stays server-side -- the default is closed, so adding a
  // setting can never accidentally leak it.
  publicConfig() {
    const all = this.all();
    const out = {};
    for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
      if (def.public) out[key] = all[key];
    }
    return out;
  },

  // Admin view: values plus the metadata needed to render an editor.
  adminConfig() {
    const all = this.all();
    const overrides = db.siteSettings.all();
    return Object.entries(SETTING_DEFINITIONS).map(([key, def]) => ({
      key,
      value: all[key],
      default: def.default,
      // Whether the effective value actually DIFFERS from the shipped
      // default -- not merely whether an override row exists.
      //
      // Those are not the same thing, and the difference is visible: toggling
      // a flag off and back on leaves a row behind whose value equals the
      // default, so the console badged it "changed" forever and offered a
      // "revert to default" button that changed nothing. An operator scanning
      // for what has been altered needs the honest answer.
      is_overridden: key in overrides && !sameValue(all[key], def.default),
      // Set when the deployment refuses to run this regardless of the stored
      // value, so the console can say "off because AI_ENABLED is not set"
      // rather than showing a toggle that silently does nothing.
      env_disabled: vetoed(key),
      type: def.type,
      public: def.public,
      label: def.label,
      description: def.description,
    }));
  },

  // Partial update. Unknown keys and wrong types are refused outright rather
  // than ignored -- a silently-dropped flag change is the kind of thing an
  // operator only discovers when the feature they meant to disable is still
  // running.
  update(patch, actorUserId) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw Errors.badRequest("Request body must be an object of setting keys");
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) throw Errors.badRequest("No settings supplied");

    for (const key of keys) {
      const def = SETTING_DEFINITIONS[key];
      if (!def) throw Errors.badRequest(`Unknown setting '${key}'`, "unknown_setting");
      if (!typeMatches(def.type, patch[key])) {
        throw Errors.badRequest(`Setting '${key}' must be of type ${def.type}`, "invalid_setting_type");
      }
    }

    db.transaction(() => {
      for (const key of keys) {
        db.siteSettings.set(key, JSON.stringify(patch[key]), actorUserId);
        db.logs.record({
          actorUserId,
          action: "settings.updated",
          entityType: "site_setting",
          entityId: key,
          meta: { value: patch[key] },
        });
      }
    });

    // Push the new public config to every connected storefront (see
    // routes/events.js). Without this a flag change only reached browsers
    // that happened to reload -- so switching purchasing off left live buy
    // buttons on screen for everyone already browsing, which is exactly the
    // moment the switch is most likely to be used.
    //
    // Published AFTER the transaction commits, so no client can ever observe
    // a value that a rollback then undoes.
    publish(Topics.siteConfig(), this.publicConfig());

    return this.adminConfig();
  },

  // Revert a key to its coded default.
  reset(key, actorUserId) {
    if (!SETTING_DEFINITIONS[key]) throw Errors.badRequest(`Unknown setting '${key}'`, "unknown_setting");
    db.transaction(() => {
      db.siteSettings.clear(key);
      db.logs.record({ actorUserId, action: "settings.reset", entityType: "site_setting", entityId: key });
    });
    return this.adminConfig();
  },
};
