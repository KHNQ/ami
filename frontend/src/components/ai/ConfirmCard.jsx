import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { confirmProposal } from "../../lib/aiClient.js";

// The card a visitor taps before anything irreversible happens.
//
// Rendered ONLY from the structured `confirm_required` payload the server
// sent -- never inferred from what the model wrote. The model's prose can be
// wrong about what it is doing; the card is generated from a read-only preview
// of the actual operation, so the numbers on it are the numbers that will be
// used.

function useCountdown(expiresAt) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt) - Date.now()));
  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => setLeft(Math.max(0, new Date(expiresAt) - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

export function ConfirmCard({ proposal, state, onResolved, t }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const msLeft = useCountdown(proposal.expires_at);
  const expired = msLeft <= 0;
  const settled = state?.status === "confirmed" || state?.status === "rejected";

  async function decide(decision) {
    setBusy(true);
    setError(null);
    try {
      const res = await confirmProposal(proposal.id, decision);
      onResolved(proposal.id, decision === "reject" ? "rejected" : "confirmed", res);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const minutes = Math.floor(msLeft / 60000);
  const seconds = Math.floor((msLeft % 60000) / 1000);

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-2xl border",
        proposal.danger && !settled ? "border-amber-500/40 bg-amber-500/5" : "border-line bg-panel"
      )}
    >
      <div className="flex items-start gap-3 p-4">
        {proposal.danger ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <b className="block text-[14px] font-black text-ink">{proposal.title}</b>
          {proposal.summary ? (
            <p className="mt-0.5 text-[12.5px] text-ink-2">{proposal.summary}</p>
          ) : null}
        </div>
      </div>

      {/* The figures being agreed to. A confirmation with no numbers on it is
          a question, not consent. */}
      {proposal.details?.length ? (
        <dl className="grid gap-px border-t border-line bg-line">
          {proposal.details.map((d, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 bg-panel px-4 py-2">
              <dt className="text-[12px] text-ink-2">{d.label}</dt>
              <dd className="b2b-tnum text-end text-[12.5px] font-bold text-ink">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
        {settled ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[12.5px] font-extrabold",
              state.status === "confirmed" ? "text-brand-green" : "text-ink-2"
            )}
          >
            {state.status === "confirmed" ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {state.status === "confirmed" ? t("ai.confirmDone") : t("ai.confirmCancelled")}
          </span>
        ) : expired ? (
          <span className="text-[12.5px] text-ink-2">{t("ai.confirmExpired")}</span>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("confirm")}
              className="cursor-pointer rounded-full bg-brand-gradient px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-50"
            >
              {busy ? t("ai.confirmWorking") : t("ai.confirmYes")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("reject")}
              className="cursor-pointer rounded-full border border-line bg-panel px-4 py-2 text-[12.5px] font-extrabold text-ink-2 hover:text-ink disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            {/* Not decoration: the card really does stop working, and finding
                that out only on tapping would be worse. */}
            <span className="b2b-tnum ms-auto text-[11.5px] text-ink-3">
              {minutes}:{String(seconds).padStart(2, "0")}
            </span>
          </>
        )}
        {error ? (
          <span className="w-full text-[12px] font-bold text-red-600 dark:text-red-300">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
