// Decorative, fixed-position blurred gradient blobs. Purely visual --
// aria-hidden and pointer-events-none so they never interfere with layout
// or a11y.
export function BackgroundGlow({ variant = "default" }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-24 -start-16 h-72 w-72 animate-blob rounded-full bg-emerald-600/25 blur-[90px]" />
      <div className="absolute top-1/3 -end-20 h-72 w-72 animate-blob rounded-full bg-blue-600/20 blur-[100px] [animation-delay:3s]" />
      {variant === "default" && (
        <div className="absolute bottom-0 start-1/4 h-64 w-64 animate-blob rounded-full bg-teal-600/15 blur-[90px] [animation-delay:6s]" />
      )}
    </div>
  );
}
