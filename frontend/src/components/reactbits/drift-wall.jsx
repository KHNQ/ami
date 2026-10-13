import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";

// A wall of tiles drifting past on a tilted 3D plane.
//
// Vendored from reactbits.dev (DriftWall) and adapted in five places, each
// of which the original gets wrong for this app:
//
//  1. TILE CONTENT IS A NODE, not an image URL. A device here is a
//     photograph, a cropped region of a catalogue page, or an emoji
//     fallback -- see lib/deviceVisual -- so the caller passes whatever
//     DeviceVisual returns and this component stays ignorant of the
//     catalogue's shape.
//  2. LINKS ARE INTERNAL. The original renders <a target="_blank"> only; a
//     product tile has to be a router Link, or clicking a machine in our own
//     catalogue reloads the whole app in a new tab.
//  3. HOVER IS NOT REACT STATE. The original calls setActiveId on every
//     hover change, which re-renders all ~90 tiles to move one shadow. The
//     active class is toggled on the node instead.
//  4. THE LOOP IS GATED ON VISIBILITY. This sits at the bottom of a long
//     page, and a rAF loop writing a 3D transform every frame for a wall
//     nobody has scrolled to yet is pure battery cost.
//  5. THE HIT TEST IS PER FRAME, not per pointermove. `elementFromPoint`
//     forces a style and layout flush; at mousemove rates over a 90-tile
//     3D subtree that is the most expensive thing on the page.
//  6. THE TILES SCALE WITH THE CONTAINER. The original takes tile size in
//     fixed pixels, so on a phone five 200px columns are 1000px wide and the
//     viewport shows one and a half of them -- which reads as two big cards,
//     not as a wall. Tile size has to come from JS rather than a CSS media
//     query because the drift maths wraps each track on its own height, and
//     a painted size the loop does not know about puts a visible seam in it.
//
// `preserve-3d` plus `pointer-events: none` on the inner element is why the
// hit test exists at all: the tiles are laid out on a transformed plane, so
// the element under the cursor is found geometrically rather than by
// listening on each tile.

const prng = (index, variance) => {
  // Golden-ratio stride: gives each column a different speed without a
  // random() that would differ between the server render and the client.
  const pseudo = ((index * 0.6180339887 + 0.35) % 1) * 2 - 1;
  return 1 + variance * pseudo;
};

