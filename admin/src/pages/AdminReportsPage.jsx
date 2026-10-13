import { useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { useAsync } from "@shared/hooks/useAsync.js";
import { adminApi as api } from "../lib/adminApi.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { StatTile } from "../components/ui/StatTile.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { money, fullDate } from "@shared/lib/format.js";

export default function AdminReportsPage() {
  const { data: products } = useAsync(() => api.listProducts({ limit: 100 }), []);
  const [productId, setProductId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const {
    data: net,
    loading,
    error,
    refetch,
  } = useAsync(
    () =>
      api.trexNetReport({
        product_id: productId || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      }),
    [productId, from, to]
  );
  const { data: reserve } = useAsync(() => api.reserveFundReport(), []);
  const [audit, setAudit] = useState(null);
  const [auditing, setAuditing] = useState(false);

  async function runAudit() {
    setAuditing(true);
    try {
      setAudit(await api.auditInvariants());
    } finally {
      setAuditing(false);
    }
  }

  return (
    <>
      <PageHeader title="Reports" description="Financial position and invariant checks." />
      <PageBody>
      <PageTitle title="Admin · Reports" />
      <div className="flex flex-col gap-2.5">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg/60">Product</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="h-12 w-full rounded-2xl border border-surface/10 bg-base-800/70 px-4 text-[15px] text-fg outline-none focus:border-brand-green/60"
          >
            <option value="">All products</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2.5">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(productId || from || to) && (
          <button
            onClick={() => {
              setProductId("");
              setFrom("");
              setTo("");
            }}
            className="self-start text-[12.5px] font-semibold text-brand-green"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-5">
        {loading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
      </div>
      {net && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Transactions" value={net.tx_count} />
          <StatTile label="Revenue" value={money(net.total_revenue_cents)} />
          <StatTile label="Total margin" value={money(net.total_margin_cents)} />
          <StatTile label="Payout pool" value={money(net.total_payout_pool_cents)} />
          <StatTile label="Actual payout" value={money(net.total_payout_cents)} />
          <StatTile label="Reserve cut" value={money(net.total_reserve_cents)} />
          <StatTile label="Trex net" value={money(net.total_trex_net_cents)} tone="brand" className="col-span-2" />
        </div>
      )}

      <div className="mt-6 text-[14px] font-extrabold text-fg">Reserve / dev fund</div>
      {reserve && (
        <>
          <Card className="mt-2.5 p-4">
            <div className="text-[12px] text-fg/40">Current balance</div>
            <div className="text-[24px] font-extrabold text-gradient">{money(reserve.balance_cents)}</div>
          </Card>
          <Card className="mt-2.5 divide-y divide-surface/6">
            {reserve.recent_entries.length === 0 && <div className="p-4 text-[13px] text-fg/40">No entries yet</div>}
            {reserve.recent_entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between p-3.5">
                <div>
                  <div className="text-[13px] font-semibold text-fg capitalize">{e.type}</div>
                  <div className="text-[11px] text-fg/40">{fullDate(e.created_at)}</div>
                </div>
                <div className={"text-[13.5px] font-bold " + (e.type === "credit" ? "text-emerald-300" : "text-red-300")}>
                  {e.type === "credit" ? "+" : "-"}
                  {money(e.amount_cents)}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      <div className="mt-6 text-[14px] font-extrabold text-fg">Standing invariant audit</div>
      <Card className="mt-2.5 p-4">
        <p className="mb-3 text-[12.5px] text-fg/45">
          Scans every historical transaction and flags any row that ever violated a financial invariant
          (trex_net &gt; 0, payout ≤ pool).
        </p>
        <Button size="sm" variant="secondary" loading={auditing} onClick={runAudit}>
          Run audit
        </Button>
        {audit && (
          <div className={"mt-3 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold " + (audit.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300")}>
            {audit.ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
            {audit.ok
              ? `All ${audit.checked} transactions pass`
              : `${audit.violations.length} violation(s) found out of ${audit.checked}`}
          </div>
        )}
      </Card>
    </PageBody>
    </>
  );
}
