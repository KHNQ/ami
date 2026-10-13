import { Suspense, lazy, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useAiEnabled } from "./useAiEnabled.js";
import { useAiChat } from "../../context/AiChatContext.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// The assistant's overlay, mounted once for the whole app.
//
// ChatDock (and the SSE client under it) stays lazy: most sessions never open
// the assistant, and it should cost them nothing.
const ChatDock = lazy(() => import("./ChatDock.jsx"));

/**
 * A loading state that says what is happening.
 *
 * A bare spinner here is the wrong answer twice over: the visitor has just
 * tapped something labelled "Ask AI" and gets an unlabelled circle, and the
 * panel fills the screen so the spinner floats in a large void. Naming the
 * step makes a ~200ms chunk fetch feel deliberate rather than stalled.
 */
function DockSkeleton({ t }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-green to-brand-blue text-white">
        <Sparkles size={22} />
        <span className="absolute inset-0 animate-ping rounded-2xl bg-brand-green/25" />
      </span>
      <div>
        <p className="text-[15px] font-extrabold text-ink">{t("ai.title")}</p>
        <p className="mt-1 text-[12.5px] text-ink-2">{t("ai.warmingUp")}</p>
      </div>
      <div className="mt-1 w-full max-w-[280px] space-y-2">
        {[88, 64, 76].map((w, i) => (
          <div
            key={i}
            className="h-2.5 animate-pulse rounded-full bg-panel-2"
            style={{ width: `${w}%`, animationDelay: `${i * 140}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function AiOverlay() {
  const t = useT();
  const enabled = useAiEnabled();
  const { open, closeChat, scope } = useAiChat();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && closeChat();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeChat]);

  // Locks the page behind the panel -- a background that scrolls under an
  // open modal reads as a bug.
  useEffect(() => {
    if (typeof document === "undefined" || !open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!enabled || !open) return null;

  return (
    <>
      {/* The assistant is now a full-screen workspace rather than a 560px
          column pinned to the bottom-right corner. That corner shape is
          right for a support widget you glance at; it is wrong for something
          that renders headed answers, bulleted lists and a list of the
          documents it read, all of which need the width. */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={closeChat}
        className="fixed inset-0 z-[60] animate-[fadeIn_200ms_ease-out] bg-ink/45 backdrop-blur-sm"
      />
      <div className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center p-3 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("ai.title")}
          className={[
            "b2b pointer-events-auto flex w-full max-w-[880px] flex-col overflow-hidden",
            // A generous radius and a soft, wide shadow: the panel should read
            // as a card lifted off the page, not as a second window.
            "h-full max-h-[min(920px,100%)] rounded-[26px] bg-panel shadow-[0_32px_80px_-24px_rgba(0,0,0,0.35)] sm:rounded-[28px]",
            "animate-[overlayIn_300ms_cubic-bezier(0.22,1,0.36,1)]",
          ].join(" ")}
        >
          <Suspense fallback={<DockSkeleton t={t} />}>
            <ChatDock
              productId={scope.productId ?? null}
              productName={scope.productName ?? null}
              onClose={closeChat}
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}
