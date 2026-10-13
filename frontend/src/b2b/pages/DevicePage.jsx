import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BadgeCheck,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  PlayCircle,
  RotateCcw,
  RotateCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { cn } from "../../lib/cn.js";
import { LazyDeviceStage } from "../../three/LazyDeviceStage.jsx";
import { deviceForProduct } from "../../three/devices/registry.js";
import { DeviceVisual } from "../sections/DeviceVisual.jsx";
import { useProduct3dEnabled } from "../lib/deviceVisual.js";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { useAiChat } from "../../context/AiChatContext.jsx";
import { useAiEnabled } from "../../components/ai/useAiEnabled.js";
import {
  CertMarks,
  Chip,
  DeepPanel,
  PillButton,
  Tabs,
} from "../ui/primitives.jsx";
import { Slider } from "@/components/shadcn/slider.jsx";
import { PageMeta } from "../ui/PageMeta.jsx";
import { LockCountdown } from "../sections/LockCountdown.jsx";
import { LeaseConfigurator } from "../sections/LeaseConfigurator.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { SSRDataContext } from "../../lib/ssrDataContext.js";
import { resolveOrigin } from "../../lib/origin.js";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { CATALOG_PAGES, pageThumb } from "../data/catalog.js";
import {
  BUNDLES,
  CBI_EUR_IRR,
  PRICE_LOCK_DAYS,
  formatPayback,
  irr,
  money,
  priceLabel,
  pricesUsable,
  roi,
} from "../lib/finance.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The device page. Everything a buyer needs about one machine, in the order
// they ask for it, without leaving the page: what it is, what it can do,
// what it costs in Rial today, whether it pays back, and how to finance it.
//
// The 3D stage is the app's own procedural model of the machine, driven by
// the same ref API the hero uses -- rotate, zoom and, uniquely here,
// explode, because "show me the inside" is a real question about a device
// somebody has to service for ten years.

const REGISTRY = {
  fda: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm",
  ce: "https://ec.europa.eu/growth/tools-databases/nando/",
  iso: "https://www.iso.org/standard/59752.html",
};

// The device's visual.
//
// A photograph by default -- see lib/deviceVisual for why. The 3D stage is
// still here, but only behind `product_3d_enabled`: it is a procedural
// approximation of the machine, and next to a specification a buyer is
// about to commit €40,000 against, an approximation is the wrong object to
// put on the page. When the flag is on, the exploded view is genuinely
// useful for a device somebody has to service for ten years, so the
// controls come with it.
function DeviceViewer({ device }) {
  const show3d = useProduct3dEnabled();

  if (!show3d) {
    return (
      <div className="relative h-[320px] overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-brand-green/8 to-brand-blue/8 p-6 sm:h-[400px]">
        <DeviceVisual device={device} />
      </div>
    );
  }

  return <DeviceStageViewer device={device} />;
}

