import { Plus, Trash2 } from "lucide-react";
import { Input } from "@shared/components/ui/Input.jsx";
import { Button } from "@shared/components/ui/Button.jsx";

// Lease rules for one product: which durations customers may choose, each
// with its own rate, the smallest upfront payment, and optionally a price to
// lease against that differs from the list price.
//
// The shape is exactly what the API stores (see src/lib/leaseRules.js) with
// two display conversions: APR is edited as a percentage and stored in basis
// points, and the base price is edited in dollars and stored in cents. The
// storefront builds its lease tab from this object, and the server re-checks
// every proforma request against it, so what is set here is what a customer
// can actually be quoted.

export const DEFAULT_RULES = {
  enabled: true,
  base_price_cents: null,
  min_upfront_pct: 10,
  max_upfront_pct: 90,
  terms: [12, 24, 36, 48].map((months) => ({ months, apr_bp: 1800 })),
};

/** From the stored object to what the form edits (strings, so typing is natural). */
export function rulesToForm(rules) {
  const r = rules || DEFAULT_RULES;
  return {
    enabled: r.enabled !== false,
    base_price: r.base_price_cents ? String(r.base_price_cents / 100) : "",
    min_upfront_pct: String(r.min_upfront_pct ?? 10),
    max_upfront_pct: String(r.max_upfront_pct ?? 90),
    terms: (r.terms?.length ? r.terms : DEFAULT_RULES.terms).map((t) => ({
      months: String(t.months),
      apr: String((t.apr_bp ?? 0) / 100),
    })),
  };
}

/** From the form back to the API shape. Throws a message the admin can act on. */
export function formToRules(form) {
  if (!form.enabled) return { enabled: false };
  const min = Number(form.min_upfront_pct);
  const max = Number(form.max_upfront_pct);
  if (!Number.isInteger(min) || min < 0 || min > 90) throw new Error("Minimum upfront must be a whole number from 0 to 90");
  if (!Number.isInteger(max) || max < min || max > 90) throw new Error("Maximum upfront must be a whole number, no lower than the minimum and at most 90");
  const terms = form.terms.map((t) => ({ months: Number(t.months), apr_bp: Math.round(Number(t.apr) * 100) }));
  if (terms.length === 0) throw new Error("Add at least one lease duration, or switch leasing off");
  for (const t of terms) {
    if (!Number.isInteger(t.months) || t.months < 1 || t.months > 120) throw new Error("Each duration must be a whole number of months from 1 to 120");
    if (!Number.isFinite(t.apr_bp) || t.apr_bp < 0 || t.apr_bp > 10_000) throw new Error("Each APR must be between 0% and 100%");
  }
  if (new Set(terms.map((t) => t.months)).size !== terms.length) throw new Error("Each duration can only be listed once");
  const base = form.base_price.trim() === "" ? null : Math.round(Number(form.base_price) * 100);
  if (base !== null && (!Number.isFinite(base) || base <= 0)) throw new Error("The lease base price must be a positive amount, or empty to use the list price");
  return { enabled: true, base_price_cents: base, min_upfront_pct: min, max_upfront_pct: max, terms };
}

export function LeaseRulesEditor({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setTerm = (i, patch) =>
    set({ terms: value.terms.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[13px] font-semibold text-fg/80">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        Offer leasing on this product
      </label>

      {value.enabled ? (
        <>
          <Input
            label="Lease base price (optional)"
            prefix="$"
            type="number"
            step="0.01"
            placeholder="Leave empty to lease against the list price"
            value={value.base_price}
            onChange={(e) => set({ base_price: e.target.value })}
          />
          <div className="flex gap-3">
            <Input
              label="Minimum upfront %"
              type="number"
              min="0"
              max="90"
              value={value.min_upfront_pct}
              onChange={(e) => set({ min_upfront_pct: e.target.value })}
            />
            <Input
              label="Maximum upfront %"
              type="number"
              min="0"
              max="90"
              value={value.max_upfront_pct}
              onChange={(e) => set({ max_upfront_pct: e.target.value })}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-bold text-ink-2">Durations and interest</div>
            <div className="flex flex-col gap-2">
              {value.terms.map((t, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input
                    label={i === 0 ? "Months" : undefined}
                    type="number"
                    min="1"
                    max="120"
                    value={t.months}
                    onChange={(e) => setTerm(i, { months: e.target.value })}
                    aria-label={`Duration ${i + 1} in months`}
                  />
                  <Input
                    label={i === 0 ? "APR" : undefined}
                    suffix="%"
                    type="number"
                    step="0.1"
                    min="0"
                    value={t.apr}
                    onChange={(e) => setTerm(i, { apr: e.target.value })}
                    aria-label={`Duration ${i + 1} APR`}
                  />
                  <button
                    type="button"
                    onClick={() => set({ terms: value.terms.filter((_, idx) => idx !== i) })}
                    aria-label={`Remove duration ${i + 1}`}
                    className="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg/40 hover:bg-surface/8 hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => set({ terms: [...value.terms, { months: "", apr: "18" }] })}
            >
              <Plus size={14} /> Add duration
            </Button>
          </div>
          <p className="text-[12px] text-fg/40">
            The instalment is a standard amortising payment on the price after the upfront payment, at each
            duration's own APR. Customers can only request what is listed here.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-fg/45">
          Customers will be told leasing is not offered and can request a cash proforma instead.
        </p>
      )}
    </div>
  );
}
