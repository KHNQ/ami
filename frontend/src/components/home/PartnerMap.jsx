import { useEffect, useMemo, useRef, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { PARTNERS, PARTNER_ORIGIN } from "../../lib/siteContent.generated.js";
import { buildDotGrid, countrySlug } from "../../lib/landMask.js";
import { project, arcPoints, toPixel } from "../../lib/mapProjection.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The partner network, drawn as a dot-matrix world map with routes arcing out
// of Tehran.
//
// Plain 2D canvas: no mapping library, no tile server, no GeoJSON. Adding
// Leaflet for a decorative background would cost more than everything else on
// this page combined, and tiles would mean a third-party request on every load.
//
// --- A country is a CLUSTER of dots, not one dot ----------------------------
// Land is drawn as hundreds of small dots, and each is tagged with the country
// it falls inside (landMask.js). Selecting a partner therefore lights up every
// dot belonging to that country, so the whole landmass glows -- a single dot
// standing in for all of Germany reads as a map pin, not a country, and is
// what makes these maps look fake. The solid pins are a separate, smaller
// layer marking the manufacturer's actual city.
//
// --- Why the previous version was janky ------------------------------------
// It rebuilt everything on every animation frame: `arc.points.map(toPx)`
// allocated ~450 fresh point objects per frame across 11 arcs, and each arc
// also built a `createRadialGradient` for its travelling dot -- 11 gradient
// objects per frame. At 30fps that is ~13,500 short-lived objects a second,
// which is GC pressure, not rendering cost, and no amount of frame-rate
// capping fixes it. Now:
//   * projected pixel positions are computed once per resize, into flat
//     Float32Arrays, and merely read each frame
//   * the travelling dot is one pre-rendered sprite canvas, stamped with
//     drawImage instead of a per-frame gradient
//   * the packet position interpolates BETWEEN samples, so it glides rather
//     than stepping through 40 discrete positions

const FRAME_MS = 1000 / 30;
const HIT_RADIUS_PX = 16;
const ARC_SAMPLES = 64;
const SPRITE_SIZE = 34;

/** Pre-renders the travelling packet glow once, as a sprite to stamp. */
function makeGlowSprite(color) {
  const c = document.createElement("canvas");
  c.width = SPRITE_SIZE;
  c.height = SPRITE_SIZE;
  const ctx = c.getContext("2d");
  const r = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, color);
  g.addColorStop(0.45, color.replace(/[\d.]+\)$/, "0.35)"));
  g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function PartnerMap({ className }) {
  const t = useT();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const [supported, setSupported] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState(null);

  // Hover/selection are read every frame by the draw loop but must NOT be
  // effect dependencies -- they change on every pointer move, and re-running
  // the effect on each one tore the canvas down and rebuilt the dot grid,
  // observers and animation loop from scratch. That restart is what read as
  // "laggy": the map re-initialising on hover rather than recolouring a pin
  // on the next already-scheduled frame.
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);

  // Each partner's country slug, resolved once.
  const partners = useMemo(
    () => PARTNERS.map((p) => ({ ...p, countrySlug: countrySlug(p.country) })),
    []
  );

  function setHovered(slug) {
    hoveredRef.current = slug;
  }
  function selectPartner(slug) {
    const next = selectedRef.current === slug ? null : slug;
    selectedRef.current = next;
    setSelected(next);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setSupported(false);
      return undefined;
    }

    const dots = buildDotGrid({ step: 3.1 });
    const arcs = partners.map((p) => ({
      partner: p,
      pts: arcPoints(PARTNER_ORIGIN, p, ARC_SAMPLES),
      pin: project(p.lng, p.lat),
    }));
    const origin = project(PARTNER_ORIGIN.lng, PARTNER_ORIGIN.lat);

    const glowHot = makeGlowSprite("rgba(34,197,94,0.95)");

    // --- flat, reusable buffers, sized once ---------------------------------
    // Positions live in plain Float32Arrays rather than arrays of {x,y}
    // objects so that redrawing touches no allocator at all.
    const dotXY = new Float32Array(dots.length * 2);
    const arcXY = arcs.map(() => new Float32Array((ARC_SAMPLES + 1) * 2));
    const pinXY = new Float32Array(arcs.length * 2);
    const originXY = new Float32Array(2);

    let width = 0;
    let height = 0;

    function projectAll() {
      for (let i = 0; i < dots.length; i++) {
        const p = toPixel(dots[i], width, height);
        dotXY[i * 2] = p.x;
        dotXY[i * 2 + 1] = p.y;
      }
      for (let a = 0; a < arcs.length; a++) {
        const buf = arcXY[a];
        const pts = arcs[a].pts;
        for (let i = 0; i < pts.length; i++) {
          const p = toPixel(pts[i], width, height);
          buf[i * 2] = p.x;
          buf[i * 2 + 1] = p.y;
        }
        const pin = toPixel(arcs[a].pin, width, height);
        pinXY[a * 2] = pin.x;
        pinXY[a * 2 + 1] = pin.y;
      }
      const o = toPixel(origin, width, height);
      originXY[0] = o.x;
      originXY[1] = o.y;
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = wrap.clientWidth || 1;
      height = wrap.clientHeight || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      projectAll();
      setSize({ width, height });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let onScreen = true;
    const io = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting), { rootMargin: "120px" });
    io.observe(wrap);

    let visible = true;
    const onVisibility = () => (visible = document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);

    const draw = (t01) => {
      const activeSlug = hoveredRef.current || selectedRef.current;
      const active = activeSlug ? arcs.find((a) => a.partner.slug === activeSlug) : null;
      const activeCountry = active?.partner.countrySlug || null;

      ctx.clearRect(0, 0, width, height);

      // 1. the land, as country clusters. Dots belonging to the highlighted
      //    country are drawn brighter and larger, so the whole landmass reads
      //    as selected rather than one point on it.
      for (let i = 0; i < dots.length; i++) {
        const y = dotXY[i * 2 + 1];
        if (y < -4 || y > height + 4) continue;
        const isHot = activeCountry && dots[i].country === activeCountry;
        ctx.fillStyle = isHot ? "rgba(34,197,94,0.92)" : "rgba(148,163,184,0.40)";
        ctx.beginPath();
        ctx.arc(dotXY[i * 2], y, isHot ? 2.1 : 1.15, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. the routes
      for (let a = 0; a < arcs.length; a++) {
        const buf = arcXY[a];
        const isHot = active === arcs[a];

        ctx.beginPath();
        ctx.moveTo(buf[0], buf[1]);
        for (let i = 1; i <= ARC_SAMPLES; i++) ctx.lineTo(buf[i * 2], buf[i * 2 + 1]);
        ctx.strokeStyle = isHot ? "rgba(34,197,94,0.8)" : "rgba(34,197,94,0.18)";
        ctx.lineWidth = isHot ? 1.7 : 0.85;
        ctx.stroke();

        if (!reducedMotion) {
          // Staggered so the map reads as continuous traffic rather than one
          // synchronised pulse, and interpolated between samples so the dot
          // glides instead of stepping through 64 fixed positions.
          const head = (t01 + a / arcs.length) % 1;
          const f = head * ARC_SAMPLES;
          const i0 = Math.floor(f);
          const frac = f - i0;
          const i1 = Math.min(i0 + 1, ARC_SAMPLES);
          const px = buf[i0 * 2] + (buf[i1 * 2] - buf[i0 * 2]) * frac;
          const py = buf[i0 * 2 + 1] + (buf[i1 * 2 + 1] - buf[i0 * 2 + 1]) * frac;
          // Stamped sprite -- no gradient allocation per frame.
          ctx.drawImage(glowHot, px - SPRITE_SIZE / 2, py - SPRITE_SIZE / 2);
        }
      }

      // 3. partner pins -- the manufacturer's actual city
      for (let a = 0; a < arcs.length; a++) {
        const x = pinXY[a * 2];
        const y = pinXY[a * 2 + 1];
        const isHot = active === arcs[a];
        ctx.fillStyle = isHot ? "#22c55e" : "rgba(34,197,94,0.85)";
        ctx.beginPath();
        ctx.arc(x, y, isHot ? 4.5 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isHot ? "rgba(34,197,94,0.55)" : "rgba(34,197,94,0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, isHot ? 10 : 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 4. home, drawn last so it sits on top of every arc leaving it
      const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(t01 * Math.PI * 2) * 0.5;
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(originXY[0], originXY[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(59,130,246,${0.5 - pulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(originXY[0], originXY[1], 8 + pulse * 12, 0, Math.PI * 2);
      ctx.stroke();
    };

    const pinAt = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best = null;
      let bestDist = HIT_RADIUS_PX;
      for (let a = 0; a < arcs.length; a++) {
        const d = Math.hypot(pinXY[a * 2] - x, pinXY[a * 2 + 1] - y);
        if (d <= bestDist) {
          bestDist = d;
          best = arcs[a].partner.slug;
        }
      }
      return best;
    };

    const onClick = (e) => selectPartner(pinAt(e.clientX, e.clientY));
    const onMove = (e) => {
      const hit = pinAt(e.clientX, e.clientY);
      canvas.style.cursor = hit ? "pointer" : "default";
      hoveredRef.current = hit;
    };
    const onLeave = () => {
      hoveredRef.current = null;
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const teardown = () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };

    if (reducedMotion) {
      draw(0);
      return teardown;
    }

    let raf = 0;
    let lastDrawAt = 0;
    const start = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!onScreen || !visible) return;
      const now = performance.now();
      if (now - lastDrawAt < FRAME_MS) return;
      lastDrawAt = now;
      // One full traversal every 9 seconds -- slow enough to read as routes
      // rather than as a loading bar.
      draw(((now - start) / 9000) % 1);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      teardown();
    };
    // Structural only. Hover/selection are refs read live by the loop above.
  }, [reducedMotion, partners]);

  const selectedPartner = selected ? partners.find((p) => p.slug === selected) : null;
  const pinPx =
    selectedPartner && size.width > 0
      ? toPixel(project(selectedPartner.lng, selectedPartner.lat), size.width, size.height)
      : null;

  return (
    <div className={className}>
      <div ref={wrapRef} className="relative h-[280px] w-full sm:h-[380px]">
        {supported && <canvas ref={canvasRef} className="absolute inset-0" aria-label={t("home.mapAriaLabel")} />}
        {!supported && (
          <div className="flex h-full items-center justify-center text-[13px] text-fg/40">
            Partner network across {new Set(partners.map((p) => p.country)).size} countries
          </div>
        )}

        {selectedPartner && pinPx && (
          <div
            role="dialog"
            aria-label={selectedPartner.name}
            className="absolute z-20 w-[210px] rounded-xl border border-surface/12 bg-bg/95 p-3 shadow-2xl backdrop-blur"
            style={{
              left: Math.min(Math.max(pinPx.x, 108), Math.max(108, size.width - 108)),
              top: pinPx.y > size.height * 0.55 ? pinPx.y - 14 : pinPx.y + 14,
              transform: pinPx.y > size.height * 0.55 ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
          >
            <button
              type="button"
              onClick={() => selectPartner(selectedPartner.slug)}
              aria-label={t("common.close")}
              className="absolute end-2 top-2 text-fg/35 hover:text-fg"
            >
              <X size={14} />
            </button>
            <p className="pe-4 text-[13.5px] font-bold text-fg">{selectedPartner.name}</p>
            <p className="mt-0.5 text-[11.5px] font-semibold text-brand-green">
              {selectedPartner.city ? `${selectedPartner.city}, ` : ""}
              {selectedPartner.country}
            </p>
            {selectedPartner.website && (
              <a
                href={selectedPartner.website}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-blue"
              >
                {t("home.visitPartner")} <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}
      </div>

      {/* The map is decorative; this list is the accessible content, and it
          doubles as the hover/click control for the pins. */}
      <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
        {partners.map((p) => (
          <li key={p.slug}>
            <button
              type="button"
              onMouseEnter={() => setHovered(p.slug)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(p.slug)}
              onBlur={() => setHovered(null)}
              onClick={() => selectPartner(p.slug)}
              aria-pressed={selected === p.slug}
              className="rounded-full border border-surface/10 bg-surface/5 px-2.5 py-1 text-[11.5px] font-semibold text-fg/55 transition-colors hover:border-brand-green/40 hover:text-fg aria-pressed:border-brand-green/60 aria-pressed:bg-brand-green/10 aria-pressed:text-fg"
            >
              {p.name}
              <span className="ms-1.5 text-fg/30">{p.country}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
