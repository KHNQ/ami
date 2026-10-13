import { Link, useParams } from "react-router-dom";
import { useAsync } from "../hooks/useAsync.js";
import { api } from "../lib/api.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { BackLink, SectionHead } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { ErrorState } from "../components/ui/ErrorState.jsx";
import { OrderDetailView } from "../components/orders/OrderDetailView.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

export default function OrderDetailPage() {
  const t = useT();
  const { id } = useParams();
  const { data, loading, error, refetch } = useAsync(() => api.getPurchase(id), [id]);
  const { data: product } = useAsync(() => (data ? api.getProduct(data.product_id) : Promise.resolve(null)), [data?.product_id]);

  return (
    <PageTransition className="b2b-container flex-1 py-8">
      <PageMeta
        title={t("account.orderFallback")}
        description={t("orders.detailMetaDesc")}
        path={`/orders/${id}`}
        noIndex
      />
      <BackLink as={Link} to="/orders">
        {t("orders.allOrders")}
      </BackLink>
      <SectionHead
        className="mt-3"
        eyebrow={t("nav.yourAccount")}
        title={product?.name || t("account.orderFallback")}
      />
      <div className="mt-5">
        {loading && <Skeleton className="h-64" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && <OrderDetailView tx={data} productName={product?.name} />}
      </div>
    </PageTransition>
  );
}
