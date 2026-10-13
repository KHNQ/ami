import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { adminApi as api } from "../lib/adminApi.js";
import { cn } from "@shared/lib/cn.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Avatar } from "@shared/components/ui/Avatar.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { money } from "@shared/lib/format.js";

// One person's place in the referral network, drawn as a tree.
//
// For each product they have joined: the chain of sponsors above them, and
// everyone below, nested. The person being viewed is highlighted so you can
// find yourself in a deep tree, and a branch can be folded away -- a real
// network is wide, and the useful view is usually "this branch, not all of it".
//
// Connectors are plain borders (a rail down the inline-start edge of each
// level) rather than SVG, so the tree reflows at any width and mirrors in RTL
// with no extra code.

function Person({ n, focus, toggle, open, hasKids }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-2.5 py-2",
        focus ? "border-brand-green/50 bg-brand-green/8" : "border-surface/10 bg-surface/[0.025]"
      )}
    >
      {hasKids ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? "Collapse branch" : "Expand branch"}
          aria-expanded={open}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg/50 hover:bg-surface/10"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} className="rtl:rotate-180" />}
        </button>
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden />
      )}
      <Avatar name={n.name} size={28} />
      <div className="min-w-0 flex-1">
        <Link to={`/users/${n.user_id}/network`} className="block truncate text-[13px] font-bold text-fg hover:underline">
          {n.name}
        </Link>
        <div className="truncate text-[11px] text-fg/40">{n.email}</div>
      </div>
      <div className="hidden shrink-0 text-end sm:block">
        <div className="text-[11.5px] font-semibold tabular-nums text-fg/70">{money(n.lifetime_volume_cents ?? 0)}</div>
        {n.child_count > 0 && <div className="text-[10.5px] text-fg/35">{n.child_count} direct</div>}
      </div>
      {n.status && n.status !== "active" && <Badge tone="neutral">{n.status}</Badge>}
    </div>
  );
}

function Branch({ node, focusId, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children || [];
  return (
    <li>
      <Person
        n={node}
        focus={node.user_id === focusId}
        hasKids={kids.length > 0}
        open={open}
        toggle={() => setOpen((o) => !o)}
      />
      {kids.length > 0 && open && (
        <ul className="ms-3 mt-1.5 flex flex-col gap-1.5 border-s border-surface/15 ps-3.5">
          {kids.map((k) => (
            <Branch key={k.node_id} node={k} focusId={focusId} depth={depth + 1} />
          ))}
        </ul>
      )}
      {node.truncated && open && (
        <p className="ms-3 mt-1.5 ps-3.5 text-[11.5px] text-fg/40">
          Deeper levels not shown here — open {node.name}'s own network to continue.
        </p>
      )}
    </li>
  );
}

export default function NetworkTreePage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = useAsync(() => api.userNetwork(id, { depth: 12 }), [id]);

  return (
    <>
      <PageTitle title="Admin · Network" />
      <PageHeader
        title={data ? `${data.user.name}'s network` : "Network"}
        description={data?.user.email}
        actions={
          <Link to="/users" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-blue hover:underline">
            <ArrowLeft size={13} className="rtl:rotate-180" /> People
          </Link>
        }
      />
      <PageBody>
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && data.memberships.length === 0 && (
          <EmptyState
            title="Not in a network yet"
            description="This person has not bought a device, so they have no position in any referral tree."
          />
        )}
        <div className="flex flex-col gap-4">
          {data?.memberships.map((m) => (
            <Card key={m.node_id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14.5px] font-extrabold text-fg">{m.product_name || "Unknown product"}</h2>
                <Badge tone="neutral">{m.downline_size} in downline</Badge>
                <span className="text-[12px] text-fg/40">lifetime {money(m.lifetime_volume_cents)}</span>
              </div>

              <div className="mt-3">
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg/35">
                  Sponsor chain
                </div>
                {m.upline.length === 0 ? (
                  <p className="text-[12.5px] text-fg/45">Founder of this tree — nobody above.</p>
                ) : (
                  <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {[...m.upline].reverse().map((u) => (
                      <li key={u.node_id} className="flex items-center gap-1.5">
                        <Link to={`/users/${u.user_id}/network`} className="rounded-lg border border-surface/10 px-2 py-1 font-semibold text-fg/80 hover:bg-surface/8">
                          {u.name}
                        </Link>
                        <ChevronRight size={12} className="text-fg/25 rtl:rotate-180" aria-hidden />
                      </li>
                    ))}
                    <li className="rounded-lg border border-brand-green/40 bg-brand-green/8 px-2 py-1 font-bold text-fg">
                      {data.user.name}
                    </li>
                  </ol>
                )}
              </div>

              <div className="mt-4">
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg/35">
                  Tree
                </div>
                <ul>
                  <Branch node={m.tree} focusId={data.user.id} />
                </ul>
              </div>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
