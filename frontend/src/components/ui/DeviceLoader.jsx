import { lazy, Suspense, useEffect, useState } from "react";
import { Spinner } from "./Spinner.jsx";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";

const DeviceStage = lazy(() => import("../../three/DeviceStage.jsx").then((m) => ({ default: m.DeviceStage })));

// The InBody analyser, assembling itself, as a loading state.
//
// The trap this is built to avoid: a 3D loading spinner that has to download
// ~670KB of three.js before it can appear is strictly worse than a CSS one --
// it makes the wait it is meant to cover measurably longer, on exactly the
// connections where the wait is already worst.
//
// So this NEVER initiates that download. It renders the plain spinner, and
// upgrades to the device only if `vendor-three` has already been fetched for
// some other reason (the visitor scrolled the home hero, or opened a product
// page). On a cold first paint you get the spinner and nothing is downloaded;
// by the second navigation the chunk is usually warm and the loader is 3D.
//
// `three` is exposed on the module graph rather than probed via the network,
// because asking the Cache API would be async, racy, and wrong in dev.
let threeIsWarm = false;

/** Called by DeviceStage/EffectStage call sites once three has actually loaded. */
export function markThreeLoaded() {
  threeIsWarm = true;
}

export function DeviceLoader({ label, className = "", size = 150 }) {
  const reducedMotion = useReducedMotion();
  // Deliberately read once, on mount, rather than subscribed: a loader that
  // swapped from CSS to 3D mid-wait would draw attention to itself, which is
  // the opposite of what a loading state should do.
  const [use3d] = useState(() => threeIsWarm && !reducedMotion);

  if (!use3d) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
        <Spinner />
        {label && <p className="text-[12.5px] text-ink-3">{label}</p>}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`}>
      <Suspense fallback={<Spinner />}>
        <div style={{ width: size, height: size }}>
          <AssemblingDevice />
        </div>
      </Suspense>
      {label && <p className="text-[12.5px] text-ink-3">{label}</p>}
    </div>
  );
}

// Loops the analyser between exploded and assembled, so the loader reads as
// "putting something together" rather than as a spinning object.
function AssemblingDevice() {
  const [api, setApi] = useState(null);

  useEffect(() => {
    if (!api) return undefined;
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // 2.4s per cycle, held briefly at each end so it doesn't feel frantic.
      const t = ((performance.now() - start) / 2400) % 1;
      const eased = t < 0.5 ? t * 2 : 2 - t * 2;
      api.setExplodeImmediate(eased * 0.85);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [api]);

  return (
    <DeviceStage
      variant="analyzer"
      accent={0x22c55e}
      autoSpin
      initialExplode={0.85}
      onReady={setApi}
      className="h-full w-full"
    />
  );
}
