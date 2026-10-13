// A tiny bus between the assistant and whatever part of the app can act.
//
// It exists because ChatDock cannot reach StorefrontContext. AiOverlay is
// mounted in TWO trees -- inside StorefrontProvider on the storefront
// (b2b/layout/StorefrontLayout.jsx) and outside it on the commerce pages
// (components/layout/BareLayout.jsx) -- and `useStorefront()` throws when its
// provider is absent. A hook would crash the assistant on half the site.
//
// So: ChatDock dispatches, and anything that CAN act subscribes. The bridge
// lives inside the provider and is simply not mounted where the provider is
// not, which is exactly the condition we need to detect.

const listeners = new Set();

export function onClientAction(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fires an action and reports whether anything took it.
 *
 * The return value is load-bearing: `false` means no bridge was listening, and
 * the caller renders a tappable card instead. An action that silently does
 * nothing is worse than no action at all -- the visitor was told it happened.
 */
export function dispatchClientAction(action) {
  let handled = false;
  for (const fn of listeners) {
    try {
      if (fn(action) === true) handled = true;
    } catch (err) {
      // One broken listener must not stop the others, and must not take the
      // chat panel down with it.
      console.error("[clientAction] listener failed", err);
    }
  }
  return handled;
}
