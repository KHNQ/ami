import { m } from "framer-motion";
import { cn } from "../../lib/cn.js";
import { Spinner } from "./Spinner.jsx";

// Storefront palette, and capsules rather than rounded rectangles -- the
// whole site's control language is pills (see b2b/ui/primitives.jsx), and
// these buttons now render on the same pages as those, so a `rounded-xl`
// button next to a `rounded-full` one read as two different products.
const variants = {
  primary: "bg-brand-gradient text-white shadow-[0_8px_24px_-8px_color-mix(in_oklab,var(--color-brand-green)_60%,transparent)] disabled:opacity-50",
  secondary: "bg-panel text-ink border border-line hover:bg-panel-2",
  ghost: "bg-transparent text-ink-2 hover:text-ink active:bg-panel-2",
  outline: "bg-transparent border border-line text-ink hover:bg-panel-2",
  danger: "bg-red-500/10 text-red-700 border border-red-500/30 hover:bg-red-500/20 dark:text-red-300",
};

const sizes = {
  sm: "h-9 px-4 text-sm rounded-full",
  md: "h-11 px-5 text-md rounded-full",
  lg: "h-12 px-6 text-base rounded-full",
  icon: "h-10 w-10 rounded-full",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  className,
  children,
  ...props
}) {
  return (
    <m.button
      whileTap={{ scale: disabled || loading ? 1 : 0.96 }}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 font-extrabold tracking-tight transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </m.button>
  );
}
