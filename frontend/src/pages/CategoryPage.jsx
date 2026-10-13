import { useContext, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../lib/api.js";
import { useAsync } from "../hooks/useAsync.js";
import { SSRDataContext } from "../lib/ssrDataContext.js";
import { CATEGORIES } from "../lib/siteContent.generated.js";
import { ORG_NAME } from "../lib/orgInfo.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { ProductCard } from "../components/products/ProductCard.jsx";
import { SiteFooter } from "../components/layout/SiteFooter.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { Reveal } from "../components/ui/Reveal.jsx";
import { KineticHeadline } from "../components/ui/KineticHeadline.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

// A treatment category: what the procedure does, followed by the devices
// that perform it. The hero is a static dotted-gradient panel rather than a
// scroll-driven 3D scene -- three.js added real weight and jank here for a
// visual that ran once per visit, which wasn't worth the cost.
export default function CategoryPage() {
  const t = useT();
  const { slug } = useParams();
  const ssr = useContext(SSRDataContext);

  const category = CATEGORIES.find((c) => c.slug === slug);

  const { data, loading } = useAsync(
    () => api.listProducts({ category: slug, status: "active", limit: 50 }),
    [slug]
  );
  const products = data ?? (ssr?.route === "category" && ssr.slug === slug ? ssr.products : null);

  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [slug]);

  if (!category) {
    return (
      <PageTransition className="flex min-h-dvh flex-col">
        <EmptyState
          title={t("category.notFound")}
          description={t("category.notFoundBody")}
          action={
            <Link to="/" className="text-brand-blue">
              {t("careers.backToCatalogue")}
            </Link>
          }
        />
      </PageTransition>
    );
  }

  const title = t("category.metaTitle", { title: category.title, org: ORG_NAME });
  const description = category.intro;

  return (
    <PageTransition className="flex min-h-dvh flex-col">
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`/c/${category.slug}`} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: category.title,
          description: category.intro,
          isPartOf: { "@type": "WebSite", name: ORG_NAME },
          about: { "@type": "MedicalProcedure", name: category.title },
        })}
      </script>

      <div className="flex-1">
        {/* Hero: the treatment itself */}
        <section className="relative">
          <div className="aurora pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative px-5 pb-4 pt-10">
            <Link to="/" className="mb-4 inline-block text-[12.5px] font-semibold text-fg/40 hover:text-fg/70">
              ← {t("category.allEquipment")}
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-green">{t("category.eyebrow")}</p>
            <KineticHeadline
              as="h1"
              text={category.title}
              className="mt-1.5 text-[clamp(32px,3.6vw,50px)] font-extrabold leading-[1.1] tracking-tight text-fg"
            />
            <Reveal delay={180}>
              <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed text-fg/60">{category.intro}</p>
            </Reveal>
          </div>

          {/* Static dotted-gradient panel -- no WebGL, no per-frame cost. */}
          <div className="relative mt-2 h-[38vh] min-h-[220px] w-full">
            <div className="mask-fade-radial bg-dotted absolute inset-0 opacity-60" aria-hidden />
            <div className="pointer-events-none absolute inset-x-5 bottom-5 z-10">
              <p className="max-w-md text-[13.5px] leading-relaxed text-fg/70">{category.body}</p>
            </div>
          </div>
        </section>

        {/* Copy */}
        <section className="relative z-10 bg-gradient-to-b from-transparent via-bg to-bg px-5 pt-8">

          <div data-spec className="mb-8">
            <h2 className="mb-3 text-[19px] font-extrabold text-fg">{t("category.devicesFor", { name: category.shortTitle.toLowerCase() })}</h2>
            {loading && !products ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            ) : products && products.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((p, i) => (
                  <Reveal key={p.id} delay={(i % 2) * 80}>
                    <ProductCard product={p} />
                  </Reveal>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("category.nothingListed")}
                description={t("category.nothingListedBody")}
              />
            )}
          </div>

          <div data-spec className="mb-10 rounded-2xl border border-surface/10 bg-surface/[0.03] p-5">
            <h3 className="mb-2 text-[15px] font-bold text-fg">{t("category.otherTreatments")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.filter((c) => c.slug !== category.slug).map((c) => (
                <Link
                  key={c.slug}
                  to={`/c/${c.slug}`}
                  className="rounded-full border border-surface/10 bg-surface/5 px-3 py-1.5 text-[12.5px] font-semibold text-fg/60 hover:text-fg"
                >
                  {c.shortTitle}
                </Link>
              ))}
            </div>
            <Link
              to="/partners"
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-blue"
            >
              {t("category.seeManufacturers")} <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      </div>

      <SiteFooter />
    </PageTransition>
  );
}
