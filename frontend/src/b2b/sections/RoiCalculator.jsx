import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Scale, X } from "lucide-react";
import { DeepPanel, PillButton, Select } from "../ui/primitives.jsx";
import { Slider } from "@/components/shadcn/slider.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { formatPayback, money, priceLabel, pricesUsable, roi } from "../lib/finance.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The page's central argument, in one control.
//
// A clinic owner's first question is never "what does it cost" -- it is
// "how long until it has paid for itself". Payback in months is therefore
// the largest number on the panel, and the price only appears as the input
// that produced it.
//
// Every figure comes from lib/finance so the number here, the number inside
// the device page, and the number printed on the proforma cannot disagree.
export function RoiCalculator({ defaultDeviceId = "primelase" }) {
  const t = useT();
  const { openRfq, compareDevices, toggleCompare, maxCompare } = useStorefront();
  const { devices, getDevice, pricesVisible } = useCatalogue();
  const [deviceId, setDeviceId] = useState(defaultDeviceId);
  const [sessions, setSessions] = useState(120);

  const device = getDevice(deviceId);
  // Payback is price divided by profit, so printing it while prices are
  // hidden would hand back the price a moment later. The revenue and profit
  // halves of the model do not depend on price and stay visible.
  const showPayback = pricesUsable(device, pricesVisible);
  const result = useMemo(
    () => roi({ price: device.price, sessionPrice: device.sessionPrice, sessionsPerMonth: sessions }),
    [device, sessions]
  );

  return (
    <section className="b2b-container mt-6 grid gap-4 lg:grid-cols-[1.6fr_0.9fr]">
      <DeepPanel className="p-6 sm:p-8">
        <span className="text-[11px] font-black tracking-[0.14em] text-brand-green uppercase">
          {t("store.roi.eyebrow")}
        </span>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-[28px]">
          {t("store.roi.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-[13px] text-white/60">{t("store.roi.lead")}</p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
            <span className="text-[10px] font-extrabold tracking-[0.1em] text-white/50 uppercase">
              {t("store.demand.deviceAria")}
            </span>
            <Select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              aria-label={t("store.demand.deviceAria")}
              className="mt-2 border-white/20 bg-transparent text-white [&>option]:text-ink"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {priceLabel(d, pricesVisible, t)}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-[11px] text-white/50">
              {t("store.roi.sessionPrice")}{" "}
              <b className="text-white">{money(device.sessionPrice, "$")}</b>
            </p>
          </div>

          <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
            <span className="text-[10px] font-extrabold tracking-[0.1em] text-white/50 uppercase">
              {t("store.device.roi.sessions")}
            </span>
            <div className="b2b-tnum mt-2 text-2xl font-black text-white">
              {sessions}
              <span className="ms-2 text-[12px] font-medium text-white/50">
                {t("store.roi.clientsAWeek", { count: Math.round(sessions / 4) })}
              </span>
            </div>
            <Slider
              min={40}
              max={300}
              step={5}
              value={[sessions]}
              onValueChange={([v]) => setSessions(v)}
              className="mt-3 w-full"
              aria-label={t("store.device.roi.sessions")}
            />
            <p className="text-[11px] text-white/50">
              {t("store.roi.revenueProfit", {
                revenue: money(result.revenue, "$"),
                profit: money(result.monthlyProfit, "$"),
              })}
            </p>
          </div>

          <div className="rounded-2xl bg-brand-gradient p-4 text-center text-white">
            {showPayback ? (
              <>
                <span className="text-[10px] font-black tracking-[0.1em] uppercase opacity-90">
                  {t("store.roi.paybackIn")}
                </span>
                <div className="b2b-tnum text-5xl leading-none font-black">
                  {formatPayback(result.payback)}
                </div>
                <span className="text-[11px] font-black">{t("store.device.roi.months")}</span>
                <p className="mt-2 text-[11px] opacity-90">
                  {t("store.roi.yearlyLine", {
                    profit: money(result.yearlyProfit, "$"),
                    sessions: result.breakEvenSessions,
                  })}
                </p>
              </>
            ) : (
              <>
                <span className="text-[10px] font-black tracking-[0.1em] uppercase opacity-90">
                  {t("store.device.roi.yearly")}
                </span>
                <div className="b2b-tnum text-4xl leading-none font-black">
                  {money(result.yearlyProfit, "$")}
                </div>
                <p className="mt-2 text-[11px] opacity-90">{t("store.roi.quotedNote")}</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <PillButton variant="white" onClick={() => openRfq(deviceId)}>
            {t("store.roi.planCta")}
          </PillButton>
          <PillButton as={Link} to={`/devices/${deviceId}`} variant="ghost">
            {t("store.roi.openDevice", { name: device.name })}
          </PillButton>
        </div>
        <p className="mt-2 text-[11px] text-white/45">{t("store.roi.includes")}</p>
      </DeepPanel>

      <div className="rounded-3xl border border-line bg-panel p-5">
        <b className="inline-flex items-center gap-2 text-sm font-black text-ink">
          <Scale className="h-4 w-4" />
          {t("store.roi.compareTitle", {
            count: compareDevices.length,
            max: maxCompare,
          })}
        </b>
        <p className="mt-1.5 text-[12px] text-ink-2">
          {t("store.roi.compareLead", { max: maxCompare })}
        </p>

        {compareDevices.length === 0 ? (
          <div className="mt-3 rounded-2xl border-2 border-dashed border-line p-6 text-center text-[12px] text-ink-3">
            {t("store.roi.nothingSelected")}
            <br />
            {t("store.roi.useScale")}
          </div>
        ) : (
          <ul className="mt-3 grid gap-2">
            {compareDevices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-[12px] font-bold text-ink"
              >
                <span>
                  {d.flag} {d.name}
                </span>
                <button
                  type="button"
                  onClick={() => toggleCompare(d.id)}
                  aria-label={t("store.compare.removeAria", { name: d.name })}
                  className="cursor-pointer text-ink-3 hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] text-ink">
          <b>{t("store.roi.whyTitle")}</b> {t("store.roi.whyBody")}
        </div>

        <PillButton as={Link} to="/compare" variant="dark" fullWidth className="mt-3">
          {t("store.roi.compareNow")}
        </PillButton>
      </div>
    </section>
  );
}
