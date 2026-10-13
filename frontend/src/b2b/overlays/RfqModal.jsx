import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "../ui/Modal.jsx";
import { Field, PillButton, Select, TextInput } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import {
  CBI_EUR_IRR,
  PRICE_LOCK_DAYS,
  defaultLeaseTerm,
  leaseOption,
  leasePrice,
  lockHash,
  money,
  priceLabel,
  pricesUsable,
  resolveLeaseRules,
} from "../lib/finance.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useSiteConfig } from "../../context/SiteConfigContext.jsx";
import { ProformaPreview } from "./ProformaPreview.jsx";
import { recallReferral } from "../../lib/referral.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// Proforma request. Three steps rather than one long form, because the
// qualifying answers (specialty, city, timeline) decide which of them a
// salesperson actually needs, and a doctor abandons a 9-field wall.
//
// Step order is deliberate: the two cheap dropdown steps come first and the
// contact details last, so a visitor has invested something before being
// asked for a phone number.
// Keys, not labels. These values are read back by staff in the Proformas queue,
// so what gets SENT stays the English key -- a quote whose specialty field
// says "پوست" is unsearchable for an English-speaking colleague. Only what
// the visitor reads is translated.
const SPECIALTIES = ["dermatology", "beauty", "hospital", "slimming", "physio"];
const CITIES = ["tehran", "isfahan", "shiraz", "mashhad", "tabriz", "karaj", "ahvaz", "other"];
const TIMELINES = ["immediate", "1_3", "3_6", "nextYear"];
const FINANCING = ["cash", "lease"];

// What a staff member reads in the Proformas queue.
//
// The form sends THIS, not the visitor's language and not the raw key: a
// quote whose specialty says "پوست" cannot be searched by an English-speaking
// colleague, and one that says "slimming" reads like a bug. One stable
// English label per key, in the one place that has to stay in step with the
// lists above.
const EN_LABEL = {
  dermatology: "Dermatology", beauty: "Beauty clinic", hospital: "Hospital / OR",
  slimming: "Slimming center", physio: "Physiotherapy",
  tehran: "Tehran", isfahan: "Isfahan", shiraz: "Shiraz", mashhad: "Mashhad",
  tabriz: "Tabriz", karaj: "Karaj", ahvaz: "Ahvaz", other: "Other",
  immediate: "Immediate (< 30 days)", "1_3": "1-3 months", "3_6": "3-6 months",
  nextYear: "Budgeting for next year",
  cash: "Cash - 7-day Rial lock",
};
const asEnglish = (key) => EN_LABEL[key] || key;

