import { useState } from "react";
import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { usePwa } from "../../hooks/usePwa.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The three moments that make an installed web app feel like an app:
// it can be installed, it tells you when it has updated, and it tells you
// when it has lost the network instead of silently failing.
//
// All three are deliberately non-blocking: nothing here is a modal, because
// none of it is more important than what the visitor came to do.
export function PwaLayer() {
  const t = useT();
  const { canInstall, updateReady, offline, promptInstall, dismissInstall, installDismissed, reload } = usePwa();
  const [hidden, setHidden] = useState(false);

  const showInstall = canInstall && !hidden && !installDismissed();

  return (
    <>
      {/* Offline. Highest priority of the three -- it explains why
          everything else may be failing. */}
      {offline && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500/95 px-4 py-1.5 text-[12px] font-semibold text-amber-950"
        >
          <WifiOff size={13} />
          {t("pwa.offline")}
        </div>
      )}

      {/* A new build is cached and waiting for a reload. */}
      {updateReady && !offline && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-gradient-to-r from-brand-green to-brand-blue px-4 py-1.5 text-[12px] font-semibold text-white">
          {t("pwa.updateReady")}
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 font-bold hover:bg-white/30"
          >
            <RefreshCw size={11} />
            {t("pwa.reload")}
          </button>
        </div>
      )}

      {/* Install invitation. Shown once; dismissing it is remembered, because
          repeatedly asking someone to install an app they declined is the
          fastest way to make them leave. */}
      {showInstall && (
        <div className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm overflow-hidden rounded-2xl border border-surface/12 bg-bg/95 p-3 shadow-2xl backdrop-blur sm:inset-x-auto sm:start-4 sm:bottom-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-green to-brand-blue text-white">
              <Download size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-fg">{t("pwa.installTitle")}</p>
              <p className="truncate text-[11.5px] text-fg/45">{t("pwa.installBody")}</p>
            </div>
            <button
              type="button"
              onClick={promptInstall}
              className="shrink-0 rounded-xl bg-gradient-to-br from-brand-green to-brand-blue px-3 py-2 text-[12px] font-bold text-white"
            >
              {t("pwa.install")}
            </button>
            <button
              type="button"
              onClick={() => {
                dismissInstall();
                setHidden(true);
              }}
              aria-label={t("common.close")}
              className="shrink-0 text-fg/30 hover:text-fg/60"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
