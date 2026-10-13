import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { Card } from "@shared/components/ui/Card.jsx";
import { StatusBadge } from "@shared/components/ui/Badge.jsx";
import { money, fullDate } from "@shared/lib/format.js";

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-fg/45">{label}</span>
      <span className={strong ? "text-[14px] font-extrabold text-fg" : "text-[13.5px] font-semibold text-fg/80"}>
        {value}
      </span>
    </div>
  );
}

export function OrderDetailView({ tx, productName, ledgerEntries, showInternals = false, refundSlot }) {
  if (!tx) return null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient">
            <Package size={19} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-fg">{productName || "Product"}</div>
            <div className="text-[11.5px] text-fg/40">{fullDate(tx.created_at)}</div>
          </div>
          <StatusBadge status={tx.status} />
        </div>

        <div className="mt-3 divide-y divide-surface/6 border-t border-surface/6 pt-1">
          <Row label="Amount paid" value={money(tx.y_at_sale_cents)} strong />
          {tx.discount_cents > 0 && <Row label="Discount" value={`-${money(tx.discount_cents)}`} />}
          {tx.refunded_amount_cents > 0 && <Row label="Refunded" value={money(tx.refunded_amount_cents)} />}
          <Row label="Order ID" value={<span className="font-mono text-[11.5px]">{tx.id.slice(0, 18)}…</span>} />
        </div>
      </Card>

      {showInternals && (
        <Card className="p-4">
          <div className="mb-1 text-[12.5px] font-bold uppercase tracking-wide text-fg/40">Financials</div>
          <div className="divide-y divide-surface/6">
            <Row label="Warehouse cost (x)" value={money(tx.x_at_sale_cents)} />
            <Row label="Sale price (y)" value={money(tx.y_at_sale_cents)} />
            <Row label="Margin" value={money(tx.margin_cents)} />
            <Row label="Payout pool" value={money(tx.payout_pool_amount_cents)} />
            <Row label="Total payout" value={money(tx.total_payout_cents)} />
            <Row label="Reserve cut" value={money(tx.reserve_amount_cents)} />
            <Row label="Trex net" value={money(tx.trex_net_amount_cents)} strong />
          </div>
        </Card>
      )}

      {showInternals && ledgerEntries && ledgerEntries.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-[12.5px] font-bold uppercase tracking-wide text-fg/40">Commission ledger</div>
          <div className="divide-y divide-surface/6">
            {ledgerEntries.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-[13px] font-semibold text-fg">Level {e.level_depth}</div>
                  <Link to={`/network/${e.node_id}`} className="font-mono text-[11px] text-brand-green underline">
                    {e.node_id.slice(0, 14)}…
                  </Link>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold text-emerald-300">{money(e.amount_cents)}</div>
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
