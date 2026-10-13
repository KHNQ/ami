import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onClientAction } from "../../lib/clientActions.js";
import { useStorefront } from "./StorefrontContext.jsx";
import { useCatalogue } from "./CatalogContext.jsx";

// Turns the assistant's `client_action` events into the very same context
// calls the buttons make.
//
// Mounted INSIDE StorefrontProvider, which is the whole point: it can call
// `useStorefront()`, and on pages where that provider is absent it simply is
// not mounted, so `dispatchClientAction` returns false and ChatDock falls back
// to a card.
//
// The slug -> id join happens here and nowhere else. The server only ever
// knows `specs.slug`; the comparison tray is keyed on the bundled catalogue's
// own `id`, and those genuinely differ (`{ id: "primelase", slug:
// "prime-lase" }`). Doing this join on the server would mean teaching it ids
// it has no business knowing, and getting it backwards silently matches
// nothing at all.

/** Frontend device id for a server slug. */
function deviceIdForSlug(slug, catalogue) {
  if (!slug) return null;
  // The catalogue already contains the bundled devices merged with the live
  // rows, so one lookup covers both.
  const live = catalogue.devices?.find((d) => d.slug === slug || d.id === slug);
  if (live) return live.id;
  return null;
}

// Only paths this app actually has. The server sends one of a fixed set, but
// re-checking here means a compromised or confused stream cannot navigate the
// visitor somewhere arbitrary.
const ALLOWED_PREFIXES = [
  "/devices", "/catalog", "/compare", "/installations", "/tools", "/affiliate", "/blog",
  "/account", "/orders", "/profile", "/contact", "/network",
];

export function StorefrontActionBridge() {
  const storefront = useStorefront();
  const catalogue = useCatalogue();
  const navigate = useNavigate();

  useEffect(() => {
    return onClientAction((action) => {
      switch (action?.type) {
        case "compare.add": {
          const ids = (action.slugs || [])
            .map((s) => deviceIdForSlug(s, catalogue))
            .filter(Boolean);
          if (!ids.length) return false;

          // Add only what is missing. `toggleCompare` is a toggle, so calling
          // it on something already in the tray would REMOVE it -- exactly the
          // wrong outcome for "compare these two".
          for (const id of ids) {
            if (!storefront.isComparing(id)) storefront.toggleCompare(id);
          }
          if (action.open !== false) navigate("/compare");
          return true;
        }

        case "compare.clear":
          storefront.clearCompare();
          return true;

        case "price.lock": {
          const id = deviceIdForSlug(action.slug, catalogue);
          if (!id) return false;
          storefront.lockPrice(id);
          return true;
        }

        case "rfq.open":
          storefront.openRfq(deviceIdForSlug(action.slug, catalogue), action.enquiry ?? null);
          return true;

        case "navigate": {
          const to = String(action.to || "");
          if (!ALLOWED_PREFIXES.some((p) => to === p || to.startsWith(`${p}/`) || to.startsWith(`${p}#`))) {
            return false;
          }
          navigate(to);
          return true;
        }

        case "toast":
          storefront.notify(action.message, action.tone || "success");
          return true;

        default:
          return false;
      }
    });
  }, [storefront, catalogue, navigate]);

  return null;
}
