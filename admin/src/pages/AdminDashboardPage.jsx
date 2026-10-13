import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Play, Vault, TrendingUp, LifeBuoy,
  Inbox, ArrowRight,
} from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { StatusBadge } from "@shared/components/ui/Badge.jsx";
import { money, relativeTime } from "@shared/lib/format.js";
import { adminApi as api } from "../lib/adminApi.js";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { StatTile, QueueTile } from "../components/ui/StatTile.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";

// The overview.
//
// Structured around the two questions someone actually opens this page to
// answer, in order:
//
//   1. "Is anything waiting for me?"  -> the queue row, first, and tinted
//      only when a count is non-zero.
//   2. "How is the business doing?"   -> the figures, with ONE hero number.
//
// The previous version was five same-sized tiles and a job list, which
// answered neither: pending requests sat in the same visual weight as
// all-time margin, so nothing was findable without reading everything.

export default function AdminDashboardPage() {
  const { data, loading, error, refetch } = useAsync(() => api.overview(), []);
  // Each queue is optional: a finance admin sees the dashboard but not the
  // support inbox, so a 403 here means "not yours", not "broken".
  const { can } = useAdminAuth();
  const { data: quotes } = useAsync(
    () => (can("sales.read") ? api.listQuotes({ status: "new", limit: 1 }).catch(() => null) : Promise.resolve(null)),
    []
  );
  const { data: support } = useAsync(
    () => (can("support.read_all") ? api.listSupportRequests({ status: "new", limit: 1 }).catch(() => null) : Promise.resolve(null)),
    []
  );
  const { data: payouts } = useAsync(
    () => (can("money.read") ? api.payouts().catch(() => null) : Promise.resolve(null)),
    []
  );
  const toast = useToast();
  const [running, setRunning] = useState(null);

  async function runJob(path, label) {
    setRunning(path);
    try {
      const holdDaysZero = path === "release-rank-bonuses";
      await api.runJob(path, { holdDays: holdDaysZero ? 0 : undefined });
      toast.success(`${label} complete`);
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <PageTitle title="Control Room" />
      <PageHeader
        title="Overview"
        description="Everything waiting, and how the business is tracking."
        actions={
          <Button size="sm" variant="secondary" onClick={refetch} loading={loading && Boolean(data)}>
            Refresh
          </Button>
        }
      />

      <PageBody className="space-y-7">
        {loading && !data && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {data && (
          <>
            {/* --- 1. what needs action --- */}
            <section>
              <SectionLabel>Needs attention</SectionLabel>
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <QueueTile
                  to="/proformas"
                  label="New proforma requests"
                  count={quotes?.summary?.quotes?.byStatus?.new ?? 0}
                  tone="critical"
                  icon={<Inbox size={16} />}
                />
                <QueueTile
                  to="/support"
                  label="New support requests"
                  count={support?.summary?.find((x) => x.status === "new")?.n ?? 0}
                  icon={<LifeBuoy size={16} />}
                />
              </div>
            </section>

            {/* --- 2. how the business is doing --- */}
            <section>
              <SectionLabel>Position</SectionLabel>
              <div className="grid gap-2.5 lg:grid-cols-4">
                {/* One hero number. Trex net is the figure the business is
                    actually run on, so it gets the size and the gradient and
                    nothing else competes with it. */}
                <StatTile
                  hero
                  tone="brand"
                  label="Trex net, all time"
                  value={money(data.trex_net_summary.total_trex_net_cents)}
                  sub={`across ${data.trex_net_summary.tx_count} transactions`}
                  icon={<TrendingUp size={15} />}
                  className="lg:col-span-2"
                />
                <StatTile
                  label="Total margin"
                  value={money(data.trex_net_summary.total_margin_cents)}
                  sub="gross, before payouts"
                />
                <StatTile
                  label="Reserve fund"
                  value={money(data.reserve_balance_cents)}
                  sub="development reserve"
                  icon={<Vault size={15} />}
                />
              </div>
            </section>

            {/* --- 3. recent activity, side by side --- */}
            <section className="grid gap-5 lg:grid-cols-2">
              <Panel
                title="Recent orders"
                action={<PanelLink to="/orders">All orders</PanelLink>}
                empty={data.transactions_recent.length === 0 && "No transactions yet"}
              >
                {data.transactions_recent.map((tx) => (
                  <Link
                    key={tx.id}
                    to={`/orders/${tx.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface/[0.04]"
                  >
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold tabular-nums text-fg">{money(tx.y_at_sale_cents)}</div>
                      <div className="text-[11.5px] text-fg/35">
                        {tx.channel === "in_person" ? "Walk-in" : "Online"} · {relativeTime(tx.created_at)}
                      </div>
                    </div>
                    <StatusBadge status={tx.status} />
                  </Link>
                ))}
              </Panel>

              <Panel
                title="Recent sign-ups"
                action={<PanelLink to="/users">All users</PanelLink>}
                empty={data.users_recent.length === 0 && "No users yet"}
              >
                {data.users_recent.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-fg">{u.name}</div>
                      <div className="truncate text-[11.5px] text-fg/35">{u.email}</div>
                    </div>
                    <StatusBadge status={u.status} />
                  </div>
                ))}
              </Panel>
            </section>

            {/* --- 4. operations --- */}
            <section>
              <SectionLabel>Scheduled jobs</SectionLabel>
              <div className="grid gap-2.5 lg:grid-cols-3">
                <JobCard
                  title="Recalculate activity"
                  description="Rolls PV counters once the activity period has elapsed"
                  onRun={() => runJob("recalculate-activity", "Activity recalculation")}
                  loading={running === "recalculate-activity"}
                />
                {/* Commission is no longer a one-button batch. Releasing every
                    matured commission at once credited wallets for people the
                    company pays by hand -- the same money twice -- and gave no
                    way to see who was being paid what. It is settled one
                    person at a time on the payouts page, with the amount on
                    screen and the admin's name in the log. */}
                {can("money.read") && <PayoutsCard payouts={payouts} />}
                <JobCard
                  title="Release rank bonuses"
                  description="Moves matured rank and leadership bonuses to paid"
                  onRun={() => runJob("release-rank-bonuses", "Rank bonus release")}
                  loading={running === "release-rank-bonuses"}
                />
              </div>
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}

function SectionLabel({ children }) {
  return (
    <h2 className="mb-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-fg/30">{children}</h2>
  );
}

function Panel({ title, action, children, empty }) {
  return (
    <div className="overflow-hidden rounded-xl border border-surface/8">
      <div className="flex items-center justify-between border-b border-surface/8 px-4 py-2.5">
        <h3 className="text-[13px] font-bold text-fg">{title}</h3>
        {action}
      </div>
      {empty ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-fg/35">{empty}</p>
      ) : (
        <div className="divide-y divide-surface/6">{children}</div>
      )}
    </div>
  );
}

function PanelLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-blue hover:underline">
      {children} <ArrowRight size={12} />
    </Link>
  );
}

function PayoutsCard({ payouts }) {
  const owed = payouts?.total?.display;
  const people = payouts?.people_count ?? 0;
  return (
    <Link
      to="/payouts"
      className="flex items-center gap-3 rounded-xl border border-surface/8 bg-surface/[0.02] p-3.5 transition-colors hover:bg-surface/[0.05]"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold text-fg">Pay commissions</div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-fg/40">
          {payouts
            ? people === 0
              ? "Nothing is owed right now"
              : `${owed} owed to ${people} ${people === 1 ? "person" : "people"} — paid one at a time`
            : "Pay each person what they are owed, and log it"}
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-blue">
        Open <ArrowRight size={12} />
      </span>
    </Link>
  );
}

function JobCard({ title, description, onRun, loading }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-surface/8 bg-surface/[0.02] p-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold text-fg">{title}</div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-fg/40">{description}</div>
      </div>
      <Button size="sm" variant="secondary" loading={loading} onClick={onRun}>
        <Play size={13} /> Run
      </Button>
    </div>
  );
}
