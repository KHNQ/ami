import { useCallback, useEffect, useState } from "react";
import { FileText, LifeBuoy, Package, Sparkles } from "lucide-react";
import { Onboarding } from "@/components/cult/onboarding.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// First-run tour on the account dashboard.
//
// cult-ui's `onboarding` compound component provides the stepper, the dot
// indicator and the back/next/complete navigation; the steps are this site's
// own. It exists because the dashboard is new and its most useful list --
// open quotes -- is the one thing a first-time visitor has never seen
// anywhere else on the site.
//
// Dismissal is remembered per user id, not globally: on a shared clinic
// machine the second person to sign in should still get the tour, and the
// first should not get it again.
const STORAGE_PREFIX = "trex-account-tour:";

const STEPS = [
  { icon: FileText, key: "step1" },
  { icon: Package, key: "step2" },
  { icon: LifeBuoy, key: "step3" },
];

export function AccountTour() {
  const t = useT();
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(true);

  // Read after mount, never during render: this component is inside an SSR'd
  // tree where localStorage does not exist, and a server/client mismatch here
  // would flash the tour at everyone who had already dismissed it.
  useEffect(() => {
    if (!user?.id) return;
    try {
      setDismissed(Boolean(window.localStorage.getItem(STORAGE_PREFIX + user.id)));
    } catch {
      setDismissed(true);
    }
  }, [user?.id]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      if (user?.id) window.localStorage.setItem(STORAGE_PREFIX + user.id, "1");
    } catch {
      /* private mode: the tour simply reappears next session */
    }
  }, [user?.id]);

  if (dismissed) return null;

  return (
    <Onboarding
      totalSteps={STEPS.length}
      onComplete={dismiss}
      className="mb-6 rounded-3xl border-line! bg-panel! p-6!"
    >
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        return (
          <Onboarding.Step key={step.key} step={i + 1}>
            <div className="flex flex-col items-center gap-3 pb-5 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-green/10 text-brand-green">
                <Icon className="h-5 w-5" />
              </span>
              <Onboarding.Header
                title={
                  <span className="text-[22px] font-black text-ink">
                    {t(`onboarding.${step.key}Title`)}
                  </span>
                }
                description={
                  <span className="mx-auto block max-w-[46ch] text-[13.5px] text-ink-2">
                    {t(`onboarding.${step.key}Body`)}
                  </span>
                }
              />
            </div>
          </Onboarding.Step>
        );
      })}

      <Onboarding.StepIndicator className="pb-4" />
      <Onboarding.Navigation
        nextLabel={t("store.catalog.next")}
        backLabel={t("common.back")}
        completeLabel={t("onboarding.gotIt")}
        className="[&_[data-slot=onboarding-complete]]:bg-brand-gradient [&_[data-slot=onboarding-complete]]:text-white"
      />

      <button
        type="button"
        onClick={dismiss}
        className="mt-3 cursor-pointer text-center text-[12px] font-bold text-ink-3 hover:text-ink-2"
      >
        <Sparkles className="me-1 inline h-3 w-3" />
        {t("onboarding.skip")}
      </button>
    </Onboarding>
  );
}
