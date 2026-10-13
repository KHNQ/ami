import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { AuthCard } from "../components/auth/AuthCard.jsx";
import { Button } from "@/components/shadcn/button.jsx";
import { Field, FieldDescription, FieldLabel } from "@/components/shadcn/field.jsx";
import { Input } from "@/components/shadcn/input.jsx";
import { Spinner } from "@/components/shadcn/spinner.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

// Create account. The same card as /login -- header, social row, separator,
// fields, one full-width CTA, the switch-to-sign-in line and the terms
// sentence -- built from the same component (components/auth/AuthCard.jsx),
// with the same shadcn inputs. The only difference is the fields.
export default function SignupPage() {
  const t = useT();
  const { signup } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      await signup(email.trim(), password, name.trim());
      toast.success(t("auth.accountCreated"));
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || t("auth.signupFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      pageTitle={t("auth.signUpTitle")}
      title={t("auth.createAccount")}
      description={t("auth.signupSubtitle")}
      onSubmit={onSubmit}
      error={error}
      cta={
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner className="size-4" /> : null}
          {t("common.signUp")}
        </Button>
      }
      switchPrompt={{ prompt: t("auth.haveAccount"), to: "/login", label: t("common.signIn") }}
    >
      <Field>
        <FieldLabel htmlFor="name">{t("auth.fullName")}</FieldLabel>
        <Input
          id="name"
          type="text"
          autoComplete="name"
          placeholder={t("auth.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>

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
        <FieldLabel htmlFor="password">{t("common.password")}</FieldLabel>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <FieldDescription>{t("auth.passwordHint")}</FieldDescription>
      </Field>
    </AuthCard>
  );
}
