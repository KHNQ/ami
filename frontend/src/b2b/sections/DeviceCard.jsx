import { Link } from "react-router-dom";
import { Box, Scale } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Chip, IconButton, PillButton } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { CATEGORY_TINT } from "../data/devices.js";
import { DeviceVisual } from "./DeviceVisual.jsx";
import { useProduct3dEnabled } from "../lib/deviceVisual.js";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { priceLabel } from "../lib/finance.js";
import { LockCountdown } from "./LockCountdown.jsx";
import { CutoutCard } from "../../components/cult/cutout-card.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// One device in the shop grid.
//
// The product shot is a framed region of the real catalogue page (see
// devices.js) rather than stock photography. It costs no extra download --
// the catalogue viewer pulls the same files -- and it means the machine on
// the card is provably the machine in the brochure.
export function DeviceCard({ device }) {
  const t = useT();
  const { isComparing, toggleCompare, lockFor } = useStorefront();
  const { pricesVisible } = useCatalogue();
  const show3d = useProduct3dEnabled();
  const comparing = isComparing(device.id);
  const lock = lockFor(device.id);

  // cult-ui's CutoutCard wraps the card: it publishes a hover state to its
  // children through context (so the corner pin reacts) and fades the card in
  // on mount. `trackPointerHover` stays on, but the existing `.b2b-card` lift
  // is kept -- that is a compositor-only transform and cheaper than animating
  // the whole card, which matters on a 13-card grid.
  return (
    <CutoutCard
      as="article"
      data-spotlight
      className="b2b-card relative flex flex-col overflow-hidden rounded-3xl border border-line bg-panel"
    >
      <div
        className={cn(
          "relative h-44 overflow-hidden bg-gradient-to-br p-4",
          CATEGORY_TINT[device.cat] || "from-panel-2 to-panel"
        )}
      >
        {/* Certification marks stay top-start: it is the first thing a
            hospital buyer's eye goes to on a card like this. */}
        <span className="absolute start-2.5 top-2.5 z-10 flex gap-1">
          {device.fda ? (
            <span className="rounded-full bg-brand-green px-1.5 py-0.5 text-[9px] font-black text-white">
              FDA
            </span>
          ) : null}
          {device.ce ? (
            <span className="rounded-full bg-brand-blue px-1.5 py-0.5 text-[9px] font-black text-white">
              CE
            </span>
          ) : null}
          <span className="rounded-full bg-ink px-1.5 py-0.5 text-[9px] font-black text-canvas">
            ISO
          </span>
        </span>

        <span className="absolute end-2.5 top-2.5 z-10 rounded-full border border-line bg-panel px-2 py-1 text-[10px] font-extrabold text-ink">
          {device.flag} {device.country}
        </span>

        {/* A centred portrait tile rather than a full-bleed band. The
            machines in the catalogue are tall, upright objects photographed
            on white; a wide letterbox crop of one shows a cable and a
            caption. Framing them in a near-square plate is both truer to
            the object and what makes the crops legible at card size. */}
        <Link
          to={`/devices/${device.id}`}
          aria-label={device.name}
          className="mx-auto flex h-full w-40 items-center justify-center overflow-hidden rounded-2xl bg-panel p-2 shadow-lg transition-transform duration-300 hover:scale-[1.04]"
        >
          <DeviceVisual device={device} />
        </Link>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[14px] leading-tight font-black text-ink">
          <Link to={`/devices/${device.id}`} className="hover:text-brand-green">
            {device.name}
          </Link>{" "}
          <span className="text-[11px] font-semibold text-ink-2">· {device.indications}</span>
        </h3>

        <p className="mt-1.5 line-clamp-2 flex-1 text-[12px] text-ink-2">
          {device.wavelength} · {device.spot} · {device.cooling}
        </p>

        {/* Stock and lock state. Real counts from the device record, not a
            random number regenerated on every render -- a "3 left" that
            becomes "5 left" when you scroll back is worse than no badge. */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {/* Only pulsed as urgency when the figure is a real stock count
              from the API. On a seeded or unreachable catalogue it is
              presented plainly as a lead time, because a blinking "2 left"
              that nobody is counting is just pressure. */}
          {device.stockIsIndicative ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-panel-2 px-2 py-1 text-[10px] font-black text-ink-2">
              {t("store.device.stock.indicative", { days: device.nextShipmentDays })}
            </span>
          ) : (
            <span className="b2b-pulse inline-flex items-center gap-1 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-600 dark:text-red-300">
              {t("store.device.card.stockShort", {
                count: device.stock,
                days: device.nextShipmentDays,
              })}
            </span>
          )}
        </div>

        <div className="mt-1.5 text-[11px] font-bold">
          {lock ? (
            <span className="text-red-600 dark:text-red-300">
              {t("store.device.card.rialLock")} <LockCountdown startedAt={lock.startedAt} />{" "}
              {t("store.device.card.left")}
            </span>
          ) : (
            <span className="text-ink-2">{t("store.device.card.lockAvailable")}</span>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip tone="neutral">{device.cat.toUpperCase()}</Chip>
          <Chip tone="teal">{priceLabel(device, pricesVisible, t)}</Chip>
          <Chip tone={device.fda ? "brand" : "amber"}>
            {device.fda ? t("store.device.card.fdaOk") : t("store.device.card.ceOk")}
          </Chip>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <PillButton
            as={Link}
            to={`/devices/${device.id}`}
            variant="dark"
            size="sm"
            className="flex-1"
          >
            {show3d ? t("store.device.card3d") : t("store.device.cardSpecs")}
          </PillButton>
          <IconButton
            active={comparing}
            onClick={() => toggleCompare(device.id)}
            aria-label={
              comparing
                ? t("store.device.removeCompareAria", { name: device.name })
                : t("store.device.compareAria", { name: device.name })
            }
            aria-pressed={comparing}
            className="h-9 w-9"
          >
            <Scale className="h-4 w-4" />
          </IconButton>
          {show3d ? (
            <Link
              to={`/devices/${device.id}`}
              aria-label={t("store.device.open3dAria", { name: device.name })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel text-ink hover:bg-panel-2"
            >
              <Box className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </div>
    </CutoutCard>
  );
}
