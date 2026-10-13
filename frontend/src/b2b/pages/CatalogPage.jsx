import { useSearchParams } from "react-router-dom";
import { Download, Share2 } from "lucide-react";
import { CatalogViewer } from "../sections/CatalogViewer.jsx";
import { DeviceDriftWall } from "../sections/DeviceDriftWall.jsx";
import { PillButton, SectionHead } from "../ui/primitives.jsx";
import { PageMeta } from "../ui/PageMeta.jsx";
import { CATALOG_PDF, CATALOG_PDF_SIZE, CATALOG_PAGES } from "../data/catalog.js";
import { whatsappCatalog } from "../lib/whatsapp.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The catalogue as its own route.
//
// `?page=` is honoured on entry so a hotspot, a device page or a shared
// WhatsApp link can point at one specific spread -- "it's on page 9" is how
// people actually refer to a printed brochure, and the URL should be able to
// say the same thing.
export default function CatalogPage() {
  const t = useT();
  const [params] = useSearchParams();
  const requested = Number(params.get("page")) || 1;

  const clickable = CATALOG_PAGES.reduce((n, p) => n + p.hotspots.length, 0);

  return (
    // The page's gutter sits on the viewer, not on the page: the drift wall
    // below it is full-bleed, and a container edge is exactly where its
    // dissolve mask is supposed to have nothing to dissolve against.
    <div className="py-8">
      <PageMeta
        title={t("store.catalogPage.metaTitle")}
        description={t("store.catalogPage.metaDesc")}
        path="/catalog"
      />

      <div className="b2b-container">
        <SectionHead
          eyebrow={t("store.catalogPage.eyebrow", {
            pages: CATALOG_PAGES.length,
            devices: clickable,
          })}
          title={t("store.catalogPage.title")}
          lead={t("store.catalogPage.lead")}
          actions={
            <>
              <PillButton as="a" href={CATALOG_PDF} download variant="white">
                <Download className="h-3.5 w-3.5" />
                {t("store.catalog.downloadPdf", { size: CATALOG_PDF_SIZE })}
              </PillButton>
              <PillButton
                as="a"
                href={whatsappCatalog()}
                target="_blank"
                rel="noreferrer noopener"
                variant="whatsapp"
              >
                <Share2 className="h-3.5 w-3.5" />
                {t("store.catalog.shareWhatsapp")}
              </PillButton>
            </>
          }
        />

        <CatalogViewer initialPage={requested} />
      </div>

      <DeviceDriftWall />
    </div>
  );
}
