import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { adminApi } from "../lib/adminApi.js";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { Card } from "@shared/components/ui/Card.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";

// Runtime feature switches and storefront contact details.
//
// The list is rendered from what the API reports rather than hardcoded here,
// so adding a setting server-side surfaces it automatically with its label,
// description, type and default -- no matching frontend change to forget.

function Toggle({ value, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        value ? "bg-brand-green" : "bg-surface/20"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { can } = useAdminAuth();
  // Settings & SEO is root only: `settings.read` and `settings.write` are held
  // by no sub-admin scope, so nobody else reaches this page (the nav hides it
  // and the route is gated). The per-key check below is kept in step with the
  // API, which still distinguishes seo_* keys (`seo.write`) from the rest.
  const writable = can("settings.write");
  const canEdit = (s) => writable || (s.key.startsWith("seo_") && can("seo.write"));
  const { data, error, loading, refetch } = useAsync(() => adminApi.getSettings(), []);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  if (loading) return <div className="flex flex-col gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const settings = data?.settings ?? [];
  const flags = settings.filter((s) => s.type === "boolean");
  const seo = settings.filter((s) => s.key.startsWith("seo_"));
  const others = settings.filter((s) => s.type !== "boolean" && !s.key.startsWith("seo_"));
  const anyEditable = settings.some(canEdit);
  const dirty = Object.keys(draft).length > 0;
  const valueOf = (s) => (s.key in draft ? draft[s.key] : s.value);

  async function save() {
    setSaving(true);
    try {
      await adminApi.updateSettings(draft);
      setDraft({});
      await refetch();
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function reset(key) {
    try {
      await adminApi.resetSetting(key);
      setDraft((d) => {
        const { [key]: _dropped, ...rest } = d;
        return rest;
      });
      await refetch();
      toast.success("Reverted to default");
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Admin · Settings" />
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-[20px] font-extrabold text-fg">Site settings</h2>
          <p className="text-[13px] text-fg/45">
            Switches take effect immediately and are enforced by the API, not just hidden in the storefront.
          </p>
        </div>
        {dirty && anyEditable && (
          <Button onClick={save} loading={saving}>
            <Save size={15} /> Save {Object.keys(draft).length}
          </Button>
        )}
      </div>

      <Card className="divide-y divide-surface/6">
        {flags.map((s) => (
          <div key={s.key} className="flex items-start gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-fg">{s.label}</span>
                {s.is_overridden && <Badge tone="pink">changed</Badge>}
                {!s.public && <Badge tone="neutral">internal</Badge>}
                {s.env_disabled && <Badge tone="neutral">off in this deployment</Badge>}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg/45">{s.description}</p>
              {/* Without this the operator turns the switch on, nothing
                  happens, and they file a bug against the feature instead of
                  setting the environment variable. */}
              {s.env_disabled && (
                <p className="mt-1 text-[12px] font-semibold text-amber-400/80">
                  Switched off for the whole deployment. Set AI_ENABLED=true on the server and
                  restart to make this toggle do anything.
                </p>
              )}
            </div>
            {s.is_overridden && canEdit(s) && (
              <button
                onClick={() => reset(s.key)}
                className="mt-1 text-fg/30 hover:text-fg/60"
                title="Revert to default"
                aria-label={`Revert ${s.label}`}
              >
                <RotateCcw size={14} />
              </button>
            )}
            <Toggle
              label={s.label}
              value={valueOf(s)}
              disabled={!canEdit(s) || s.env_disabled}
              onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
            />
          </div>
        ))}
      </Card>

      {seo.length > 0 && (
        <Card className="p-4">
          <div className="mb-1 text-[14px] font-bold text-fg">Search &amp; sharing (SEO)</div>
          <p className="mb-3 text-[12.5px] leading-relaxed text-fg/45">
            Defaults for page titles, descriptions and link previews. Individual blog posts set their own in
            their front matter; products use their own name and description.
          </p>
          <div className="flex flex-col gap-3">
            {seo.map((s) => (
              <div key={s.key}>
                <Input
                  label={s.label.replace(/^SEO: /, "")}
                  value={String(valueOf(s) ?? "")}
                  disabled={!canEdit(s)}
                  hint={s.description}
                  onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                />
                {s.is_overridden && canEdit(s) && (
                  <button onClick={() => reset(s.key)} className="mt-1 text-[11.5px] text-fg/40 hover:text-fg/70">
                    Revert to default
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {others.map((s) => (
        <Card key={s.key} className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[14px] font-bold text-fg">{s.label}</span>
            {s.is_overridden && <Badge tone="pink">changed</Badge>}
          </div>
          <p className="mb-3 text-[12.5px] leading-relaxed text-fg/45">{s.description}</p>

          {s.type === "object" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(valueOf(s)).map(([k, v]) => (
                <Input
                  key={k}
                  label={k.replace(/_/g, " ")}
                  value={Array.isArray(v) ? v.join(", ") : String(v ?? "")}
                  disabled={!canEdit(s)}
                  onChange={(e) => {
                    const next = { ...valueOf(s) };
                    next[k] = Array.isArray(v)
                      ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean)
                      : typeof v === "number"
                        ? Number(e.target.value)
                        : e.target.value;
                    setDraft((d) => ({ ...d, [s.key]: next }));
                  }}
                />
              ))}
            </div>
          ) : (
            <Input
              value={Array.isArray(valueOf(s)) ? valueOf(s).join(", ") : String(valueOf(s))}
              disabled={!canEdit(s)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  [s.key]: s.type === "array" ? e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) : e.target.value,
                }))
              }
            />
          )}
        </Card>
      ))}

      {!writable && (
        <p className="text-center text-[12.5px] text-fg/35">
          You can read these but not change them — that needs the settings.write permission.
        </p>
      )}
    </div>
  );
}
