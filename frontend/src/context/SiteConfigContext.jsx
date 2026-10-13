import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api.js";

// Runtime feature flags and contact details, from GET /site-config.
//
// Defaults are permissive and match the server's own defaults, so the first
// paint before the fetch resolves shows the normal storefront rather than
// flashing "Visit us" and then swapping to a buy button. The server enforces
// every one of these regardless -- this only decides what to render.
//
// The assistant is the exception, and defaults CLOSED: it ships switched off
// (AI_ENABLED on the server), and guessing "on" would mean every page load on
// every deployment fetched the chat bundle and flashed a launcher for a
// feature that is not there. The other direction is cheap -- the button
// appears a moment after /site-config says it should.
const DEFAULTS = {
  online_purchase_enabled: true,
  show_prices: true,
  signup_enabled: true,
  support_tickets_enabled: true,
  // Defaults CLOSED, like the assistant: it publishes customers' activity, so it
  // is opt-in and nothing should flash on screen before the server says it is on.
  show_live_activity: false,
  ai_chat_enabled: false,
};

const SiteConfigContext = createContext(DEFAULTS);

export function SiteConfigProvider({ children, initial }) {
  // SSR injects the config into __SSR_DATA__ so a server-rendered page is
  // already correct -- a buy button that appears and then vanishes is worse
  // than one that was never there.
  const [config, setConfig] = useState(() => ({ ...DEFAULTS, ...(initial || {}) }));

  useEffect(() => {
    let cancelled = false;
    api
      .siteConfig()
      .then((res) => {
        if (!cancelled && res) setConfig((c) => ({ ...c, ...res }));
      })
      .catch(() => {
        // A failed config fetch must not break the storefront: fall through
        // to the permissive defaults. The API still refuses anything that is
        // actually switched off.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates.
  //
  // Without this, config was read once at boot, so an admin switching
  // purchasing off left working buy buttons on screen for every visitor
  // already browsing until they happened to reload -- which is precisely the
  // moment such a switch gets used. EventSource reconnects on its own after a
  // drop, so a blip self-heals without any retry logic here.
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return undefined;

    const source = new EventSource(`${api.baseUrl()}/events/site-config`);
    source.addEventListener("config", (e) => {
      try {
        const next = JSON.parse(e.data);
        // Merged rather than replaced, so a server that starts sending a
        // narrower payload can never blank out a flag the UI still reads.
        setConfig((c) => ({ ...c, ...next }));
      } catch {
        /* malformed frame -- keep the config we already have */
      }
    });
    source.onerror = () => {
      // Deliberately silent and deliberately NOT closed: EventSource retries
      // by itself, and closing here would turn one transient network error
      // into a permanently stale page.
    };

    return () => source.close();
  }, []);

  return <SiteConfigContext.Provider value={config}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}

/** Convenience for the common case of gating on a single boolean flag. */
export function useFeature(flag) {
  return useContext(SiteConfigContext)[flag] !== false;
}
