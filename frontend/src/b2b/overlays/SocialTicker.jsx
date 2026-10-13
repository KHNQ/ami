import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { useSiteConfig } from "../../context/SiteConfigContext.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";

// Live-activity pop-up: real, recent proforma requests, when an admin turns it on.
//
// This used to be a fixed list of invented clinics ("Dr. Moradi -- Isfahan requested
// a proforma...") cycled forever, under a comment promising it only showed things that
// genuinely happen. It did not, and telling a doctor that their peers are requesting
// quotes right now, when nobody is, is exactly the lie that comment ruled out.
//
// Now every line comes from GET /sales/activity -- an actual request, reduced to the
// device and the time. No name, phone, email or city is ever sent (see
// salesService.recentActivity for why), so the avatar is a neutral building icon rather
// than initials. Whether it appears at all is the admin's call: Settings -> "Live
// proforma activity". The flag arrives with the site config, which updates live, so
// switching it off removes the pop-up from pages that are already open.
const REFRESH_MS = 5 * 60_000;
const SHOW_AFTER_MS = 4000;
const VISIBLE_MS = 4600;
const CYCLE_MS = 13000;

export function SocialTicker() {
  const reduced = useReducedMotion();
  const { show_live_activity: enabled } = useSiteConfig();
  const { t, locale } = useI18n();
  const [events, setEvents] = useState([]);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  // Fetch only while the feature is on, and refresh now and then so a long-open tab
  // keeps showing what is actually recent.
  useEffect(() => {
    if (!enabled || reduced) {
      setEvents([]);
      setVisible(false);
      return undefined;
    }
    let cancelled = false;
    const load = () =>
      api
        .recentActivity()
        .then((res) => {
          if (!cancelled) setEvents(res?.enabled ? res.events || [] : []);
        })
        .catch(() => {
          // The pop-up is decoration: a failed fetch simply shows nothing.
          if (!cancelled) setEvents([]);
        });
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [enabled, reduced]);

  const count = events.length;
  useEffect(() => {
    // Reduced motion means no slide-in loop at all. A notification that reappears every
    // thirteen seconds is exactly the kind of movement the preference exists to suppress.
    if (reduced || count === 0) return undefined;

    let hideTimer;
    const cycle = () => {
      setVisible(true);
      hideTimer = setTimeout(() => setVisible(false), VISIBLE_MS);
    };
    const showTimer = setTimeout(cycle, SHOW_AFTER_MS);
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % count);
      cycle();
    }, CYCLE_MS);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearInterval(interval);
    };
  }, [reduced, count]);

  if (!enabled || reduced || count === 0) return null;

  const event = events[index % count];
  const text = t(event.kind === "lease" ? "store.activity.lease" : "store.activity.proforma", { device: event.device });

  return (
    <div
      aria-live="polite"
      data-testid="live-activity"
      className={`pointer-events-none fixed start-4 bottom-24 z-40 max-w-[320px] transition-all duration-500 lg:bottom-6 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink px-3.5 py-3 text-canvas shadow-2xl">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
          <Building2 size={16} aria-hidden />
        </span>
        <span className="text-[12px] leading-snug">
          <b className="font-extrabold">{text}</b>
          <br />
          <span className="text-canvas/55">{relativeTime(event.at, locale)}</span>
        </span>
        <span aria-hidden className="ms-auto h-2 w-2 shrink-0 rounded-full bg-brand-green" />
      </div>
    </div>
  );
}
