import { useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { adminApi } from "../lib/adminApi.js";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { relativeTime } from "@shared/lib/format.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";

const TONE = { pending: "neutral", sent: "success", failed: "danger", cancelled: "neutral" };

// The outbound message queue. Worth having a screen for: messages are queued
// rather than sent inline, so without visibility a provider outage would look
// like silence rather than like a problem.
export default function NotificationsPage() {
  const toast = useToast();
  const { can } = useAdminAuth();
  const [status, setStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const { data, error, loading, refetch } = useAsync(
    () => adminApi.listNotifications({ status: status === "all" ? undefined : status, limit: 200 }),
    [status]
  );

  async function run(job, label) {
    setBusy(true);
    try {
      const res = await adminApi.runJob(job);
      await refetch();
      toast.success(`${label}: ${JSON.stringify(res)}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.notifications ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-[20px] font-extrabold text-fg">Messages</h2>
          <p className="text-[13px] text-fg/45">
            Queued, then delivered by a job. Re-running either job is safe — reminders are de-duplicated per cheque
            and stage.
          </p>
        </div>
        <SegmentedControl
          value={status}
          onChange={setStatus}
          options={[
            { value: "pending", label: "Queued" },
            { value: "sent", label: "Sent" },
            { value: "failed", label: "Failed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {can("jobs.run") && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" loading={busy} onClick={() => run("queue-cheque-reminders", "Reminders queued")}>
            <RefreshCw size={14} /> Queue cheque reminders
          </Button>
          <Button variant="ghost" loading={busy} onClick={() => run("send-due-notifications", "Queue drained")}>
            <Send size={14} /> Send queued messages
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="Queue empty" description="No messages in this state." />
      ) : (
        <Card className="table-scroll p-1">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>To</th>
                <th>Template</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap text-fg/55">{relativeTime(n.created_at)}</td>
                  <td>
                    <Badge tone={n.channel === "sms" ? "pink" : "neutral"}>{n.channel}</Badge>
                  </td>
                  <td className="max-w-[220px] truncate text-fg/70">{n.recipient}</td>
                  <td className="text-fg/55">{n.template}</td>
                  <td>
                    <Badge tone={TONE[n.status]}>{n.status}</Badge>
                    {n.error && <div className="mt-0.5 max-w-[280px] truncate text-[11.5px] text-red-400">{n.error}</div>}
                  </td>
                  <td className="text-end">
                    {n.status === "failed" && can("jobs.run") && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await adminApi.retryNotification(n.id);
                            await refetch();
                            toast.success("Re-queued");
                          } catch (err) {
                            toast.error(err.message);
                          }
                        }}
                      >
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
