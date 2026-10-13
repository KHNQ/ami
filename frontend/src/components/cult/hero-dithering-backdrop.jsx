import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion.js";

// The dithering shader from cult-ui's `hero-dithering`, on its own.
//
// The published component is a complete hero -- its own headline, subtitle,
// description, CTA and tech-stack badges, all laid out in its own grid.
// Dropping that in would have replaced this site's hero wholesale, taking
// the procedural 3D device stage, the three-slide carousel and the real
// product copy with it. What was actually wanted is the *look*: the animated
// swirl dither behind the content. So this is the shader layer extracted and
// nothing else.
//
// Three things guard it, because `@paper-design/shaders-react` is 417KB and
// this is decoration:
//
//  - `lazy()`, so the shader never lands in the initial chunk. The hero
//    renders complete and readable without it and the backdrop fades in.
//  - reduced-motion: a permanently swirling background is exactly what that
//    preference exists to stop, so it renders nothing at all.
//  - a WebGL probe, matching what LazyDeviceStage already does -- on a
//    machine with no GL context the library would otherwise mount and fail.

const Dithering = lazy(() =>
  import("@paper-design/shaders-react").then((m) => ({ default: m.Dithering }))
);

function useWebglReady() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      setOk(Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch {
      setOk(false);
    }
  }, []);
  return ok;
}

export function HeroDitheringBackdrop({
  className,
  colorBack = "#00000000",
  colorFront = "var(--color-brand-green)",
  shape = "swirl",
  type = "4x4",
  size = 2,
  speed = 0.7,
  scale = 0.6,
  opacity = 0.55,
}) {
  const reduced = useReducedMotion();
  const webgl = useWebglReady();

  if (reduced || !webgl) return null;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={{ opacity }}
    >
      <Suspense fallback={null}>
        <Dithering
          colorBack={colorBack}
          colorFront={colorFront}
          shape={shape}
          type={type}
          size={size}
          speed={speed}
          scale={scale}
          style={{ width: "100%", height: "100%" }}
        />
      </Suspense>
    </div>
  );
}
