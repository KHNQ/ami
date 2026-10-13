import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Phone, Mail, FileDown, UserPlus, Link2, ShoppingBag } from "lucide-react";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { adminApi } from "../lib/adminApi.js";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { relativeTime, money } from "@shared/lib/format.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";

// The sales queue: every proforma and lease request from the storefront.
//
// A lease request carries the exact terms the customer chose -- duration,
// upfront payment, rate and the instalment the server computed -- so the
// person calling back can quote from the row rather than reconstructing it.
const TONE = { new: "pink", contacted: "neutral", quoted: "neutral", accepted: "success", converted: "success", declined: "neutral", expired: "neutral" };
const NEXT = { new: "contacted", contacted: "quoted", quoted: "accepted" };
// A proforma can be turned into a walk-in sale while it is still open. Not an
// enquiry (nothing to sell) and not once it has been sold, declined or lapsed.
const REGISTERABLE = ["new", "contacted", "quoted", "accepted"];
const KIND_LABEL = { proforma: "Proforma", lease: "Lease proforma", enquiry: "Enquiry", demo: "Demo", reservation: "Reservation (legacy)", rental: "Rental (legacy)", subscription: "Subscription (legacy)", trade_in: "Trade-in (legacy)", lead_program: "Lead programme (legacy)" };

function LeaseTerms({ q }) {
  if (q.term_months == null) return null;
  const cur = q.currency === "USD" ? "USD" : q.currency;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-surface/10 bg-surface/[0.03] p-3 text-[12.5px] sm:grid-cols-4">
      <div><dt className="text-fg/40">Duration</dt><dd className="font-bold text-fg">{q.term_months} months</dd></div>
      <div><dt className="text-fg/40">Upfront</dt><dd className="font-bold text-fg">{q.upfront_pct != null ? `${q.upfront_pct}% · ` : ""}{money(q.deposit_cents ?? 0)}</dd></div>
      <div><dt className="text-fg/40">APR</dt><dd className="font-bold text-fg">{q.apr_bp != null ? `${(q.apr_bp / 100).toFixed(2)}%` : "—"}</dd></div>
      <div><dt className="text-fg/40">Instalment</dt><dd className="font-bold text-brand-green">{q.instalment_cents != null ? `${money(q.instalment_cents)} / mo` : "—"}</dd></div>
      <div className="col-span-2 sm:col-span-4 text-fg/35">Priced from {money(q.amount_cents ?? 0)} ({cur}); indicative until a lease agreement is drawn up.</div>
    </dl>
  );
}

export default function ProformasPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAdminAuth();
  const [status, setStatus] = useState("new");
  const [kind, setKind] = useState("");
  const { data, error, loading, refetch } = useAsync(
    () => adminApi.listQuotes({ status: status === "all" ? undefined : status, kind: kind || undefined, limit: 200 }),
    [status, kind]
  );

  async function advance(q, next) {
    try {
      await adminApi.updateQuote(q.id, { status: next });
      await refetch();
      toast.success(`Marked ${next}`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const quotes = data?.quotes ?? [];
  const by = data?.summary?.quotes?.byStatus ?? {};

  return (
    <>
      <PageTitle title="Admin · Proformas" />
      <PageHeader
        title="Proformas"
        description={`${by.new ?? 0} new · ${by.contacted ?? 0} contacted · ${by.quoted ?? 0} quoted`}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SegmentedControl
            value={status}
            onChange={setStatus}
            options={[
              { value: "new", label: "New" },
              { value: "contacted", label: "Contacted" },
              { value: "quoted", label: "Quoted" },
              { value: "all", label: "All" },
            ]}
          />
          <SegmentedControl
            value={kind}
            onChange={setKind}
            options={[
              { value: "", label: "Any kind" },
              { value: "lease", label: "Lease" },
              { value: "proforma", label: "Proforma" },
              { value: "enquiry", label: "Enquiry" },
            ]}
          />
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : quotes.length === 0 ? (
          <EmptyState title="Nothing here" description="No proforma requests match this view." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {quotes.map((q) => (
              <Card key={q.id} className="flex flex-col gap-2.5 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold text-fg">{q.contact_name}</div>
                    <div className="text-[12.5px] text-fg/60">{q.subject}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-fg/50">
                      {q.contact_phone && (
                        <a href={`tel:${q.contact_phone}`} className="flex items-center gap-1 hover:text-fg/80" dir="ltr">
                          <Phone size={12} /> {q.contact_phone}
                        </a>
                      )}
                      {q.contact_email && (
                        <a href={`mailto:${q.contact_email}`} className="flex items-center gap-1 truncate hover:text-fg/80">
                          <Mail size={12} /> {q.contact_email}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={TONE[q.status]}>{q.status}</Badge>
                    <Badge tone="neutral">{KIND_LABEL[q.kind] || q.kind}</Badge>
                  </div>
                </div>

                {/* Who sent them. The link a member shares carries their code, so
                    the desk sees it here and the walk-in form fills it in --
                    nobody has to ask the customer who referred them. */}
                {q.referrer && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-brand-green/25 bg-brand-green/[0.06] px-3 py-2 text-[12.5px] text-fg/70">
                    <Link2 size={13} className="text-brand-green" />
                    <span>
                      Invited by <b className="text-fg">{q.referrer.name || "a member"}</b>
                    </span>
                    <span className="font-mono text-[11.5px] text-fg/45">{q.referrer.code}</span>
                    {!q.referrer.usable && <Badge tone="danger">code no longer active</Badge>}
                  </div>
                )}

                <LeaseTerms q={q} />

                {q.kind !== "lease" && q.amount_cents != null && (
                  <div className="text-[12.5px] text-fg/55">Quoted at {money(q.amount_cents)}{q.financing ? ` · ${q.financing}` : ""}</div>
                )}
                {(q.clinic_city || q.specialty || q.timeline) && (
                  <div className="text-[12px] text-fg/40">{[q.clinic_city, q.specialty, q.timeline].filter(Boolean).join(" · ")}</div>
                )}
                {q.notes && <p className="text-[12.5px] leading-relaxed text-fg/60">{q.notes}</p>}

                <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-fg/35">
                  <span className="font-mono">{q.reference}</span>
                  <span>{relativeTime(q.created_at)}</span>
                  <a
                    href={`${adminApi.baseUrl()}/sales/quotes/${q.id}/proforma.pdf?ref=${q.reference}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-semibold text-brand-blue hover:underline"
                  >
                    <FileDown size={12} /> PDF
                  </a>
                  <span className="flex-1" />
                  {q.status === "converted" && q.transaction_id && (
                    <Link to={`/orders/${q.transaction_id}`} className="inline-flex items-center gap-1 font-semibold text-brand-green hover:underline">
                      <ShoppingBag size={12} /> Sold · open order
                    </Link>
                  )}
                  {can("orders.create_manual") && q.product_id && REGISTERABLE.includes(q.status) && (
                    <button
                      onClick={() => navigate(`/orders/manual?quote=${q.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-3.5 py-1.5 text-[12px] font-bold text-white"
                    >
                      <UserPlus size={13} /> Register now
                    </button>
                  )}
                  {can("sales.write") && NEXT[q.status] && (
                    <button onClick={() => advance(q, NEXT[q.status])} className="font-semibold text-brand-blue hover:underline">
                      Mark {NEXT[q.status]}
                    </button>
                  )}
                  {can("sales.write") && !["declined", "expired", "converted", "accepted"].includes(q.status) && (
                    <button onClick={() => advance(q, "declined")} className="hover:text-fg/60">
                      Decline
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
