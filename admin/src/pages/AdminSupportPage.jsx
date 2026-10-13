import { useState } from "react";
import { Phone, Mail } from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { Card } from "@shared/components/ui/Card.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";
import { relativeTime } from "@shared/lib/format.js";

// The support inbox: requests from the contact form.
//
// Not a conversation -- there is no thread and no reply box. Someone reads the
// request, contacts the person using the details on it, and records what
// happened here with a status and a note.
const TONE = { new: "pink", in_progress: "neutral", resolved: "success", closed: "neutral" };
const LABEL = { new: "New", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
const NEXT = { new: "in_progress", in_progress: "resolved" };

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || "");
}

function RequestCard({ r, canWrite, onChanged }) {
  const toast = useToast();
  const [note, setNote] = useState(r.admin_note || "");
  const [saving, setSaving] = useState(false);

  async function update(patch) {
    setSaving(true);
    try {
      await api.updateSupportRequest(r.id, patch);
      await onChanged();
      toast.success("Updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const tel = /^[+\d][\d\s()-]{5,}$/.test(r.contact || "");

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-fg">{r.name}</div>
          <div className="mt-0.5 text-[12.5px] text-fg/55">
            {isEmail(r.contact) ? (
              <a href={`mailto:${r.contact}`} className="inline-flex items-center gap-1 hover:text-fg/80">
                <Mail size={12} /> {r.contact}
              </a>
            ) : tel ? (
              <a href={`tel:${r.contact.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 hover:text-fg/80" dir="ltr">
                <Phone size={12} /> {r.contact}
              </a>
            ) : (
              r.contact
            )}
          </div>
        </div>
        <Badge tone={TONE[r.status]}>{LABEL[r.status] || r.status}</Badge>
      </div>

      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg/70">{r.message}</p>

      <div className="text-[11.5px] text-fg/35">
        {relativeTime(r.created_at)}
        {r.user_id ? " · signed-in customer" : ""}
      </div>

      {canWrite && (
        <>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal note: who called, what was agreed…"
            className="w-full resize-y rounded-xl border border-surface/12 bg-surface/5 px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg/30 focus:border-brand-green/40"
          />
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            {note !== (r.admin_note || "") && (
              <button disabled={saving} onClick={() => update({ admin_note: note })} className="font-semibold text-brand-blue hover:underline">
                Save note
              </button>
            )}
            <span className="flex-1" />
            {NEXT[r.status] && (
              <button disabled={saving} onClick={() => update({ status: NEXT[r.status] })} className="font-semibold text-brand-blue hover:underline">
                Mark {LABEL[NEXT[r.status]].toLowerCase()}
              </button>
            )}
            {r.status !== "closed" && (
              <button disabled={saving} onClick={() => update({ status: "closed" })} className="text-fg/50 hover:text-fg/80">
                Close
              </button>
            )}
            {r.status === "closed" && (
              <button disabled={saving} onClick={() => update({ status: "new" })} className="text-fg/50 hover:text-fg/80">
                Reopen
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

export default function AdminSupportPage() {
  const { can } = useAdminAuth();
  const [status, setStatus] = useState("new");
  const { data, loading, error, refetch } = useAsync(
    () => api.listSupportRequests({ status: status === "all" ? undefined : status, limit: 100 }),
    [status]
  );
  const requests = data?.requests ?? [];
  const count = (s) => data?.summary?.find((x) => x.status === s)?.n ?? 0;

  return (
    <>
      <PageTitle title="Admin · Support" />
      <PageHeader
        title="Support requests"
        description={`${count("new")} new · ${count("in_progress")} in progress. Sent from the contact form; follow up using the details on each.`}
      />
      <PageBody>
        <SegmentedControl
          value={status}
          onChange={setStatus}
          options={[
            { value: "new", label: "New" },
            { value: "in_progress", label: "In progress" },
            { value: "resolved", label: "Resolved" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
        <div className="mt-4">
          {loading && (
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
          )}
          {error && <ErrorState error={error} onRetry={refetch} />}
          {data && requests.length === 0 && <EmptyState title="Nothing here" description="No support requests in this view." />}
          <div className="grid gap-3 xl:grid-cols-2">
            {requests.map((r) => (
              <RequestCard key={r.id} r={r} canWrite={can("support.write")} onChanged={refetch} />
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
