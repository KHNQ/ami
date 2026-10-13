import { useRef } from "react";
import { Download, Printer } from "lucide-react";
import { PillButton } from "../ui/primitives.jsx";
import { ORG_CONTACT, ORG_NAME } from "../../lib/orgInfo.js";
import { CBI_EUR_IRR, PRICE_LOCK_DAYS, irr, money } from "../lib/finance.js";
import { countryName } from "../lib/labels.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The proforma, as the buyer will receive it.
//
// Printed to PDF through the browser rather than generated with a PDF
// library: this is a one-page A4 document of text and a table, `window.print`
// produces a real PDF on every platform with no dependency, and -- the part
// that matters commercially -- what the buyer downloads is exactly the
// document they just read on screen rather than a second rendering of it
// that can drift.
//
// The print rules live in index.css (`@media print`), which hides the rest of
// the app so only this sheet is on the page.
export function ProformaPreview({ reference, subject, device, form, priced, lease = null }) {
  const t = useT();
  // The form carries stable keys so staff read one language; the visitor
  // reading their own document should see theirs.
  const label = (group, key) =>
    key ? t(group === "city" ? `store.city.${key}` : `store.rfq.${group}.${key}`) : "—";
  const sheetRef = useRef(null);
  const issued = new Date();
  const expires = new Date(issued.getTime() + PRICE_LOCK_DAYS * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  return (
    <div>
      <div
        ref={sheetRef}
        data-proforma-sheet
        className="rounded-2xl border border-line bg-white p-6 text-[12px] leading-relaxed text-[#0b1f1a]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dce7e2] pb-4">
          <div>
            <b className="block text-[15px] font-black tracking-tight">{ORG_NAME}</b>
            <span className="mt-1 block max-w-[240px] text-[11px] text-[#5a7069]">
              {ORG_CONTACT.address}
            </span>
            <span className="block text-[11px] text-[#5a7069]">{ORG_CONTACT.email}</span>
          </div>
          <div className="text-end">
            <b className="block text-[13px] font-black">{t("store.proforma.heading")}</b>
            <span className="block text-[11px] text-[#5a7069]">
              {t("store.proforma.no", { reference })}
            </span>
            <span className="block text-[11px] text-[#5a7069]">
              {t("store.proforma.issued", { date: fmt(issued) })}
            </span>
            <span className="block text-[11px] text-[#5a7069]">
              {t("store.proforma.validTo", { date: fmt(expires) })}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <b className="block text-[10px] font-black tracking-[0.1em] text-[#5a7069] uppercase">
              {t("store.proforma.issuedTo")}
            </b>
            <span className="mt-1 block font-bold">{form.name || "—"}</span>
            <span className="block text-[11px] text-[#5a7069]">
              {label("specialty", form.specialty)} · {label("city", form.city)}
            </span>
            {form.phone ? (
              <span className="block text-[11px] text-[#5a7069]" dir="ltr">
                {form.phone}
              </span>
            ) : null}
            {form.email ? (
              <span className="block text-[11px] text-[#5a7069]">{form.email}</span>
            ) : null}
          </div>
          <div>
            <b className="block text-[10px] font-black tracking-[0.1em] text-[#5a7069] uppercase">
              {t("store.proforma.terms")}
            </b>
            <span className="mt-1 block text-[11px]">
              {t("store.rfq.paymentLine", { value: label("financing", form.financing) })}
            </span>
            {/* The lease as requested, so the document the buyer keeps states
                what they asked for. Indicative: sales confirms the terms. */}
            {lease ? (
              <span className="block text-[11px]">
                {t("store.rfq.leaseSummary", {
                  months: lease.months,
                  pct: lease.upfrontPct,
                  amount: money(lease.monthly),
                })}
              </span>
            ) : null}
            <span className="block text-[11px]">
              {t("store.rfq.timelineLine", { value: label("timeline", form.timeline) })}
            </span>
            <span className="block text-[11px]">
              {t("store.proforma.rateLocked", {
                days: PRICE_LOCK_DAYS,
                rate: CBI_EUR_IRR.toLocaleString("en-US"),
              })}
            </span>
          </div>
        </div>

        <table className="mt-5 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="bg-[#eef4f1] text-[10px] tracking-wide text-[#5a7069] uppercase">
              <th className="p-2 text-start">{t("store.proforma.colItem")}</th>
              <th className="p-2 text-start">{t("store.proforma.colOrigin")}</th>
              <th className="p-2 text-end">{t("store.proforma.colEur")}</th>
              <th className="p-2 text-end">{t("store.proforma.colIrr")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-t border-[#dce7e2] p-2">
                <b className="block font-bold">{subject}</b>
                {device && !device.enquiryOnly ? (
                  <span className="block text-[10.5px] text-[#5a7069]">
                    {t("store.proforma.specLine", {
                      wavelength: device.wavelength,
                      spot: device.spot,
                      warranty: device.warranty,
                    })}
                  </span>
                ) : (
                  <span className="block text-[10.5px] text-[#5a7069]">
                    {t("store.proforma.enquiryLine")}
                  </span>
                )}
              </td>
              <td className="border-t border-[#dce7e2] p-2">
                {device ? `${countryName(t, device.country)} — ${device.brand}` : "—"}
              </td>
              <td className="border-t border-[#dce7e2] p-2 text-end font-bold">
                {priced ? money(device.price) : t("store.proforma.onRequest")}
              </td>
              <td className="border-t border-[#dce7e2] p-2 text-end">
                {priced ? irr(device.price) : "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 border-t border-[#dce7e2] pt-3 text-[10.5px] text-[#5a7069]">
          {t("store.proforma.legal", { days: PRICE_LOCK_DAYS })}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <PillButton variant="white" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" />
          {t("store.proforma.print")}
        </PillButton>
        <PillButton variant="white" onClick={() => window.print()}>
          <Download className="h-3.5 w-3.5" />
          {t("store.proforma.savePdf")}
        </PillButton>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-2">
        {t("store.proforma.printHint")}
      </p>
    </div>
  );
}
