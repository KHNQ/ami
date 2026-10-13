import { StorefrontActionBridge } from "../../b2b/context/StorefrontActionBridge.jsx";
import AiRuntime from "./AiRuntime.jsx";

// The storefront's version: the same runtime plus the bridge that lets the
// agent drive the storefront's own dialogs and compare tray.
//
// A separate module rather than a prop on AiRuntime, because the bridge calls
// `useStorefront()` and would throw under BareLayout, which is outside that
// provider. Keeping it in its own file means BareLayout's chunk never
// contains it at all.
export default function AiStorefrontRuntime(props) {
  return (
    <>
      <StorefrontActionBridge />
      <AiRuntime {...props} />
    </>
  );
}
