import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Check, Globe } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { LOCALES, splitLocalePath, localePath } from "../../i18n/config.js";
import { cn } from "../../lib/cn.js";

// Language picker.
//
// Switching reloads rather than just setting state, because the locale is
// part of the URL (`/fa/products/123`). Keeping them in sync matters for more
// than tidiness: a shared link has to open in the language it was read in, and
// search engines need a stable URL per language to index.
export function LanguageSwitcher({ className, compact = false }) {
  const { locale, meta, available, t } = useI18n();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(code) {
    setOpen(false);
    if (code === locale) return;
    // Preserve where the reader actually is -- dropping them on the home page
    // because they changed language is a small betrayal of their intent.
    const { path } = splitLocalePath(location.pathname);
    const href = `${localePath(code, path)}${location.search}${location.hash}`;

    // A FULL page load, not navigate().
    //
    // The locale is the router's `basename`, and that is read once from the
    // URL when the app boots (entry-client.jsx). A client-side navigate()
    // therefore looks `/fa` up *inside* the English router, where no route
    // matches it -- so every language switch landed on the 404 page, while
    // typing the same URL by hand worked. Reassigning location re-boots the
    // app with the right basename, which is the only thing that can change
    // it.
    window.location.assign(href);
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("common.language")}
        className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 text-[12.5px] font-semibold text-ink-2 hover:text-fg"
      >
        <Globe size={14} />
        {!compact && <span>{meta.nativeName}</span>}
      </button>

      {open && (
        <ul
          role="listbox"
          // Anchored to the inline end so it never opens off-screen, in
          // either direction.
          className="absolute end-0 top-11 z-50 min-w-[168px] overflow-hidden rounded-xl border border-line bg-bg/95 py-1 shadow-xl backdrop-blur"
        >
          {available.map((code) => {
            const l = LOCALES[code];
            return (
              <li key={code}>
                <button
                  role="option"
                  aria-selected={code === locale}
                  onClick={() => choose(code)}
                  // Each option is rendered in its own language and its own
                  // direction: someone looking for Persian is scanning for
                  // "فارسی", not for "Persian".
                  lang={code}
                  dir={l.dir}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13.5px] hover:bg-panel-2",
                    code === locale ? "font-bold text-fg" : "text-ink-2"
                  )}
                >
                  <span aria-hidden className="text-[15px]">
                    {l.flag}
                  </span>
                  <span className="flex-1">{l.nativeName}</span>
                  {code === locale && <Check size={14} className="text-brand-green" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
