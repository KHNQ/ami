import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// Tuned for the storefront's light canvas, which is what the signed-in
// screens sit on now. The old tones were `*-300` text on a 15 % tint --
// correct on the commerce app's near-black surface, and unreadable on
// white. The dark-theme variants keep the lighter text so both themes work.
const tones = {
  neutral: "bg-panel-2 text-ink-2 border-line",
  pink: "bg-pink-500/10 text-pink-700 border-pink-500/25 dark:text-pink-300",
  violet: "bg-violet-500/10 text-violet-700 border-violet-500/25 dark:text-violet-300",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
  warning: "bg-amber-500/12 text-amber-800 border-amber-500/25 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-700 border-red-500/25 dark:text-red-300",
  sky: "bg-sky-500/10 text-sky-700 border-sky-500/25 dark:text-sky-300",
};

export function Badge({ tone = "neutral", className, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-label font-semibold tracking-wide uppercase",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE = {
  active: "success",
  completed: "success",
  paid: "success",
  approved: "success",
  pending: "warning",
  open: "sky",
  inactive: "neutral",
  suspended: "danger",
  banned: "danger",
  rejected: "danger",
  refunded: "danger",
  clawed_back: "danger",
  partially_refunded: "warning",
  partially_clawed_back: "warning",
  closed: "neutral",
  expired: "neutral",
  revoked: "danger",
  discontinued: "neutral",
};

export function StatusBadge({ status, className }) {
  const t = useT();
  if (!status) return null;
  // The catalogs own the words. A status the backend adds later has no key,
  // so `t` degrades to the final key segment with its underscores removed --
  // which is exactly the humanised id this used to print.
  return (
    <Badge tone={STATUS_TONE[status] || "neutral"} className={className}>
      {t(`status.${status}`)}
    </Badge>
  );
}
