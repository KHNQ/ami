import { useState } from "react";
import { Phone, MapPin, Mail, Send, CheckCircle2 } from "lucide-react";
import { ORG_CONTACT } from "../../lib/orgInfo.js";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Input } from "../ui/Input.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// Replaces the buy button when online purchasing is switched off.
//
// This is the whole point of the online_purchase_enabled flag: B2B medical
// equipment is normally sold by quote and consultation, not by checkout, and
// the company may well want walk-ins and phone calls rather than card
// payments. Turning the flag off has to leave a *better* path, not a dead end
// where a button used to be.
//
// The way to leave details is the same support intake the contact page uses
// -- a name, a way to reach you and a message -- with the product named in
// the message so staff know what it is about.
export function VisitUsPanel({ product }) {
  const t = useT();
  const { address, phones, email, map } = ORG_CONTACT;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", message: "" });
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api.submitSupportRequest({
        name: form.name,
        contact: form.contact,
        message: [product ? `Enquiry about: ${product.name}` : null, form.message || "Please get in touch."]
          .filter(Boolean)
          .join("\n\n"),
      });
      setState("sent");
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  }

  return (
    <div className="rounded-2xl border border-surface/10 bg-surface/[0.03] p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-green">{t("contact.eyebrow")}</p>
      <h3 className="mt-1.5 text-[18px] font-extrabold text-fg">
        {product ? t("contact.askAbout", { name: product.name }) : t("contact.talkToUs")}
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg/55">
        {t("contact.soldWithConsultation")}
      </p>

      <div className="mt-4 flex flex-col gap-2.5">
        {phones.map((p) => (
          <a
            key={p}
            href={`tel:${p.replace(/[^+\d]/g, "")}`}
            className="flex items-center gap-3 rounded-xl border border-surface/10 bg-surface/5 px-3.5 py-3 text-[14px] font-semibold text-fg"
          >
            <Phone size={15} className="text-brand-green" />
            <span dir="ltr">{p}</span>
          </a>
        ))}
        <a
          href={`mailto:${email}`}
          className="flex items-center gap-3 rounded-xl border border-surface/10 bg-surface/5 px-3.5 py-3 text-[14px] text-fg/75"
        >
          <Mail size={15} className="text-brand-green" />
          {email}
        </a>
        <a
          href={map.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-xl border border-surface/10 bg-surface/5 px-3.5 py-3 text-[13px] leading-relaxed text-fg/65"
        >
          <MapPin size={15} className="mt-0.5 shrink-0 text-brand-green" />
          <span>
            {address}
            <span className="mt-0.5 block text-[12px] font-semibold text-brand-blue">{t("contact.openInMaps")} →</span>
          </span>
        </a>
      </div>

      {state === "sent" ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-brand-green/25 bg-brand-green/5 p-3.5">
          <CheckCircle2 size={17} className="shrink-0 text-brand-green" />
          <p className="text-[13px] text-fg/70">{t("contact.thanksTitle")}</p>
        </div>
      ) : !open ? (
        <Button variant="ghost" fullWidth className="mt-3" onClick={() => setOpen(true)}>
          {t("contact.leaveDetails")}
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5">
          <Input
            placeholder={t("contact.yourName")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            placeholder={t("contact.phoneOrEmail")}
            value={form.contact}
            onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
          />
          <textarea
            rows={2}
            placeholder={t("contact.anythingToKnow")}
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            className="w-full rounded-xl border border-surface/10 bg-surface/5 px-3 py-2.5 text-[14px] text-fg placeholder:text-fg/30"
          />
          {error && <p className="text-[12.5px] text-red-400">{error}</p>}
          <Button type="submit" loading={state === "sending"} disabled={!form.name || !form.contact}>
            <Send size={14} /> {t("contact.sendEnquiry")}
          </Button>
        </form>
      )}
    </div>
  );
}
