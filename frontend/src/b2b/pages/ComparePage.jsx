import { useState } from "react";
import { Link } from "react-router-dom";
import { FileDown, X } from "lucide-react";
import { CertMarks, Chip, PillButton, SectionHead } from "../ui/primitives.jsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table.jsx";
import { Slider } from "@/components/shadcn/slider.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { formatPayback, money, priceLabel, pricesUsable, roi } from "../lib/finance.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// Side-by-side comparison, built for the meeting where the decision is
// actually made.
//
// The row order is the order a committee argues in: what it does, whether
// it is cleared, what it costs to run, and only then the price. Payback is
// computed live at a shared session volume so the columns are comparable --
// comparing a €24,000 machine to a €55,000 one on price alone is the
// mistake this table exists to prevent.
const ROWS = [
  { key: "store.compare.row.origin", get: (d) => `${d.flag} ${d.country} — ${d.brand}` },
  { key: "store.device.spec.indications", get: (d) => d.indications },
  { key: "store.device.spec.wavelength", get: (d) => d.wavelength },
  { key: "store.device.spec.spot", get: (d) => d.spot },
  { key: "store.device.spec.output", get: (d) => d.shots },
  { key: "store.device.spec.cooling", get: (d) => d.cooling },
  { key: "store.device.spec.consumables", get: (d) => d.consumable },
  { key: "store.device.spec.warranty", get: (d) => d.warranty },
  {
    key: "store.compare.row.availability",
    get: (d, t) =>
      d.stockIsIndicative
        ? t("store.device.stock.indicative", { days: d.nextShipmentDays })
        : t("store.compare.row.stock", { count: d.stock, days: d.nextShipmentDays }),
  },
];

export default function ComparePage() {
  const t = useT();
  const { compareDevices, clearCompare, toggleCompare, openRfq, notify, maxCompare } =
    useStorefront();
  const { pricesVisible } = useCatalogue();
  const [sessions, setSessions] = useState(120);

  if (compareDevices.length === 0) {
    return (
      <div className="b2b-container py-20 text-center">
        <h1 className="text-2xl font-black text-ink">{t("store.compare.empty.title")}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
          {t("store.compare.empty.body", { max: maxCompare })}
        </p>
        <PillButton as={Link} to="/devices" className="mt-5">
          {t("store.compare.empty.cta")}
        </PillButton>
      </div>
    );
  }

  return (
    <div className="b2b-container py-8">
      <SectionHead
        eyebrow={t("store.compare.eyebrow", {
          count: compareDevices.length,
          max: maxCompare,
        })}
        title={t("store.compare.title")}
        lead={t("store.compare.lead")}
        actions={
          <>
            <PillButton variant="white" onClick={clearCompare}>
              {t("store.compare.clearAll")}
            </PillButton>
            <PillButton onClick={() => openRfq(compareDevices[0].id)}>
              {t("store.cta.requestProforma")}
            </PillButton>
          </>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-4">
        <label className="text-[12px] font-black text-ink" htmlFor="compare-sessions">
          {t("store.compare.sessionsLabel")}
        </label>
        <Slider
          id="compare-sessions"
          min={40}
          max={300}
          step={5}
          value={[sessions]}
          onValueChange={([v]) => setSessions(v)}
          className="min-w-[180px] flex-1"
        />
        <span className="b2b-tnum text-lg font-black text-ink">{sessions}</span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
        <Table className="min-w-[640px] text-[12.5px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-44 bg-panel-2 p-3 text-start text-[11px] font-black tracking-wide text-ink-2 uppercase">
                {t("store.compare.row.feature")}
              </TableHead>
              {compareDevices.map((d) => (
                <TableHead key={d.id} className="bg-panel-2 p-3 text-start align-top">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/devices/${d.id}`} className="font-black text-ink hover:text-brand-green">
                      {d.name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleCompare(d.id)}
                      aria-label={t("store.compare.removeAria", { name: d.name })}
                      className="cursor-pointer text-ink-3 hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="mt-1 block font-normal text-ink-2">{d.tagline}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="border-t border-line bg-panel-2 p-3 font-black text-ink">
                  {t(row.key)}
                </TableCell>
                {compareDevices.map((d) => (
                  <TableCell key={d.id} className="border-t border-line bg-panel p-3 text-ink-2">
                    {row.get(d, t)}
                  </TableCell>
                ))}
              </TableRow>
            ))}

            <TableRow>
              <TableCell className="border-t border-line bg-panel-2 p-3 font-black text-ink">
                {t("store.compare.row.certification")}
              </TableCell>
              {compareDevices.map((d) => (
                <TableCell key={d.id} className="border-t border-line bg-panel p-3">
                  <CertMarks device={d} size="xs" />
                </TableCell>
              ))}
            </TableRow>

            <TableRow>
              <TableCell className="border-t border-line bg-panel-2 p-3 font-black text-ink">
                {t("store.compare.row.price")}
              </TableCell>
              {compareDevices.map((d) => (
                <TableCell key={d.id} className="b2b-tnum border-t border-line bg-panel p-3 font-black text-ink">
                  {priceLabel(d, pricesVisible, t)}
                </TableCell>
              ))}
            </TableRow>

            <TableRow>
              <TableCell className="border-t border-line bg-panel-2 p-3 font-black text-ink">
                {t("store.compare.row.payback", { sessions })}
              </TableCell>
              {compareDevices.map((d) => {
                const r = roi({
                  price: d.price,
                  sessionPrice: d.sessionPrice,
                  sessionsPerMonth: sessions,
                });
                return (
                  <TableCell key={d.id} className="border-t border-line bg-panel p-3">
                    {pricesUsable(d, pricesVisible) ? (
                      <b className="b2b-tnum text-base text-brand-green">
                        {t("store.compare.months", { value: formatPayback(r.payback) })}
                      </b>
                    ) : (
                      <b className="text-[12px] text-ink-2">{t("store.compare.withQuote")}</b>
                    )}
                    <span className="block text-[11px] text-ink-2">
                      {t("store.compare.profitLine", {
                        profit: money(r.monthlyProfit, "$"),
                        price: money(d.sessionPrice, "$"),
                      })}
                    </span>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PillButton
          variant="white"
          onClick={() => {
            // The browser's own print pipeline, not a fabricated download:
            // it produces a real PDF, on any platform, with the table
            // exactly as the buyer is looking at it.
            window.print();
            notify(t("store.compare.printHint"));
          }}
        >
          <FileDown className="h-3.5 w-3.5" />
          {t("store.compare.exportCta")}
        </PillButton>
        {compareDevices.map((d) => (
          <Chip key={d.id} tone="neutral">
            {d.flag} {d.name}
          </Chip>
        ))}
      </div>

      <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[12px] text-ink">
        <b>{t("store.compare.caveatTitle")}</b> {t("store.compare.caveatBody")}
      </p>
    </div>
  );
}
