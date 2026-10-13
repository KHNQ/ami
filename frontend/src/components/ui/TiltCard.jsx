import { useRef } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { cn } from "../../lib/cn.js";

// A card that tips slightly toward the pointer, with a specular highlight
// tracking the cursor.
//
// Written against the DOM directly rather than through React state: a
// pointermove handler that called setState would re-render the subtree on
// every mouse event, which is exactly how this effect usually ends up
// janky. Here the handler writes two custom properties and nothing else --
// no React work, no layout, and the transform stays on the compositor.
//
// Pointer-driven only, so it never fires on touch (where there is no hover
// and the tilt would just fight the scroll), and it is skipped entirely
// under reduced motion.

const MAX_TILT_DEG = 7;

export function TiltCard({ children, className, glare = true, ...rest }) {
  const ref = useRef(null);
  const reducedMotion = useReducedMotion();

  function onPointerMove(e) {
    // Coarse pointers are touch: no hover state, and tilting under a finger
    // that is trying to scroll feels broken rather than responsive.
    if (reducedMotion || e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // -0.5..0.5 from the card's centre.
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;

    el.style.setProperty("--tilt-x", `${(-py * MAX_TILT_DEG).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(px * MAX_TILT_DEG).toFixed(2)}deg`);
    el.style.setProperty("--glare-x", `${((px + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--glare-y", `${((py + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--glare-o", "1");
  }

  function reset() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--glare-o", "0");
  }

  if (reducedMotion) {
    return (
      <div className={className} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      className={cn("group/tilt relative [transform-style:preserve-3d]", className)}
      style={{
        transform:
          "perspective(900px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))",
        transition: "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      {...rest}
    >
      {children}
      {glare && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-[var(--glare-o,0)] transition-opacity duration-300"
          style={{
            background:
              "radial-gradient(180px circle at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255,255,255,0.14), transparent 65%)",
          }}
        />
      )}
    </div>
  );
}
