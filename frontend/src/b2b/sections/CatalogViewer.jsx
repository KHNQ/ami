import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Minus,
  Plus,
  Search,
  Share2,
  BookOpen,
} from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Chip, PillButton, TextInput } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import {
  CATALOG_PAGES,
  CATALOG_PDF,
  CATALOG_PDF_SIZE,
  pageImage,
  pageThumb,
  searchCatalog,
} from "../data/catalog.js";
import { DEVICE_BY_ID } from "../data/devices.js";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { whatsappCatalog } from "../lib/whatsapp.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The Ashkan 2024 catalogue, made shoppable.
//
// The pages are the real printed brochure -- the twelve full-page images
// extracted from "Ashkan products.pdf", served from public/catalog alongside
// the PDF itself for anyone who still wants to print or email it.
//
// What makes it more than a PDF reader is the hotspot layer: the machines
// printed on each page are click targets that open that device's 3D model,
// ROI model and proforma flow. A doctor flipping through the brochure the
// way they always have can act on it without ever leaving the page.
//
// Zoom is applied to the page wrapper and the hotspots are positioned in
// percentages inside it, so the click targets stay locked to the artwork at
// any zoom level -- which is the thing that breaks first in naive
// implementations.

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;

export function CatalogViewer({ initialPage = 1 }) {
  const t = useT();
  const navigate = useNavigate();
  const { openRfq } = useStorefront();
  // Hotspot labels name the live device, so a renamed or discontinued
  // machine reads correctly on a page that was printed before the change.
  const { getDevice } = useCatalogue();

  const [index, setIndex] = useState(() => Math.min(CATALOG_PAGES.length, Math.max(1, initialPage)) - 1);
  const [zoom, setZoom] = useState(1);
  const [spread, setSpread] = useState(false);
  const [query, setQuery] = useState("");
  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const thumbsRef = useRef(null);

  const page = CATALOG_PAGES[index];
  // The printed label lives in the catalog, keyed by page number. `label` in
  // catalog.js stays English because searchCatalog matches against it and the
  // brand names a doctor types are the same in every language.
  const pageLabel = (p) => t(`store.catalog.page.${p.n}`);
  const matchedPages = useMemo(() => searchCatalog(query, DEVICE_BY_ID), [query]);

  const goto = useCallback((n) => {
    setIndex(Math.max(0, Math.min(CATALOG_PAGES.length - 1, n)));
  }, []);
  const next = useCallback(() => goto(index + 1), [goto, index]);
  const prev = useCallback(() => goto(index - 1), [goto, index]);

  // Jump to the first hit as the query is typed. Only when there is a hit --
  // deleting characters back to nothing must not throw the reader back to
  // page one.
  useEffect(() => {
    if (query && matchedPages.length > 0) goto(matchedPages[0] - 1);
  }, [query, matchedPages, goto]);

  // Keep the active thumbnail in view in the rail. Without this, paging
  // with the arrow keys silently scrolls the main stage while the rail sits
  // on page 1 and the reader loses their position in the book.
  useEffect(() => {
    const rail = thumbsRef.current;
    const active = rail?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [index]);

  // Arrow keys page the catalogue, but only while it has focus or the
  // pointer is over it -- a global arrow-key handler would hijack the whole
  // page's scrolling.
  useEffect(() => {
    const onKey = (e) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const engaged = viewer.contains(document.activeElement) || viewer.matches(":hover");
      if (!engaged) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // Swipe. Horizontal-only and past a threshold, so a vertical scroll that
  // drifts sideways does not flip the page out from under a thumb.
  const touch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) next();
    else prev();
  };

  const zoomBy = (factor) =>
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((z * factor).toFixed(2)))));

  const toggleFullscreen = () => {
    const el = viewerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  // A hotspot either opens the device page or, for a machine we do not
  // list, an enquiry naming it. Sending the second kind to a similar
  // device's page was the previous behaviour and it silently answered a
  // question the buyer had not asked.
  const openHotspot = (hotspot) => {
    if (hotspot.device) navigate(`/devices/${hotspot.device}`);
    else openRfq(null, hotspot.order);
  };

  return (
    <div ref={viewerRef} className="mt-5">
      {/* Toolbar. Sticks under the header so paging, zoom and search stay
          reachable while the reader is deep in a page. */}
      <div className="sticky top-[68px] z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/95 p-2.5 backdrop-blur">
        <div className="flex items-center gap-1.5">
          <PillButton variant="white" size="xs" onClick={prev} disabled={index === 0}>
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            {t("store.catalog.prev")}
          </PillButton>
          <span className="b2b-tnum rounded-full bg-panel-2 px-3 py-1.5 text-[12px] font-extrabold text-ink">
            {index + 1} / {CATALOG_PAGES.length}
          </span>
          <PillButton
            variant="white"
            size="xs"
            onClick={next}
            disabled={index === CATALOG_PAGES.length - 1}
          >
            {t("store.catalog.next")}
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          </PillButton>
        </div>

        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />

        <div className="flex items-center gap-1.5">
          <PillButton variant="white" size="xs" onClick={() => zoomBy(0.85)} aria-label={t("store.catalog.zoomOut")}>
            <Minus className="h-3.5 w-3.5" />
          </PillButton>
          <span className="b2b-tnum w-11 text-center text-[11px] font-extrabold text-ink-2">
            {Math.round(zoom * 100)}%
          </span>
          <PillButton variant="white" size="xs" onClick={() => zoomBy(1.15)} aria-label={t("store.catalog.zoomIn")}>
            <Plus className="h-3.5 w-3.5" />
          </PillButton>
          <PillButton variant="white" size="xs" onClick={() => setZoom(1)}>
            {t("store.catalog.fit")}
          </PillButton>
        </div>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("store.catalog.searchPlaceholder")}
            aria-label={t("store.catalog.searchAria")}
            className="rounded-full py-2 ps-9 text-[12px]"
          />
        </div>

        {query ? (
          <span className="text-[11px] font-bold whitespace-nowrap text-ink-2">
            {matchedPages.length > 0
              ? t("store.catalog.pagesHit", { list: matchedPages.join(", ") })
              : t("store.catalog.noMatch")}
          </span>
        ) : null}

        {/* Wraps rather than pushing the toolbar sideways: at 320px these
            three pills are wider than the viewport, and a toolbar that
            scrolls horizontally is a toolbar whose last button is invisible. */}
        <div className="flex flex-wrap items-center gap-1.5 sm:ms-auto">
          <PillButton
            variant={spread ? "dark" : "white"}
            size="xs"
            onClick={() => setSpread((s) => !s)}
            aria-pressed={spread}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("store.catalog.spread")}
          </PillButton>
          <PillButton variant="white" size="xs" onClick={toggleFullscreen}>
            <Expand className="h-3.5 w-3.5" />
            {t("store.catalog.fullscreen")}
          </PillButton>
          <PillButton size="xs" onClick={() => openRfq()}>
            {t("store.cta.requestProforma")}
          </PillButton>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[210px_1fr]">
        {/* Thumbnail rail. Horizontal strip on phones, vertical rail on
            desktop -- the same component either way so the active-page
            highlight and the scroll-into-view logic have one home. */}
        <div
          ref={thumbsRef}
          className="no-scrollbar flex gap-2 overflow-x-auto rounded-2xl border border-line bg-panel p-2 lg:max-h-[620px] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto"
        >
          {CATALOG_PAGES.map((p, i) => (
            <button
              key={p.n}
              type="button"
              data-active={i === index}
              onClick={() => goto(i)}
              aria-label={t("store.catalog.thumbAria", { n: p.n, label: pageLabel(p) })}
              aria-current={i === index}
              className={cn(
                "relative w-[84px] shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 transition-all lg:w-full",
                i === index
                  ? "border-brand-green ring-3 ring-brand-green/20"
                  : "border-transparent hover:border-line",
                query && matchedPages.includes(p.n) && "ring-3 ring-amber-400/60"
              )}
            >
              <img
                src={pageThumb(p.n)}
                alt=""
                loading="lazy"
                width={320}
                height={453}
                className="block w-full"
              />
              <span className="absolute start-1 bottom-1 rounded-full bg-ink/85 px-1.5 py-0.5 text-[9px] font-black text-canvas">
                {p.n}
              </span>
            </button>
          ))}
        </div>

        {/* The stage. */}
        <div
          ref={stageRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="b2b-stage relative flex min-h-[460px] items-center justify-center overflow-auto rounded-3xl p-4 sm:min-h-[620px]"
        >
          <button
            type="button"
            onClick={prev}
            disabled={index === 0}
            aria-label={t("store.catalog.prevPage")}
            className="absolute start-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-line bg-panel/90 text-ink shadow-lg disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </button>

          {spread ? (
            // Two-page spread, the way the brochure is actually read in
            // print. Hotspots are intentionally not layered here: at spread
            // scale the targets are too small to hit reliably, and offering
            // a target that misses is worse than not offering one.
            <div className="grid w-full max-w-4xl gap-3 sm:grid-cols-2">
              {[index, index + 1].map((i) =>
                i < CATALOG_PAGES.length ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      goto(i);
                      setSpread(false);
                    }}
                    className="cursor-pointer"
                    aria-label={t("store.catalog.openPage", { n: i + 1 })}
                  >
                    <img
                      src={pageImage(CATALOG_PAGES[i].n)}
                      alt={pageLabel(CATALOG_PAGES[i])}
                      loading="lazy"
                      className="w-full rounded-xl bg-white shadow-2xl"
                    />
                  </button>
                ) : (
                  <div key={i} aria-hidden />
                )
              )}
            </div>
          ) : (
            <div
              className="relative max-w-full transition-transform duration-200"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            >
              <img
                src={pageImage(page.n)}
                alt={t("store.catalog.pageAlt", { n: page.n, label: pageLabel(page) })}
                width={992}
                height={1403}
                className="block max-h-[560px] w-auto max-w-full rounded-xl bg-white shadow-2xl"
              />

              {page.hotspots.map((h) => {
                const device = h.device ? getDevice(h.device) : null;
                // Flip the label above the target when the hotspot sits low
                // on the page -- below it, the label lands behind the page
                // caption bar and cannot be read.
                const labelAbove = h.y + h.h > 78;
                return (
                  <button
                    key={`${h.device}-${h.x}-${h.y}`}
                    type="button"
                    onClick={() => openHotspot(h)}
                    title={
                      device
                        ? t("store.catalog.hotspotTitleDevice", { label: h.label })
                        : t("store.catalog.hotspotTitleOrder", { label: h.label })
                    }
                    aria-label={
                      device
                        ? t("store.catalog.hotspotAriaDevice", {
                            label: h.label,
                            device: device.name,
                          })
                        : t("store.catalog.hotspotAriaOrder", { label: h.label })
                    }
                    className="b2b-hotspot group"
                    style={{
                      left: `${h.x}%`,
                      top: `${h.y}%`,
                      width: `${h.w}%`,
                      height: `${h.h}%`,
                    }}
                  >
                    <span
                      className={cn(
                        "pointer-events-none absolute start-1/2 -translate-x-1/2 rounded-full bg-brand-gradient px-2.5 py-1 text-[10px] font-black whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
                        labelAbove ? "-top-7" : "-bottom-7"
                      )}
                    >
                      {device ? h.label : t("store.catalog.orderLabel", { label: h.label })} →
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={next}
            disabled={index === CATALOG_PAGES.length - 1}
            aria-label={t("store.catalog.nextPage")}
            className="absolute end-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-line bg-panel/90 text-ink shadow-lg disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </button>

          <div className="absolute inset-x-4 bottom-3 flex flex-wrap items-center justify-center gap-2 text-center">
            <span className="rounded-full bg-ink/85 px-3 py-1.5 text-[11px] font-bold text-canvas">
              {page.n}. {pageLabel(page)}
            </span>
            <span className="rounded-full bg-brand-green/90 px-3 py-1.5 text-[11px] font-bold text-white">
              {page.hotspots.length > 0
                ? t("store.catalog.clickable", { count: page.hotspots.length })
                : t("store.catalog.noDevice")}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-2">
        <span>{t("store.catalog.help")}</span>
        <div className="flex flex-wrap gap-2">
          <a href={CATALOG_PDF} download>
            <Chip tone="neutral">
              <Download className="h-3 w-3" />
              {t("store.catalog.downloadPdf", { size: CATALOG_PDF_SIZE })}
            </Chip>
          </a>
          <a href={whatsappCatalog(page.n)} target="_blank" rel="noreferrer noopener">
            <Chip tone="brand">
              <Share2 className="h-3 w-3" />
              {t("store.catalog.shareWhatsapp")}
            </Chip>
          </a>
        </div>
      </div>
    </div>
  );
}
