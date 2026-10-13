import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { Card } from "../ui/Card.jsx";
import { StatusBadge } from "../ui/Badge.jsx";
import { money, fullDate } from "../../lib/format.js";
import { useT } from "../../i18n/I18nProvider.jsx";

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className={strong ? "text-[14px] font-extrabold text-fg" : "text-[13.5px] font-semibold text-ink"}>
        {value}
      </span>
    </div>
  );
}

export function OrderDetailView({ tx, productName, ledgerEntries, showInternals = false, refundSlot }) {
  const t = useT();
  if (!tx) return null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient">
            <Package size={19} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-fg">
              {productName || t("network.productFallback")}
            </div>
            <div className="text-[11.5px] text-ink-2">{fullDate(tx.created_at)}</div>
          </div>
          <StatusBadge status={tx.status} />
        </div>

        <div className="mt-3 divide-y divide-line border-t border-line pt-1">
          {/* What was actually received, not what the order is worth: an instalment
              order is worth more than has been paid so far. */}
          <Row label={t("orders.amountPaid")} value={money(tx.amount_received_cents ?? tx.y_at_sale_cents)} strong />
          {tx.amount_received_cents != null && tx.amount_received_cents < tx.y_at_sale_cents && (
            <Row label={t("orders.orderValue")} value={money(tx.y_at_sale_cents)} />
          )}
          {tx.discount_cents > 0 && (
            <Row label={t("orders.discount")} value={`-${money(tx.discount_cents)}`} />
          )}
          {tx.refunded_amount_cents > 0 && (
            <Row label={t("orders.refunded")} value={money(tx.refunded_amount_cents)} />
          )}
          <Row
            label={t("orders.orderId")}
            value={<span className="font-mono text-[11.5px]">{tx.id.slice(0, 18)}…</span>}
          />
        </div>
      </Card>

      {showInternals && (
        <Card className="p-4">
          <div className="mb-1 text-[12.5px] font-bold uppercase tracking-wide text-ink-2">
            {t("orders.financials")}
          </div>
          <div className="divide-y divide-line">
            <Row label={t("orders.warehouseCost")} value={money(tx.x_at_sale_cents)} />
            <Row label={t("orders.salePrice")} value={money(tx.y_at_sale_cents)} />
            <Row label={t("orders.margin")} value={money(tx.margin_cents)} />
            <Row label={t("orders.payoutPool")} value={money(tx.payout_pool_amount_cents)} />
            <Row label={t("orders.totalPayout")} value={money(tx.total_payout_cents)} />
            <Row label={t("orders.reserveCut")} value={money(tx.reserve_amount_cents)} />
            <Row label={t("orders.netAmount")} value={money(tx.trex_net_amount_cents)} strong />
          </div>
        </Card>
      )}

      {showInternals && ledgerEntries && ledgerEntries.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-[12.5px] font-bold uppercase tracking-wide text-ink-2">
            {t("orders.commissionLedger")}
          </div>
          <div className="divide-y divide-line">
            {ledgerEntries.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-[13px] font-semibold text-fg">
                    {t("orders.level", { level: e.level_depth })}
                  </div>
                  <Link to={`/network/${e.node_id}`} className="font-mono text-[11px] text-brand-green underline">
                    {e.node_id.slice(0, 14)}…
                  </Link>
                </div>
                <div className="text-end">
                  <div className="text-[13px] font-bold text-emerald-700 dark:text-emerald-300">{money(e.amount_cents)}</div>
                  <StatusBadge status={e.status} className="mt-1" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {refundSlot}
    </div>
  );
}