function DeviceStageViewer({ device }) {
  const t = useT();
  const stageRef = useRef(null);
  const reduced = useReducedMotion();
  const [explode, setExplode] = useState(0);

  // The stage owns rotation internally (drag + auto-spin); explode is the
  // one piece of state this page drives, so it is the only one mirrored
  // into React.
  useEffect(() => {
    stageRef.current?.setExplodeImmediate?.(explode);
  }, [explode]);

  // `look` is absolute, not relative, so rotation is tracked here and the
  // buttons step it. Without the local accumulator every press would snap
  // back to the same two positions.
  const yaw = useRef(0);
  const nudge = (dir) => {
    yaw.current += dir * 0.5;
    stageRef.current?.look?.(yaw.current, -0.1);
  };

  // The archetype is resolved from the device NAME, not its id: the 3D
  // registry is keyed off the catalogue names shared with the rest of the
  // app, and passing an id here silently falls back to the generic shape.
  const model = deviceForProduct({ name: device.name });

  return (
    <div>
      <div className="relative h-[320px] overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-brand-green/8 to-brand-blue/8 sm:h-[400px]">
        <LazyDeviceStage
          ref={stageRef}
          variant={model.variant}
          accent={model.accent}
          autoSpin={!reduced}
          interactive
          className="device-stage h-full w-full"
          fallback={<DeviceVisual device={device} className="p-6" />}
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">
          {t("store.device.dragHint")}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PillButton variant="white" size="sm" onClick={() => nudge(-1)}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("store.device.rotate")}
        </PillButton>
        <PillButton variant="white" size="sm" onClick={() => nudge(1)}>
          <RotateCw className="h-3.5 w-3.5" />
          {t("store.device.rotate")}
        </PillButton>
        <PillButton
          variant={explode > 0 ? "dark" : "white"}
          size="sm"
          onClick={() => setExplode((e) => (e > 0 ? 0 : 1))}
        >
          {explode > 0 ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
          {explode > 0 ? t("store.device.reassemble") : t("store.device.explode")}
        </PillButton>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <label className="text-[11px] font-extrabold tracking-wide text-ink-2 uppercase">
          {t("store.device.separation")}
        </label>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[explode]}
          onValueChange={([v]) => setExplode(v)}
          className="flex-1"
          aria-label={t("store.device.ariaSeparation")}
        />
      </div>
    </div>
  );
}

