import { Link } from "react-router-dom";
import { PageTitle } from "../layout/PageTitle.jsx";
import { Button } from "@/components/shadcn/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card.jsx";
import { Field, FieldDescription, FieldGroup, FieldSeparator } from "@/components/shadcn/field.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// The one card that /login and /signup are both built from.
//
// Sign-in is shadcn's login-03 block: a centred card with a social row, a
// separator, the fields, a submit and a switch-to-the-other-form line, with
// the terms sentence beneath. Sign-up used to be a different screen entirely
// (a 3D device above a glass panel, its own input component, its own button),
// so going from one to the other read as leaving the product. Both now render
// through this component, which makes "same card, same spacing, same CTA
// layout" a property of the code rather than of two files kept in step by
// hand.
//
// The two social buttons are DISABLED rather than removed. This backend has no
// OAuth provider, and a live-looking "Login with Google" that silently fails
// is worse than one that plainly says it is not available yet -- so they keep
// the block's position and styling and state their own status.

function AppleIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <path
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
        fill="currentColor"
      />
    </svg>
  );
}

function GoogleIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <path
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * @param pageTitle   the browser tab title
 * @param title       the card heading
 * @param description the line under the heading
 * @param onSubmit    form submit handler
 * @param children    the credential fields, as <Field> blocks
 * @param error       message shown above the CTA, or null
 * @param cta         { label, loading } for the submit button
 * @param switchPrompt { prompt, to, label } the "other form" line under the CTA
 */
export function AuthCard({ pageTitle, title, description, onSubmit, children, error, cta, switchPrompt }) {
  const t = useT();
  return (
    <div className="b2b flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 p-6 md:p-10">
      <PageTitle title={pageTitle} />
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <FieldGroup>
                <Field>
                  <Button variant="outline" type="button" disabled title={t("auth.notAvailableYet")}>
                    <AppleIcon />
                    {t("auth.loginWithApple")}
                  </Button>
                  <Button variant="outline" type="button" disabled title={t("auth.notAvailableYet")}>
                    <GoogleIcon />
                    {t("auth.loginWithGoogle")}
                  </Button>
                  <FieldDescription className="text-center">{t("auth.socialDisabled")}</FieldDescription>
                </Field>

                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  {t("auth.orContinueWith")}
                </FieldSeparator>

                {children}

                {error ? (
                  <FieldDescription role="alert" className="text-center font-medium text-destructive">
                    {error}
                  </FieldDescription>
                ) : null}

                <Field>
                  {cta}
                  <FieldDescription className="text-center">
                    {switchPrompt.prompt}{" "}
                    <Link to={switchPrompt.to} className="underline underline-offset-4">
                      {switchPrompt.label}
                    </Link>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <FieldDescription className="px-6 text-center">
          {t("auth.terms")} <Link to="/contact">{t("auth.termsOfService")}</Link> {t("auth.and")}{" "}
          <Link to="/contact">{t("auth.privacyPolicy")}</Link>.
        </FieldDescription>
      </div>
    </div>
  );
}
