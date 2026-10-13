import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/cn.js";

export function CopyChip({ value, className }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard unavailable, still flash the affordance */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-dashed border-line bg-panel-2 px-3 py-2 font-mono text-sm font-bold tracking-widest text-fg active:bg-panel-2",
        className
      )}
    >
      {value}
      {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} className="text-ink-2" />}
    </button>
  );
}
