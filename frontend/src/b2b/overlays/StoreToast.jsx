import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/shadcn/sonner.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";

// Confirmation surface for the actions that don't open a dialog: locking a
// rate, subscribing, reserving, comparing past the limit.
//
// Now Sonner, which is what shadcn ships for this. It stacks (the previous
// implementation could only ever show one message, so a second action while
// a toast was up silently replaced the first), it pauses on hover, and it is
// already announced to screen readers.
//
// The storefront context stays the single source of "something happened" --
// call sites still call `notify()` and know nothing about Sonner. This
// component is the adapter between the two.
export function StoreToast() {
  const { toast: current, dismissToast } = useStorefront();

  useEffect(() => {
    if (!current) return;
    const show = current.tone === "warning" ? toast.warning : toast.success;
    show(current.message, { id: current.id, duration: 5200 });
    // Hand ownership to Sonner immediately. Leaving the message in context
    // would re-fire it on the next unrelated re-render.
    dismissToast();
  }, [current, dismissToast]);

  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-2xl border-line bg-panel text-ink shadow-2xl",
          description: "text-ink-2",
        },
      }}
    />
  );
}
