import { Link } from "react-router-dom";
import { ChevronRight, GitBranch } from "lucide-react";
import { useAsync } from "../hooks/useAsync.js";
import { api } from "../lib/api.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { ErrorState } from "../components/ui/ErrorState.jsx";
import { StatusBadge } from "../components/ui/Badge.jsx";
import { PillButton, SectionHead } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { money } from "../lib/format.js";
import { useT } from "../i18n/I18nProvider.jsx";

export default function NetworkPage() {
  const t = useT();
  const { data: nodes, loading, error, refetch } = useAsync(() => api.listMyNodes(), []);
  const { data: products } = useAsync(() => api.listProducts({ limit: 100 }), []);
  const productById = new Map((products || []).map((p) => [p.id, p]));

  return (
    <PageTransition className="b2b-container flex-1 py-8">
      <PageMeta
        title={t("nav.network")}
        description={t("network.listMetaDesc")}
        path="/network"
        noIndex
      />
      <SectionHead
        eyebrow={t("nav.yourAccount")}
        title={t("nav.network")}
        lead={t("network.listLead")}
      />

      <div className="mt-5">
        {loading && (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {nodes && nodes.length === 0 && (
          <EmptyState
            icon="🌱"
            title={t("network.noSpaceTitle")}
            description={t("network.noSpaceBody")}
            action={
              <PillButton as={Link} to="/devices" size="sm">
                {t("account.browseDevices")}
              </PillButton>
            }
          />
        )}
        <div className="flex flex-col gap-2.5">
          {nodes?.map((n) => {
            const product = productById.get(n.product_id);
            return (
              <Link to={`/network/${n.id}`} key={n.id}>
                <Card className="b2b-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-md font-black text-ink">
                        {product?.name || t("network.productFallback")}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-label text-ink-2">
                        <GitBranch size={12} />{" "}
                        {n.parent_node_id
                          ? t("network.joinedSpace")
                          : t("network.rootOfSpace")}
                      </div>
                    </div>
                    <StatusBadge status={n.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                    <Stat
                      label={t("network.lifetimeVolume")}
                      value={money(n.lifetime_volume_cents)}
                    />
                    <Stat
                      label={t("network.thisPeriod")}
                      value={money(n.personal_volume_period_cents)}
                    />
                    <ChevronRight size={16} className="text-ink-3 rtl:rotate-180" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </PageTransition>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-label font-bold tracking-wide text-ink-2 uppercase">{label}</div>
      <div className="b2b-tnum text-xs font-black text-ink">{value}</div>
    </div>
  );
}
