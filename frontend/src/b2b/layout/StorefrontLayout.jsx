import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CatalogProvider } from "../context/CatalogContext.jsx";
import { StorefrontProvider } from "../context/StorefrontContext.jsx";
import { AnnouncementBar } from "./AnnouncementBar.jsx";
import { StoreHeader } from "./StoreHeader.jsx";
import { StoreFooter } from "./StoreFooter.jsx";
import { CompareBar } from "../overlays/CompareBar.jsx";
import { SocialTicker } from "../overlays/SocialTicker.jsx";
import { StickyActionBar } from "../overlays/StickyActionBar.jsx";
import { StoreToast } from "../overlays/StoreToast.jsx";
import { RfqModal } from "../overlays/RfqModal.jsx";
import { AiMount } from "../../components/ai/AiMount.jsx";
import { BottomNav } from "../../components/layout/BottomNav.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { startPointerSpotlight } from "../../lib/pointerSpotlight.js";

// Scopes the assistant to whatever device the visitor is looking at.
//
// The commerce app's BareLayout has always done this by reading the product
// id out of the path; the storefront layout did not, so opening the chat
// from a device page produced a general-purpose assistant that had to be
// told which machine you meant. It sits in its own component because it
// needs the catalogue context, which is provided above it.
function StorefrontAssistant() {
  const { pathname } = useLocation();
  const { getDevice, hasDevice } = useCatalogue();
  const { isAuthed } = useAuth();
  const id = /^\/devices\/([^/]+)$/.exec(pathname)?.[1] ?? null;
  const device = id && hasDevice(id) ? getDevice(id) : null;

  return (
    <AiMount
      storefront
      // Signed-in visitors have the assistant in the dock. Rendering the FAB
      // as well would put two launchers for the same overlay in the same
      // corner, with the FAB sitting on top of the dock.
      launcher={!isAuthed}
      productId={device?.productId ?? null}
      productName={device?.name ?? null}
      offsetClass="bottom-[max(1rem,env(safe-area-inset-bottom))] lg:bottom-6"
    />
  );
}

// The phone sales bar and the dock both pin themselves to the bottom of the
// viewport, so only one of them can exist at a time. Signed-out visitors get
// the sales bar (call / WhatsApp / quote); signed-in ones get the dock, which
// carries navigation they cannot get to any other way on a phone.
function StorefrontBottomChrome() {
  const { isAuthed } = useAuth();
  return isAuthed ? <BottomNav /> : <StickyActionBar />;
}

// The public storefront shell.
//
// Every one of the storefront's cross-page pieces is mounted exactly once
// here rather than per page: the proforma dialog, the comparison tray, the
// ticker, the toast and the assistant. The alternative -- each page
// rendering its own -- is what produces two proforma dialogs stacked on top
// of each other when one page navigates to another mid-flow.
//
// The assistant is the app's existing retrieval-backed one (AiOverlay),
// not a second scripted chatbot. It already answers in the visitor's
// language and cites real product data, which is the whole promise the
// storefront makes about it.
export function StorefrontLayout() {
  const { isAuthed } = useAuth();
  // One delegated listener for the whole storefront, started here rather than
  // per card -- see lib/pointerSpotlight.js for why that distinction is the
  // difference between a smooth effect and a janky one.
  useEffect(() => startPointerSpotlight(), []);

  return (
    <CatalogProvider>
      <StorefrontProvider>
        <div className="b2b flex min-h-dvh flex-1 flex-col">
          <AnnouncementBar />
          <StoreHeader />

          <main className="flex-1">
            <Outlet />
          </main>

          <CompareBar />
          <StoreFooter clearDock={isAuthed} />

          <SocialTicker />
          <StorefrontBottomChrome />
          <StoreToast />

          <RfqModal />

          {/* The whole assistant, or nothing. Mounted inside the provider so
              the agent's client actions reach the same context methods the
              buttons do -- see clientActions.js for why that is a bridge
              rather than a hook in ChatDock. The launcher is lifted above the
              phone action bar so the two never overlap. */}
          <StorefrontAssistant />
        </div>
      </StorefrontProvider>
    </CatalogProvider>
  );
}
