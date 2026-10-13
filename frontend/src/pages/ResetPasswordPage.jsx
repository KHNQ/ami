import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { useToast } from "../context/ToastContext.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { BrandLogo } from "../components/ui/BrandLogo.jsx";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { PageTitle } from "../components/layout/PageTitle.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

export default function ResetPasswordPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const toast = useToast();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword({ token, new_password: password });
      toast.success(t("auth.resetDone"));
      // No auto-login after a security-sensitive change -- force a fresh,
      // explicit sign-in with the new password.
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err.message || t("auth.resetLinkInvalid"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageTransition className="flex min-h-dvh flex-1 flex-col justify-center px-6 py-10">
      <PageTitle title={t("auth.resetTitlePage")} />
      <div className="mx-auto w-full max-w-sm">
        <div className="mx-auto mb-6 w-fit">
          <BrandLogo />
        </div>
        <h1 className="text-center text-[26px] font-extrabold tracking-tight text-fg">
          {t("auth.resetPassword")}
        </h1>
        <p className="mt-1.5 text-center text-[14px] text-fg/45">{t("auth.resetBody")}</p>

        {!token && (
          <p className="mt-6 text-center text-[13.5px] font-medium text-red-400">
            {t("auth.missingToken")}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <Input
            label={t("auth.newPassword")}
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label={t("auth.confirmNewPassword")}
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {error && (
            <div className="text-[13px] font-medium text-red-400">
              {error}{" "}
              <Link to="/forgot-password" className="underline">
                {t("auth.requestNewLink")}
              </Link>
            </div>
          )}
          <Button type="submit" size="lg" fullWidth loading={loading} disabled={!token} className="mt-2">
            {t("auth.resetPassword")}
          </Button>
        </form>

        <p className="mt-6 text-center text-[13.5px] text-fg/40">
          <Link to="/login" className="font-semibold text-brand-green">
            {t("auth.backToSignIn")}
          </Link>
        </p>
      </div>
    </PageTransition>
  );
}
