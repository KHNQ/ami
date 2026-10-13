import { AnimatePresence, m } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // SSR (entry-server.jsx) has no `document` at all -- portals only ever
  // make sense in a real browser, so render nothing server-side. The client
  // re-renders this into the real portal immediately on hydration.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <m.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="safe-bottom relative z-10 max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[32px] border-t border-line bg-panel px-5 pt-3 pb-6"
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" />
            {title && <h2 className="mb-4 text-lg font-black text-ink">{title}</h2>}
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
