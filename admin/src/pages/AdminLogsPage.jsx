import { useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { adminApi as api } from "../lib/adminApi.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { fullDate, truncate } from "@shared/lib/format.js";

export default function AdminLogsPage() {
  const [action, setAction] = useState("");
  const { data, loading, error, refetch } = useAsync(() => api.logs({ action: action || undefined, limit: 100 }), [action]);

  return (
    <>
      <PageHeader title="Audit log" description="Every privileged action, and who took it." />
      <PageBody>
      <PageTitle title="Admin · Logs" />
      <Input placeholder="Filter by action, e.g. purchase.completed" value={action} onChange={(e) => setAction(e.target.value)} />
      <div className="mt-4">
        {loading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && data.length === 0 && <EmptyState title="No log entries" />}
        <Card className="divide-y divide-surface/6">
          {data?.map((log) => (
            <div key={log.id} className="p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12.5px] font-bold text-brand-green">{log.action}</span>
                <span className="text-[10.5px] text-fg/35">{fullDate(log.created_at)}</span>
              </div>
              <div className="mt-1 text-[11.5px] text-fg/40">
                {log.entity_type && `${log.entity_type} · `}
                {log.entity_id && truncate(log.entity_id, 28)}
              </div>
              {log.actor_user_id && (
                <div className="mt-0.5 font-mono text-[10.5px] text-fg/25">by {truncate(log.actor_user_id, 24)}</div>
              )}
            </div>
          ))}
        </Card>
      </div>
    </PageBody>
    </>
  );
}
