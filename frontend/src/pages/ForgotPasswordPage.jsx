import { useState } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { api } from "../lib/api.js";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { BrandLogo } from "../components/ui/BrandLogo.jsx";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { PageTitle } from "../components/layout/PageTitle.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(null); // holds the API response once submitted

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // The backend always returns the same generic shape whether or not
      // the email exists -- this page must never branch on that either,
      // so there's nothing here to distinguish "found" from "not found".
      const res = await api.forgotPassword({ email: email.trim() });
      setSent(res);
    } catch (err) {
      setError(err.message || t("common.somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageTransition className="flex min-h-dvh flex-1 flex-col justify-center px-6 py-10">
      <PageTitle title={t("auth.forgotTitlePage")} />
      <div className="mx-auto w-full max-w-sm">
        <div className="mx-auto mb-6 w-fit">
          <BrandLogo />
        </div>

        {!sent ? (
          <>
            <h1 className="text-center text-[26px] font-extrabold tracking-tight text-fg">
              {t("auth.forgotHeading")}
            </h1>
            <p className="mt-1.5 text-center text-[14px] text-fg/45">{t("auth.forgotBody")}</p>

            <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
              <Input
                label={t("common.email")}
                type="email"
                autoComplete="email"
                placeholder={t("auth.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={loading} className="mt-2">
                {t("auth.sendResetLink")}
              </Button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
              <MailCheck size={26} />
            </div>
            <h1 className="mt-4 text-[22px] font-extrabold tracking-tight text-fg">
              {t("auth.checkEmail")}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-fg/45">{sent.message}</p>

            {import.meta.env.DEV && sent.debug_reset_link && (
              <div className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-start">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                  {t("auth.devNoProvider")}
                </p>
                <Link to={`/reset-password?token=${sent.debug_token}`} className="mt-2 block break-all text-[12.5px] text-amber-200 underline">
                  {sent.debug_reset_link}
                </Link>
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-[13.5px] text-fg/40">
          <Link to="/login" className="font-semibold text-brand-green">
            {t("auth.backToSignIn")}
          </Link>
        </p>
      </div>
    </PageTransition>
  );
}
