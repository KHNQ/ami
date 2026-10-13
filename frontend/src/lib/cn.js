import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, last one winning.
 *
 * The twMerge half is new, and it fixes a real bug rather than being
 * decoration. Previously this was clsx alone, so a caller passing
 * `hidden` to a component whose base classes already said `inline-flex`
 * ended up with both: which one applied was decided by their order in the
 * generated stylesheet, not by the call site's intent -- and Tailwind emits
 * `inline-flex` after `hidden`, so the element stayed visible. That is what
 * made the storefront header overflow at four viewport widths.
 *
 * It is also what every shadcn component assumes, since `className` on them
 * is expected to override the variant defaults rather than fight them.
 */
export function cn(...args) {
  return twMerge(clsx(...args));
}
