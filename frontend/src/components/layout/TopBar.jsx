import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn.js";
import { ThemeToggle } from "../ui/ThemeToggle.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

export function TopBar({ title, back = false, right, transparent = false, sticky = true }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div
      className={cn(
        "safe-top z-30 flex h-14 shrink-0 items-center gap-2 px-3",
        sticky && "sticky top-0",
        transparent ? "bg-transparent" : "glass border-b border-surface/6"
      )}
    >
      {back && (
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-surface/10 bg-surface/5 active:bg-surface/10"
          aria-label={t("common.back")}
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {title && <h1 className="flex-1 truncate text-body font-bold tracking-tight text-fg">{title}</h1>}
      {!title && <div className="flex-1" />}
      <div className="flex shrink-0 items-center gap-2">
        {right}
        <ThemeToggle />
      </div>
    </div>
  );
}
