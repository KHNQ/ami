import { useEffect, useState } from "react";

// Single source of truth for "should this device animate at all".
// SSR-safe: returns false on the server (entry-server.jsx renders HomePage),
// then re-evaluates on mount, so the server never touches matchMedia.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
