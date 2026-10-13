import { useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useAsync } from "@shared/hooks/useAsync.js";
import { adminApi as api } from "../lib/adminApi.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { StatusBadge } from "@shared/components/ui/Badge.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";
import { money, shortDate } from "@shared/lib/format.js";

const FILTERS = [
  { value: "", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "refunded", label: "Refunded" },
];

export default function AdminOrdersPage() {
  const [status, setStatus] = useState("");
  const { data, loading, error, refetch } = useAsync(() => api.listOrders({ status: status || undefined, limit: 100 }), [status]);

  return (
    <>
      <PageHeader title="Orders" description="Every sale, online and walk-in." />
      <PageBody>
      <PageTitle title="Admin · Orders" />
      <SegmentedControl options={FILTERS} value={status} onChange={setStatus} />
      <div className="mt-4">
        {loading && (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && data.length === 0 && <EmptyState title="No orders found" />}
        <Card className="divide-y divide-surface/6">
          {data?.map((tx) => (
            <Link to={`/orders/${tx.id}`} key={tx.id} className="flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold text-fg">{money(tx.y_at_sale_cents)}</div>
                <div className="text-[11px] text-fg/40">{shortDate(tx.created_at)}</div>
              </div>
              <div className="text-right text-[12px] text-fg/40">
                margin {money(tx.margin_cents)}
                <br />
                net {money(tx.trex_net_amount_cents)}
              </div>
              <StatusBadge status={tx.status} />
              <ChevronRight size={16} className="text-fg/25" />
            </Link>
          ))}
        </Card>
      </div>
    </PageBody>
    </>
  );
}
