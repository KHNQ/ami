import { Component } from "react";
import { useT } from "../i18n/I18nProvider.jsx";

// Deliberately self-contained: no useAuth/useToast/Button/etc, since this
// sits above LazyMotion/BrowserRouter/the providers in AppProviders.jsx and must
// render correctly even if one of *those* is what crashed. Whole-app
// boundary only (not per-route) -- this is a single mobile shell, not a
// multi-section app, so "something broke, reload" is an acceptable
// fallback anywhere in it.
//
// `useT` is the one exception to the no-imports rule, and it is a safe one:
// called outside I18nProvider -- which is where this always sits -- it hands
// back an English translator rather than throwing. So this screen reads in
// English even for a Persian visitor, which is the right trade for a screen
// whose job is to render when the provider tree itself may be what broke.
function ErrorFallback() {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-base-950 px-6 text-center">
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl text-2xl font-extrabold text-white shadow-lg shadow-emerald-500/30"
        style={{ background: "linear-gradient(135deg, var(--color-brand-green) 0%, var(--color-brand-blue) 100%)" }}
      >
        !
      </div>
      <h1 className="text-[22px] font-extrabold tracking-tight text-fg">
        {t("common.somethingWentWrong")}
      </h1>
      <p className="mt-2 max-w-[32ch] text-[14px] leading-relaxed text-fg/45">
        {t("errorBoundary.body")}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex h-12 items-center justify-center rounded-2xl px-6 text-[15px] font-semibold text-white shadow-lg shadow-emerald-500/20"
        style={{ background: "linear-gradient(135deg, var(--color-brand-green) 0%, var(--color-brand-blue) 100%)" }}
      >
        {t("errorBoundary.reload")}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // No error-reporting service wired up yet -- this is the single spot to
    // add one (Sentry, etc.) later.
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return <ErrorFallback />;
    return this.props.children;
  }
}
