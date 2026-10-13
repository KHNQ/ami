import { useState } from "react";
import { CheckCircle2, Clock, Mail, MapPin, Phone, Send } from "lucide-react";
import { ORG_CONTACT, ORG_NAME } from "../lib/orgInfo.js";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useFeature } from "../context/SiteConfigContext.jsx";
import { useT } from "../i18n/I18nProvider.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { Field, PillButton, SectionHead, TextInput } from "../b2b/ui/primitives.jsx";

// Contact and support, in one place.
//
// Two ways to reach us, both deliberately simple: the phone numbers, email
// and address on the left, and an intake form on the right -- a name, a way to
// reach you and what you need. The form lands in the admin queue and a person
// replies directly. There is no conversation here: no thread, no live chat,
// and no account required, because the person who most needs help is often
// the one who cannot sign in.
export default function ContactPage() {
  const t = useT();
  const { user } = useAuth();
  const open = useFeature("support_tickets_enabled");
  const { address, phones, email, map, supportHours } = ORG_CONTACT;

  const [form, setForm] = useState({ name: "", contact: "", message: "" });
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState(null);

  // Signed-in visitors do not retype who they are.
  const name = form.name || user?.name || "";
  const contact = form.contact || user?.phone || user?.email || "";
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !contact.trim() || !form.message.trim()) {
      setError(t("contact.form.required"));
      return;
    }
    setState("sending");
    setError(null);
    try {
      await api.submitSupportRequest({ name: name.trim(), contact: contact.trim(), message: form.message.trim() });
      setState("sent");
      setForm({ name: "", contact: "", message: "" });
    } catch (err) {
      setError(err?.message || t("contact.form.failed"));
      setState("idle");
    }
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: `${t("contact.contactUs")} — ${ORG_NAME}`,
    mainEntity: {
      "@type": "Organization",
      name: ORG_NAME,
      address: { "@type": "PostalAddress", streetAddress: address, addressLocality: "Tehran", addressCountry: "IR" },
      telephone: phones?.[0],
      email,
    },
  };

  return (
    <div className="b2b-container py-8">
      <PageMeta
        title={t("contact.contactUs")}
        description={t("contact.metaDesc", { address })}
        path="/contact"
        jsonLd={jsonLd}
      />
      <SectionHead
        eyebrow={t("contact.eyebrow")}
        title={t("contact.talkToUs")}
        lead={t("contact.soldWithConsultation")}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid content-start gap-3">
          <div className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-black text-ink">
              <Phone className="h-4 w-4 text-brand-green" aria-hidden /> {t("common.phone")}
            </h2>
            <ul className="space-y-1.5">
              {(phones || []).map((p) => (
                <li key={p}>
                  <a
                    href={`tel:${p.replace(/[^\d+]/g, "")}`}
                    className="text-[14px] text-ink-2 hover:text-ink"
                    dir="ltr"
                  >
                    {p}
                  </a>
                </li>
              ))}
            </ul>
            <a
              href={`mailto:${email}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-brand-blue"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden /> {email}
            </a>
            {supportHours ? (
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
                <Clock className="h-3 w-3" aria-hidden /> {supportHours}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-black text-ink">
              <MapPin className="h-4 w-4 text-brand-green" aria-hidden /> {t("contact.visitUs")}
            </h2>
            <p className="text-[14px] leading-relaxed text-ink-2">{address}</p>
            {map?.url ? (
              <a
                href={map.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-block text-[13px] font-bold text-brand-blue"
              >
                {t("contact.openInMaps")} →
              </a>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
          <h2 className="text-lg font-black text-ink">{t("contact.form.title")}</h2>
          <p className="mt-1 text-[13px] text-ink-2">{t("contact.form.lead")}</p>

          {!open ? (
            <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[13px] text-ink">
              {t("errors.support_disabled")}
            </p>
          ) : state === "sent" ? (
            <div role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-brand-green/30 bg-brand-green/8 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" aria-hidden />
              <div>
                <b className="block text-[14px] font-black text-ink">{t("contact.thanksTitle")}</b>
                <button
                  type="button"
                  onClick={() => setState("idle")}
                  className="mt-1.5 cursor-pointer text-[12.5px] font-bold text-brand-blue"
                >
                  {t("contact.form.another")}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 grid gap-3.5" noValidate>
              <Field label={t("contact.form.name")}>
                <TextInput value={name} onChange={set("name")} autoComplete="name" maxLength={200} required />
              </Field>
              <Field label={t("contact.form.contact")} hint={t("contact.form.contactHint")}>
                <TextInput
                  value={contact}
                  onChange={set("contact")}
                  autoComplete="email"
                  maxLength={200}
                  dir="ltr"
                  required
                />
              </Field>
              <Field label={t("contact.form.message")}>
                <textarea
                  rows={5}
                  value={form.message}
                  onChange={set("message")}
                  maxLength={4000}
                  required
                  placeholder={t("contact.form.messagePlaceholder")}
                  className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 focus-visible:border-brand-green/60 focus-visible:outline-none"
                />
              </Field>
              {error ? (
                <p role="alert" className="text-[12.5px] font-bold text-red-600 dark:text-red-300">
                  {error}
                </p>
              ) : null}
              <PillButton type="submit" size="lg" disabled={state === "sending"}>
                <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                {state === "sending" ? t("contact.form.sending") : t("contact.form.submit")}
              </PillButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
