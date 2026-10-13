import { initials } from "../../lib/format.js";
import { cn } from "../../lib/cn.js";

export function Avatar({ name, size = 40, className }) {
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-brand-gradient font-bold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}
