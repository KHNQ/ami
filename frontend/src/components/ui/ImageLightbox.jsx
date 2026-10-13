import { AnimatePresence, m } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useT } from "../../i18n/I18nProvider.jsx";

// Full-screen preview for a single image.
//
// The plate behind the photo is deliberately WHITE, not the dark page
// backdrop. These are background-removed product PNGs
// (scripts/make-transparent-images.py) photographed against white in the
// manufacturer's own material -- on a dark scrim their white bodywork,
// cabling and printed panel legends all disappear into the background, which
// is precisely the detail someone opens a full-screen preview to look at.
//
// Zoom and pan are here because the previous version was a static <img> at
// `max-height: 72dvh`: on a phone that renders a 1500px product photo at
// about 300px tall, so "view the actual unit" showed less detail than the
// thumbnail it was opened from.

const MAX_SCALE = 4;
const MIN_SCALE = 1;

export function ImageLightbox({ open, onClose, src, alt, caption }) {
  const t = useT();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Reset whenever it opens, so reopening never inherits the previous
  // image's zoom and lands the visitor on a random magnified corner.
  useEffect(() => {
    if (open) reset();
  }, [open, src, reset]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(MAX_SCALE, s + 0.5));
      if (e.key === "-") setScale((s) => Math.max(MIN_SCALE, s - 0.5));
      if (e.key === "0") reset();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, reset]);

  // Panning is only meaningful once zoomed in; at 1x the image already fits,
  // so dragging would just detach it from the frame for no reason.
  function onPointerDown(e) {
    if (scale <= 1) return;
    dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  }
  function onPointerUp(e) {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // SSR has no `document`; portals only mean anything in a real browser.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex flex-col">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
          />

          {/* Controls sit above the plate so they stay reachable at any zoom. */}
          <div className="relative z-20 flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="flex items-center gap-1.5">
              <IconButton onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.5))} label={t("lightbox.zoomOut")} disabled={scale <= MIN_SCALE}>
                <ZoomOut size={16} />
              </IconButton>
              <IconButton onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.5))} label={t("lightbox.zoomIn")} disabled={scale >= MAX_SCALE}>
                <ZoomIn size={16} />
              </IconButton>
              <IconButton onClick={reset} label={t("lightbox.resetZoom")} disabled={scale === 1 && offset.x === 0 && offset.y === 0}>
                <RotateCcw size={15} />
              </IconButton>
              <span className="ms-1 font-mono text-[11px] tabular-nums text-white/45">{Math.round(scale * 100)}%</span>
            </div>
            <IconButton onClick={onClose} label={t("lightbox.close")}>
              <X size={18} />
            </IconButton>
          </div>

          <m.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {/* The white plate. `overflow-hidden` keeps a zoomed image
                clipped to the frame instead of spilling across the page. */}
            <div
              className="relative flex w-full max-w-[560px] flex-1 items-center justify-center overflow-hidden rounded-3xl bg-white shadow-2xl"
              style={{ cursor: scale > 1 ? (dragRef.current ? "grabbing" : "grab") : "default" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => (scale > 1 ? reset() : setScale(2))}
            >
              <img
                src={src}
                alt={alt}
                draggable={false}
                className="max-h-full max-w-full select-none object-contain p-4"
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                  // No transition while dragging, or the image lags a frame
                  // behind the finger and feels broken.
                  transition: dragRef.current ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
            </div>

            {caption && (
              <div className="mt-3 max-w-[560px] text-center text-[12.5px] font-medium text-white/60">{caption}</div>
            )}
            <p className="mt-1 text-[10.5px] text-white/30">{t("lightbox.zoomHint")}</p>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function IconButton({ children, onClick, label, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 backdrop-blur-xl transition-colors hover:bg-white/20 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export default ImageLightbox;
