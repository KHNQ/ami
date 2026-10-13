import { useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { adminApi as api } from "../lib/adminApi.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { fullDate, truncate } from "@shared/lib/format.js";

// What the assistant DID, as opposed to what it said.
//
// The conversation log answers "what was this customer told"; this answers
// "what was done to their account, on whose say-so". Those are different
// questions and the second one is the one asked under pressure -- when a
// customer disputes a debit, the useful record is the proposal, the arguments
// it carried, and the moment the customer approved it.

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "proposed", label: "Awaiting the customer" },
  { value: "executed", label: "Done" },
  { value: "rejected", label: "Declined" },
  { value: "expired", label: "Expired" },
  { value: "failed", label: "Failed" },
];

// Colour carries the meaning here, so it maps to consequence rather than to
// mere success: a failed write and an expired proposal are not the same thing.
const TONE = {
  executed: "text-brand-green",
  proposed: "text-amber-400",
  confirmed: "text-amber-400",
  rejected: "text-fg/40",
  expired: "text-fg/40",
  failed: "text-red-400",
};

export default function AiActivityPage() {
  const [status, setStatus] = useState("");
  const { data, loading, error, refetch } = useAsync(
    () => api.aiToolCalls({ status: status || undefined, limit: 150 }),
    [status]
  );
  const rows = data?.tool_calls || [];

  return (
    <>
      <PageHeader
        title="Assistant activity"
        description="Every action the assistant took or proposed, and how it was answered."
      />
      <PageBody>
        <PageTitle title="Admin · Assistant activity" />

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`cursor-pointer rounded-full px-3 py-1.5 text-[12px] font-bold ${
                status === f.value ? "bg-brand-green text-black" : "bg-surface/6 text-fg/50 hover:text-fg"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {loading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          )}
          {error && <ErrorState error={error} onRetry={refetch} />}
          {data && rows.length === 0 && (
            <EmptyState
              title="Nothing yet"
              description="The assistant has not run any tools matching this filter."
            />
          )}

          {rows.length ? (
            <Card className="divide-y divide-surface/6">
              {rows.map((call) => (
                <div key={call.id} className="p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-[12.5px] font-bold text-brand-green">
                        {call.tool_name}
                      </span>
                      {/* The one distinction worth a badge: this tool spends
                          money or destroys something, and a human agreed. */}
                      {call.consequential ? (
                        <span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                          needs approval
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-fg/35">{fullDate(call.created_at)}</span>
                  </div>

                  <div className={`mt-1 text-[11.5px] font-bold ${TONE[call.status] || "text-fg/40"}`}>
                    {call.status}
                    {call.duration_ms != null ? (
                      <span className="ms-1.5 font-normal text-fg/30">{call.duration_ms}ms</span>
                    ) : null}
                    {call.error_code ? (
                      <span className="ms-1.5 font-normal text-fg/40">{call.error_code}</span>
                    ) : null}
                    {call.resolved_at ? (
                      <span className="ms-1.5 font-normal text-fg/30">
                        answered {fullDate(call.resolved_at)}
                      </span>
                    ) : null}
                  </div>

                  {/* The arguments, verbatim. A summary would be the thing you
                      cannot check the dispute against. */}
                  <pre className="mt-1.5 overflow-x-auto rounded-lg bg-surface/5 p-2 font-mono text-[10.5px] text-fg/45">
                    {JSON.stringify(call.args, null, 1)}
                  </pre>

                  <div className="mt-1 font-mono text-[10.5px] text-fg/25">
                    {call.user_id ? `for ${truncate(call.user_id, 24)}` : "no account"}
                    {call.session_id ? ` · ${truncate(call.session_id, 24)}` : ""}
                  </div>
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
