import { Link, useParams } from "react-router-dom";
import { GitBranch, Users2 } from "lucide-react";
import { useAsync } from "../hooks/useAsync.js";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

import { PageTransition } from "../components/layout/PageTransition.jsx";
import { BackLink, SectionHead } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { ErrorState } from "../components/ui/ErrorState.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { SpaceTreeCanvas } from "../components/spaces/SpaceTreeCanvas.jsx";
import { shortDate } from "../lib/format.js";
import { useT } from "../i18n/I18nProvider.jsx";

function countNodes(node) {
  if (!node) return 0;
  return 1 + (node.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

function treeDepth(node) {
  if (!node) return 0;
  if (!node.children || node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(treeDepth));
}

export default function SpaceTreePage() {
  const t = useT();
  const { spaceId } = useParams();
  const { user, isAdmin } = useAuth();
  const { data: space } = useAsync(() => api.getSpace(spaceId), [spaceId]);
  const { data: product } = useAsync(() => (space ? api.getProduct(space.product_id) : Promise.resolve(null)), [space?.product_id]);
  const { data: tree, loading, error, refetch } = useAsync(() => api.getSpaceTree(spaceId), [spaceId]);

  return (
    <PageTransition className="b2b-container flex flex-1 flex-col py-8">
      <PageMeta
        title={t("space.treeTitle")}
        description={t("space.treeMetaDesc")}
        path="/network"
        noIndex
      />
      <BackLink as={Link} to="/network">
        {t("nav.network")}
      </BackLink>
      <SectionHead
        className="mt-3"
        eyebrow={t("nav.yourAccount")}
        title={t("space.treeTitle")}
      />
      <div className="mt-5 flex flex-1 flex-col">
        <Card className="shrink-0 p-4">
          <div className="flex items-center gap-1.5 text-2xs font-semibold text-brand-green">
            <GitBranch size={13} /> {product?.name || t("network.productFallback")}
          </div>
          <div className="mt-2 flex gap-4">
            <div>
              <div className="text-label font-medium uppercase tracking-wide text-ink-2">
                {t("space.members")}
              </div>
              <div className="flex items-center gap-1 text-md font-extrabold text-ink">
                <Users2 size={14} className="text-ink-2" /> {tree?.root ? countNodes(tree.root) : "—"}
              </div>
            </div>
            <div>
              <div className="text-label font-medium uppercase tracking-wide text-ink-2">
                {t("space.depth")}
              </div>
              <div className="text-md font-extrabold text-ink">{tree?.root ? treeDepth(tree.root) : "—"}</div>
            </div>
            <div>
              <div className="text-label font-medium uppercase tracking-wide text-ink-2">
                {t("space.created")}
              </div>
              <div className="text-md font-extrabold text-ink">{space ? shortDate(space.created_at) : "—"}</div>
            </div>
          </div>
        </Card>

        <div className="mt-4 min-h-0 flex-1">
          {loading && <Skeleton className="h-full min-h-[420px]" />}
          {error && <ErrorState error={error} onRetry={refetch} />}
          {tree && !tree.root && <EmptyState icon="🌱" title={t("space.noRoot")} />}
          {tree?.root && (
            <div className="h-[min(68dvh,640px)]">
              <SpaceTreeCanvas root={tree.root} currentUserId={user?.id} isAdmin={isAdmin} />
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
