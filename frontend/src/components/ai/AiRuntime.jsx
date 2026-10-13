import { AiOverlay } from "./AiOverlay.jsx";
import { AskButton } from "./AskButton.jsx";

// Everything the assistant needs mounted, in one lazily-loaded chunk.
//
// Split from AiMount so that the import graph below this line -- the overlay,
// the launcher, and through them ChatDock and the SSE client -- is reachable
// only when the feature is actually on.
export default function AiRuntime({ launcher = true, productId = null, productName = null, offsetClass }) {
  return (
    <>
      <AiOverlay />
      {launcher ? (
        <AskButton productId={productId} productName={productName} offsetClass={offsetClass} />
      ) : null}
    </>
  );
}
