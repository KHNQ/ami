import { defineTool } from "../registry.js";
import { getIndex } from "../../aiService.js";

// Tools whose effect is in the visitor's browser rather than in the database.
//
// "Compare these two" is not a server operation -- the comparison tray is
// client state, and the requirement was that the agent doing it produces the
// same result as the visitor clicking it. So these emit a `client_action`
// event that ChatDock forwards to a bridge mounted inside StorefrontProvider,
// which calls the very same context methods the buttons call.
//
// IMPORTANT: everything here speaks SLUGS. The compare tray is keyed on the
// frontend's own device ids, which are NOT the same strings -- devices.js has
// `{ id: "primelase", slug: "prime-lase" }`. The server has never known those
// ids, and it should not learn them; the bridge does the join through the
// catalogue it already has. Emitting an id from here would look like it worked
// and silently match nothing.

/** The slugs the model is permitted to name, with their display names. */
function knownDevices() {
  const { corpus } = getIndex();
  const map = new Map();
  for (const c of corpus) {
    if (c.kind === "product") map.set(c.slug, c.name);
  }
  return map;
}

function resolveSlugs(slugs) {
  const known = knownDevices();
  const found = [];
  const unknown = [];
  for (const s of slugs) {
    if (known.has(s)) found.push({ slug: s, name: known.get(s) });
    else unknown.push(s);
  }
  return { found, unknown };
}

defineTool("compare_devices", {
  auth: "public",
  parallelSafe: false,
  timeoutMs: 2000,
  description:
    "Put two or three devices side by side in the site's comparison tray and open the comparison " +
    "page. Use when the visitor asks to compare specific machines. This does the same thing as " +
    "them clicking the compare button on each device card.",
  parameters: {
    type: "object",
    properties: {
      slugs: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
        description: "Two or three device slugs from search_catalogue.",
      },
      open: { type: "boolean", description: "Navigate to the comparison page. Default true." },
    },
    required: ["slugs"],
    additionalProperties: false,
  },

  summarise: (r) => (r.opened ? `Comparing ${r.devices.join(" and ")}` : "Nothing to compare"),

  handler({ slugs, open = true }, ctx) {
    const { found, unknown } = resolveSlugs(slugs || []);

    if (!found.length) {
      return {
        opened: false,
        error: `None of those devices exist: ${unknown.join(", ")}. Use search_catalogue to get valid slugs.`,
        code: "unknown_products",
      };
    }
    if (found.length < 2) {
      return {
        opened: false,
        error: "A comparison needs at least two devices.",
        code: "need_two",
        known: found.map((f) => f.slug),
      };
    }

    ctx.emit?.("client_action", {
      type: "compare.add",
      slugs: found.map((f) => f.slug),
      open,
      // The fallback card ChatDock renders when no bridge is listening --
      // on the commerce pages, which are outside StorefrontProvider.
      fallback: { label: `Compare ${found.map((f) => f.name).join(" and ")}`, to: "/compare" },
    });

    // The truth the MODEL is told, which is only what the server knows. The
    // tray may have been full already, in which case the bridge shows the same
    // "holds 3 devices" toast a click would -- that is presentational, and not
    // worth a round trip mid-stream to report back.
    return {
      opened: true,
      devices: found.map((f) => f.name),
      unknown: unknown.length ? unknown : undefined,
      note: "The comparison tray now holds these devices and the comparison page is open.",
    };
  },
});

defineTool("lock_price", {
  auth: "public",
  parallelSafe: false,
  timeoutMs: 2000,
  description:
    "Take a 7-day Rial price lock on a device, the same as the 'Lock the rate' button. Use when " +
    "the visitor worries about the exchange rate moving.",
  parameters: {
    type: "object",
    properties: { slug: { type: "string", maxLength: 100 } },
    required: ["slug"],
    additionalProperties: false,
  },

  summarise: (r) => (r.locked ? `Rate locked on ${r.device}` : "Could not lock"),

  handler({ slug }, ctx) {
    const { found } = resolveSlugs([slug]);
    if (!found.length) return { locked: false, error: `No device with slug "${slug}".`, code: "unknown_product" };

    ctx.emit?.("client_action", {
      type: "price.lock",
      slug: found[0].slug,
      fallback: { label: `Open ${found[0].name}`, to: `/devices/${found[0].slug}` },
    });
    return {
      locked: true,
      device: found[0].name,
      note: "A 7-day Rial lock is held in this browser. The binding lock is the one written onto a proforma -- offer to raise one.",
    };
  },
});

defineTool("open_proforma_form", {
  auth: "public",
  parallelSafe: false,
  timeoutMs: 2000,
  description:
    "Open the proforma request dialog with a device pre-filled, so the visitor can fill it in " +
    "themselves. Prefer create_quote, which raises the request directly -- use this only when they " +
    "explicitly ask to fill in the form, or when they are not signed in.",
  parameters: {
    type: "object",
    properties: {
      slug: { type: "string", maxLength: 100 },
      enquiry: { type: "boolean", description: "Open as a general enquiry rather than a priced proforma." },
    },
    additionalProperties: false,
  },

  summarise: () => "Opened the proforma form",

  handler({ slug, enquiry }, ctx) {
    const { found } = resolveSlugs(slug ? [slug] : []);
    ctx.emit?.("client_action", {
      type: "rfq.open",
      slug: found[0]?.slug ?? null,
      enquiry: Boolean(enquiry),
      fallback: { label: "Request a proforma", to: found[0] ? `/devices/${found[0].slug}` : "/devices" },
    });
    return { opened: true, device: found[0]?.name ?? null };
  },
});

defineTool("navigate_to", {
  auth: "public",
  parallelSafe: false,
  timeoutMs: 2000,
  description:
    "Take the visitor to a page on this site. Use for things that must be done on a real screen -- " +
    "changing a password, deleting an account, paying -- and for 'show me X'. Never invent a path; " +
    "use one of the listed destinations.",
  parameters: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        enum: [
          "devices", "catalog", "compare", "installations", "tools", "affiliate", "blog",
          "account", "orders", "profile", "profile_password", "profile_delete",
          "contact", "network",
        ],
      },
      device_slug: {
        type: "string",
        maxLength: 100,
        description: "Optional: open a specific device page instead of the destination.",
      },
    },
    required: ["destination"],
    additionalProperties: false,
  },

  summarise: (r) => `Opened ${r.to}`,

  handler({ destination, device_slug }, ctx) {
    // An allowlist, not free text. A path the model composes is a path the
    // model can get wrong, and a chat that navigates somewhere unexpected is
    // worse than one that does nothing.
    const PATHS = {
      devices: "/devices", catalog: "/catalog", compare: "/compare",
      installations: "/installations", tools: "/tools", affiliate: "/affiliate", blog: "/blog",
      account: "/account", orders: "/orders", profile: "/profile",
      // Password and account deletion are NOT tools. changePassword rotates
      // token_version, which would 401 the open stream mid-answer, and the
      // tool would need the current password as an argument -- which would
      // then sit in plaintext in ai_messages. Sending the visitor to the real
      // screen is the same click and the same result, without either problem.
      profile_password: "/profile#password",
      profile_delete: "/profile#delete",
      contact: "/contact", network: "/network",
    };

    let to = PATHS[destination];
    if (device_slug) {
      const { found } = resolveSlugs([device_slug]);
      if (found.length) to = `/devices/${found[0].slug}`;
    }
    if (!to) return { error: `Unknown destination "${destination}".`, code: "unknown_destination" };

    ctx.emit?.("client_action", { type: "navigate", to, fallback: { label: `Open ${to}`, to } });
    return { opened: true, to };
  },
});
