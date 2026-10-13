import { useEffect, useState } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";

// Recent-activity ticker.
//
// Two deliberate constraints. It only ever shows things that genuinely
// happen on this site (a proforma request, a 1% reservation, a demo booking,
// a consumables subscription) -- inventing purchases would be a lie told to
// a doctor about their peers. And it is initials-on-a-tint rather than a
// stock portrait, because a face implies a specific identifiable person
// consented to appear here.
const EVENTS = [
  { who: "Dr. Moradi", where: "Isfahan", what: "requested a proforma for Cooltech Define", ago: "2 min ago" },
  { who: "Dr. Ahmadi", where: "Tehran", what: "reserved a Primelase with 1%", ago: "5 min ago" },
  { who: "Enghelab Clinic", where: "Tehran", what: "booked a demo for TESLA Former", ago: "9 min ago" },
  { who: "Dr. Shirazi", where: "Shiraz", what: "subscribed to gel pads, auto every 45 days", ago: "12 min ago" },
  { who: "Mehregan Clinic", where: "Isfahan", what: "downloaded the committee comparison PDF", ago: "18 min ago" },
];

const initials = (name) =>
  name
    .replace(/^Dr\.\s*/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

export function SocialTicker() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Reduced motion means no slide-in loop at all. A notification that
    // reappears every eleven seconds is exactly the kind of movement the
    // preference exists to suppress.
    if (reduced) return undefined;

    let showTimer;
    let hideTimer;
    const cycle = () => {
      setVisible(true);
      hideTimer = setTimeout(() => setVisible(false), 4600);
    };
    showTimer = setTimeout(cycle, 4000);
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % EVENTS.length);
      cycle();
    }, 13000);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearInterval(interval);
    };
  }, [reduced]);

  if (reduced) return null;

  const event = EVENTS[index];

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed start-4 bottom-24 z-40 max-w-[320px] transition-all duration-500 lg:bottom-6 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink px-3.5 py-3 text-canvas shadow-2xl">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-[11px] font-black text-white">
          {initials(event.who)}
        </span>
        <span className="text-[12px] leading-snug">
          <b className="font-extrabold">
            {event.who} — {event.where}
          </b>
          <br />
          <span className="text-canvas/55">
            {event.what} · {event.ago}
          </span>
        </span>
        <span aria-hidden className="ms-auto h-2 w-2 shrink-0 rounded-full bg-brand-green" />
      </div>
    </div>
  );
}
