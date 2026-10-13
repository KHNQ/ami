import { useMemo, useState } from "react";
import { cn } from "../../lib/cn.js";
import { Slider } from "@/components/shadcn/slider.jsx";
import { PillButton } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { useSiteConfig } from "../../context/SiteConfigContext.jsx";
import {
  defaultLeaseTerm,
  leaseOption,
  leasePrice,
  money,
  pricesUsable,
  resolveLeaseRules,
} from "../lib/finance.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// The lease tab.
//
// What the visitor can choose here is not hardcoded: the durations on offer,
// each one's rate, the smallest upfront payment and the price leased against
// all come from the lease rules an admin set on the product (see
// finance.resolveLeaseRules). The tab configures a quote and hands it to the
// proforma dialog -- it collects no contact details of its own and sends
// nothing to WhatsApp. "Request Proforma Invoice" is the one action, and it
// lands in the sales queue; the server re-validates the term and upfront
// against the same rules and computes the instalment itself.
export function LeaseConfigurator({ device, pricesVisible }) {
  const t = useT();
  const { openRfq } = useStorefront();
  const config = useSiteConfig();
  const rules = useMemo(
    () => resolveLeaseRules(device, Number(config?.lease_apr_bp) || 1800),
    [device, config?.lease_apr_bp]
  );
  const showFigures = pricesUsable(device, pricesVisible);
  const price = leasePrice(device, rules);

  const [months, setMonths] = useState(() => defaultLeaseTerm(rules));
  const [upfrontPct, setUpfrontPct] = useState(() => Math.min(rules.max_upfront_pct, Math.max(rules.min_upfront_pct, 20)));

  // Rules can change under the tab (the live catalogue lands after first
  // paint, and navigating between devices reuses this component), so the
  // selection is re-clamped rather than trusted.
  const termAllowed = rules.terms.some((x) => x.months === months);
  const activeMonths = termAllowed ? months : defaultLeaseTerm(rules);
  const activeUpfront = Math.min(rules.max_upfront_pct, Math.max(rules.min_upfront_pct, upfrontPct));

  const options = useMemo(
    () =>
      rules.terms.map((term) =>
        leaseOption(rules, price, { months: term.months, upfrontPct: activeUpfront })
      ),
    [rules, price, activeUpfront]
  );
  const chosen = options.find((o) => o?.months === activeMonths) || null;

  if (!rules.enabled) {
    return (
      <div className="rounded-2xl border border-line bg-panel-2 p-4">
        <b className="text-[13px] font-black text-ink">{t("store.device.lease.title")}</b>
        <p className="mt-1 text-[12px] text-ink-2">{t("store.device.lease.notOffered")}</p>
        <PillButton className="mt-3" fullWidth onClick={() => openRfq(device.id)}>
          {t("store.device.lease.requestProforma")}
        </PillButton>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-line bg-panel-2 p-4">
        <b className="text-[13px] font-black text-ink">{t("store.device.lease.title")}</b>
        <p className="mt-1 text-[12px] text-ink-2">{t("store.device.lease.leadRules")}</p>

        <fieldset className="mt-3">
          <legend className="text-[10px] font-extrabold tracking-wide text-ink-2 uppercase">
            {t("store.device.lease.durationLabel")}
          </legend>
          <div role="radiogroup" className="mt-1.5 flex flex-wrap gap-2">
            {rules.terms.map((term) => {
              const selected = term.months === activeMonths;
              return (
                <button
                  key={term.months}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMonths(term.months)}
                  className={cn(
                    "b2b-tnum cursor-pointer rounded-full border px-4 py-2 text-[13px] font-black transition-colors",
                    selected
                      ? "border-transparent bg-ink text-canvas"
                      : "border-line bg-panel text-ink hover:border-brand-green hover:text-brand-green"
                  )}
                >
                  {t("store.device.lease.monthsLabel", { months: term.months })}
                </button>
              );
            })}
          </div>
        </fieldset>

        {rules.max_upfront_pct > rules.min_upfront_pct ? (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="lease-upfront"
                className="text-[10px] font-extrabold tracking-wide text-ink-2 uppercase"
              >
                {t("store.device.lease.upfrontLabel")}
              </label>
              <b className="b2b-tnum text-[13px] font-black text-ink">{activeUpfront}%</b>
            </div>
            <Slider
              id="lease-upfront"
              className="mt-2.5"
              min={rules.min_upfront_pct}
              max={rules.max_upfront_pct}
              step={1}
              value={[activeUpfront]}
              onValueChange={([v]) => setUpfrontPct(v)}
              aria-label={t("store.device.lease.upfrontLabel")}
            />
            <p className="mt-1.5 text-[11px] text-ink-3">
              {t("store.device.lease.upfrontRange", {
                min: rules.min_upfront_pct,
                max: rules.max_upfront_pct,
              })}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[12px] text-ink-2">
            {t("store.device.lease.upfrontFixed", { pct: rules.min_upfront_pct })}
          </p>
        )}
      </div>

      {showFigures && chosen ? (
        <>
          <div className="rounded-2xl border border-transparent bg-ink p-4 text-canvas">
            <span className="text-[10px] font-extrabold tracking-wide uppercase opacity-70">
              {t("store.device.lease.monthlyLabel")}
            </span>
            <div className="b2b-tnum mt-0.5 text-3xl font-black">
              {t("store.device.lease.perMonth", { amount: money(chosen.monthly) })}
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">{t("store.device.lease.cashPrice")}</dt>
                <dd className="b2b-tnum font-bold">{money(chosen.price)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">{t("store.device.lease.upfrontAmount")}</dt>
                <dd className="b2b-tnum font-bold">{money(chosen.upfront)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">{t("store.device.lease.financed")}</dt>
                <dd className="b2b-tnum font-bold">{money(chosen.principal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">{t("store.device.lease.apr")}</dt>
                <dd className="b2b-tnum font-bold">{(chosen.aprBp / 100).toFixed(1)}%</dd>
              </div>
              <div className="flex justify-between gap-3 sm:col-span-2">
                <dt className="opacity-70">{t("store.device.lease.totalPaid")}</dt>
                <dd className="b2b-tnum font-bold">{money(chosen.total)}</dd>
              </div>
            </dl>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[320px] text-[12.5px]">
              <caption className="sr-only">{t("store.device.lease.compareCaption")}</caption>
              <thead>
                <tr className="bg-panel-2 text-[11px] tracking-wide text-ink-2 uppercase">
                  <th scope="col" className="p-2.5 text-start">{t("store.device.lease.durationLabel")}</th>
                  <th scope="col" className="p-2.5 text-start">{t("store.device.lease.monthlyLabel")}</th>
                  <th scope="col" className="p-2.5 text-start">{t("store.device.lease.apr")}</th>
                  <th scope="col" className="p-2.5 text-start">{t("store.device.lease.totalPaid")}</th>
                </tr>
              </thead>
              <tbody>
                {options.filter(Boolean).map((o) => (
                  <tr key={o.months} className={o.months === activeMonths ? "bg-brand-green/8" : ""}>
                    <th scope="row" className="b2b-tnum border-t border-line p-2.5 text-start font-black text-ink">
                      {t("store.device.lease.monthsLabel", { months: o.months })}
                    </th>
                    <td className="b2b-tnum border-t border-line p-2.5 font-black text-brand-green">
                      {money(o.monthly)}
                    </td>
                    <td className="b2b-tnum border-t border-line p-2.5 text-ink-2">
                      {(o.aprBp / 100).toFixed(1)}%
                    </td>
                    <td className="b2b-tnum border-t border-line p-2.5 text-ink-2">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="rounded-2xl border border-line bg-panel-2 p-4 text-[12px] text-ink-2">
          {t("store.device.lease.quotedOnly")}
        </p>
      )}

      <PillButton
        size="lg"
        fullWidth
        onClick={() =>
          openRfq(device.id, null, { months: activeMonths, upfrontPct: activeUpfront, priced: Boolean(showFigures && chosen) })
        }
      >
        {t("store.device.lease.requestProforma")}
      </PillButton>
      <p className="text-center text-[11px] text-ink-3">{t("store.device.lease.requestNote")}</p>
    </div>
  );
}

