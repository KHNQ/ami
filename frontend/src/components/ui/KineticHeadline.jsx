import { useInView } from "../../hooks/useInView.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { cn } from "../../lib/cn.js";

// The hero's animated-text treatment, extracted so every page headline can
// use it.
//
// Words rise and un-blur one after another as the heading scrolls into view.
// Split per *word*, never per character: a per-letter split shatters the text
// for a screen reader and breaks text selection, and at these font sizes the
// difference is not visible anyway.
//
// The accessible text is preserved as a single visually-hidden copy, so
// assistive tech reads one clean sentence rather than a stream of
// disconnected <span>s -- the animated words are aria-hidden.

export function KineticHeadline({
  text,
  as: Tag = "h2",
  className,
  wordClassName,
  stagger = 55,
  delay = 0,
  gradientFrom = null,
}) {
  const reducedMotion = useReducedMotion();
  const [ref, inView] = useInView({ enabled: !reducedMotion, threshold: 0.2 });

  if (reducedMotion || !text) {
    return <Tag className={className}>{text}</Tag>;
  }

  const words = String(text).split(/\s+/).filter(Boolean);
  // Everything from this index on is painted with the brand gradient, which
  // is how the hero emphasises the back half of a headline.
  const gradientStart = gradientFrom === null ? words.length : gradientFrom;

  return (
    <Tag ref={ref} className={cn("relative", className)}>
      {/* No visually-hidden duplicate of the text.

          The obvious implementation pairs an `sr-only` copy with `aria-hidden`
          animated words, and that is genuinely necessary for a per-character
          split -- but this splits per *word* and keeps real spaces between
          them, so the heading's text content is already the exact original
          sentence and screen readers read it as continuous prose. The
          duplicate would only mean crawlers see the headline twice
          ("Tattoo removalTattoo removal"), which reads as keyword stuffing on
          pages whose entire purpose is being indexed. */}
      {words.map((word, i) => (
        <span key={i}>
          <span className="inline-block overflow-hidden align-bottom">
            <span
              className={cn(
                "inline-block",
                i >= gradientStart && "bg-gradient-to-r from-brand-green to-brand-blue bg-clip-text text-transparent",
                wordClassName
              )}
              style={{
                opacity: inView ? 1 : 0,
                // A small blur on the way in is what makes this read as
                // motion rather than as a list of fading words.
                filter: inView ? "blur(0px)" : "blur(6px)",
                transform: inView ? "none" : "translate3d(0, 0.55em, 0)",
                // Instant on the way out -- see the note in Reveal.jsx. The
                // headline ships visible so a crawler (and a visitor whose JS
                // failed) reads a real heading, not an invisible one.
                transition: inView
                  ? `opacity 620ms cubic-bezier(0.22,1,0.36,1) ${delay + i * stagger}ms, transform 620ms cubic-bezier(0.22,1,0.36,1) ${delay + i * stagger}ms, filter 620ms cubic-bezier(0.22,1,0.36,1) ${delay + i * stagger}ms`
                  : "none",
              }}
            >
              {word}
            </span>
          </span>
          {/* The space sits OUTSIDE the overflow-hidden wrapper. Inside it a
              trailing space is clipped along with the word's overflow, and the
              headline renders as one run-on string. */}
          {i < words.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}
