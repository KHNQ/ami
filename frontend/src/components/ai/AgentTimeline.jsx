import { useState } from "react";
import { Check, ChevronRight, Search, Wrench, X } from "lucide-react";
import { cn } from "../../lib/cn.js";

// What the agent did, while it is doing it.
//
// Replaces the old `Thought` disclosure, which described a single retrieval
// step because that was all there was. A turn can now search the catalogue,
// read the visitor's account and call out to the web before it answers, and
// the difference between "thinking…" and a list of what actually ran is the
// difference between trusting the answer and taking it on faith.
//
// Collapsed once prose arrives: the steps matter while you are waiting and
// become clutter the moment there is an answer to read.

function StatusDot({ state }) {
  if (state === "running") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-3/40 border-t-transparent" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-600 dark:text-red-300">
        <X className="h-2.5 w-2.5" />
      </span>
    );
  }
  return (
    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-green/15 text-brand-green">
      <Check className="h-2.5 w-2.5" />
    </span>
  );
}

/** Renders `{query: "CO2 laser", limit: 5}` as `CO2 laser · 5`. */
function argSummary(args) {
  if (!args) return "";
  const parts = Object.values(args)
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map((v) => (Array.isArray(v) ? v.join(", ") : String(v)));
  return parts.join(" · ");
}

function Step({ step, t }) {
  const label = t(`ai.tool.${step.name}`);
  // A missing translation resolves to the key itself; showing a customer
  // `ai.tool.search_catalogue` is worse than showing the raw tool name.
  const title = label.startsWith("ai.tool.") ? step.name.replace(/_/g, " ") : label;

  return (
    <div className="flex items-start gap-2 py-0.5">
      <StatusDot state={step.state} />
      <span className="min-w-0 flex-1">
        <span className="text-[12.5px] text-ink-2">
          <span className="font-semibold text-ink">{title}</span>
          {step.args && argSummary(step.args) ? (
            <span className="text-ink-3"> — {argSummary(step.args)}</span>
          ) : null}
        </span>
        {step.summary ? (
          <span className="block truncate text-[11.5px] text-ink-3">{step.summary}</span>
        ) : null}
        {step.error ? (
          <span className="block truncate text-[11.5px] text-red-600 dark:text-red-300">
            {step.error}
          </span>
        ) : null}
      </span>
      {step.durationMs != null ? (
        <span className="b2b-tnum shrink-0 text-[11px] text-ink-3">{step.durationMs}ms</span>
      ) : null}
    </div>
  );
}

export function AgentTimeline({ retrieval, steps = [], thinking = "", busy, t }) {
  // Open while there is nothing else to look at, closed once the answer
  // arrives -- the same disclosure behaviour the old Thought row had.
  const [manual, setManual] = useState(null);
  const open = manual ?? busy;

  const hasSteps = steps.length > 0;
  if (!retrieval && !hasSteps && !thinking) return null;

  const running = steps.filter((s) => s.state === "running").length;
  const headline = running
    ? t("ai.working")
    : hasSteps
      ? t("ai.ranSteps", { count: steps.length })
      : t("ai.thought");

  return (
    <div className="text-ink-2">
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 rounded-lg py-1 hover:text-ink"
      >
        {running ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-ink-3/40 border-t-transparent" />
        ) : hasSteps ? (
          <Wrench className="h-3.5 w-3.5" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
        <span className="text-[13.5px] font-semibold">{headline}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
      </button>

      {open ? (
        <div className="mt-1 ms-5 grid gap-0.5 border-s border-line ps-3">
          {retrieval ? (
            <div className="flex items-start gap-2 py-0.5">
              <StatusDot state="done" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
                <span className="font-semibold text-ink">{t("ai.stepRetrieval")}</span>
                {retrieval.count ? (
                  <span className="text-ink-3"> — {t("ai.matches", { count: retrieval.count })}</span>
                ) : null}
              </span>
            </div>
          ) : null}

          {steps.map((s) => (
            <Step key={s.id} step={s} t={t} />
          ))}

          {/* The model's own filler prose while it works. Dimmed and italic
              because it is narration, not the answer. */}
          {thinking ? (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3 italic">{thinking}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
