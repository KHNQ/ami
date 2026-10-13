import { Mail, Phone } from "lucide-react";
import { ORG_CONTACT } from "../../lib/orgInfo.js";
import { CBI_EUR_IRR } from "../lib/finance.js";
import { TOTAL_CENTERS } from "../data/installations.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The credential strip above the header.
//
// It is not decoration: FDA / CE / ISO 13485, the exclusive-representation
// claim and the installed count are the four things a procurement committee
// checks before it reads anything else, and burying them below the fold
// costs the sale. Phone and email sit on the right because in this market a
// large purchase still starts with a call.
export function AnnouncementBar() {
  const t = useT();
  const phone = ORG_CONTACT.phones?.[0];
  const telHref = phone ? `tel:${String(phone).replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="bg-ink text-canvas">
      <div className="b2b-container flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold text-brand-green">✓</span>
          <span>
            <b className="font-extrabold">FDA</b> · <b className="font-extrabold">CE</b> ·{" "}
            <b className="font-extrabold">ISO 13485</b> {t("store.bar.certified")}
          </span>
          <span aria-hidden className="opacity-30">
            •
          </span>
          <span className="hidden sm:inline">{t("store.bar.exclusive")}</span>
          <span aria-hidden className="hidden opacity-30 sm:inline">
            •
          </span>
          <span>
            <b className="font-extrabold">{TOTAL_CENTERS.toLocaleString("en-US")}</b>{" "}
            {t("store.bar.clinics")}
          </span>
          <span aria-hidden className="hidden opacity-30 md:inline">
            •
          </span>
          <span className="hidden md:inline">
            <b className="font-extrabold">{t("store.bar.years")}</b> {t("store.bar.inTehran")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {telHref ? (
            <a href={telHref} className="inline-flex items-center gap-1.5 hover:text-brand-green">
              <Phone className="h-3 w-3" />
              <span dir="ltr">{phone}</span>
            </a>
          ) : null}
          <a
            href={`mailto:${ORG_CONTACT.email}`}
            className="inline-flex items-center gap-1.5 hover:text-brand-green"
          >
            <Mail className="h-3 w-3" />
            <span className="hidden sm:inline">{ORG_CONTACT.email}</span>
          </a>
          {/* The live reference rate. Every euro price on the site converts
              through this number, so showing it is what makes the 7-day
              Rial lock a verifiable promise rather than a slogan. */}
          <span className="b2b-tnum rounded-full bg-canvas/10 px-2.5 py-0.5 font-extrabold">
            CBI EUR→IRR {CBI_EUR_IRR.toLocaleString("en-US")}
          </span>
        </div>
      </div>
    </div>
  );
}