export function DriftWall({
  items = [],
  columns = 5,
  tileWidth = 200,
  tileHeight = 132,
  gap = 18,
  radius = 14,
  tilt = 16,
  turn = -14,
  roll = 0,
  perspective = 1200,
  depth = 120,
  speed = 42,
  direction = "up",
  variance = 0.45,
  parallax = 0.6,
  pauseOnHover = false,
  lift = 64,
  fade = 0.6,
  dim = 0.55,
  grayscale = false,
  overlayColor,
  // Below `fitWidth` the tiles scale down proportionally, floored at
  // `minScale`, so the wall keeps roughly the same number of columns on
  // screen at any width.
  fitWidth = 1280,
  minScale = 0.55,
  label,
  className = "",
  style,
}) {
  const containerRef = useRef(null);
  const planeRef = useRef(null);
  const trackRefs = useRef([]);
  const rafRef = useRef(null);

  const offsetsRef = useRef([]);
  const velocitiesRef = useRef([]);
  const hoveredColRef = useRef(-1);
  const wallHoveredRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const pointerDampedRef = useRef({ x: 0, y: 0 });
  const pointerClientRef = useRef(null);
  const activeElRef = useRef(null);
  const lastTsRef = useRef(null);

  const [{ width, height }, setSize] = useState({ width: fitWidth, height: 600 });
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();

  // One scale applied to every length, so the painted tile and the height the
  // drift loop wraps on can never disagree.
  const scale = fitWidth > 0 ? Math.min(1, Math.max(minScale, width / fitWidth)) : 1;
  const tw = Math.round(tileWidth * scale);
  const th = Math.round(tileHeight * scale);
  const g = Math.round(gap * scale);
  const lf = Math.round(lift * scale);

  // Round-robin into columns, so a 13-device catalogue spreads evenly
  // instead of filling the first column and leaving the last one short.
  const columnItems = useMemo(() => {
    if (items.length === 0) return [];
    const cols = Array.from({ length: columns }, () => []);
    items.forEach((item, i) => cols[i % columns].push(item));
    return cols.map((col) => (col.length ? col : items.slice(0, 1)));
  }, [items, columns]);

  const columnMeta = useMemo(() => {
    const unit = th + g;
    return columnItems.map((col) => {
      const copyHeight = Math.max(unit, col.length * unit);
      // Enough copies to cover the viewport twice over, so the seam where
      // the track wraps is always outside the masked area.
      return { copyHeight, copies: Math.max(2, Math.ceil((height * 1.6) / copyHeight) + 1) };
    });
  }, [columnItems, th, g, height]);

  // useEffect, not useLayoutEffect: this renders on the server too, and
  // useLayoutEffect has no server equivalent. One frame at the fallback
  // height costs nothing -- the wall is masked at its edges anyway.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width || fitWidth,
        height: entry.contentRect.height || 600,
      })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitWidth]);

  // Only animate while the wall is on screen. `rootMargin` starts it just
  // before it scrolls into view so it is already in motion on arrival
  // rather than visibly starting from a dead stop.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const baseVelocities = useMemo(() => {
    const dirSign = direction === "up" ? 1 : -1;
    return columnItems.map((_, c) => {
      const altSign = c % 2 === 0 ? 1 : -1;
      return speed * prng(c, variance) * dirSign * altSign;
    });
  }, [columnItems, speed, direction, variance]);

  useEffect(() => {
    offsetsRef.current = columnMeta.map((meta, c) => meta.copyHeight * ((c * 0.37) % 1));
    velocitiesRef.current = columnItems.map(() => 0);
  }, [columnMeta, columnItems]);

  const setActive = useCallback((el) => {
    if (activeElRef.current === el) return;
    activeElRef.current?.classList.remove("is-active");
    el?.classList.add("is-active");
    activeElRef.current = el;
    hoveredColRef.current = el ? Number(el.dataset.col) : -1;
  }, []);

  const applyPlaneTransform = useCallback(
    (px, py) => {
      const plane = planeRef.current;
      if (!plane) return;
      plane.style.transform =
        `translate(-50%, -50%) scale(1.18) ` +
        `rotateX(${tilt + py}deg) rotateY(${turn + px}deg) rotateZ(${roll}deg) ` +
        `translateZ(${-depth}px)`;
    },
    [tilt, turn, roll, depth]
  );

  // The plane's resting transform, for the server render and for a visitor
  // who never scrolls this far: without it the wall would be flat until the
  // first animation frame.
  useEffect(() => {
    applyPlaneTransform(0, 0);
  }, [applyPlaneTransform]);

  useEffect(() => {
    if (!visible || columnItems.length === 0) return undefined;

    const frame = (ts) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = Math.min(0.05, Math.max(0, ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      // One hit test per frame rather than per pointermove.
      const p = pointerClientRef.current;
      if (p) {
        pointerClientRef.current = null;
        const hit = document.elementFromPoint(p.x, p.y);
        setActive(hit?.closest?.("[data-drift-tile]") ?? null);
      }

      if (parallax > 0 && !reduced) {
        const max = parallax * 8;
        const damp = 1 - Math.exp(-dt / 0.12);
        pointerDampedRef.current.x += (pointerRef.current.x * max - pointerDampedRef.current.x) * damp;
        pointerDampedRef.current.y += (-pointerRef.current.y * max - pointerDampedRef.current.y) * damp;
        applyPlaneTransform(pointerDampedRef.current.x, pointerDampedRef.current.y);
      }

      if (!reduced) {
        for (let c = 0; c < trackRefs.current.length; c++) {
          const meta = columnMeta[c];
          const el = trackRefs.current[c];
          if (!meta || !el) continue;
          const held = (wallHoveredRef.current && pauseOnHover) || hoveredColRef.current === c;
          const target = held ? 0 : baseVelocities[c];
          // Eased rather than snapped, and faster into a stop than out of
          // one: a column that halts the instant the cursor touches it
          // reads as a glitch.
          const ease = 1 - Math.exp(-dt / (target === 0 ? 0.16 : 0.28));
          velocitiesRef.current[c] += (target - velocitiesRef.current[c]) * ease;
          let next = (offsetsRef.current[c] ?? 0) + velocitiesRef.current[c] * dt;
          next = ((next % meta.copyHeight) + meta.copyHeight) % meta.copyHeight;
          offsetsRef.current[c] = next;
          el.style.transform = `translate3d(0, ${-next}px, 0)`;
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [
    visible,
    columnItems.length,
    baseVelocities,
    columnMeta,
    pauseOnHover,
    parallax,
    reduced,
    applyPlaneTransform,
    setActive,
  ]);

  const onPointerMove = useCallback((e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
    };
    // Stored, not acted on: the frame loop does the hit test.
    pointerClientRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerLeave = useCallback(() => {
    wallHoveredRef.current = false;
    pointerRef.current = { x: 0, y: 0 };
    pointerClientRef.current = null;
    setActive(null);
  }, [setActive]);

  const cssVars = useMemo(
    () => ({
      "--dw-tile-w": `${tw}px`,
      "--dw-tile-h": `${th}px`,
      "--dw-gap": `${g}px`,
      "--dw-radius": `${Math.round(radius * scale)}px`,
      "--dw-perspective": `${perspective}px`,
      "--dw-lift": `${lf}px`,
      "--dw-dim": dim,
      "--dw-gray": grayscale ? 1 : 0,
      "--dw-edge": `${Math.max(0, (1 - fade) * 100)}%`,
      ...(overlayColor ? { "--dw-overlay": overlayColor } : null),
      ...style,
    }),
    [tw, th, g, radius, scale, perspective, lf, dim, grayscale, fade, overlayColor, style]
  );

  if (columnItems.length === 0) return null;

  const renderTile = (item, col, copy, i) => {
    const key = `${col}-${copy}-${i}`;
    // The duplicate copies that make the drift seamless are the same product
    // over and over, so only the first run is in the tab order and exposed to
    // a screen reader. Nine identical links to one device page is noise, not
    // navigation -- but every copy stays clickable, because a visitor aims at
    // the tile they can see.
    const primary = copy === 0;
    const media = (
      <span className="drift-wall__inner">
        <span className="drift-wall__media">{item.media}</span>
        <span aria-hidden className="drift-wall__overlay" />
      </span>
    );
    const shared = {
      className: "drift-wall__tile",
      "data-drift-tile": "",
      "data-col": col,
      onFocus: (e) => setActive(e.currentTarget),
      onBlur: () => setActive(null),
    };

    if (item.to) {
      return (
        <Link
          key={key}
          to={item.to}
          aria-label={item.title}
          tabIndex={primary ? 0 : -1}
          aria-hidden={primary ? undefined : "true"}
          {...shared}
        >
          {media}
        </Link>
      );
    }
    if (item.href) {
      return (
        <a
          key={key}
          href={item.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={item.title}
          tabIndex={primary ? 0 : -1}
          aria-hidden={primary ? undefined : "true"}
          {...shared}
        >
          {media}
        </a>
      );
    }
    return (
      <span key={key} aria-hidden={primary ? undefined : "true"} {...shared}>
        {media}
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`drift-wall${reduced ? " drift-wall--reduced" : ""}${className ? ` ${className}` : ""}`}
      style={cssVars}
      onPointerMove={onPointerMove}
      onPointerEnter={() => {
        wallHoveredRef.current = true;
      }}
      onPointerLeave={onPointerLeave}
      role="group"
      aria-label={label}
    >
      <div ref={planeRef} className="drift-wall__plane">
        {columnItems.map((col, c) => (
          <div className="drift-wall__col" key={`col-${c}`}>
            <div
              className="drift-wall__track"
              ref={(el) => {
                trackRefs.current[c] = el;
              }}
            >
              {Array.from({ length: columnMeta[c].copies }).map((_, copy) =>
                col.map((item, i) => renderTile(item, c, copy, i))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
