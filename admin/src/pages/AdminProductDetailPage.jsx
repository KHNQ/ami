import { useEffect, useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { useParams } from "react-router-dom";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { TopBar } from "@shared/components/layout/TopBar.jsx";
import { Card } from "@shared/components/ui/Card.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { LeaseRulesEditor, formToRules, rulesToForm } from "../components/LeaseRulesEditor.jsx";
import { StatusBadge } from "@shared/components/ui/Badge.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";
import { ImagePicker } from "../components/ui/ImagePicker.jsx";
import { money } from "@shared/lib/format.js";

export default function AdminProductDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: product, loading, error, refetch } = useAsync(() => api.getProduct(id), [id]);

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <PageTitle title="Admin · Product" />
      <TopBar back title={product?.name || "Product"} right={product && <StatusBadge status={product.status} />} />
      <div className="flex-1 px-5 pb-16 pt-2">
        {loading && <Skeleton className="h-64" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {product && (
          <div className="flex flex-col gap-4">
            <StatusSection product={product} onSaved={refetch} toast={toast} />
            <ProductImageSection product={product} onSaved={refetch} toast={toast} />
            <PricingSection product={product} onSaved={refetch} toast={toast} />
            <StockSection product={product} onSaved={refetch} toast={toast} />
            <LeaseSection product={product} onSaved={refetch} toast={toast} />
            {product.commission_plan && (
              <CommissionPlanSection productId={product.id} plan={product.commission_plan} onSaved={refetch} toast={toast} />
            )}
            <RankTiersSection productId={product.id} toast={toast} />
            <RankBonusPeriodsSection productId={product.id} toast={toast} />
            <QuotaTiersSection productId={product.id} toast={toast} />
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-[13px] font-bold uppercase tracking-wide text-fg/40">{title}</div>
      {children}
    </Card>
  );
}

function ProductImageSection({ product, onSaved, toast }) {
  const [saving, setSaving] = useState(false);

  async function save(imageDataUrl) {
    setSaving(true);
    try {
      // Only the changed key: the API merges specs over what's stored, so
      // spreading the read-back object would just write the derived
      // `image_url` back into storage.
      await api.updateProduct(product.id, { specs: { image_data_url: imageDataUrl } });
      toast.success("Product image updated");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Product image">
      <ImagePicker imageDataUrl={api.productImageUrl(product)} onChange={save} />
      {saving && <p className="mt-2 text-[12px] text-fg/40">Saving...</p>}
    </SectionCard>
  );
}

function StatusSection({ product, onSaved, toast }) {
  const [loading, setLoading] = useState(false);
  async function toggle() {
    setLoading(true);
    try {
      await api.updateProductStatus(product.id, { status: product.status === "active" ? "discontinued" : "active" });
      toast.success("Status updated");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <SectionCard title="Availability">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] text-fg/70">Currently {product.status}</div>
        <Button size="sm" variant="secondary" loading={loading} onClick={toggle}>
          {product.status === "active" ? "Discontinue" : "Reactivate"}
        </Button>
      </div>
    </SectionCard>
  );
}

function PricingSection({ product, onSaved, toast }) {
  const [y, setY] = useState((product.list_price_y_cents / 100).toFixed(2));
  const [newX, setNewX] = useState("");
  const [savingY, setSavingY] = useState(false);
  const [savingX, setSavingX] = useState(false);
  const { data: history, refetch: refetchHistory } = useAsync(() => api.getWarehouseCostHistory(product.id), [product.id]);

  async function saveY() {
    setSavingY(true);
    try {
      await api.updateProductPrice(product.id, { y_cents: Math.round(parseFloat(y) * 100) });
      toast.success("Price updated");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingY(false);
    }
  }

  async function saveX() {
    setSavingX(true);
    try {
      await api.appendWarehouseCost(product.id, { x_cents: Math.round(parseFloat(newX) * 100) });
      toast.success("Warehouse cost updated");
      setNewX("");
      onSaved();
      refetchHistory();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingX(false);
    }
  }

  return (
    <SectionCard title="Pricing">
      <div className="mb-3 text-[12px] text-fg/40">
        Current warehouse cost (x): <span className="font-bold text-fg/70">{money(product.current_x_cents)}</span>
      </div>
      <div className="flex items-end gap-2">
        <Input label="List price (y)" prefix="$" type="number" step="0.01" value={y} onChange={(e) => setY(e.target.value)} />
        <Button size="sm" loading={savingY} onClick={saveY}>
          Save
        </Button>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <Input label="New warehouse cost" prefix="$" type="number" step="0.01" placeholder="e.g. 42.00" value={newX} onChange={(e) => setNewX(e.target.value)} />
        <Button size="sm" variant="secondary" loading={savingX} disabled={!newX} onClick={saveX}>
          Append
        </Button>
      </div>
      {history && history.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-[12px] font-semibold text-fg/40">Cost history</div>
          <div className="flex flex-col gap-1.5">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-[12px]">
                <span className="text-fg/60">{new Date(h.effective_from).toLocaleString()}</span>
                <span className="font-semibold text-fg">{money(h.x_cents)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function LeaseSection({ product, onSaved, toast }) {
  const stored = product.specs?.lease_rules ?? null;
  const [form, setForm] = useState(() => rulesToForm(stored));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    let rules;
    try {
      rules = formToRules(form);
    } catch (err) {
      setError(err.message);
      return;
    }
    setSaving(true);
    try {
      await api.updateProduct(product.id, { lease_rules: rules });
      toast.success("Lease terms saved");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function useDefaults() {
    setSaving(true);
    try {
      await api.updateProduct(product.id, { lease_rules: null });
      setForm(rulesToForm(null));
      toast.success("Reset to the standard 12 / 24 / 36 / 48 month terms");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Lease terms">
      {!stored && (
        <p className="mb-3 text-[12px] text-fg/40">
          No terms set: this product uses the standard 12 / 24 / 36 / 48 month terms at the site's default APR.
        </p>
      )}
      <LeaseRulesEditor value={form} onChange={setForm} />
      {error && <p className="mt-3 text-[13px] font-medium text-red-400">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button loading={saving} onClick={save}>
          Save lease terms
        </Button>
        {stored && (
          <Button variant="secondary" disabled={saving} onClick={useDefaults}>
            Use standard terms
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

function StockSection({ product, onSaved, toast }) {
  const [loading, setLoading] = useState(false);
  async function adjust(delta) {
    setLoading(true);
    try {
      await api.adjustStock(product.id, { delta });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <SectionCard title="Stock">
      <div className="flex items-center justify-between">
        <div className="text-[22px] font-extrabold text-fg">{product.stock_count}</div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={loading} onClick={() => adjust(-10)}>
            -10
          </Button>
          <Button size="sm" variant="secondary" loading={loading} onClick={() => adjust(10)}>
            +10
          </Button>
          <Button size="sm" variant="secondary" loading={loading} onClick={() => adjust(100)}>
            +100
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function CommissionPlanSection({ productId, plan, onSaved, toast }) {
  const [payoutPoolPct, setPayoutPoolPct] = useState(plan.payout_pool_pct_bp / 100);
  const [reservePct, setReservePct] = useState(plan.reserve_pct_bp / 100);
  const [minMargin, setMinMargin] = useState(plan.min_margin_threshold_cents / 100);
  const [maxDepth, setMaxDepth] = useState(plan.max_payout_depth);
  const [levelRates, setLevelRates] = useState(plan.level_rates_bp.map((r) => r / 100).join(", "));
  const [activityMinPv, setActivityMinPv] = useState(plan.activity_min_pv_cents / 100);
  const [activityPeriodDays, setActivityPeriodDays] = useState(plan.activity_period_days);
  const [decayDays, setDecayDays] = useState(plan.decay_inactive_days);
  const [decayPct, setDecayPct] = useState(plan.decay_pct_per_period_bp / 100);
  const [rankBonusPoolPct, setRankBonusPoolPct] = useState((plan.rank_bonus_pool_pct_bp || 0) / 100);
  const [payoutMode, setPayoutMode] = useState(plan.payout_mode || "wallet");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setPayoutPoolPct(plan.payout_pool_pct_bp / 100);
    setReservePct(plan.reserve_pct_bp / 100);
    setMinMargin(plan.min_margin_threshold_cents / 100);
    setMaxDepth(plan.max_payout_depth);
    setLevelRates(plan.level_rates_bp.map((r) => r / 100).join(", "));
    setActivityMinPv(plan.activity_min_pv_cents / 100);
    setActivityPeriodDays(plan.activity_period_days);
    setDecayDays(plan.decay_inactive_days);
    setDecayPct(plan.decay_pct_per_period_bp / 100);
    setRankBonusPoolPct((plan.rank_bonus_pool_pct_bp || 0) / 100);
    setPayoutMode(plan.payout_mode || "wallet");
  }, [plan]);

  const rateArray = levelRates
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Math.round(parseFloat(s) * 100));
  const rateSum = rateArray.reduce((a, b) => a + b, 0);
  const poolBp = Math.round(payoutPoolPct * 100);
  const overCap = rateSum > poolBp;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await api.updateCommissionPlan(productId, {
        payout_pool_pct_bp: poolBp,
        reserve_pct_bp: Math.round(reservePct * 100),
        min_margin_threshold_cents: Math.round(minMargin * 100),
        max_payout_depth: Number(maxDepth),
        level_rates_bp: rateArray,
        activity_min_pv_cents: Math.round(activityMinPv * 100),
        activity_period_days: Number(activityPeriodDays),
        decay_inactive_days: Number(decayDays),
        decay_pct_per_period_bp: Math.round(decayPct * 100),
        rank_bonus_pool_pct_bp: Math.round(rankBonusPoolPct * 100),
        payout_mode: payoutMode,
      });
      toast.success("Commission plan saved");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Commission plan">
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <Input label="Payout pool %" type="number" step="0.1" value={payoutPoolPct} onChange={(e) => setPayoutPoolPct(e.target.value)} />
          <Input label="Reserve % (of net)" type="number" step="0.1" value={reservePct} onChange={(e) => setReservePct(e.target.value)} />
        </div>
        <Input
          label="Level rates % (comma separated, level 1 → N)"
          value={levelRates}
          onChange={(e) => setLevelRates(e.target.value)}
          error={overCap ? `Sum ${(rateSum / 100).toFixed(1)}% exceeds payout pool ${(poolBp / 100).toFixed(1)}%` : undefined}
        />
        <div className="flex gap-3">
          <Input label="Max payout depth" type="number" value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} />
          <Input label="Min margin ($)" type="number" step="0.01" value={minMargin} onChange={(e) => setMinMargin(e.target.value)} />
        </div>
        <div className="mt-1 text-[12px] font-semibold text-fg/40">Activity & decay</div>
        <div className="flex gap-3">
          <Input label="Min PV / period ($)" type="number" step="0.01" value={activityMinPv} onChange={(e) => setActivityMinPv(e.target.value)} />
          <Input label="Period (days)" type="number" value={activityPeriodDays} onChange={(e) => setActivityPeriodDays(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <Input label="Decay after (days)" type="number" value={decayDays} onChange={(e) => setDecayDays(e.target.value)} />
          <Input label="Decay % / period" type="number" step="0.1" value={decayPct} onChange={(e) => setDecayPct(e.target.value)} />
        </div>
        <div className="mt-1 text-[12px] font-semibold text-fg/40">Direct/indirect margin payout mode</div>
        <SegmentedControl
          value={payoutMode}
          onChange={setPayoutMode}
          options={[
            { value: "wallet", label: "Pay to wallet" },
            { value: "quota", label: "Fill quota tiers" },
          ]}
        />
        {payoutMode === "quota" && (
          <p className="text-[11.5px] text-fg/40">
            Ancestor margin shares are redirected into quota-tier progress instead of a pending wallet payout.
            Configure Blue/Silver/Gold/Platinum/Diamond tiers below.
          </p>
        )}
        <div className="mt-1 text-[12px] font-semibold text-fg/40">Rank / leadership bonus</div>
        <Input
          label="Rank bonus pool % (of period trex_net)"
          type="number"
          step="0.1"
          value={rankBonusPoolPct}
          onChange={(e) => setRankBonusPoolPct(e.target.value)}
        />
        {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}
        <Button fullWidth loading={saving} disabled={overCap} onClick={save}>
          Save commission plan
        </Button>
      </div>
    </SectionCard>
  );
}

function RankTiersSection({ productId, toast }) {
  const { data: tiers, loading, error, refetch } = useAsync(() => api.listRankTiers(productId), [productId]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [rankOrder, setRankOrder] = useState("");
  const [teamVolume, setTeamVolume] = useState("");
  const [personalVolume, setPersonalVolume] = useState("");
  const [poolShare, setPoolShare] = useState("");

  async function addTier() {
    setAdding(true);
    try {
      await api.createRankTier(productId, {
        rank_order: Number(rankOrder),
        name,
        team_volume_threshold_cents: Math.round(parseFloat(teamVolume || "0") * 100),
        personal_volume_threshold_cents: Math.round(parseFloat(personalVolume || "0") * 100),
        pool_share_bp: Math.round(parseFloat(poolShare || "0") * 100),
      });
      toast.success("Rank tier added");
      setName("");
      setRankOrder("");
      setTeamVolume("");
      setPersonalVolume("");
      setPoolShare("");
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function toggleStatus(tier) {
    try {
      await api.updateRankTier(productId, tier.id, { status: tier.status === "active" ? "disabled" : "active" });
      refetch();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const poolShareSum = (tiers || []).reduce((a, t) => a + t.pool_share_bp, 0);

  return (
    <SectionCard title="Rank tiers">
      {loading && <Skeleton className="h-24" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {tiers && tiers.length === 0 && <EmptyState title="No rank tiers configured yet" />}
      {tiers && tiers.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-xl border border-surface/10 bg-surface/5 px-3 py-2">
              <div>
                <div className="text-[13.5px] font-bold text-fg">
                  #{t.rank_order} {t.name}
                </div>
                <div className="text-[11px] text-fg/40">
                  Team {money(t.team_volume_threshold_cents)} &middot; Personal {money(t.personal_volume_threshold_cents)} &middot;{" "}
                  {(t.pool_share_bp / 100).toFixed(1)}% of pool
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={t.status} />
                <Button size="sm" variant="secondary" onClick={() => toggleStatus(t)}>
                  {t.status === "active" ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          ))}
          {poolShareSum > 10000 && (
            <p className="text-[13px] font-medium text-red-400">
              Warning: active tier pool shares sum to {(poolShareSum / 100).toFixed(1)}%, over 100%.
            </p>
          )}
        </div>
      )}

      <div className="mt-1 text-[12px] font-semibold text-fg/40">Add a tier</div>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <Input label="Rank order" type="number" value={rankOrder} onChange={(e) => setRankOrder(e.target.value)} />
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Input label="Team volume threshold ($)" type="number" step="0.01" value={teamVolume} onChange={(e) => setTeamVolume(e.target.value)} />
          <Input label="Personal volume threshold ($)" type="number" step="0.01" value={personalVolume} onChange={(e) => setPersonalVolume(e.target.value)} />
        </div>
        <Input label="Pool share %" type="number" step="0.1" value={poolShare} onChange={(e) => setPoolShare(e.target.value)} />
        <Button size="sm" loading={adding} disabled={!name || !rankOrder || !poolShare} onClick={addTier}>
          Add tier
        </Button>
      </div>
    </SectionCard>
  );
}

function QuotaTiersSection({ productId, toast }) {
  const { data: tiers, loading, error, refetch } = useAsync(() => api.listQuotaTiers(productId), [productId]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [tierOrder, setTierOrder] = useState("");
  const [target, setTarget] = useState("");
  const [cashBonus, setCashBonus] = useState("");
  const [rateBonus, setRateBonus] = useState("");
  const [perks, setPerks] = useState("");

  async function addTier() {
    setAdding(true);
    try {
      await api.createQuotaTier(productId, {
        tier_order: Number(tierOrder),
        name,
        quota_target_cents: Math.round(parseFloat(target || "0") * 100),
        cash_bonus_cents: Math.round(parseFloat(cashBonus || "0") * 100),
        rate_bonus_bp: Math.round(parseFloat(rateBonus || "0") * 100),
        perks: perks.split(",").map((p) => p.trim()).filter(Boolean),
      });
      toast.success("Quota tier added");
      setName("");
      setTierOrder("");
      setTarget("");
      setCashBonus("");
      setRateBonus("");
      setPerks("");
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function toggleStatus(tier) {
    try {
      await api.updateQuotaTier(productId, tier.id, { status: tier.status === "active" ? "disabled" : "active" });
      refetch();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <SectionCard title="Quota tiers (Blue / Silver / Gold / Platinum / Diamond)">
      {loading && <Skeleton className="h-24" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {tiers && tiers.length === 0 && <EmptyState title="No quota tiers configured yet" />}
      {tiers && tiers.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {tiers.map((t) => (
            <div key={t.id} className="rounded-xl border border-surface/10 bg-surface/5 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-[13.5px] font-bold text-fg">
                  #{t.tier_order} {t.name}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <Button size="sm" variant="secondary" onClick={() => toggleStatus(t)}>
                    {t.status === "active" ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-fg/40">
                Target {money(t.quota_target_cents)} &middot; Cash bonus {money(t.cash_bonus_cents)} &middot; Rate +
                {(t.rate_bonus_bp / 100).toFixed(1)}%
                {t.perks?.length > 0 && <> &middot; Perks: {t.perks.join(", ")}</>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-1 text-[12px] font-semibold text-fg/40">Add a tier</div>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <Input label="Tier order" type="number" value={tierOrder} onChange={(e) => setTierOrder(e.target.value)} />
          <Input label="Name" placeholder="e.g. Blue" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Input label="Quota target ($)" type="number" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} />
        <div className="flex gap-2">
          <Input label="Cash bonus ($)" type="number" step="0.01" value={cashBonus} onChange={(e) => setCashBonus(e.target.value)} />
          <Input label="Rate bonus %" type="number" step="0.1" value={rateBonus} onChange={(e) => setRateBonus(e.target.value)} />
        </div>
        <Input label="Perks (comma separated)" placeholder="e.g. Free shipping, Priority support" value={perks} onChange={(e) => setPerks(e.target.value)} />
        <Button size="sm" loading={adding} disabled={!name || !tierOrder || !target} onClick={addTier}>
          Add tier
        </Button>
      </div>
    </SectionCard>
  );
}

function RankBonusPeriodsSection({ productId, toast }) {
  const { data: periods, loading, error, refetch } = useAsync(
    () => api.rankBonusPeriods({ product_id: productId, limit: 20 }),
    [productId]
  );
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [funding, setFunding] = useState(false);
  const [distributingId, setDistributingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  async function fund() {
    setFunding(true);
    try {
      await api.runJob("fund-rank-pool", {
        product_id: productId,
        period_start: new Date(start).toISOString(),
        period_end: new Date(end).toISOString(),
      });
      toast.success("Rank bonus pool funded");
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setFunding(false);
    }
  }

  async function distribute(periodId) {
    setDistributingId(periodId);
    try {
      await api.runJob("distribute-rank-bonuses", { period_id: periodId });
      toast.success("Rank bonuses distributed");
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDistributingId(null);
    }
  }

  return (
    <SectionCard title="Rank bonus periods">
      {loading && <Skeleton className="h-24" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {periods && periods.length === 0 && <EmptyState title="No rank bonus periods funded yet" />}
      {periods && periods.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {periods.map((p) => (
            <div key={p.id} className="rounded-xl border border-surface/10 bg-surface/5 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-[12px] text-fg/50">
                  {new Date(p.period_start).toLocaleDateString()} &ndash; {new Date(p.period_end).toLocaleDateString()}
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-1 flex items-center justify-between">
                <div className="text-[13.5px] font-bold text-fg">
                  Pool {money(p.pool_amount_cents)}
                  {p.status !== "funded" && <span className="text-fg/40"> &middot; distributed {money(p.distributed_cents)}</span>}
                </div>
                {p.status === "funded" ? (
                  <Button size="sm" loading={distributingId === p.id} onClick={() => distribute(p.id)}>
                    Distribute
                  </Button>
                ) : (
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="text-[12px] font-semibold text-brand-green"
                  >
                    {expandedId === p.id ? "Hide entries" : "View entries"}
                  </button>
                )}
              </div>
              {expandedId === p.id && <PeriodEntries periodId={p.id} />}
            </div>
          ))}
        </div>
      )}

      <div className="mt-1 text-[12px] font-semibold text-fg/40">Fund a new period</div>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <Input label="Period start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="Period end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Button size="sm" variant="secondary" loading={funding} disabled={!start || !end} onClick={fund}>
          Fund pool from period's trex_net
        </Button>
      </div>
    </SectionCard>
  );
}

function PeriodEntries({ periodId }) {
  const { data, loading, error } = useAsync(() => api.rankBonusPeriodDetail(periodId), [periodId]);
  if (loading) return <Skeleton className="mt-2 h-10" />;
  if (error) return <p className="mt-2 text-[12px] text-red-400">{error.message}</p>;
  if (!data?.entries?.length) return <p className="mt-2 text-[12px] text-fg/40">No nodes qualified in this period.</p>;
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-surface/8 pt-2">
      {data.entries.map((e) => (
        <div key={e.id} className="flex items-center justify-between text-[11.5px]">
          <span className="font-mono text-fg/50">{e.node_id.slice(0, 14)}&hellip;</span>
          <span className="font-semibold text-fg">
            {money(e.amount_cents)} <span className="text-fg/40">({e.status})</span>
          </span>
        </div>
      ))}
    </div>
  );
}
