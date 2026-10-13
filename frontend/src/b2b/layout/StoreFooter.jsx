import { Link } from "react-router-dom";
import { cn } from "../../lib/cn.js";
import { ORG_CONTACT, ORG_SOCIAL } from "../../lib/orgInfo.js";
import { AparatIcon, InstagramIcon, LinkedInIcon } from "../../components/ui/BrandIcons.jsx";
import { PillButton } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// Keys, not words. The link targets belong here; what each one is called in
// five languages belongs in the catalogs, under `store.footer.*`.
const COLUMNS = [
  {
    key: "products",
    links: [
      // The product column names treatment categories, which the shop
      // filters name too -- so both read `store.cat.*` rather than keeping
      // two translations of "Hair removal" in step.
      { key: "hair", labelKey: "store.cat.hair", to: "/devices?cat=hair" },
      { key: "skin", labelKey: "store.cat.skin", to: "/devices?cat=skin" },
      { key: "slim", labelKey: "store.cat.slim", to: "/devices?cat=slim" },
      { key: "tattoo", labelKey: "store.cat.tattoo", to: "/devices?cat=tattoo" },
      { key: "body", labelKey: "store.cat.body", to: "/devices?cat=body" },
      { key: "vascular", labelKey: "store.cat.vascular", to: "/devices?cat=vascular" },
    ],
  },
  {
    key: "buying",
    links: [
      { key: "catalog", labelKey: "store.section.catalog.label", to: "/catalog" },
      { key: "compare", labelKey: "store.section.compare.label", to: "/compare" },
      { key: "tools", labelKey: "store.section.tools.label", to: "/tools" },
    ],
  },
  {
    key: "company",
    links: [
      { key: "blog", labelKey: "store.section.blog.label", to: "/blog" },
      { key: "installations", labelKey: "store.section.installations.label", to: "/installations" },
      { key: "network", labelKey: "store.section.affiliate.label", to: "/affiliate" },
      { key: "contact", labelKey: "contact.contactUs", to: "/contact" },
    ],
  },
];

// Channel -> mark. Keyed off the names the org record uses, so a channel
// added there without an icon here still renders (as a text pill) rather
// than crashing.
const SOCIAL_ICONS = {
  instagram: InstagramIcon,
  linkedin: LinkedInIcon,
  aparat: AparatIcon,
};

export function StoreFooter({ clearDock = false }) {
  const t = useT();
  const { openRfq } = useStorefront();

  return (
    <footer className="b2b-deep mt-16">
      <div className={cn("b2b-container pt-12", clearDock ? "pb-32" : "pb-12")}>
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(3,0.9fr)]">
          <div>
            <b className="text-sm font-black tracking-tight">ASHKAN MEDICAL IDEA</b>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-white/60">
              {t("store.footer.about")}
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-white/60">
              {ORG_CONTACT.address}
              <br />
              <a className="hover:text-white" href={`mailto:${ORG_CONTACT.email}`}>
                {ORG_CONTACT.email}
              </a>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(ORG_SOCIAL ? Object.entries(ORG_SOCIAL) : []).map(([name, href]) => {
                const Icon = SOCIAL_ICONS[name];
                return href ? (
                  <a
                    key={name}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    // The channel name stays as the accessible name: an icon
                    // alone tells a screen reader nothing, and "Aparat" is
                    // not a mark most non-Iranian readers would recognise.
                    aria-label={name}
                    title={name}
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-3 py-1.5 text-[11px] font-bold capitalize hover:bg-white/14"
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
                    {name}
                  </a>
                ) : null;
              })}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.key}>
              <b className="text-[11px] font-black tracking-[0.14em] uppercase">
                {t(`store.footer.col.${col.key}`)}
              </b>
              <ul className="mt-3 space-y-2 text-[13px] text-white/60">
                {col.links.map((link) => (
                  <li key={link.key}>
                    <Link to={link.to} className="hover:text-white">
                      {t(link.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/12 bg-white/6 p-5">
          <div>
            <b className="text-sm font-black">{t("store.footer.demoTitle")}</b>
            <p className="mt-1 text-[13px] text-white/60">{t("store.footer.demoBody")}</p>
          </div>
          <PillButton onClick={() => openRfq()}>{t("store.footer.demoCta")}</PillButton>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-[11px] text-white/45">
          <span>{t("store.footer.copyright", { year: new Date().getFullYear() })}</span>
          <span>{t("store.footer.languages")}</span>
        </div>
      </div>
    </footer>
  );
}
