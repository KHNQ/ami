import { Link } from "react-router-dom";
import { ChevronRight, Package } from "lucide-react";
import { useAsync } from "../hooks/useAsync.js";
import { api } from "../lib/api.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { ErrorState } from "../components/ui/ErrorState.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { StatusBadge } from "../components/ui/Badge.jsx";
import { PillButton, SectionHead } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { money, shortDate } from "../lib/format.js";
import { useT } from "../i18n/I18nProvider.jsx";

export default function OrdersPage() {
  const t = useT();
  const { data: orders, loading, error, refetch } = useAsync(() => api.listMyPurchases({ limit: 50 }), []);
  const { data: products } = useAsync(() => api.listProducts({ limit: 100 }), []);
  const productById = new Map((products || []).map((p) => [p.id, p]));

  return (
    // The storefront header sits above this now, so the old phone-style
    // TopBar (back chevron, title, theme toggle) is gone -- it would be a
    // second header bar stacked under the real one. Same reason the page
    // measure is `b2b-container` rather than the 560px app column.
    <PageTransition className="b2b-container flex-1 py-8">
      <PageMeta
        title={t("profile.myOrders")}
        description={t("orders.metaDesc")}
        path="/orders"
        noIndex
      />
      <SectionHead
        eyebrow={t("nav.yourAccount")}
        title={t("profile.myOrders")}
        lead={t("orders.lead")}
        actions={
          <PillButton as={Link} to="/devices" variant="white" size="sm">
            {t("account.browseDevices")}
          </PillButton>
        }
      />

      <div className="mt-5">
        {loading && (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {orders && orders.length === 0 && (
          <EmptyState
            icon={<Package className="mx-auto" />}
            title={t("orders.noneTitle")}
            description={t("orders.noneBody")}
          />
        )}
        <div className="flex flex-col gap-2.5">
          {orders?.map((o) => (
            <Link to={`/orders/${o.id}`} key={o.id}>
              <Card className="b2b-card flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel-2">
                  <Package size={17} className="text-ink-2" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-black text-ink">
                    {productById.get(o.product_id)?.name || t("network.productFallback")}
                  </div>
                  <div className="text-label text-ink-2">{shortDate(o.created_at)}</div>
                </div>
                <div className="text-end">
                  <div className="b2b-tnum text-[13px] font-black text-ink">{money(o.y_at_sale_cents)}</div>
                  <StatusBadge status={o.status} className="mt-1" />
                </div>
                <ChevronRight size={16} className="text-ink-3 rtl:rotate-180" />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageTransition>
  );
}
