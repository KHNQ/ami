import { Link } from "react-router-dom";
import { Scale, X } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { PillButton } from "../ui/primitives.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// The comparison tray. Sticks to the bottom of the viewport for as long as
// anything is in it, because comparison is a cross-page activity: devices go
// in from the shop grid, from a device page and from a catalogue hotspot,
// and the tray is the only thing telling the visitor those picks survived
// the navigation.
export function CompareBar() {
  const t = useT();
  const { compareDevices, clearCompare, toggleCompare, maxCompare } = useStorefront();
  const { isAuthed } = useAuth();
  if (compareDevices.length === 0) return null;

  return (
    // Both this and the signed-in dock are `sticky bottom-*` in the same
    // flex column, so with a signed-in visitor they occupy the same strip of
    // viewport and overlap. The tray sits above the dock instead.
    <div
      className={cn("pointer-events-none sticky z-30 px-3 sm:px-6", isAuthed ? "bottom-24" : "bottom-3")}
    >
      <div className="b2b-container pointer-events-auto flex flex-wrap items-center gap-3 rounded-3xl border border-white/10 bg-ink px-4 py-3 text-canvas shadow-2xl">
        <b className="inline-flex items-center gap-2 text-sm font-black">
          <Scale className="h-4 w-4" />
          {t("store.compareBar.title", {
            count: compareDevices.length,
            max: maxCompare,
          })}
        </b>

        <div className="flex flex-1 flex-wrap gap-2">
          {compareDevices.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-2 rounded-full bg-canvas/12 px-3 py-1.5 text-xs font-bold"
            >
              <span aria-hidden>{d.flag}</span>
              {d.name}
              <button
                type="button"
                onClick={() => toggleCompare(d.id)}
                aria-label={t("store.device.removeCompareAria", { name: d.name })}
                className="cursor-pointer opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <PillButton variant="ghost" size="sm" onClick={clearCompare}>
            {t("store.shop.clear")}
          </PillButton>
          <PillButton as={Link} to="/compare" size="sm">
            {t("store.roi.compareNow")}
          </PillButton>
        </div>
      </div>
    </div>
  );
}
