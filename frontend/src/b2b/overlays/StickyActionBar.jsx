import { useEffect, useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { ORG_CONTACT } from "../../lib/orgInfo.js";
import { ActionsDrawer } from "./ActionsDrawer.jsx";
import { whatsappGeneral } from "../lib/whatsapp.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// Phone-only call/WhatsApp/quote bar.
//
// It appears after the first screenful rather than immediately: covering the
// hero with a call-to-action before the visitor knows what the company sells
// is the pattern that trained people to close these bars on sight. Hidden
// entirely on desktop, where the header CTA is always in view anyway.
export function StickyActionBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Both before the early return: a hook called after `if (!show)` runs on
  // some renders and not others, which is exactly the hook-order violation
  // React cannot recover from.
  const t = useT();
  const phone = ORG_CONTACT.phones?.[0];

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-3 z-40 flex justify-center px-3 lg:hidden">
      <div
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-ink p-1.5 text-canvas shadow-2xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {phone ? (
          <a
            href={`tel:${String(phone).replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-extrabold"
          >
            <Phone className="h-3.5 w-3.5" />
            {t("store.bar.call")}
          </a>
        ) : null}
        <a
          href={whatsappGeneral(t("store.bar.whatsappMessage"))}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-3.5 py-2 text-xs font-extrabold text-white"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </a>
        {/* One tap opens the family drawer rather than the proforma dialog
            directly: on a phone the visitor may want any of four things, and
            a height-animating sheet can offer all of them without stacking
            modals. */}
        <ActionsDrawer>
          <button
            type="button"
            className="cursor-pointer rounded-full bg-brand-gradient px-3.5 py-2 text-xs font-extrabold text-white"
          >
            {t("store.bar.getQuote")}
          </button>
        </ActionsDrawer>
      </div>
    </div>
  );
}
