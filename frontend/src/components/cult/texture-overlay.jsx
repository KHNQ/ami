import { cn } from "@/lib/utils";

// cult-ui `texture-overlay`, converted to JSX and made theme-aware.
//
// Two changes from the published component, both load-bearing:
//
// 1. It shipped every pattern as a hardcoded `rgba(0,0,0,…)`. This site has a
//    dark theme, and a black-on-near-black texture is invisible -- so each
//    stop is mixed from `--color-fg`, which flips with the theme.
//
// 2. The patterns are inline `background-image` strings rather than
//    arbitrary-value Tailwind classes. That is NOT a style preference: the
//    original works because `bg-[radial-gradient(...)]` is a complete literal
//    in the source, which Tailwind's scanner can see. Building the same
//    class from a template (to inject the theme colour) produces a string
//    that exists only at runtime -- Tailwind never emits a rule for it, and
//    every texture renders as nothing. Inline styles have no scanner to
//    satisfy, so the colour can be computed.

const fg = (pct) => `color-mix(in oklab, var(--color-fg) ${pct}%, transparent)`;

const PATTERNS = {
  dots: () => ({
    backgroundImage: `radial-gradient(circle at 1px 1px, ${fg(40)} 1px, transparent 0)`,
    backgroundSize: "8px 8px",
  }),
  grid: () => ({
    backgroundImage: `linear-gradient(${fg(30)} 1px, transparent 1px), linear-gradient(90deg, ${fg(30)} 1px, transparent 1px)`,
    backgroundSize: "12px 12px",
  }),
  noise: () => ({
    backgroundImage: `radial-gradient(circle at 2px 2px, ${fg(25)} 1px, transparent 0)`,
    backgroundSize: "6px 6px",
  }),
  crosshatch: () => ({
    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, ${fg(30)} 2px, ${fg(30)} 4px), repeating-linear-gradient(-45deg, transparent, transparent 2px, ${fg(30)} 2px, ${fg(30)} 4px)`,
  }),
  diagonal: () => ({
    backgroundImage: `repeating-linear-gradient(-45deg, ${fg(20)}, ${fg(20)} 1px, transparent 1px, transparent 6px)`,
  }),
  scatteredDots: () => ({
    backgroundImage: `radial-gradient(circle at 3px 7px, ${fg(30)} 1px, transparent 0), radial-gradient(circle at 11px 2px, ${fg(30)} 1px, transparent 0), radial-gradient(circle at 7px 12px, ${fg(30)} 1px, transparent 0)`,
    backgroundSize: "16px 16px",
  }),
  halftone: () => ({
    backgroundImage: `radial-gradient(circle, ${fg(40)} 25%, transparent 25%)`,
    backgroundSize: "10px 10px",
    backgroundPosition: "0 0, 5px 5px",
  }),
  triangular: () => ({
    backgroundImage: `conic-gradient(from 0deg at 50% 50%, ${fg(30)} 0deg 120deg, transparent 120deg 240deg, ${fg(30)} 240deg 360deg)`,
    backgroundSize: "8px 8px",
    backgroundPosition: "0 0, 4px 4px",
  }),
  chevron: () => ({
    backgroundImage: `repeating-linear-gradient(45deg, ${fg(20)} 0px, ${fg(20)} 2px, transparent 2px, transparent 8px), repeating-linear-gradient(-45deg, ${fg(20)} 0px, ${fg(20)} 2px, transparent 2px, transparent 8px)`,
  }),
  paperGrain: () => ({
    backgroundImage: `repeating-linear-gradient(0deg, ${fg(10)} 0px, transparent 1px, transparent 3px), repeating-linear-gradient(90deg, ${fg(10)} 0px, transparent 1px, transparent 4px), repeating-linear-gradient(45deg, ${fg(5)} 0px, transparent 1px, transparent 5px)`,
  }),
  horizontalLines: () => ({
    backgroundImage: `repeating-linear-gradient(0deg, ${fg(25)} 0px, ${fg(25)} 1px, transparent 1px, transparent 4px)`,
  }),
  verticalLines: () => ({
    backgroundImage: `repeating-linear-gradient(90deg, ${fg(25)} 0px, ${fg(25)} 1px, transparent 1px, transparent 4px)`,
  }),
};

// Two patterns this site already relied on that cult-ui has no equivalent
// for: `hatch` reads on the deep inverted panels where dots vanish, and
// `aurora` is a soft brand wash rather than a repeat, used behind headers.
PATTERNS.hatch = () => ({
  backgroundImage: `repeating-linear-gradient(45deg, ${fg(7)} 0 1px, transparent 1px 8px)`,
});
PATTERNS.aurora = () => ({
  backgroundImage:
    "radial-gradient(60% 45% at 20% 15%, color-mix(in oklab, var(--color-brand-green) 16%, transparent), transparent 70%)," +
    "radial-gradient(55% 40% at 82% 25%, color-mix(in oklab, var(--color-brand-blue) 15%, transparent), transparent 70%)",
});

// Fades the tile out toward the edges so it reads as texture rather than as
// a hard-edged panel sitting on top of the section. cult-ui ships no masking
// at all -- without it every texture ends in a visible straight line at the
// section boundary, which is the tell that it is an overlay.
const MASKS = {
  none: undefined,
  y: "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)",
  radial: "radial-gradient(ellipse at center, black 45%, transparent 78%)",
  top: "linear-gradient(to bottom, black, transparent)",
};

export const TEXTURE_TYPES = Object.keys(PATTERNS);

export function TextureOverlay({
  texture,
  // `variant` is the name the storefront's own overlay used at every call
  // site; accepted as an alias so this could replace it without touching them.
  variant,
  mask = "none",
  opacity = 1,
  className,
  style,
}) {
  const pattern = PATTERNS[texture ?? variant];
  if (!pattern) return null;
  const maskImage = MASKS[mask];

  return (
    <div
      aria-hidden
      data-slot="texture-overlay"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        ...pattern(),
        opacity,
        ...(maskImage ? { maskImage, WebkitMaskImage: maskImage } : null),
        ...style,
      }}
    />
  );
}
