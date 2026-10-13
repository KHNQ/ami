import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { cn } from "../../lib/cn.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { BRAND_CARDS } from "../data/brands.js";

// The partner wall, as a set of columns that each cycle through a different
// slice of the roster.
//
// Adapted from the cult-ui logo carousel pattern. Two deliberate departures
// from the reference implementation:
//
//  1. It uses framer-motion, already in this app, rather than adding
//     `motion` alongside it. The two are the same library under different
//     package names -- shipping both would mean two animation runtimes in
//     one bundle for identical behaviour.
//
//  2. The reference drives every column from a single `currentTime` counter
//     ticking every 100ms, which re-renders the whole carousel ten times a
//     second whether or not anything changes. Each column here owns its own
//     interval and re-renders only when its own logo actually changes.
//
// The logos are the manufacturers' real marks, already in public/partners.

/** Even distribution across columns, then padded so no column runs short. */
function distribute(logos, columnCount) {
  const columns = Array.from({ length: columnCount }, () => []);
  logos.forEach((logo, i) => columns[i % columnCount].push(logo));
  const longest = Math.max(...columns.map((c) => c.length));
  columns.forEach((column, ci) => {
    let i = 0;
    while (column.length < longest) {
      // Pad from the *next* column rather than at random: a random pick can
      // repeat the logo already showing, which reads as the animation
      // having stalled.
      column.push(columns[(ci + 1) % columnCount][i % longest]);
      i++;
    }
  });
  return columns;
}

const CYCLE_MS = 2600;
const COLUMN_STAGGER_MS = 260;

function LogoColumn({ logos, index, animate }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!animate || logos.length < 2) return undefined;
    // Staggered start so the columns never flip in unison, which is what
    // makes a wall like this look mechanical.
    const startDelay = index * COLUMN_STAGGER_MS;
    let interval;
    const timeout = setTimeout(() => {
      setCurrent((c) => (c + 1) % logos.length);
      interval = setInterval(() => setCurrent((c) => (c + 1) % logos.length), CYCLE_MS);
    }, startDelay + CYCLE_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [animate, index, logos.length]);

  const logo = logos[current];
  if (!logo) return null;

  return (
    <m.div
      className="relative flex h-20 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-line bg-panel px-3 sm:h-24"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.45, ease: "easeOut" }}
    >
      <AnimatePresence mode="wait">
        <m.div
          key={logo.name}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2"
          initial={{ y: "18%", opacity: 0, filter: "blur(6px)" }}
          animate={{
            y: "0%",
            opacity: 1,
            filter: "blur(0px)",
            transition: { type: "spring", stiffness: 300, damping: 22, mass: 1 },
          }}
          exit={{
            y: "-22%",
            opacity: 0,
            filter: "blur(6px)",
            transition: { type: "tween", ease: "easeIn", duration: 0.28 },
          }}
        >
          {logo.logo ? (
            <img
              src={logo.logo}
              alt={logo.name}
              loading="lazy"
              className="max-h-9 max-w-[78%] object-contain"
              // A partner whose mark is missing should still be named, not
              // leave a gap in the wall.
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <span className="text-[10px] font-bold text-ink-2">{logo.name}</span>
        </m.div>
      </AnimatePresence>
    </m.div>
  );
}

export function LogoCarousel({ columnCount = 4, className }) {
  const reduced = useReducedMotion();

  // Stable across renders. The reference shuffles randomly on mount, which
  // makes the server render and the client hydration disagree about which
  // logo is in which column -- a hydration mismatch on every load. The order
  // here is deterministic.
  const columns = useMemo(() => distribute(BRAND_CARDS, columnCount), [columnCount]);

  const render = useCallback(
    (logos, i) => <LogoColumn key={i} logos={logos} index={i} animate={!reduced} />,
    [reduced]
  );

  return (
    <div className={cn("flex gap-3", className)}>{columns.map(render)}</div>
  );
}
