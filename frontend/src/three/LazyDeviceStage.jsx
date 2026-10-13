import { Suspense, lazy, useEffect, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.js";

// three.js is ~150KB gzipped and needs a real WebGL context, so it must
// never be part of the server render (entry-server.jsx) or the initial
// client bundle. This boundary defers it until after mount, and degrades to
// `fallback` when the device can't or shouldn't run it.
const DeviceStage = lazy(() => import("./DeviceStage.jsx"));

// Exported: any component deciding whether to attempt a 3D render needs this
// same probe, and duplicating it would risk the two answers diverging.
export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function LazyDeviceStage({ fallback = null, ...props }) {
  const reducedMotion = useReducedMotion();
  const [canRender, setCanRender] = useState(false);

  useEffect(() => {
    setCanRender(webglAvailable());
  }, []);

  if (!canRender) return fallback;
  return (
    <Suspense fallback={fallback}>
      <DeviceStage reducedMotion={reducedMotion} {...props} />
    </Suspense>
  );
}
