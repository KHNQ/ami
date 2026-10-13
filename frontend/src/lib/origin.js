// SSR (entry-server.jsx/server.js) has no `window` -- the SSR data payload
// carries the real request origin instead (see server.js), which the
// client then matches exactly post-hydration via window.location.origin.
export function resolveOrigin(ssrData) {
  if (ssrData?.origin) return ssrData.origin;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
