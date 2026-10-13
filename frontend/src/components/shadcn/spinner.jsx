import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { useT } from "../../i18n/I18nProvider.jsx";

function Spinner({
  className,
  ...props
}) {
  const t = useT();
  return (
    <Loader2Icon
      role="status"
      aria-label={t("common.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
