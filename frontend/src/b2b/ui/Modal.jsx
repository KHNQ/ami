import { cn } from "../../lib/cn.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/shadcn/dialog.jsx";

// Shared dialog shell for the five storefront flows (device detail,
// comparison, proforma, reserve, patient leads) plus the exit offer.
//
// This is now shadcn's Dialog, which is Radix underneath. That replaces a
// hand-rolled portal that had to implement -- and keep correct -- focus
// trapping, focus restore, Escape handling, scroll locking, `aria-modal`
// and the press-started-inside-released-outside case that otherwise
// dismisses a dialog when you finish selecting text. Radix has all of that,
// and it is the single strongest argument for adopting the library at all.

const SIZES = {
  sm: "sm:max-w-lg",
  md: "sm:max-w-2xl",
  lg: "sm:max-w-4xl",
  xl: "sm:max-w-6xl",
};

export function Modal({ open, onClose, title, description, size = "md", children, footer, className }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent
        className={cn(
          "flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-3xl border-line bg-panel p-0",
          SIZES[size],
          className
        )}
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-line px-5 py-4 text-start">
          <DialogTitle className="text-sm font-black text-ink sm:text-base">{title}</DialogTitle>
          {/* Radix warns when a dialog has no description. Most of these
              flows carry their explanation in the body rather than a
              subtitle, so the element is always present and simply hidden
              when there is nothing to say. */}
          <DialogDescription className={description ? "text-[13px] text-ink-2" : "sr-only"}>
            {description || title}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <DialogFooter className="shrink-0 border-t border-line bg-panel-2/60 px-5 py-4">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
