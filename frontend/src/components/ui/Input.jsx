import { forwardRef, useId } from "react";
import { cn } from "../../lib/cn.js";

// The commerce app's labelled input: label, optional prefix/suffix adornments,
// and a hint line that the error message replaces when there is one (never
// both -- two lines of guidance under one field is one too many).
export const Input = forwardRef(function Input(
  { label, error, hint, prefix, suffix, className, containerClassName, ...props },
  ref
) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("block", containerClassName)}>
      {label && <span className="mb-1.5 block text-xs font-bold text-ink-2">{label}</span>}
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border bg-panel px-4 transition-colors",
          error ? "border-red-500/50" : "border-line focus-within:border-brand-green/60"
        )}
      >
        {prefix && <span className="shrink-0 text-ink-3">{prefix}</span>}
        <input
          id={id}
          ref={ref}
          className={cn(
            "h-12 w-full flex-1 bg-transparent text-md text-ink outline-none placeholder:text-ink-3",
            className
          )}
          {...props}
        />
        {suffix && <span className="shrink-0 text-ink-3">{suffix}</span>}
      </div>
      {error && <span className="mt-1.5 block text-2xs font-bold text-red-600 dark:text-red-300">{error}</span>}
      {!error && hint && <span className="mt-1.5 block text-2xs text-ink-2">{hint}</span>}
    </label>
  );
});