export function RfqModal() {
  const t = useT();
  const { rfq, closeRfq, notify } = useStorefront();
  const { devices, getDevice, pricesVisible } = useCatalogue();
  const { user } = useAuth();
  const siteConfig = useSiteConfig();
  const open = Boolean(rfq);

  const [step, setStep] = useState(1);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [done, setDone] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    specialty: SPECIALTIES[0],
    city: CITIES[0],
    timeline: TIMELINES[0],
    deviceId: "",
    financing: FINANCING[0],
    // Lease choice. Seeded from the lease tab when that is where the dialog
    // was opened from, and from the device's own rules otherwise.
    leaseMonths: null,
    leaseUpfront: null,
    name: "",
    phone: "",
    email: "",
  });

  // Each time the dialog opens: land on the financing the visitor already
  // chose on the device's lease tab, and fill in who they are if they are
  // signed in -- asking a customer for their own name again is the kind of
  // friction that ends a proforma request at step three.
  useEffect(() => {
    if (!rfq) return;
    // Someone who has already configured a lease has answered the qualifying
    // questions of step 1 in spirit; take them to the financing summary.
    setStep(rfq.lease ? 2 : 1);
    setForm((f) => ({
      ...f,
      financing: rfq.lease ? "lease" : f.financing,
      leaseMonths: rfq.lease?.months ?? null,
      leaseUpfront: rfq.lease?.upfrontPct ?? null,
      deviceId: rfq.deviceId || f.deviceId,
      name: f.name || user?.name || "",
      phone: f.phone || user?.phone || "",
      email: f.email || user?.email || "",
    }));
    // The dialog's identity is the `rfq` object; the user is read once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfq]);

  // The device the visitor was looking at when they opened this, so the
  // dropdown is pre-answered in the overwhelmingly common case.
  // An enquiry names a machine printed in the catalogue that we do not
  // list. There is no device record to quote against, so the flow carries
  // the name through instead of substituting a lookalike.
  const enquiry = rfq?.enquiry || null;
  const deviceId = form.deviceId || rfq?.deviceId || devices[0]?.id;
  const device = useMemo(() => getDevice(deviceId), [deviceId, getDevice]);
  const subject = enquiry || device.name;

  // The member whose link brought this visitor here, if the code was issued
  // for the device being quoted. Read when the dialog is open rather than at
  // render time on the server, where there is no storage to read.
  const referralCode = useMemo(
    () => (open && !enquiry ? recallReferral(deviceId) : null),
    [open, enquiry, deviceId]
  );

  // Lease: the rules this device is leased under, and the option the form
  // currently describes. Both come from the same code the device page uses,
  // so the figure here is the one the visitor was shown there.
  const rules = useMemo(
    () => resolveLeaseRules(device, Number(siteConfig?.lease_apr_bp) || 1800),
    [device, siteConfig?.lease_apr_bp]
  );
  const priced = !enquiry && pricesUsable(device, pricesVisible);
  const leaseAvailable = !enquiry && rules.enabled;
  const wantsLease = leaseAvailable && form.financing === "lease";
  const leaseMonths = rules.terms.some((x) => x.months === form.leaseMonths)
    ? form.leaseMonths
    : defaultLeaseTerm(rules);
  const leaseUpfront = Math.min(
    rules.max_upfront_pct,
    Math.max(rules.min_upfront_pct, form.leaseUpfront ?? 20)
  );
  const leaseQuote = wantsLease && priced
    ? leaseOption(rules, leasePrice(device, rules), { months: leaseMonths, upfrontPct: leaseUpfront })
    : null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function reset() {
    setStep(1);
    setDone(null);
    setSubmitting(false);
  }

  function handleClose() {
    closeRfq();
    // Deferred so the closing frame doesn't show the form snapping back to
    // step 1 while the dialog is still fading out.
    setTimeout(reset, 200);
  }

  async function submit() {
    // A name, and some way to reach them. Either a phone or an email will
    // do -- the server accepts both, and insisting on a phone number loses
    // the visitor who would rather be emailed.
    if (!form.name.trim() || !(form.phone.trim() || form.email.trim())) {
      notify(t("store.rfq.contactRequired"), "warning");
      return;
    }
    setSubmitting(true);
    const reference = `A7K-${lockHash(deviceId)}`;

    // A quote, not a contact-form entry. The backend gives it a reference,
    // stamps the CBI rate onto it, starts the lock clock, and can track it
    // through to an accepted sale -- none of which /leads can do.
    //
    // The server's reference wins over the locally generated one: it is the
    // number the sales desk and the customer will both quote, so it has to
    // be the one that exists in the database.
    let issued = reference;
    let pdfUrl = null;

    // A real lease request needs a product the server can price against and a
    // visible price. Without one (price on request, or a device that exists
    // only in the bundled catalogue) the visitor's preference still reaches
    // sales, as a plain proforma with the chosen terms written in the notes.
    const leaseRequest = Boolean(leaseQuote && device.productId);
    const leaseNote = wantsLease
      ? `Lease requested: ${leaseMonths} months, ${leaseUpfront}% upfront.`
      : undefined;
    try {
      const quote = await api.createQuote({
        kind: enquiry ? "enquiry" : leaseRequest ? "lease" : "proforma",
        product_id: enquiry ? undefined : device.productId || undefined,
        subject: subject,
        contact_name: form.name,
        contact_phone: form.phone,
        contact_email: form.email || undefined,
        clinic_city: asEnglish(form.city),
        specialty: asEnglish(form.specialty),
        timeline: asEnglish(form.timeline),
        financing: wantsLease ? `${leaseMonths}-month lease` : asEnglish(form.financing),
        // Only send a figure when one may be published -- the amount on the
        // quote is what the rate lock and the downloadable proforma are both
        // built from, so a placeholder would poison both. For a lease the
        // server recomputes everything from the product's rules; the price
        // is only used when the product has no real list price of its own.
        amount_cents:
          !enquiry && pricesUsable(device, pricesVisible)
            ? Math.round((leaseRequest ? leasePrice(device, rules) : device.price) * 100)
            : undefined,
        term_months: leaseRequest ? leaseMonths : undefined,
        upfront_pct: leaseRequest ? leaseUpfront : undefined,
        // Validated server-side against the product; a stale or foreign code
        // is simply dropped there and never fails the request.
        referral_code: referralCode || undefined,
        source: leaseRequest ? "storefront:lease" : "storefront:rfq",
        notes: enquiry ? `Catalogue enquiry: ${enquiry}` : leaseNote,
      });
      if (quote?.reference) issued = quote.reference;
      // The link the server minted for this document. It carries the id and
      // the reference together, which is what authorises the download for a
      // visitor who has no account yet.
      if (quote?.download_url) pdfUrl = api.absoluteUrl(quote.download_url);
    } catch {
      // The visitor has done their part. A network error on our side is not
      // something to hand back to them as a dead end -- they keep the
      // reference and the WhatsApp route still works.
    }

    setSubmitting(false);
    setDownloadUrl(pdfUrl);
    setDone(issued);
  }

  const stepTitle = done ? t("store.rfq.doneTitle") : t("store.rfq.stepTitle", { step });

  return (
    <Modal open={open} onClose={handleClose} title={stepTitle} size="sm">
      {done ? (
        <div>
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-green/12 text-brand-green">
              <Check className="h-6 w-6" />
            </span>
            <b className="mt-3 block text-base font-black text-ink">
              {t("store.rfq.proformaNo", { reference: done })}
            </b>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-ink-2">
              {t("store.rfq.doneBody")}
            </p>

            {/* The real document, not the preview below it. A visitor who is
                going to walk into an office with this needs the file, and the
                link works later from their email as well. */}
            {downloadUrl ? (
              <PillButton
                as="a"
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3"
              >
                {t("store.rfq.downloadPdf")}
              </PillButton>
            ) : null}
          </div>

          {/* The document itself, not a description of it. A buyer who has
              just handed over a phone number should be able to see exactly
              what was issued in their name -- and take it into a meeting --
              without waiting for the email to arrive. */}
          <div className="mt-4">
            <ProformaPreview
              reference={done}
              subject={subject}
              device={enquiry ? null : device}
              priced={priced}
              form={form}
              lease={leaseQuote}
            />
          </div>

          <PillButton className="mt-4" fullWidth variant="white" onClick={handleClose}>
            {t("common.close")}
          </PillButton>
        </div>
      ) : (
        // minmax(0,1fr): a bare `grid` column is auto-sized, so a select whose
        // longest option is wide (device name + price) stretches the column
        // past the dialog and takes every full-width button with it.
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {step === 1 ? (
            <>
              <Field label={t("store.rfq.specialtyLabel")}>
                <Select value={form.specialty} onChange={set("specialty")}>
                  {SPECIALTIES.map((key) => (
                    <option key={key} value={key}>
                      {t(`store.rfq.specialty.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("store.rfq.cityLabel")}>
                <Select value={form.city} onChange={set("city")}>
                  {CITIES.map((key) => (
                    <option key={key} value={key}>
                      {t(`store.city.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("store.rfq.timelineLabel")}>
                <Select value={form.timeline} onChange={set("timeline")}>
                  {TIMELINES.map((key) => (
                    <option key={key} value={key}>
                      {t(`store.rfq.timeline.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <PillButton fullWidth onClick={() => setStep(2)}>
                {t("common.next")}
              </PillButton>
            </>
          ) : null}

          {step === 2 ? (
            <>
              {enquiry ? (
                <div className="rounded-2xl border border-brand-green/30 bg-brand-green/8 p-3.5">
                  <span className="text-[10px] font-extrabold tracking-[0.1em] text-ink-2 uppercase">
                    {t("store.rfq.enquiringAbout")}
                  </span>
                  <b className="mt-0.5 block text-[13px] font-black text-ink">{enquiry}</b>
                  <p className="mt-1 text-[12px] text-ink-2">
                    {t("store.rfq.enquiryNote")}
                  </p>
                </div>
              ) : (
                <Field label={t("store.rfq.deviceLabel")}>
                  <Select value={deviceId} onChange={set("deviceId")}>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {priceLabel(d, pricesVisible)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t("store.rfq.financingLabel")}>
                <Select value={wantsLease ? "lease" : "cash"} onChange={set("financing")}>
                  {FINANCING.filter((key) => key !== "lease" || leaseAvailable).map((key) => (
                    <option key={key} value={key}>
                      {t(`store.rfq.financing.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {wantsLease ? (
                <div className="grid gap-3 rounded-2xl border border-line bg-panel-2 p-3.5">
                  <Field label={t("store.rfq.leaseTermLabel")}>
                    <Select
                      value={leaseMonths ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, leaseMonths: Number(e.target.value) }))}
                    >
                      {rules.terms.map((term) => (
                        <option key={term.months} value={term.months}>
                          {t("store.device.lease.monthsLabel", { months: term.months })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {rules.max_upfront_pct > rules.min_upfront_pct ? (
                    <Field
                      label={t("store.rfq.leaseUpfrontLabel", { pct: leaseUpfront })}
                      hint={t("store.device.lease.upfrontRange", {
                        min: rules.min_upfront_pct,
                        max: rules.max_upfront_pct,
                      })}
                    >
                      <TextInput
                        type="range"
                        min={rules.min_upfront_pct}
                        max={rules.max_upfront_pct}
                        step={1}
                        value={leaseUpfront}
                        onChange={(e) => setForm((f) => ({ ...f, leaseUpfront: Number(e.target.value) }))}
                        className="accent-brand-green h-auto cursor-pointer px-0 py-1"
                      />
                    </Field>
                  ) : null}
                  {leaseQuote ? (
                    <p className="text-[12px] text-ink-2">
                      {t("store.rfq.leaseSummary", {
                        months: leaseQuote.months,
                        pct: leaseQuote.upfrontPct,
                        amount: money(leaseQuote.monthly),
                      })}
                    </p>
                  ) : (
                    <p className="text-[12px] text-ink-2">{t("store.device.lease.quotedOnly")}</p>
                  )}
                </div>
              ) : null}
              {!enquiry && pricesUsable(device, pricesVisible) ? (
                <div className="rounded-2xl border border-line bg-panel-2 p-3.5 text-[12px] text-ink-2">
                  <b className="text-ink">{money(device.price)}</b> ≈{" "}
                  <span className="b2b-tnum">
                    {Math.round(device.price * CBI_EUR_IRR).toLocaleString("en-US")} IRR
                  </span>{" "}
                  at the CBI reference rate, locked for {PRICE_LOCK_DAYS} days on the proforma.
                </div>
              ) : (
                <div className="rounded-2xl border border-line bg-panel-2 p-3.5 text-[12px] text-ink-2">
                  This device is quoted rather than listed. Your proforma will carry the price and a{" "}
                  {PRICE_LOCK_DAYS}-day Rial lock at the CBI reference rate.
                </div>
              )}
              {/* A grid, not a flex row: the shared button is shrink-0, so two
                  w-full buttons in a flex row each claim the whole width and
                  push "Next" out past the dialog's edge, where it cannot be
                  seen or tapped. */}
              <div className="grid grid-cols-2 gap-2">
                <PillButton variant="white" fullWidth onClick={() => setStep(1)}>
                  {t("common.back")}
                </PillButton>
                <PillButton fullWidth onClick={() => setStep(3)}>
                  {t("common.next")}
                </PillButton>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Field label={t("store.rfq.nameLabel")}>
                <TextInput value={form.name} onChange={set("name")} placeholder={t("store.rfq.namePlaceholder")} />
              </Field>
              <Field label={t("store.rfq.phoneLabel")}>
                <TextInput
                  value={form.phone}
                  onChange={set("phone")}
                  inputMode="tel"
                  dir="ltr"
                  placeholder="+98 912 000 0000"
                />
              </Field>
              <Field label={t("store.rfq.emailLabel")} hint={t("store.rfq.emailHint")}>
                <TextInput
                  value={form.email}
                  onChange={set("email")}
                  type="email"
                  dir="ltr"
                  placeholder="doctor@clinic.ir"
                />
              </Field>
              {referralCode ? (
                <p className="rounded-2xl border border-brand-green/30 bg-brand-green/8 p-3 text-[12px] text-ink-2">
                  {t("store.rfq.referredNote")}
                </p>
              ) : null}
              <PillButton fullWidth onClick={submit} disabled={submitting}>
                {submitting ? t("store.rfq.generating") : t("store.rfq.generate")}
              </PillButton>
              <p className="text-center text-[11px] text-ink-2">{t("store.rfq.routedNote")}</p>
              <PillButton variant="white" fullWidth onClick={() => setStep(2)}>
                {t("common.back")}
              </PillButton>
            </>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
