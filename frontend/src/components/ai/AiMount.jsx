import { Suspense, lazy } from "react";
import { useAiEnabled } from "./useAiEnabled.js";

// The assistant's one entry point into the rest of the app.
//
// Every layout mounts this and nothing else of the assistant. It matters
// that this file imports NOTHING from the feature itself: the overlay, the
// launcher, the SSE client, the agent timeline and the storefront bridge all
// sit behind `lazy()`, so with the feature off none of them is in the main
// bundle, none is fetched, and none mounts. Importing AiOverlay directly --
// as the layouts used to -- pulled all of that into the first paint of every
// page whether or not anyone ever opened the chat.
//
// Switched off with AI_ENABLED on the server, which forces `ai_chat_enabled`
// false in /site-config no matter what the admin setting says.
const AiRuntime = lazy(() => import("./AiRuntime.jsx"));
const AiStorefrontRuntime = lazy(() => import("./AiStorefrontRuntime.jsx"));

/**
 * @param storefront  mount the storefront bridge too, so the agent's client
 *                    actions (compare, open a dialog, navigate) reach the
 *                    real context. Only valid inside StorefrontProvider.
 * @param launcher    render the floating "Ask AI" button as well as the
 *                    overlay. Pages with their own launcher pass false.
 */
export function AiMount({ storefront = false, launcher = true, productId = null, productName = null, offsetClass }) {
  if (!useAiEnabled()) return null;

  const Runtime = storefront ? AiStorefrontRuntime : AiRuntime;
  // No fallback: this is a floating launcher and an overlay that is closed.
  // There is nothing for a skeleton to stand in for, and a flash of one in
  // the corner of every page would be worse than the 200ms of nothing.
  return (
    <Suspense fallback={null}>
      <Runtime
        launcher={launcher}
        productId={productId}
        productName={productName}
        offsetClass={offsetClass}
      />
    </Suspense>
  );
}
