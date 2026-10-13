import { Suspense, lazy, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { Ticket, TrendingUp, Boxes, CheckCircle2, PartyPopper, Cpu, Stethoscope, ShieldCheck, Maximize2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { api, ApiError } from "../lib/api.js";
import { TopBar } from "../components/layout/TopBar.jsx";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { ErrorState } from "../components/ui/ErrorState.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { BottomSheet } from "../components/ui/BottomSheet.jsx";
import { ImageLightbox } from "../components/ui/ImageLightbox.jsx";
import { VisitUsPanel } from "../components/products/VisitUsPanel.jsx";
import { useFeature } from "../context/SiteConfigContext.jsx";
import { useT } from "../i18n/I18nProvider.jsx";
import { StatusBadge } from "../components/ui/Badge.jsx";
import { CopyChip } from "../components/ui/CopyChip.jsx";
import { SSRDataContext } from "../lib/ssrDataContext.js";
import { resolveOrigin } from "../lib/origin.js";
import { deviceForProduct } from "../three/devices/registry.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { money, pct } from "../lib/format.js";

// gsap + three stay behind this boundary so the product page's initial
// paint (and its SSR output, which is the SEO-critical part) never loads
// them. Mirrors HomePage's HomeHeroMotion arrangement.
const ProductShowcaseMotion = lazy(() => import("../components/products/ProductShowcaseMotion.jsx"));

function SpecHeading({ icon, title }) {
  return (
    <div className="flex items-center gap-2 text-[13.5px] font-bold text-fg">
      <span className="text-brand-green">{icon}</span>
      {title}
    </div>
  );
}

export default function ProductDetailPage() {
  const t = useT();
  const purchasingEnabled = useFeature("online_purchase_enabled");
  const { id } = useParams();
  const { isSignedOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const ssrData = useContext(SSRDataContext);
  const origin = resolveOrigin(ssrData);

  const { data: fetchedProduct, loading, error, refetch } = useAsync(() => api.getProduct(id), [id]);
  // Same seed-then-revalidate pattern as HomePage -- server.js already
  // fetched this exact product for the SSR'd request.
  const product = fetchedProduct ?? (ssrData?.route === "product" && ssrData.product?.id === id ? ssrData.product : null);
  const showLoading = loading && !product;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  function handleBuyClick() {
    // Only bounce to /login when the session is *known* to be absent. `status`
    // starts at "loading" on every page load while GET /me is in flight, so
    // testing `!isAuthed` here threw signed-in customers onto the login screen
    // whenever they tapped Buy before that request came back -- easy to hit on
    // this route, which is public and server-rendered, so it paints long before
    // auth resolves. RouteGuards already draws this distinction; this matches it.
    if (isSignedOut) {
      navigate("/login", { state: { from: location } });
      return;
    }
    setSheetOpen(true);
  }

  // ...and if it resolves to "signed-out" while the sheet is open (they tapped
  // Buy during that window without a session), send them on rather than leaving
  // a purchase form in front of an anonymous visitor.
  useEffect(() => {
    if (sheetOpen && isSignedOut) {
      setSheetOpen(false);
      navigate("/login", { state: { from: location } });
    }
  }, [sheetOpen, isSignedOut, navigate, location]);

  const showcaseRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const [webgl, setWebgl] = useState(false);
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      setWebgl(Boolean(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
  }, []);
  const showcaseEnabled = webgl && !reducedMotion;
  const device = deviceForProduct(product);

  const canonicalUrl = origin ? `${origin}/products/${id}` : undefined;
  // og:image and JSON-LD `image` must be a real fetchable URL -- social
  // crawlers (and Google's structured data) don't support data: URIs, which
  // stored (see specs.image_url). Same-origin route so the preview host
  // matches the page host, which some crawlers prefer.
  const shareImageUrl = product?.specs?.image_url && origin ? `${origin}/products/${id}/image` : undefined;
  // Real bytes from the API, not a base64 blob inlined into every response.
  const productImage = api.productImageUrl(product);
  const productJsonLd = product && {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: shareImageUrl,
    url: canonicalUrl,
    offers: {
      "@type": "Offer",
      price: (product.list_price_y_cents / 100).toFixed(2),
      priceCurrency: "USD",
      availability:
        product.status === "active" && product.stock_count > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      url: canonicalUrl,
    },
  };

  return (
    <PageTransition className="flex min-h-dvh flex-1 flex-col">
      <title>{product ? `${product.name} — Ashkan Medical Idea` : "Product — Ashkan Medical Idea"}</title>
      {product?.description && <meta name="description" content={product.description} />}
      {product && (
        <>
          {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
          <meta property="og:type" content="product" />
          <meta property="og:title" content={product.name} />
          {product.description && <meta property="og:description" content={product.description} />}
          {shareImageUrl && <meta property="og:image" content={shareImageUrl} />}
          {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={product.name} />
          {product.description && <meta name="twitter:description" content={product.description} />}
          <script type="application/ld+json">{JSON.stringify(productJsonLd)}</script>
        </>
      )}
      <TopBar back title={product?.name || "Product"} />

      <div className="flex-1 px-5 pb-32 pt-2">
        {showLoading && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-44" />
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {product && (
          <div ref={showcaseRef}>
            {/* --- Showcase. No card, no border: the device floats directly
                on the page. The real product photograph is the first thing
                you see; scrolling dissolves it and the same device rebuilds
                itself from its exploded parts behind it. Drag to turn it,
                tap to blow it apart. --- */}
            <div data-product-stage className="relative z-0 -mx-5 h-[340px]">
              {/* Light bloom behind the device, driven by assembly progress. */}
              <div
                data-product-aura
                className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-30"
              >
                <div className="h-44 w-44 rounded-full bg-brand-gradient blur-[70px]" />
              </div>

              {/* Without WebGL (or under reduced motion) the 3D stage never
                  mounts, so the real photograph stands in as the hero. When
                  the model IS available the photo lives inline in the
                  description instead -- stacking it in front of the device
                  just hid the device. */}
              {!showcaseEnabled && productImage && (
                <img
                  src={productImage}
                  alt={product.name}
                  className="absolute inset-0 z-[2] h-full w-full object-contain px-8 py-4"
                />
              )}

              {showcaseEnabled && (
                <Suspense fallback={null}>
                  <ProductShowcaseMotion
                    scopeRef={showcaseRef}
                    variant={device.variant}
                    accent={device.accent}
                    reducedMotion={false}
                  />
                </Suspense>
              )}

              <div className="absolute end-5 top-1 z-[3]">
                <StatusBadge status={product.status} />
              </div>

              {showcaseEnabled && (
                <div
                  data-stage-hint
                  className="pointer-events-none absolute inset-x-5 bottom-0 z-[3] text-center font-mono text-[9px] uppercase tracking-[0.2em] text-fg/30"
                >
                  {t("product.dragHint")}
                </div>
              )}
            </div>

            {/* Scrim: the stage is pinned, so this content scrolls up over
                the device. The gradient gives the copy a readable ground
                without putting a hard panel edge across the model. */}
            <div className="relative z-10 -mt-2 bg-gradient-to-b from-transparent via-base-950/85 to-base-950 pt-6">
            <div data-product-intro className="relative z-20">
              {device.tagline && (
                <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-brand-green">
                  {device.tagline}
                </div>
              )}
              <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight text-fg">{product.name}</h1>

              {/* The real photograph, set into the description text rather
                  than layered over the model. Floated so the copy wraps
                  around it; tap for a full-screen preview. */}
              {productImage && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  aria-label={`Preview photo of ${product.name}`}
                  // `relative z-10` is load-bearing, not styling. This button
                  // is floated and the description paragraph below wraps
                  // around it -- but that paragraph's *box* still spans the
                  // float's area and comes later in the DOM, so it painted on
                  // top and swallowed every click. The preview was completely
                  // unreachable until this raised the button above it.
                  className="group relative z-10 float-end ms-3.5 mt-2.5 mb-1.5 flex w-[104px] flex-col items-center gap-1 rounded-2xl border border-surface/10 bg-surface/[0.04] p-2 transition-colors hover:border-brand-green/30 hover:bg-surface/[0.07]"
                >
                  <img
                    src={productImage}
                    alt={product.name}
                    loading="lazy"
                    decoding="async"
                    className="h-[76px] w-full object-contain transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-fg/35">
                    <Maximize2 size={9} /> {t("product.actualUnit")}
                  </span>
                </button>
              )}

              {product.description && (
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-fg/50">{product.description}</p>
              )}
              <div className="mt-4 flex items-center gap-3 clear-both pt-1">
                <div className="text-[28px] font-extrabold text-gradient">{money(product.list_price_y_cents)}</div>
                <div className="flex items-center gap-1 text-[12.5px] text-fg/40">
                  <Boxes size={14} /> {product.stock_count} in stock
                </div>
              </div>
            </div>

            {/* Structured spec sections from the imported catalogue, instead
                of dumping the raw specs object (which includes the base64
                product image and a source URL -- neither of which belong on
                screen as a "key: value" chip). */}
            {(product.specs?.manufacturer || product.specs?.category) && (
              <div data-spec className="relative z-20 mt-5 grid grid-cols-2 gap-2.5">
                {product.specs.manufacturer && (
                  <Card className="p-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-fg/35">
                      {t("product.manufacturer")}
                    </div>
                    <div className="mt-1 text-[13.5px] font-bold text-fg">{product.specs.manufacturer}</div>
                  </Card>
                )}
                {product.specs.category && (
                  <Card className="p-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-fg/35">
                      {t("product.category")}
                    </div>
                    <div className="mt-1 text-[13.5px] font-bold text-fg">{product.specs.category}</div>
                  </Card>
                )}
              </div>
            )}

            {product.specs?.features?.length > 0 && (
              <div data-spec className="relative z-20 mt-6">
                <SpecHeading icon={<Cpu size={15} />} title={t("product.keyCapabilities")} />
                <div className="mt-3 flex flex-col gap-2">
                  {product.specs.features.map((f) => (
                    <div key={f} className="flex gap-2.5 rounded-xl border border-surface/8 bg-surface/[0.03] p-3">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-brand-green" />
                      <span className="text-[12.5px] leading-relaxed text-fg/65">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {product.specs?.applications?.length > 0 && (
              <div data-spec className="relative z-20 mt-6">
                <SpecHeading icon={<Stethoscope size={15} />} title={t("product.clinicalApplications")} />
                <div className="mt-3 flex flex-wrap gap-2">
                  {product.specs.applications.map((a) => (
                    <span
                      key={a}
                      className="rounded-full border border-brand-blue/20 bg-brand-blue/5 px-3 py-1.5 text-[11.5px] text-fg/60"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {product.specs?.certifications?.length > 0 && (
              <div data-spec className="relative z-20 mt-6">
                <SpecHeading icon={<ShieldCheck size={15} />} title={t("product.certifications")} />
                <div className="mt-3 flex flex-wrap gap-2">
                  {product.specs.certifications.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-[11.5px] font-semibold text-emerald-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {product.commission_plan && (
              <Card className="mt-5 p-4">
                <div className="flex items-center gap-2 text-[13.5px] font-bold text-fg">
                  <TrendingUp size={16} className="text-brand-green" />{" "}
                  {t("product.earnBySharing")}
                </div>
                {/* One sentence from the catalog rather than three fragments
                    stitched around two <span>s: the percentage and the depth
                    do not sit in the same places in every language. */}
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg/45">
                  {t("product.earnBody", {
                    pct: pct(product.commission_plan.payout_pool_pct_bp),
                    levels: product.commission_plan.max_payout_depth,
                  })}
                </p>
              </Card>
            )}

            <Card className="mt-4 flex items-center gap-3 p-4">
              <Ticket size={18} className="shrink-0 text-brand-green" />
              <p className="text-[12.5px] leading-relaxed text-fg/45">
                {t("product.redeemCodeHint")}
              </p>
            </Card>

            {!purchasingEnabled && (
              <div data-spec className="mt-5">
                <VisitUsPanel product={product} />
              </div>
            )}
            </div>
          </div>
        )}
      </div>

      {product && purchasingEnabled && (
        // The bar is `fixed`, so it cannot inherit #root's width and has to
        // restate the same steps; they share Tailwind's breakpoints so the
        // two edges stay aligned. Its top border reads as the page's own edge,
        // and a border that stopped short of the content would look broken.
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-surface/8 bg-base-950/90 px-5 py-4 backdrop-blur-xl md:max-w-[720px] lg:max-w-[940px] xl:max-w-[1120px]">
          {/* The button itself stops growing well before the bar does: a
              1120px-wide "Buy" is a worse target than a 420px one, not a
              better one. Uncapped below md, so phones are untouched. */}
          <div className="md:mx-auto md:w-[420px]">
          <Button size="lg" fullWidth disabled={product.status !== "active" || product.stock_count <= 0} onClick={handleBuyClick}>
            {product.status !== "active"
              ? t("common.unavailable")
              : product.stock_count <= 0
                ? t("common.outOfStock")
                : product.list_price_y_cents !== undefined
                  ? t("product.buyFor", { price: money(product.list_price_y_cents) })
                  : t("product.requestQuote")}
          </Button>
          </div>
        </div>
      )}

      {productImage && (
        <ImageLightbox
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          src={productImage}
          alt={product.name}
          caption={`${product.name}${product.specs.manufacturer ? ` — ${product.specs.manufacturer}` : ""}`}
        />
      )}

      {product && (
        <PurchaseSheet
          product={product}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onPurchased={() => {
            toast.success("Purchase complete");
            refetch();
          }}
        />
      )}
    </PageTransition>
  );
}

function PurchaseSheet({ product, open, onClose, onPurchased }) {
  const t = useT();
  const { search } = useLocation();
  // A shared referral link (?ref=CODE) pre-fills the invite code, so the buyer
  // does not have to copy it across by hand.
  const [redeemCode, setRedeemCode] = useState(() => new URLSearchParams(search).get("ref") || "");
  const [checking, setChecking] = useState(false);
  const [codePreview, setCodePreview] = useState(null);
  const [codeError, setCodeError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  function reset() {
    setRedeemCode("");
    setCodePreview(null);
    setCodeError(null);
    setSubmitError(null);
    setResult(null);
  }

  async function checkCode(code) {
    setRedeemCode(code);
    setCodePreview(null);
    setCodeError(null);
    if (!code.trim()) return;
    setChecking(true);
    try {
      const preview = await api.validateRedeemCode(code.trim());
      if (preview.usable) setCodePreview(preview);
      else setCodeError("This code can't be used (expired, revoked, or full)");
    } catch (err) {
      setCodeError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function confirmPurchase() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.purchase({
        product_id: product.id,
        redeem_code: redeemCode.trim() || undefined,
      });
      setResult(res);
      onPurchased?.();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Purchase failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        onClose();
        setTimeout(reset, 300);
      }}
      title={result ? undefined : `Buy ${product.name}`}
    >
      {!result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-2xl border border-surface/10 bg-surface/5 px-4 py-3">
            <span className="text-[13px] text-fg/50">{t("product.total")}</span>
            <span className="text-[17px] font-extrabold text-fg">{money(product.list_price_y_cents)}</span>
          </div>

          <Input
            label={t("product.redeemCodeOptional")}
            placeholder="e.g. ALICE9F2Q"
            value={redeemCode}
            onChange={(e) => checkCode(e.target.value.toUpperCase())}
            hint={!codePreview && !codeError ? t("product.redeemBlankHint") : undefined}
            error={codeError}
          />
          {checking && (
            <div className="text-[12px] text-fg/35">{t("product.checkingCode")}</div>
          )}
          {codePreview && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-[12.5px] text-emerald-300">
              <CheckCircle2 size={15} /> {t("product.validCode")}
            </div>
          )}

          {submitError && <p className="text-[13px] font-medium text-red-400">{submitError}</p>}

          <Button size="lg" fullWidth loading={submitting} disabled={checking} onClick={confirmPurchase}>
            {t("product.confirmPurchase")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 pb-2 pt-2 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-gradient">
            <PartyPopper size={28} className="text-white" />
          </div>
          <div>
            <div className="text-[18px] font-extrabold text-fg">{t("product.youreIn")}</div>
            <div className="mt-1 text-[13px] text-fg/50">
              {result.transaction.redeem_code_id
                ? t("product.joinedExisting")
                : t("product.startedNew")}
            </div>
          </div>
          <div className="w-full rounded-2xl border border-surface/10 bg-surface/5 p-4">
            <div className="mb-2 text-[12px] font-semibold text-fg/40">
              {t("product.yourCodeShare")}
            </div>
            <CopyChip value={result.ownRedeemCode.code} className="w-full justify-center" />
          </div>
          <div className="flex w-full gap-2">
            <Link to={`/space/${result.space.id}`} className="flex-1">
              <Button variant="secondary" fullWidth onClick={onClose}>
                {t("product.viewSpace")}
              </Button>
            </Link>
            <Link to={`/network/${result.node.id}`} className="flex-1">
              <Button fullWidth onClick={onClose}>
                {t("product.myNode")}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
