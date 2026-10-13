import { useCallback, useMemo, useRef, useState } from "react";

// Drag-to-pan + pinch-to-zoom + wheel-to-zoom for a content div living
// inside a fixed-size, overflow-hidden container. Deliberately hand-rolled
// (no gesture library) since all we need is: 1-pointer drag pans, 2-pointer
// pinch zooms anchored at the pinch midpoint, wheel zooms anchored at the
// cursor. Nodes inside the content are expected to call stopPropagation on
// their own onPointerDown so taps on them never start a pan gesture.
export function usePanZoom({ minScale = 0.35, maxScale = 2.5, initialScale = 1 } = {}) {
  const containerRef = useRef(null);
  const [transform, setTransform] = useState({ scale: initialScale, tx: 0, ty: 0 });

  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const mode = useRef(null); // "pan" | "pinch" | null
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const pinchPrevDist = useRef(0);

  const clampScale = useCallback((s) => Math.min(maxScale, Math.max(minScale, s)), [minScale, maxScale]);

  const localPoint = useCallback((clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const onPointerDown = useCallback((e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (pointers.current.size === 1) {
      mode.current = "pan";
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
    } else if (pointers.current.size === 2) {
      mode.current = "pinch";
      const pts = [...pointers.current.values()];
      pinchPrevDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform.tx, transform.ty]);

  const onPointerMove = useCallback((e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode.current === "pan" && pointers.current.size === 1) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setTransform((t) => ({ ...t, tx: panStart.current.tx + dx, ty: panStart.current.ty + dy }));
    } else if (mode.current === "pinch" && pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const anchor = localPoint(midClient.x, midClient.y);
      const ratio = dist / (pinchPrevDist.current || dist);
      pinchPrevDist.current = dist;
      setTransform((t) => {
        const newScale = clampScale(t.scale * ratio);
        const actualRatio = newScale / t.scale;
        return {
          scale: newScale,
          tx: anchor.x - (anchor.x - t.tx) * actualRatio,
          ty: anchor.y - (anchor.y - t.ty) * actualRatio,
        };
      });
    }
  }, [localPoint, clampScale]);

  const endPointer = useCallback((e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) mode.current = null;
    else if (pointers.current.size === 1) {
      mode.current = "pan";
      const [[, p]] = pointers.current;
      panStart.current = { x: p.x, y: p.y, tx: transform.tx, ty: transform.ty };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform.tx, transform.ty]);

  const zoomBy = useCallback((factor, centerClient) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const anchor = centerClient
      ? localPoint(centerClient.x, centerClient.y)
      : rect
        ? { x: rect.width / 2, y: rect.height / 2 }
        : { x: 0, y: 0 };
    setTransform((t) => {
      const newScale = clampScale(t.scale * factor);
      const actualRatio = newScale / t.scale;
      return {
        scale: newScale,
        tx: anchor.x - (anchor.x - t.tx) * actualRatio,
        ty: anchor.y - (anchor.y - t.ty) * actualRatio,
      };
    });
  }, [localPoint, clampScale]);

  const setTo = useCallback((next) => setTransform(next), []);

  const handlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      style: { touchAction: "none" },
    }),
    [onPointerDown, onPointerMove, endPointer]
  );

  return { containerRef, scale: transform.scale, tx: transform.tx, ty: transform.ty, handlers, zoomBy, setTransform: setTo };
}
