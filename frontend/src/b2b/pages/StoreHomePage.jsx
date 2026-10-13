import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { HeroSlider } from "../sections/HeroSlider.jsx";
import { DeviceShop } from "../sections/DeviceShop.jsx";
import { RoiCalculator } from "../sections/RoiCalculator.jsx";
import { SectionDirectory } from "../sections/SectionDirectory.jsx";
import { Newsletter } from "../sections/panels.jsx";
import { PillButton, SectionHead } from "../ui/primitives.jsx";
import { PageMeta } from "../ui/PageMeta.jsx";
import { TextureOverlay } from "../../components/cult/texture-overlay.jsx";
import { ScrollTint } from "../sections/ScrollTint.jsx";
import { CATALOG_PAGES, pageThumb } from "../data/catalog.js";
import { ORG_DESCRIPTION, ORG_NAME } from "../../lib/orgInfo.js";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { pricesUsable } from "../lib/finance.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The storefront home page.
//
// It used to render the entire site: the installed map, the evidence hub,
// the service portal, the case matcher, the demand simulator, the network
// programme, the lead generator, the trade-in and the ownership cards were
// all bands on this one page -- and every one of them ALSO had its own
// route, rendering the same components again. Thirteen screens of scroll,
// no page you could link someone to, and a permanent temptation to paste
// the next feature on the end.
//
// What is left is the argument, in the order a clinical buyer makes it:
// what we sell, what it costs, whether it pays for itself, then a directory
// of everywhere else, the catalogue, and the newsletter. Nothing was
// deleted -- each section now lives only on the route that owns it, which
// is listed in b2b/data/sections.js.
export default function StoreHomePage() {
  const t = useT();
  const { devices, pricesVisible } = useCatalogue();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: ORG_NAME,
    description: ORG_DESCRIPTION,
    address: { "@type": "PostalAddress", addressLocality: "Tehran", addressCountry: "IR" },
    makesOffer: devices.map((d) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "MedicalDevice",
        name: d.name,
        brand: d.brand,
        countryOfOrigin: d.country,
      },
      // A price the page refuses to print must not appear in structured data
      // either -- it would leak straight into search results.
      ...(pricesUsable(d, pricesVisible) ? { priceCurrency: "EUR", price: d.price } : {}),
    })),
  };

  return (
    <>
      <PageMeta
        title={t("store.home.metaTitle")}
        description={t("store.home.metaDesc")}
        path="/"
        jsonLd={jsonLd}
      />

      <HeroSlider />

      {/* The shop carries the stats row under it, so the numbers that
          establish the company sit with the machines rather than in a band
          of their own. */}
      {/* Each band gets a different texture, which is what stops the page
          reading as one flat sheet as you scroll it. */}
      <div className="relative">
        <TextureOverlay variant="paperGrain" mask="top" opacity={0.5} />
        <div className="relative">
          <DeviceShop />
        </div>
      </div>

      {/* One interactive proof stays on the home page. The payback model is
          the single thing that most often turns a browse into an enquiry,
          and the rest of the tools are one click away on /tools. */}
      <ScrollTint className="mt-10 py-10">
        <TextureOverlay variant="scatteredDots" mask="y" opacity={0.55} />
        <div className="relative">
          <RoiCalculator />
        </div>
      </ScrollTint>

      <ScrollTint from="var(--color-brand-blue)" to="var(--color-brand-teal)" className="py-10">
        <TextureOverlay variant="crosshatch" mask="radial" opacity={0.35} />
        <div className="relative">
          <SectionDirectory />
        </div>
      </ScrollTint>

      {/* Catalogue teaser. The full viewer is its own route because it
          wants the whole viewport; here it is a spread of page thumbnails
          that makes clear this is a real printed brochure. */}
      <section className="b2b-container relative mt-10">
        <TextureOverlay variant="diagonal" mask="y" opacity={0.4} />
        <SectionHead
          eyebrow={
            <>
              <BookOpen className="h-3 w-3" />
              {t("store.home.catalogEyebrow", { pages: CATALOG_PAGES.length })}
            </>
          }
          title={t("store.home.catalogTitle")}
          lead={t("store.home.catalogLead")}
          actions={
            <PillButton as={Link} to="/catalog" size="lg">
              {t("store.home.catalogCta")}
            </PillButton>
          }
        />

        <div className="no-scrollbar mt-5 flex gap-3 overflow-x-auto pb-2">
          {CATALOG_PAGES.map((p) => (
            <Link
              key={p.n}
              to={`/catalog?page=${p.n}`}
              data-spotlight
              className="b2b-card group relative w-[132px] shrink-0 overflow-hidden rounded-2xl border border-line bg-panel"
              aria-label={t("store.catalog.thumbAria", {
                n: p.n,
                label: t(`store.catalog.page.${p.n}`),
              })}
            >
              <img src={pageThumb(p.n)} alt="" loading="lazy" className="block w-full" />
              <span className="absolute start-2 bottom-2 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] font-black text-canvas">
                {p.n}
              </span>
              {p.hotspots.length > 0 ? (
                <span className="absolute end-2 top-2 rounded-full bg-brand-green px-1.5 py-0.5 text-[9px] font-black text-white">
                  {p.hotspots.length}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <section className="b2b-container relative mt-10">
        <TextureOverlay variant="halftone" mask="radial" opacity={0.3} />
        <div className="relative">
          <Newsletter />
        </div>
      </section>
    </>
  );
}
