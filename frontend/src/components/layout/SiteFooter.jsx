import { useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, Phone, Mail, Clock, Send } from "lucide-react";
import { InstagramIcon, LinkedInIcon, AparatIcon } from "../ui/BrandIcons.jsx";
import { ORG_CONTACT, ORG_SOCIAL, ORG_NAME } from "../../lib/orgInfo.js";
import { CATEGORIES } from "../../lib/siteContent.generated.js";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Input } from "../ui/Input.jsx";
import { LanguageSwitcher } from "../ui/LanguageSwitcher.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// Aparat is Iran's main video platform and has no lucide icon; drawn inline
// rather than pulling in a second icon package for one mark.
const SOCIALS = [
  { key: "aparat", label: "Aparat", Icon: AparatIcon },
  { key: "instagram", label: "Instagram", Icon: InstagramIcon },
  { key: "linkedin", label: "LinkedIn", Icon: LinkedInIcon },
];

function ContactForm() {
  const t = useT();
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
        message: form.message || "Please get in touch.",
      });
      setState("sent");
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <p className="rounded-xl border border-brand-green/25 bg-brand-green/5 p-3.5 text-[13px] text-fg/70">
        {t("contact.thanksTitle")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
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
        placeholder={t("contact.form.messagePlaceholder")}
        rows={2}
        value={form.message}
        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        className="w-full rounded-xl border border-surface/10 bg-surface/5 px-3 py-2.5 text-[14px] text-fg placeholder:text-fg/30"
      />
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      <Button type="submit" loading={state === "sending"} disabled={!form.name || !form.contact}>
        <Send size={14} /> {t("contact.sendEnquiry")}
      </Button>
    </form>
  );
}

export function SiteFooter() {
  const t = useT();
  const { address, phones, email, supportHours, map } = ORG_CONTACT;

  return (
    <footer className="mt-16 border-t border-surface/8 bg-surface/[0.02]">
      <div className="px-5 py-10">
        <div className="flex flex-col gap-9">
          {/* Where we are */}
          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg/35">{t("contact.visitUs")}</h3>
            <a
              href={map.url}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden rounded-2xl border border-surface/10"
            >
              {/* A styled placeholder rather than an embedded map: a tile
                  provider would mean a third-party request on every page load
                  and an API key to manage, for something whose only job is to
                  be clicked through to directions. */}
              <div className="relative h-32 bg-[radial-gradient(circle_at_50%_50%,rgba(34,197,94,0.16),transparent_65%)]">
                <div
                  className="absolute inset-0 opacity-50"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(148,163,184,0.18) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,0.18) 1px,transparent 1px)",
                    backgroundSize: "22px 22px",
                  }}
                />
                {/* rtl-keep: left-1/2 + -translate-x-1/2 is a centring idiom, not text
                    flow. Converting only the offset half puts the pin off-centre
                    under RTL, because the translate does not mirror with it. */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <span className="relative flex h-4 w-4">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green opacity-60" />
                    <span className="relative inline-flex h-4 w-4 rounded-full bg-brand-green" />
                  </span>
                </div>
                <span className="absolute bottom-2 end-3 text-[11px] font-semibold text-fg/45 group-hover:text-fg/70">
                  {t("contact.openInMaps")} →
                </span>
              </div>
            </a>
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-relaxed text-fg/60">
              <MapPin size={14} className="mt-0.5 shrink-0 text-fg/35" />
              {address}
            </p>
          </div>

          {/* How to reach us */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg/35">{t("contact.contactUs")}</h3>
              <ul className="flex flex-col gap-2 text-[13px]">
                {phones.map((p) => (
                  <li key={p}>
                    <a href={`tel:${p.replace(/[^+\d]/g, "")}`} className="flex items-center gap-2 text-fg/60 hover:text-fg">
                      <Phone size={13} className="text-fg/35" />
                      <span dir="ltr">{p}</span>
                    </a>
                  </li>
                ))}
                <li>
                  <a href={`mailto:${email}`} className="flex items-center gap-2 text-fg/60 hover:text-fg">
                    <Mail size={13} className="text-fg/35" />
                    {email}
                  </a>
                </li>
                <li className="flex items-center gap-2 text-fg/45">
                  <Clock size={13} className="text-fg/35" />
                  {supportHours}
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg/35">
                {t("contact.form.title")}
              </h3>
              <ContactForm />
            </div>
          </div>

          {/* Where to go */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg/35">{t("nav.equipment")}</h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {CATEGORIES.map((c) => (
                  <li key={c.slug}>
                    <Link to={`/c/${c.slug}`} className="text-fg/55 hover:text-fg">
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg/35">{t("nav.company")}</h3>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                <li>
                  <Link to="/our-story" className="text-fg/55 hover:text-fg">
                    {t("nav.ourStory")}
                  </Link>
                </li>
                <li>
                  <Link to="/partners" className="text-fg/55 hover:text-fg">
                    {t("nav.partners")}
                  </Link>
                </li>
                <li>
                  <Link to="/careers" className="text-fg/55 hover:text-fg">
                    {t("nav.careers")}
                  </Link>
                </li>
                <li>
                  <Link to="/socials" className="text-fg/55 hover:text-fg">
                    {t("socials.eyebrow")}
                  </Link>
                </li>
                <li>
                  <Link to="/contact" className="text-fg/55 hover:text-fg">
                    {t("contact.contactUs")}
                  </Link>
                </li>
                <li>
                  <Link to="/blog" className="text-fg/55 hover:text-fg">
                    {t("store.section.blog.label")}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Social + legal */}
          <div className="flex flex-col gap-4 border-t border-surface/8 pt-6 sm:flex-row sm:items-center">
            <LanguageSwitcher />
            <div className="flex gap-2">
              {SOCIALS.filter(({ key }) => ORG_SOCIAL[key]).map(({ key, label, Icon }) => (
                <a
                  key={key}
                  href={ORG_SOCIAL[key]}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-surface/10 bg-surface/5 text-fg/50 transition-colors hover:border-brand-green/40 hover:text-fg"
                >
                  <Icon width={16} height={16} />
                </a>
              ))}
            </div>
            <p className="flex-1 text-[12px] text-fg/30 sm:text-end">
              © {new Date().getFullYear()} {ORG_NAME}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