function SpecsTab({ device, pricesVisible }) {
  const t = useT();
  const { lockPrice, lockFor, openRfq } = useStorefront();
  const showPrice = pricesUsable(device, pricesVisible);
  const [bundle, setBundle] = useState("bundle");
  const lock = lockFor(device.id);

  const selected = BUNDLES.find((b) => b.id === bundle) || BUNDLES[0];
  const total = device.price + selected.add;

  const rows = [
    ["wavelength", device.wavelength],
    ["spot", device.spot],
    ["output", device.shots],
    ["cooling", device.cooling],
    ["indications", device.indications],
    ["consumables", device.consumable],
    ["warranty", device.warranty],
    ["manufacturer", `${device.brand} — ${device.flag} ${device.country}`],
  ];

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-line bg-panel-2 p-4">
        <dl className="grid gap-2 text-[12.5px]">
          {rows.map(([key, value]) => (
            <div key={key} className="flex flex-wrap gap-x-2 border-b border-line/60 pb-2 last:border-0 last:pb-0">
              <dt className="w-40 shrink-0 font-black text-ink">{t(`store.device.spec.${key}`)}</dt>
              <dd className="min-w-0 flex-1 text-ink-2">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {device.highlights?.length ? (
        <ul className="grid gap-1.5 text-[12.5px] text-ink-2">
          {device.highlights.map((h) => (
            <li key={h} className="flex gap-2">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green" />
              {h}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Certification, each mark linking to the registry that issued it.
          A claim a buyer cannot check is a claim they have to take on
          trust, which is not how a procurement committee works. */}
      <div className="flex flex-wrap gap-2">
        {device.fda ? (
          <a href={REGISTRY.fda} target="_blank" rel="noreferrer noopener">
            <Chip tone="brand">
              <ShieldCheck className="h-3 w-3" />
              {t("store.device.cert.fda")}
              <ExternalLink className="h-3 w-3" />
            </Chip>
          </a>
        ) : null}
        {device.ce ? (
          <a href={REGISTRY.ce} target="_blank" rel="noreferrer noopener">
            <Chip tone="blue">
              <ShieldCheck className="h-3 w-3" />
              {t("store.device.cert.ce")}
              <ExternalLink className="h-3 w-3" />
            </Chip>
          </a>
        ) : null}
        <a href={REGISTRY.iso} target="_blank" rel="noreferrer noopener">
          <Chip tone="neutral">
            ISO 13485
            <ExternalLink className="h-3 w-3" />
          </Chip>
        </a>
      </div>

      {/* Price + Rial lock. Suppressed entirely when the operator has
          switched off published prices -- see priceLabel in lib/finance. */}
      <div className="rounded-2xl bg-ink p-4 text-canvas">
        {showPrice ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <b className="text-lg font-black">{money(device.price)}</b>
                <span className="b2b-tnum ms-2 text-[12px] text-canvas/60">
                  = {irr(device.price)} @ CBI {CBI_EUR_IRR.toLocaleString("en-US")}
                </span>
                <p className="mt-1 text-[11px] text-brand-green">
                  {lock ? (
                    <>
                      {t("store.device.price.lockedRef", { hash: lock.hash })} ·{" "}
                      <LockCountdown startedAt={lock.startedAt} />{" "}
                      {t("store.device.price.remaining")}
                    </>
                  ) : (
                    t("store.device.price.lockHint", { days: PRICE_LOCK_DAYS })
                  )}
                </p>
                {device.priceIsIndicative ? (
                  <p className="mt-1 text-[11px] text-canvas/45">
                    {t("store.device.price.indicative")}
                  </p>
                ) : null}
              </div>
              {!lock ? (
                <PillButton onClick={() => lockPrice(device.id)}>
                  {t("store.device.price.lockCta", { days: PRICE_LOCK_DAYS })}
                </PillButton>
              ) : (
                <PillButton variant="white" onClick={() => openRfq(device.id)}>
                  {t("store.device.price.proformaCta")}
                </PillButton>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <b className="text-lg font-black">{t("store.device.priceOnRequest")}</b>
              <p className="mt-1 text-[11px] text-canvas/60">
                {t("store.device.price.onRequestBody", { days: PRICE_LOCK_DAYS })}
              </p>
            </div>
            <PillButton onClick={() => openRfq(device.id)}>
              {t("store.device.price.quoteCta")}
            </PillButton>
          </div>
        )}
      </div>

      {/* Bundle builder. */}
      {showPrice ? (
        <>
          <div>
            <b className="text-[13px] font-black text-ink">{t("store.device.bundle.title")}</b>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {BUNDLES.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBundle(b.id)}
                  aria-pressed={bundle === b.id}
                  className={cn(
                    "relative cursor-pointer rounded-2xl border p-3.5 text-start transition-all",
                    bundle === b.id
                      ? "border-brand-green bg-brand-green/8 ring-2 ring-brand-green/20"
                      : "border-line bg-panel hover:border-ink-3"
                  )}
                >
                  {b.popular ? (
                    <span className="absolute -top-2 end-3 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-black tracking-wide text-white">
                      {t("store.device.bundle.popular")}
                    </span>
                  ) : null}
                  <b className="block text-[13px] font-black text-ink">
                    {t(`store.device.bundle.${b.id}.name`)}
                  </b>
                  <span className="b2b-tnum block text-[12px] text-ink-2">
                    {money(device.price + b.add)}
                  </span>
                  {/* The catalog owns the bullets, keyed by position: BUNDLES
                      keeps its English `includes` because the lease and
                      proforma notes sent to the sales desk quote them. */}
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-ink-2">
                    {b.includes.map((inc, i) => (
                      <li key={inc}>· {t(`store.device.bundle.${b.id}.inc${i + 1}`)}</li>
                    ))}
                  </ul>
                  {b.saving ? (
                    <span className="mt-1.5 block text-[10px] font-black text-brand-green">
                      {t("store.device.bundle.saves", { amount: money(b.saving) })}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel-2 p-3">
              <span className="text-[12.5px] font-bold text-ink">
                {t("store.device.bundle.total")}{" "}
                <b className="b2b-tnum text-brand-green">{money(total)}</b>
                <span className="ms-2 text-[11px] font-medium text-ink-2">{irr(total)}</span>
              </span>
              <PillButton variant="dark" size="sm" onClick={() => openRfq(device.id)}>
                {t("store.device.bundle.quoteCta")}
              </PillButton>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function EvidenceTab({ device }) {
  const t = useT();
  const { openChat } = useAiChat();
  const aiEnabled = useAiEnabled();
  // The catalogue pages this device is actually printed on -- the primary
  // source document we can genuinely point at today.
  const pages = CATALOG_PAGES.filter((p) => p.hotspots.some((h) => h.device === device.id));

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-line bg-panel-2 p-4">
        <b className="inline-flex items-center gap-2 text-[13px] font-black text-ink">
          <FileText className="h-4 w-4 text-brand-green" />
          {t("store.device.evidence.catalogueTitle")}
        </b>
        {pages.length > 0 ? (
          <>
            <p className="mt-1 text-[12px] text-ink-2">
              {t("store.device.evidence.catalogueBody")}
            </p>
            <div className="mt-2.5 flex gap-2">
              {pages.map((p) => (
                <Link
                  key={p.n}
                  to={`/catalog?page=${p.n}`}
                  className="b2b-card w-24 overflow-hidden rounded-xl border border-line"
                  aria-label={t("store.device.evidence.cataloguePage", { n: p.n })}
                >
                  <img src={pageThumb(p.n)} alt="" loading="lazy" className="block w-full" />
                </Link>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1 text-[12px] text-ink-2">
            {t("store.device.evidence.notPrinted")}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-panel-2 p-4">
        <b className="inline-flex items-center gap-2 text-[13px] font-black text-ink">
          <PlayCircle className="h-4 w-4 text-brand-green" />
          {t("store.device.evidence.videoTitle")}
        </b>
        <p className="mt-1 text-[12px] text-ink-2">
          {t("store.device.evidence.videoBody", { device: device.name })}
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-panel-2 p-4">
        <b className="text-[13px] font-black text-ink">
          {t("store.device.evidence.litTitle")}
        </b>
        <p className="mt-1 text-[12px] text-ink-2">{t("store.device.evidence.litBody")}</p>
        {/* Without the assistant this paragraph already says to ask a
            person, and the section links to the contact routes above -- so
            the CTA goes rather than being replaced by a second "call us". */}
        {aiEnabled ? (
          <PillButton
            variant="white"
            size="sm"
            className="mt-2.5"
            onClick={() =>
              openChat({
                productName: device.name,
                // Seeded in the visitor's own language: the assistant answers
                // in whatever it is asked in, so an English seed would reply
                // in English to a Persian page.
                seed: t("store.device.evidence.aiSeed", { device: device.name }),
              })
            }
          >
            {t("store.device.evidence.askAi")}
          </PillButton>
        ) : null}
      </div>

    </div>
  );
}

// Kept in the left column rather than behind the Evidence tab: "who else
// runs one" is a question a buyer asks while looking at the machine, not
// one they go hunting through tabs for.
function TrustedBy({ device }) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <b className="text-[13px] font-black text-ink">
        {t("store.device.trusted.title", { device: device.name })}
      </b>
      <ul className="mt-2.5 grid gap-1.5">
        {device.trusted.map((ref) => (
          <li
            key={ref.clinic}
            className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-[12px]"
          >
            <span>
              <b className="block font-black text-ink">{ref.clinic}</b>
              <span className="text-ink-2">{ref.doctor}</span>
            </span>
            <Chip tone="brand">{t("store.device.trusted.verified")}</Chip>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[11px] text-ink-2">{t("store.device.trusted.visit")}</p>
    </div>
  );
}

function RoiTab({ device, pricesVisible }) {
  const t = useT();
  const { openRfq } = useStorefront();
  const showPayback = pricesUsable(device, pricesVisible);
  const [sessions, setSessions] = useState(120);
  const result = useMemo(
    () => roi({ price: device.price, sessionPrice: device.sessionPrice, sessionsPerMonth: sessions }),
    [device, sessions]
  );

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-panel-2 p-4">
          <span className="text-[10px] font-extrabold tracking-wide text-ink-2 uppercase">
            {t("store.device.roi.sessions")}
          </span>
          <div className="b2b-tnum mt-1 text-2xl font-black text-ink">{sessions}</div>
          <Slider
            min={40}
            max={300}
            step={5}
            value={[sessions]}
            onValueChange={([v]) => setSessions(v)}
            className="my-2 w-full"
            aria-label={t("store.device.roi.sessions")}
          />
          <span className="text-[11px] text-ink-2">
            {t("store.device.roi.perSession", { price: money(device.sessionPrice, "$") })}
          </span>
        </div>

        <div className="rounded-2xl bg-brand-gradient p-4 text-center text-white">
          {showPayback ? (
            <>
              <span className="text-[10px] font-black tracking-wide uppercase opacity-90">
                {t("store.device.roi.payback")}
              </span>
              <div className="b2b-tnum text-4xl leading-none font-black">
                {formatPayback(result.payback)}
              </div>
              <span className="text-[11px] font-black">{t("store.device.roi.months")}</span>
              <p className="mt-1.5 text-[11px] opacity-90">
                {t("store.device.roi.paybackNote", {
                  profit: money(result.monthlyProfit, "$"),
                  sessions: result.breakEvenSessions,
                })}
              </p>
            </>
          ) : (
            <>
              <span className="text-[10px] font-black tracking-wide uppercase opacity-90">
                {t("store.device.roi.monthlyProfit")}
              </span>
              <div className="b2b-tnum text-3xl leading-none font-black">
                {money(result.monthlyProfit, "$")}
              </div>
              <p className="mt-1.5 text-[11px] opacity-90">
                {t("store.device.roi.paybackOnQuote")}
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-panel-2 p-4">
          <span className="text-[10px] font-extrabold tracking-wide text-ink-2 uppercase">
            {t("store.device.roi.yearly")}
          </span>
          <div className="b2b-tnum mt-1 text-xl font-black text-ink">
            {money(result.yearlyProfit, "$")}
          </div>
          <p className="mt-1 text-[11px] text-ink-2">{t("store.device.roi.yearlyNote")}</p>
          <PillButton
            variant="dark"
            size="sm"
            fullWidth
            className="mt-2"
            onClick={() => openRfq(device.id)}
          >
            {t("store.device.roi.planCta")}
          </PillButton>
        </div>
      </div>

      <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[12px] text-ink">
        <b>{t("store.device.roi.assumeTitle")}</b> {t("store.device.roi.assumeBody")}
      </p>
    </div>
  );
}

export default function DevicePage() {
  const t = useT();
  const { id } = useParams();
  const { getDevice, hasDevice, pricesVisible, loading } = useCatalogue();
  const known = hasDevice(id);
  const device = getDevice(id);
  const { openRfq, toggleCompare, isComparing } = useStorefront();
  const ssr = useContext(SSRDataContext);
  const [tab, setTab] = useState("specs");

  // Reset to the first tab when navigating between devices -- landing on
  // the lease tab of a machine you have not read the specs of yet is
  // disorienting.
  useEffect(() => setTab("specs"), [id]);

  // `known` is false both for a genuinely unknown id and for the instant
  // before the catalogue arrives, so the not-found copy waits for the
  // fetch to settle rather than flashing on every cold load.
  if (!known && !loading) {
    return (
      <div className="b2b-container py-20 text-center">
        <h1 className="text-2xl font-black text-ink">{t("store.device.notFound.title")}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {t("store.device.notFound.bodyPrefix")}{" "}
          <Link to="/devices" className="font-bold text-brand-green">
            {t("store.device.notFound.bodyLink")}
          </Link>
          .
        </p>
      </div>
    );
  }

  const comparing = isComparing(device.id);

  // Structured data for the device, built from whatever is actually true:
  // the live product row where we have one, the curated record otherwise,
  // and no price at all when the operator has prices switched off. A
  // schema.org offer carrying a price the page itself refuses to print
  // would leak it straight into search results.
  const origin = resolveOrigin(ssr);
  const imageUrl = device.productImageUrl ? `${origin}${device.productImageUrl}` : undefined;
  const pageUrl = origin ? `${origin}/devices/${device.id}` : undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    // Both types: a MedicalDevice for what it is, a Product so the offer
    // (price, availability) is something search engines will read.
    "@type": ["MedicalDevice", "Product"],
    name: device.name,
    description: device.description || device.tagline,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(pageUrl ? { url: pageUrl } : {}),
    sku: device.slug,
    brand: { "@type": "Brand", name: device.manufacturer || device.brand },
    countryOfOrigin: device.country,
    ...(pricesUsable(device, pricesVisible)
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "EUR",
            price: device.price,
            ...(pageUrl ? { url: pageUrl } : {}),
            availability:
              device.stock > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/PreOrder",
          },
        }
      : {}),
  };

  return (
    <div className="b2b-container py-8">
      <PageMeta
        title={device.name}
        description={device.description || `${device.tagline}. ${device.indications}.`}
        path={`/devices/${device.id}`}
        image={device.productImageUrl || undefined}
        type="product"
        jsonLd={jsonLd}
      />
      <nav aria-label={t("store.device.breadcrumb")} className="text-[12px] text-ink-2">
        <Link to="/" className="hover:text-ink">
          {t("nav.home")}
        </Link>{" "}
        ·{" "}
        <Link to="/devices" className="hover:text-ink">
          {t("store.device.crumbDevices")}
        </Link>{" "}
        · <span className="text-ink">{device.name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral">
              {device.flag} {device.country} · {device.brand}
            </Chip>
            <CertMarks device={device} />
          </div>
          <h1 className="mt-2.5 text-3xl font-black tracking-tight text-ink sm:text-4xl">
            {device.name}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[14px] text-ink-2">{device.tagline}</p>
        </div>
        <div className="text-end">
          <span className="b2b-tnum block text-2xl font-black text-ink">
            {priceLabel(device, pricesVisible, t)}
          </span>
          {pricesUsable(device, pricesVisible) ? (
            <span className="text-[11px] text-ink-2">{irr(device.price)}</span>
          ) : null}
          <p className="mt-1 text-[11px] font-bold text-brand-green">
            {device.stockIsIndicative
              ? t("store.device.stock.indicative", { days: device.nextShipmentDays })
              : t("store.device.stock.inStock", {
                  count: device.stock,
                  days: device.nextShipmentDays,
                })}
          </p>
        </div>
      </header>

      {/* min-w-0 on both columns: a grid item defaults to min-width:auto,
          so any un-shrinkable descendant (a nowrap badge next to a long
          clinic name, here) widens the whole track and pushes the page
          sideways at 320px. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="min-w-0">
          <DeviceViewer device={device} />

          <DeepPanel className="mt-4 p-4">
            <b className="text-[13px] font-black text-white">{t("store.device.why.title")}</b>
            <ul className="mt-2 grid gap-1.5 text-[12px] text-white/65">
              <li>· {t("store.device.why.point1", { brand: device.brand })}</li>
              <li>· {t("store.device.why.point2")}</li>
              <li>· {t("store.device.why.point3")}</li>
              <li>· {t("store.device.why.point4", { warranty: device.warranty })}</li>
            </ul>
          </DeepPanel>

          <div className="mt-4">
            <TrustedBy device={device} />
          </div>
        </div>

        <div className="min-w-0">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "specs", label: t("store.device.tab.specs") },
              { id: "evidence", label: t("store.device.tab.evidence") },
              { id: "roi", label: t("store.device.tab.roi") },
              { id: "lease", label: t("store.device.tab.lease") },
            ]}
          />

          <div className="mt-4">
            {tab === "specs" ? <SpecsTab device={device} pricesVisible={pricesVisible} /> : null}
            {tab === "evidence" ? <EvidenceTab device={device} /> : null}
            {tab === "roi" ? <RoiTab device={device} pricesVisible={pricesVisible} /> : null}
            {tab === "lease" ? <LeaseConfigurator device={device} pricesVisible={pricesVisible} /> : null}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <PillButton size="lg" className="flex-1" onClick={() => openRfq(device.id)}>
          {t("store.device.cta.proforma")}
        </PillButton>
        <PillButton
          size="lg"
          variant={comparing ? "dark" : "white"}
          onClick={() => toggleCompare(device.id)}
        >
          <Scale className="h-4 w-4" />
          {comparing ? t("store.device.cta.inComparison") : t("store.device.cta.addComparison")}
        </PillButton>
      </div>
    </div>
  );
}
