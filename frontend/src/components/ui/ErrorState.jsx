import { AlertTriangle } from "lucide-react";
import { Button } from "./Button.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

export function ErrorState({ error, onRetry }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-red-500/20 bg-red-500/5 px-6 py-10 text-center">
      <AlertTriangle className="text-red-600 dark:text-red-300" size={28} />
      <div className="text-sm font-black text-ink">{t("common.somethingWentWrong")}</div>
      <div className="max-w-[30ch] text-xs text-ink-2">{error?.message || t("common.retry")}</div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}
