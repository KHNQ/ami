import { useState } from "react";
import { HandCoins, Check } from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { adminApi as api } from "../lib/adminApi.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Dialog } from "../components/ui/Dialog.jsx";
import { fullDate } from "@shared/lib/format.js";
import { useToast } from "@shared/context/ToastContext.jsx";

// What the company owes its networks.
//
// This is a payday screen: someone has the person in front of them, or on the
// phone, and needs to know how much and why. So the total per person is the
// headline and the sales behind it are one click away -- not the other way
// round, which would be a ledger export nobody can act on.
//
// Nothing here moves money. Settling records that a payment was made outside
// the system, because that is how this business pays: in person, the same way
// it takes payment for a device.

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "offset", label: "Offset against an order" },
  { value: "other", label: "Other" },
];

// The question the person at the desk is really answering: "have I handed this
// person this money?" So the dialog leads with the amount and the name, makes
// the admin say they paid it themselves, and only then enables the button --
// whose label repeats the amount, so a thumb on autopilot still reads it.
function PayDialog({ person, onDone, onClose }) {
  const toast = useToast();
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [paidIt, setPaidIt] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await api.settlePayout(person.user_id, {
        // The figure on screen, sent back so the server can refuse if the
        // real total has moved since this row was rendered.
        expected_cents: person.owed.cents,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success(`Logged ${res.paid.display} paid to ${person.name}`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={`Pay ${person.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!paidIt}>
            <Check size={15} /> Confirm · {person.owed.display} paid
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-surface/10 bg-surface/4 p-4 text-center">
        <div className="text-[12px] text-fg/45">Commission owed to {person.name}</div>
        <div className="mt-1 font-mono text-[28px] font-extrabold text-brand-green">{person.owed.display}</div>
        <div className="mt-0.5 text-[11.5px] text-fg/35">
          from {person.entry_count} sale{person.entry_count === 1 ? "" : "s"}
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-fg/55">
        You pay this yourself — in cash, by transfer or by cheque. Nothing is sent from here. Confirming only
        <b className="text-fg"> logs that you paid it</b>, under your name, and clears it from what is owed.
      </p>

      <div className="mt-3 grid gap-2.5">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          aria-label="How you paid"
          className="rounded-lg border border-surface/12 bg-surface/5 px-3 py-2.5 text-[13px] text-fg"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <Input placeholder="Receipt / transfer reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-surface/10 p-3 text-[13px] text-fg">
        <input type="checkbox" checked={paidIt} onChange={(e) => setPaidIt(e.target.checked)} className="mt-0.5" />
        <span>
          I have paid <b>{person.owed.display}</b> to <b>{person.name}</b> myself.
        </span>
      </label>
    </Dialog>
  );
}

function PersonRow({ person, onSettled }) {
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const { data: detail } = useAsync(
    () => (open ? api.payoutDetail(person.user_id) : Promise.resolve(null)),
    [open, person.user_id]
  );

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[14px] font-bold text-fg">{person.name}</span>
          <div className="mt-0.5 text-[11.5px] text-fg/40">
            {[person.email, person.phone].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-0.5 text-[11px] text-fg/30">
            {person.entry_count} sale{person.entry_count === 1 ? "" : "s"} · oldest{" "}
            {fullDate(person.earliest_sale_at)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[16px] font-bold text-brand-green">{person.owed.display}</span>
          <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Why?"}
          </Button>
          <Button onClick={() => setSettling(true)}>Pay {person.owed.display}</Button>
        </div>
      </div>

      {open && detail ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-surface/8">
          <table className="w-full text-[12px]">
            <thead className="bg-surface/5 text-fg/45">
              <tr>
                <th className="p-2 text-start font-semibold">Buyer</th>
                <th className="p-2 text-start font-semibold">Device</th>
                <th className="p-2 text-start font-semibold">Level</th>
                <th className="p-2 text-start font-semibold">Rate</th>
                <th className="p-2 text-end font-semibold">Sale</th>
                <th className="p-2 text-end font-semibold">Commission</th>
                <th className="p-2 text-start font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.entry_id} className="border-t border-surface/6">
                  <td className="p-2 text-fg/80">{l.from_buyer}</td>
                  <td className="p-2 text-fg/60">{l.product}</td>
                  <td className="p-2 text-fg/60">L{l.level}</td>
                  <td className="p-2 text-fg/60">{l.rate_bp / 100}%</td>
                  <td className="p-2 text-end font-mono text-fg/60">{l.sale_value.display}</td>
                  <td className="p-2 text-end font-mono font-bold text-fg">{l.amount.display}</td>
                  <td className="p-2 text-fg/35">{fullDate(l.sale_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {settling ? (
        <PayDialog
          person={person}
          onDone={() => {
            setSettling(false);
            onSettled();
          }}
          onClose={() => setSettling(false)}
        />
      ) : null}
    </div>
  );
}

export default function PayoutsPage() {
  const { data, loading, error, refetch } = useAsync(() => api.payouts(), []);
  const { data: history, refetch: refetchHistory } = useAsync(() => api.payoutHistory({ limit: 20 }), []);

  function reload() {
    refetch();
    refetchHistory();
  }

  return (
    <>
      <PageHeader
        title="Network payouts"
        description="What the company owes the people in its networks, and a record of paying them."
      />
      <PageBody>
        <PageTitle title="Admin · Network payouts" />

        {loading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {data ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-surface/10 bg-surface/4 p-4">
              <HandCoins className="text-brand-green" size={20} />
              <div>
                <div className="font-mono text-[22px] font-bold text-fg">{data.total.display}</div>
                <div className="text-[12px] text-fg/45">
                  outstanding to {data.people_count} {data.people_count === 1 ? "person" : "people"}
                </div>
              </div>
              <div className="flex-1" />
              {/* Says which world the operator is in. Getting this wrong is
                  how the same commission gets paid twice. */}
              {data.auto_payout ? (
                <Badge tone="pink">Automatic payout is ON — wallets are credited by the job</Badge>
              ) : (
                <Badge tone="neutral">Paid by hand · the system never transfers</Badge>
              )}
            </div>

            {data.people.length === 0 ? (
              <EmptyState
                title="Nothing outstanding"
                description="Every commission earned so far has been settled."
              />
            ) : (
              <Card className="divide-y divide-surface/6">
                {data.people.map((p) => (
                  <PersonRow key={p.user_id} person={p} onSettled={reload} />
                ))}
              </Card>
            )}
          </>
        ) : null}

        {history?.payments?.length ? (
          <>
            <h2 className="mt-6 mb-2 text-[13px] font-bold text-fg/50">Recent payments</h2>
            <Card className="divide-y divide-surface/6">
              {history.payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-3 p-3">
                  <span className="font-mono text-[13px] font-bold text-fg">{p.paid.display}</span>
                  <span className="text-[12px] text-fg/45">
                    {p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="text-[11px] text-fg/30">{fullDate(p.at)}</span>
                </div>
              ))}
            </Card>
          </>
        ) : null}
      </PageBody>
    </>
  );
}
