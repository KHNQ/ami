import { useState } from "react";
import { Link } from "react-router-dom";
import { Image as ImageIcon, Check, X } from "lucide-react";
import { adminApi } from "../lib/adminApi.js";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { money, shortDate } from "@shared/lib/format.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";

const TONE = { pending: "neutral", cleared: "success", bounced: "danger", cancelled: "neutral" };

// The due-date board. Ordered by due date ascending so whatever needs
// chasing today is at the top, which is the only ordering that matters for
// the person working this queue.
export default function ChequesPage() {
  const toast = useToast();
  const { can } = useAdminAuth();
  const [status, setStatus] = useState("pending");
  const { data, error, loading, refetch } = useAsync(
    () => adminApi.listCheques({ status: status === "all" ? undefined : status, limit: 200 }),
    [status]
  );

  async function settle(id, next) {
    try {
      await adminApi.setChequeStatus(id, next);
      await refetch();
      toast.success(next === "cleared" ? "Marked cleared" : "Marked bounced — the customer has been notified");
    } catch (err) {
      toast.error(err.message);
    }
  }

  const cheques = data?.cheques ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-[20px] font-extrabold text-fg">Cheques</h2>
          <p className="text-[13px] text-fg/45">
            Marking one cleared records that the bank honoured it. It does not move money — commission was booked
            when the order was signed.
          </p>
        </div>
        <SegmentedControl
          value={status}
          onChange={setStatus}
          options={[
            { value: "pending", label: "Pending" },
            { value: "cleared", label: "Cleared" },
            { value: "bounced", label: "Bounced" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : cheques.length === 0 ? (
        <EmptyState title="Nothing here" description={`No ${status === "all" ? "" : status} cheques.`} />
      ) : (
        <Card className="table-scroll p-1">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Due</th>
                <th>Amount</th>
                <th>Cheque</th>
                <th>Bank</th>
                <th>Order</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cheques.map((c) => {
                const overdue = c.status === "pending" && c.due_date < today;
                return (
                  <tr key={c.id}>
                    <td className={overdue ? "font-bold text-red-400" : "text-fg/70"}>
                      {shortDate(c.due_date)}
                      {overdue && <span className="ms-1.5 text-[11px] uppercase">overdue</span>}
                    </td>
                    <td className="font-semibold text-fg">{money(c.amount_cents)}</td>
                    <td className="text-fg/60">{c.cheque_number || "—"}</td>
                    <td className="text-fg/60">{c.bank_name || "—"}</td>
                    <td>
                      <Link to={`/orders/${c.transaction_id}`} className="text-brand-blue hover:underline">
                        view
                      </Link>
                    </td>
                    <td>
                      <Badge tone={TONE[c.status]}>{c.status}</Badge>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        {c.has_image ? (
                          <a
                            href={adminApi.chequeImageUrl(c.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-fg/35 hover:text-fg/70"
                            title="View scan"
                          >
                            <ImageIcon size={15} />
                          </a>
                        ) : null}
                        {c.status === "pending" && can("cheques.write") && (
                          <>
                            <Button variant="ghost" onClick={() => settle(c.id, "cleared")} title="Mark cleared">
                              <Check size={14} />
                            </Button>
                            <Button variant="ghost" className="text-red-400" onClick={() => settle(c.id, "bounced")} title="Mark bounced">
                              <X size={14} />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
