import { Outlet, useLocation } from "react-router-dom";
import { BackgroundGlow } from "../ui/BackgroundGlow.jsx";
import { AiMount } from "../ai/AiMount.jsx";

// For pages that own their own fixed bottom action bar (e.g. a purchase CTA)
// and therefore should NOT show the shared BottomNav -- showing both would
// mean two things pinned to the viewport bottom fighting for the same
// space. Same convention as Amazon/most commerce apps hiding the tab bar
// on a product detail screen in favor of the buy button.
export function BareLayout() {
  // Read from the path rather than useParams(): this is the *parent* route
  // element, so the child's :id is not reliably in scope here, and a regex
  // over the pathname is unambiguous either way.
  //
  // The product id is all that's needed -- the server resolves the device's
  // name for the prompt, so the assistant is scoped to whatever the visitor
  // is actually looking at without this layout having to fetch anything.
  const { pathname } = useLocation();
  const productId = /^\/products\/([^/]+)$/.exec(pathname)?.[1] ?? null;

  return (
    <div className="app-column flex min-h-dvh flex-1 flex-col">
      <BackgroundGlow />
      <Outlet />
      {/* The product page pins its own buy bar to the bottom, so the
          launcher is lifted clear of it there and sits normally elsewhere.
          Renders nothing at all when the assistant is switched off. */}
      <AiMount
        productId={productId}
        offsetClass={productId ? "bottom-[calc(6rem+env(safe-area-inset-bottom))]" : "bottom-[max(1rem,env(safe-area-inset-bottom))]"}
      />
    </div>
  );
}
