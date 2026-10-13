import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GitBranch, Plus, Users2, TrendingUp, Award, Target, Link2 } from "lucide-react";
import { useAsync } from "../hooks/useAsync.js";
import { useToast } from "../context/ToastContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";

import { PageTransition } from "../components/layout/PageTransition.jsx";
import { BackLink, SectionHead } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { ErrorState } from "../components/ui/ErrorState.jsx";
import { StatusBadge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { BottomSheet } from "../components/ui/BottomSheet.jsx";
import { SegmentedControl } from "../components/ui/SegmentedControl.jsx";
import { money, fullDate, shortDate } from "../lib/format.js";
import { useT } from "../i18n/I18nProvider.jsx";
import { useCatalogue } from "../b2b/context/CatalogContext.jsx";
import { referralLink } from "../lib/referral.js";

export default function NodeDetailPage() {
  const t = useT();
  const { nodeId } = useParams();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { data: node, loading, error, refetch } = useAsync(() => api.getNode(nodeId), [nodeId]);
  const { data: codes, refetch: refetchCodes } = useAsync(() => api.getNodeRedeemCodes(nodeId), [nodeId]);
  const [tab, setTab] = useState("downline");
  const [sheetOpen, setSheetOpen] = useState(false);
  const { devices } = useCatalogue();

  // The page a shared link should open: this node's device on the storefront.
  // A product with no storefront device (the starter kits) is bought from its
  // own product page, which takes the same `ref` parameter.
  function shareLink(code) {
    const device = devices.find((d) => d.productId === node?.product_id);
    const origin = window.location.origin;
    if (device) return referralLink(origin, device.id, code);
    return `${origin}/products/${encodeURIComponent(node.product_id)}?ref=${encodeURIComponent(code)}`;
  }

  async function copyLink(code) {
    const url = shareLink(code);
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("network.linkCopied"));
    } catch {
      // Clipboard blocked (insecure origin, denied permission): show the link
      // so it can still be selected and copied by hand.
      window.prompt(t("network.copyLinkManual"), url);
    }
  }

  return (
    <PageTransition className="b2b-container flex-1 py-8">
      <PageMeta
        title={t("network.nodeTitle")}
        description={t("network.nodeMetaDesc")}
        path="/network"
        noIndex
      />
      <BackLink as={Link} to="/network">
        {t("nav.network")}
      </BackLink>
      <SectionHead
        className="mt-3"
        eyebrow={t("nav.yourAccount")}
        title={t("network.nodeTitle")}
      />
      <div className="mt-5">
        {loading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-40" />
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {node && (
          <>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                  <GitBranch size={13} />{" "}
                  {node.parent_node_id ? t("network.memberNode") : t("network.rootNode")}
                </div>
                <StatusBadge status={node.status} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
                <MiniStat label={t("network.lifetime")} value={money(node.lifetime_volume_cents)} />
                <MiniStat
                  label={t("network.thisPeriod")}
                  value={money(node.personal_volume_period_cents)}
                />
                <MiniStat label={t("network.joined")} value={shortDate(node.joined_at)} />
              </div>
              <Link to={`/space/${node.space_id}`} className="mt-3 block">
                <Button variant="secondary" size="sm" fullWidth>
                  {t("network.viewTree")}
                </Button>
              </Link>
            </Card>

            {isAdmin && <AdminNodeControl node={node} onChanged={refetch} toast={toast} />}

            <RankCard nodeId={nodeId} />
            <QuotaCard nodeId={nodeId} />

            <div className="mt-5 flex items-center justify-between">
              <div className="text-[14px] font-extrabold text-ink">{t("network.yourCodes")}</div>
              <button onClick={() => setSheetOpen(true)} className="flex items-center gap-1 text-[12.5px] font-semibold text-brand-green">
                <Plus size={14} /> {t("network.newCode")}
              </button>
            </div>
            <div className="mt-2.5 flex flex-col gap-2">
              {!codes && <Skeleton className="h-14" />}
              {codes?.map((c) => (
                <Card key={c.id} className="flex items-center justify-between p-3.5">
                  <div>
                    <div className="font-mono text-[13.5px] font-bold tracking-wide text-ink">{c.code}</div>
                    <div className="mt-0.5 text-[11px] text-ink-2">
                      {t("network.usesCount", { count: c.uses_count })}
                      {c.max_uses
                        ? t("network.usesMax", { max: c.max_uses })
                        : t("network.usesUnlimited")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.status} />
                    {c.status === "active" && (
                      <button
                        onClick={() => copyLink(c.code)}
                        className="flex items-center gap-1 text-[11.5px] font-semibold text-brand-green"
                      >
                        <Link2 size={12} /> {t("network.copyLink")}
                      </button>
                    )}
                    {c.status === "active" && (
                      <button
                        onClick={async () => {
                          await api.revokeRedeemCode(c.id);
                          toast.success(t("network.codeRevoked"));
                          refetchCodes();
                        }}
                        className="text-[11.5px] font-semibold text-red-600 dark:text-red-300"
                      >
                        {t("network.revoke")}
                      </button>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <div className="mt-6">
              <SegmentedControl
                value={tab}
                onChange={setTab}
                options={[
                  { value: "downline", label: t("network.tabDownline") },
                  { value: "earnings", label: t("network.tabEarnings") },
                  { value: "rank_bonuses", label: t("network.tabRankBonuses") },
                  { value: "quota_bonuses", label: t("network.tabQuotaBonuses") },
                ]}
              />
            </div>
            <div className="mt-4">
              {tab === "downline" && <DownlinePanel nodeId={nodeId} />}
              {tab === "earnings" && <EarningsPanel nodeId={nodeId} />}
              {tab === "rank_bonuses" && <RankBonusesPanel nodeId={nodeId} />}
              {tab === "quota_bonuses" && <QuotaBonusesPanel nodeId={nodeId} />}
            </div>
          </>
        )}
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t("network.generateCode")}
      >
        <NewCodeForm
          onSubmit={async ({ maxUses, expiresAt }) => {
            await api.generateRedeemCode({
              product_id: node.product_id,
              max_uses: maxUses || undefined,
              expires_at: expiresAt || undefined,
            });
            toast.success(t("network.codeGenerated"));
            setSheetOpen(false);
            refetchCodes();
          }}
        />
      </BottomSheet>
    </PageTransition>
  );
}

function AdminNodeControl({ node, onChanged, toast }) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function setStatus(status) {
    if (status === node.status) return;
    setSaving(true);
    try {
      await api.setNodeStatus(node.id, { status });
      toast.success(t("network.nodeMarked", { status: t(`status.${status}`) }));
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-3 p-4">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">
        {t("network.adminNodeStatus")}
      </div>
      <SegmentedControl
        value={node.status}
        onChange={saving ? () => {} : setStatus}
        options={[
          { value: "active", label: t("status.active") },
          { value: "inactive", label: t("status.inactive") },
          { value: "suspended", label: t("status.suspended") },
        ]}
      />
    </Card>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl bg-panel-2 p-2.5 text-center">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-[12.5px] font-bold text-ink">{value}</div>
    </div>
  );
}

function NewCodeForm({ onSubmit }) {
  const t = useT();
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handle() {
    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        maxUses: maxUses ? Number(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t("network.maxUses")}
        type="number"
        inputMode="numeric"
        placeholder={t("network.unlimited")}
        value={maxUses}
        onChange={(e) => setMaxUses(e.target.value)}
      />
      <Input
        label={t("network.expiresOn")}
        type="date"
        value={expiresAt}
        onChange={(e) => setExpiresAt(e.target.value)}
      />
      {error && <p className="text-[13px] font-medium text-red-600 dark:text-red-300">{error}</p>}
      <Button size="lg" fullWidth loading={loading} onClick={handle}>
        {t("network.generateCta")}
      </Button>
    </div>
  );
}

function DownlinePanel({ nodeId }) {
  const t = useT();
  const { data, loading, error, refetch } = useAsync(() => api.getNodeDownline(nodeId, { limit: 50 }), [nodeId]);
  if (loading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data || data.length === 0)
    return (
      <EmptyState
        icon={<Users2 />}
        title={t("network.noDownlineTitle")}
        description={t("network.noDownlineBody")}
      />
    );
  return (
    <Card className="divide-y divide-line">
      {data.map((n) => (
        <div key={n.id} className="flex items-center justify-between p-3.5">
          <div>
            <div className="text-[13px] font-bold text-ink">
              {t("network.memberLabel", { id: n.id.slice(-6) })}
            </div>
            <div className="text-[11px] text-ink-2">
              {t("network.joinedOn", { date: shortDate(n.joined_at) })}
            </div>
          </div>
          <div className="text-end">
            <div className="text-[12.5px] font-bold text-ink">{money(n.lifetime_volume_cents)}</div>
            <StatusBadge status={n.status} className="mt-1" />
          </div>
        </div>
      ))}
    </Card>
  );
}

function EarningsPanel({ nodeId }) {
  const t = useT();
  const { data, loading, error, refetch } = useAsync(() => api.getNodeEarnings(nodeId, { limit: 50 }), [nodeId]);
  if (loading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const entries = data?.entries || [];
  const totals = data?.totals || {};
  return (
    <>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <MiniStat label={t("network.total")} value={money(totals.total_cents || 0)} />
        <MiniStat label={t("network.paid")} value={money(totals.paid_cents || 0)} />
        <MiniStat label={t("network.pending")} value={money(totals.pending_cents || 0)} />
      </div>
      {entries.length === 0 ? (
        <EmptyState
          icon={<TrendingUp />}
          title={t("network.noCommissionsTitle")}
          description={t("network.noCommissionsBody")}
        />
      ) : (
        <Card className="divide-y divide-line">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-3.5">
              <div>
                <div className="text-[13px] font-bold text-ink">
                  {t("network.levelCommission", { level: e.level_depth })}
                </div>
                <div className="text-[11px] text-ink-2">{fullDate(e.created_at)}</div>
              </div>
              <div className="text-end">
                <div className="text-[13.5px] font-extrabold text-emerald-700 dark:text-emerald-300">+{money(e.amount_cents)}</div>
                <StatusBadge status={e.status} className="mt-1" />
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function RankCard({ nodeId }) {
  const t = useT();
  const { data, loading, error } = useAsync(() => api.getNodeRank(nodeId), [nodeId]);
  if (loading) return <Skeleton className="mt-3 h-20" />;
  if (error || !data) return null;
  return (
    <Card className="mt-3 p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
        <Award size={13} /> {t("network.currentRank")}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[18px] font-extrabold text-ink">
          {data.current_tier ? data.current_tier.name : t("network.unranked")}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MiniStat label={t("network.teamVolume")} value={money(data.team_volume_cents)} />
        <MiniStat
          label={t("network.personalVolume")}
          value={money(data.personal_volume_cents)}
        />
      </div>
    </Card>
  );
}

function QuotaCard({ nodeId }) {
  const t = useT();
  const { data, loading, error } = useAsync(() => api.getNodeQuota(nodeId), [nodeId]);
  if (loading) return <Skeleton className="mt-3 h-24" />;
  if (error || !data) return null;
  const pct = data.next_tier
    ? Math.min(100, Math.round((data.accumulated_cents / data.next_tier.quota_target_cents) * 100))
    : 100;
  return (
    <Card className="mt-3 p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
        <Target size={13} /> {t("network.quotaProgress")}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[18px] font-extrabold text-ink">
          {data.current_tier ? data.current_tier.name : t("network.noTierYet")}
        </div>
        {data.unlocked_rate_bonus_bp > 0 && (
          <div className="text-[12px] font-bold text-brand-green">
            {t("network.ratePlus", {
              pct: (data.unlocked_rate_bonus_bp / 100).toFixed(1),
            })}
          </div>
        )}
      </div>
      {data.next_tier ? (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-2">
            <span>
              {t("network.towardTier", {
                amount: money(data.accumulated_cents),
                tier: data.next_tier.name,
              })}
            </span>
            <span>{money(data.next_tier.quota_target_cents)}</span>
          </div>
        </>
      ) : (
        <div className="mt-2 text-[12px] text-ink-2">{t("network.allTiersDone")}</div>
      )}
    </Card>
  );
}

function QuotaBonusesPanel({ nodeId }) {
  const t = useT();
  const { data, loading, error, refetch } = useAsync(() => api.getNodeQuotaBonuses(nodeId, { limit: 50 }), [nodeId]);
  if (loading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Target />}
        title={t("network.noQuotaTitle")}
        description={t("network.noQuotaBody")}
      />
    );
  }
  return (
    <Card className="divide-y divide-line">
      {data.map((e) => (
        <div key={e.id} className="flex items-center justify-between p-3.5">
          <div>
            <div className="text-[13px] font-bold text-ink">
              {t("network.tierCompleted", { tier: e.tier_order })}
            </div>
            <div className="text-[11px] text-ink-2">{fullDate(e.completed_at)}</div>
          </div>
          <div className="text-end">
            <div className="text-[13.5px] font-extrabold text-emerald-700 dark:text-emerald-300">+{money(e.cash_bonus_cents)}</div>
            {e.rate_bonus_bp > 0 && (
              <div className="text-[11px] text-brand-green">
                {t("network.ratePlus", { pct: (e.rate_bonus_bp / 100).toFixed(1) })}
              </div>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

function RankBonusesPanel({ nodeId }) {
  const t = useT();
  const { data, loading, error, refetch } = useAsync(() => api.getNodeRankBonuses(nodeId, { limit: 50 }), [nodeId]);
  if (loading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Award />}
        title={t("network.noRankBonusTitle")}
        description={t("network.noRankBonusBody")}
      />
    );
  }
  return (
    <Card className="divide-y divide-line">
      {data.map((e) => (
        <div key={e.id} className="flex items-center justify-between p-3.5">
          <div>
            <div className="text-[13px] font-bold text-ink">{t("network.rankBonus")}</div>
            <div className="text-[11px] text-ink-2">{fullDate(e.created_at)}</div>
          </div>
          <div className="text-end">
            <div className="text-[13.5px] font-extrabold text-emerald-700 dark:text-emerald-300">+{money(e.amount_cents)}</div>
            <StatusBadge status={e.status} className="mt-1" />
          </div>
        </div>
      ))}
    </Card>
  );
}
