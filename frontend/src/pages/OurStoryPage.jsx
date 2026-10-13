import { Link } from "react-router-dom";
import { STORY, PARTNERS } from "../lib/siteContent.generated.js";
import { ORG_NAME } from "../lib/orgInfo.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { SiteFooter } from "../components/layout/SiteFooter.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Reveal } from "../components/ui/Reveal.jsx";
import { KineticHeadline } from "../components/ui/KineticHeadline.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

export default function OurStoryPage() {
  const t = useT();
  const title = t("story.metaTitle", { org: ORG_NAME });
  const description = STORY.tagline;

  return (
    <PageTransition className="flex min-h-dvh flex-col">
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href="/our-story" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={STORY.banner} />
      <meta property="og:type" content="article" />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: title,
          description,
          mainEntity: {
            "@type": "Organization",
            name: ORG_NAME,
            founder: { "@type": "Person", name: STORY.ceo.name, jobTitle: STORY.ceo.role },
          },
        })}
      </script>

      <div className="flex-1">
        <section className="relative">
          <div className="relative h-[240px] w-full overflow-hidden">
            <img src={STORY.banner} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
          </div>
          <div className="relative -mt-16 px-5">
            <Link to="/" className="mb-3 inline-block text-[12.5px] font-semibold text-fg/50 hover:text-fg/80">
              ← {t("common.back")}
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-green">{t("story.eyebrow")}</p>
            <KineticHeadline
              as="h1"
              text={STORY.tagline}
              className="mt-1.5 max-w-md text-[28px] font-extrabold leading-[1.15] tracking-tight text-fg"
            />
          </div>
        </section>

        <section className="bg-dotted-dense mask-fade-y mt-8 px-5 py-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {STORY.stats.map((s, i) => (
              <Reveal key={s.label} delay={i * 90} from="scale">
                <Card className="p-4">
                  <div className="text-gradient text-[26px] font-extrabold leading-none">{s.value}</div>
                  <div className="mt-1 text-[12.5px] text-fg/45">{s.label}</div>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="px-5 py-4">
          <div className="flex flex-col gap-7">
            {STORY.sections.map((s) => (
              <Reveal as="article" key={s.id}>
                <h2 className="mb-2 text-[19px] font-extrabold tracking-tight text-fg">{s.heading}</h2>
                <p className="text-[14.5px] leading-relaxed text-fg/60">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="px-5 py-6">
          <Card className="p-5">
            <p className="text-[15px] font-semibold leading-relaxed text-fg/85">"{STORY.proofPoint}"</p>
          </Card>
        </section>

        <section className="px-5 pb-8">
          <Card className="flex items-start gap-4 p-5">
            <img
              src={STORY.ceo.image}
              alt={STORY.ceo.name}
              loading="lazy"
              className="h-16 w-16 shrink-0 rounded-2xl object-cover"
            />
            <div className="min-w-0">
              <p className="text-[13.5px] leading-relaxed text-fg/65">"{STORY.ceo.statement}"</p>
              <p className="mt-2.5 text-[13px] font-bold text-fg">{STORY.ceo.name}</p>
              <p className="text-[12px] text-fg/40">{STORY.ceo.role}</p>
            </div>
          </Card>
        </section>

        <section className="px-5 pb-10">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg/35">
            {t("partners.whoWeRepresent")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {PARTNERS.map((p) => (
              <div key={p.slug} className="flex h-11 items-center gap-2 rounded-xl bg-white px-2.5">
                <img src={p.logo} alt={p.name} loading="lazy" className="max-h-6 max-w-[70px] object-contain" />
              </div>
            ))}
          </div>
          <Link to="/partners" className="mt-4 inline-block text-[13px] font-semibold text-brand-blue">
            {t("partners.moreAboutPartners")} →
          </Link>
        </section>
      </div>

      <SiteFooter />
    </PageTransition>
  );
}
