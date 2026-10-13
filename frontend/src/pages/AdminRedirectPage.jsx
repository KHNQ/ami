import { ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/Button.jsx";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { PageTitle } from "../components/layout/PageTitle.jsx";
import { adminUrl } from "../lib/orgInfo.js";
import { useT } from "../i18n/I18nProvider.jsx";

// The admin console was deliberately split out into its own app (admin/) so
// a customer's browser never has to load any admin code -- see the plan
// note on Phase 3. That means there is no `/admin` route in *this* app on
// purpose, but a bare 404 gives no indication of that, which reads as
// "the admin panel is broken" rather than "it moved". This page exists
// purely to say where it actually lives.
export default function AdminRedirectPage() {
  const t = useT();
  const url = adminUrl();
  return (
    <PageTransition className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <PageTitle title={t("adminRedirect.pageTitle")} />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue">
        <ShieldCheck size={26} />
      </div>
      <h1 className="text-[19px] font-extrabold text-fg">{t("adminRedirect.heading")}</h1>
      <p className="max-w-[38ch] text-[14px] leading-relaxed text-fg/55">
        {t("adminRedirect.body")}
      </p>
      <code className="rounded-lg bg-surface/8 px-3 py-1.5 text-[13px] text-fg/80">{url}</code>
      <a href={url}>
        <Button>{t("adminRedirect.open")}</Button>
      </a>
    </PageTransition>
  );
}
