import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PARTNERS, PARTNERS_HERO } from "../lib/siteContent.generated.js";
import { ORG_NAME } from "../lib/orgInfo.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { PartnerMap } from "../components/home/PartnerMap.jsx";
import { PartnerLogoSlider } from "../components/home/PartnerLogoSlider.jsx";
import { SiteFooter } from "../components/layout/SiteFooter.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Reveal } from "../components/ui/Reveal.jsx";
import { KineticHeadline } from "../components/ui/KineticHeadline.jsx";
import { TiltCard } from "../components/ui/TiltCard.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

export default function PartnersPage() {
  const t = useT();
  const title = t("partners.metaTitle", { org: ORG_NAME });
  const description = t("partners.metaDescription", { org: ORG_NAME, count: PARTNERS.length });

  return (
    <PageTransition className="flex min-h-dvh flex-col">
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href="/partners" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: ORG_NAME,
          description,
          // Naming each manufacturer as a related organisation is the piece
          // search engines actually use to connect this company to the brands
          // people search for by name.
          knowsAbout: PARTNERS.map((p) => p.name),
          subOrganization: PARTNERS.map((p) => ({
            "@type": "Organization",
            name: p.name,
            url: p.website || undefined,
            address: { "@type": "PostalAddress", addressCountry: p.country, addressLocality: p.city },
          })),
        })}
      </script>

      <div className="flex-1">
        <section className="relative px-5 pb-2 pt-10">
          <div className="aurora pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <Link to="/" className="mb-4 inline-block text-[12.5px] font-semibold text-fg/40 hover:text-fg/70">
              ← {t("common.back")}
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-green">{t("partners.eyebrow")}</p>
            <KineticHeadline
              as="h1"
              text={PARTNERS_HERO}
              className="mt-1.5 max-w-lg text-[clamp(30px,3.4vw,46px)] font-extrabold leading-[1.15] lg:max-w-3xl tracking-tight text-fg"
            />
          </div>
        </section>

        <PartnerLogoSlider className="py-2" />

        <section className="bg-dotted mask-fade-y px-5 py-6">
          <PartnerMap />
        </section>

        <section className="px-5 pb-10">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PARTNERS.map((p, i) => (
              <Reveal key={p.slug} delay={(i % 2) * 80} from="up">
                <TiltCard className="h-full rounded-2xl">
              <Card className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  {/* White plate behind the logo: most of these are dark marks
                      supplied for a light background and would disappear
                      entirely in dark mode. */}
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white p-1.5">
                    <img
                      src={p.logo}
                      alt={`${p.name} logo`}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15.5px] font-bold text-fg">{p.name}</h2>
                    <p className="text-[12px] text-fg/40">
                      {p.city}, {p.country}
                      {p.founded ? ` · ${t("partners.established", { year: p.founded })}` : ""}
                    </p>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-fg/60">{p.description}</p>
                {p.website && (
                  <a
                    href={p.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-blue"
                  >
                    {t("partners.visitSite")} <ExternalLink size={12} />
                  </a>
                )}
              </Card>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </section>
      </div>

      <SiteFooter />
    </PageTransition>
  );
}
