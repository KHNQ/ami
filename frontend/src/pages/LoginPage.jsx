import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { AuthCard } from "../components/auth/AuthCard.jsx";
import { Button } from "@/components/shadcn/button.jsx";
import { Field, FieldLabel } from "@/components/shadcn/field.jsx";
import { Input } from "@/components/shadcn/input.jsx";
import { Spinner } from "@/components/shadcn/spinner.jsx";
import { ORG_NAME } from "../lib/orgInfo.js";
import { useT } from "../i18n/I18nProvider.jsx";

// Sign-in. The card itself (header, social row, separator, CTA, terms line)
// lives in components/auth/AuthCard.jsx and is shared with /signup, so the
// two screens cannot drift apart. This file is only the credential fields and
// the call to the real auth endpoint.

export default function LoginPage() {
  const t = useT();
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.success(t("auth.welcomeBack"));
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (err) {
      setError(err.message || t("auth.loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      pageTitle={t("auth.signInTitle")}
      title={t("auth.welcomeBack")}
      description={t("auth.signInSubtitle", { org: ORG_NAME })}
      onSubmit={onSubmit}
      error={error}
      cta={
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner className="size-4" /> : null}
          {t("auth.login")}
        </Button>
      }
      switchPrompt={{ prompt: t("auth.noAccount"), to: "/signup", label: t("common.signUp") }}
    >
      <Field>
        <FieldLabel htmlFor="email">{t("common.email")}</FieldLabel>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="m@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>

      <Field>
        <div className="flex items-center">
          <FieldLabel htmlFor="password">{t("common.password")}</FieldLabel>
          <Link to="/forgot-password" className="ms-auto text-sm underline-offset-4 hover:underline">
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
    </AuthCard>
  );
}
