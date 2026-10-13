import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { cn } from "@shared/lib/cn.js";

// A centred confirmation dialog.
//
// The admin console has used a bottom sheet for forms and `window.confirm` for
// yes/no questions. Neither suits "you are about to hand someone $5,000":
// a native confirm cannot show the amount, the person and a method to record,
// and a bottom sheet reads as a form to fill rather than a decision to make.
//
// Closes on Escape and on a click outside the panel, and locks page scroll
// while open. It does not close while `busy`, so a request in flight cannot be
// abandoned half-way through by a stray click.
export function Dialog({ open, onClose, title, children, footer, busy = false, className }) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl",
          className
        )}
      >
        <h2 id={titleId} className="shrink-0 border-b border-line px-5 py-4 text-[15px] font-extrabold text-fg">
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
