import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, ShieldCheck } from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { SCOPES, describeRole, scopesOf } from "../lib/scopes.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Avatar } from "@shared/components/ui/Avatar.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";

// Who may do what. Root admins only.
//
// An admin is either ROOT (everything, including this page) or holds one or
// more SCOPES, which combine. Only a root admin can create an admin or change
// what another admin can do; the API enforces that (`admins.manage`), this page
// is just where it is done. There can be any number of root admins.

function ScopePicker({ value, onChange, idPrefix }) {
  const root = value.includes("root");
  const toggle = (scope) =>
    onChange(value.includes(scope) ? value.filter((s) => s !== scope) : [...value.filter((s) => s !== "root"), scope]);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Access</legend>
      <label className="flex items-start gap-2.5 rounded-xl border border-surface/10 p-2.5 text-[13px]">
        <input
          type="checkbox"
          id={`${idPrefix}-root`}
          checked={root}
          onChange={(e) => onChange(e.target.checked ? ["root"] : [])}
          className="mt-0.5"
        />
        <span>
          <b className="text-fg">Root admin</b>
          <span className="block text-[12px] text-fg/45">
            Everything, including creating admins and changing their access. Cannot be combined with the scopes below.
          </span>
        </span>
      </label>
      {SCOPES.map((s) => (
        <label
          key={s.value}
          className={`flex items-start gap-2.5 rounded-xl border border-surface/10 p-2.5 text-[13px] ${root ? "opacity-40" : ""}`}
        >
          <input
            type="checkbox"
            id={`${idPrefix}-${s.value}`}
            checked={value.includes(s.value)}
            disabled={root}
            onChange={() => toggle(s.value)}
            className="mt-0.5"
          />
          <span>
            <b className="text-fg">{s.label}</b>
            <span className="block text-[12px] text-fg/45">{s.blurb}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function AdminRow({ admin, selfId, onSaved }) {
  const toast = useToast();
  const initial = useMemo(() => scopesOf(admin.staff_role || "root"), [admin.staff_role]);
  const [scopes, setScopes] = useState(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = scopes.slice().sort().join() !== initial.slice().sort().join();

  async function save() {
    setSaving(true);
    try {
      await api.setUserRole(admin.id, { role: "admin", staff_scopes: scopes });
      toast.success("Access updated");
      setOpen(false);
      await onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!window.confirm(`Remove all admin access from ${admin.name}?`)) return;
    try {
      await api.setUserRole(admin.id, { role: "user" });
      toast.success("Admin access removed");
      await onSaved();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="p-3.5">
      <div className="flex items-center gap-3">
        <Avatar name={admin.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-fg">
            {admin.name} {admin.id === selfId && <span className="text-fg/35">(you)</span>}
          </div>
          <div className="truncate text-[11px] text-fg/40">{admin.email}</div>
        </div>
        <Badge tone="pink">{describeRole(admin.staff_role || "root")}</Badge>
        <button onClick={() => setOpen((o) => !o)} className="text-[12px] font-semibold text-brand-blue" aria-expanded={open}>
          {open ? "Close" : "Edit access"}
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <ScopePicker value={scopes} onChange={setScopes} idPrefix={`edit-${admin.id}`} />
          <div className="flex items-center gap-2">
            <Button size="sm" loading={saving} disabled={!dirty || scopes.length === 0} onClick={save}>
              Save access
            </Button>
            {admin.id !== selfId && (
              <Button size="sm" variant="danger" onClick={revoke}>
                Remove admin access
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateAdmin({ promoteEmail, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: promoteEmail || "", password: "" });
  const [scopes, setScopes] = useState(["FINANCE_ADMIN"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (promoteEmail) setForm((f) => ({ ...f, email: promoteEmail }));
  }, [promoteEmail]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (scopes.length === 0) return setError("Choose what this admin may do");
    setBusy(true);
    try {
      // Promoting an existing customer: find them by email and change their role,
      // so no second account is created.
      const found = promoteEmail ? (await api.listUsers({ limit: 500 })).find((u) => u.email === form.email.trim().toLowerCase()) : null;
      if (found) {
        await api.setUserRole(found.id, { role: "admin", staff_scopes: scopes });
        toast.success(`${found.name} is now an admin`);
      } else {
        await api.createAdmin({ ...form, email: form.email.trim(), staff_scopes: scopes });
        toast.success("Admin created");
      }
      setForm({ name: "", email: "", password: "" });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-fg">
        <Plus size={15} /> {promoteEmail ? "Make an existing account an admin" : "Create an admin"}
      </h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {!promoteEmail && <Input label="Name" value={form.name} onChange={set("name")} required />}
        <Input label="Email" type="email" value={form.email} onChange={set("email")} required />
        {!promoteEmail && (
          <Input label="Temporary password" type="password" hint="At least 8 characters. They can change it after signing in." value={form.password} onChange={set("password")} required minLength={8} />
        )}
        <ScopePicker value={scopes} onChange={setScopes} idPrefix="new" />
        {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}
        <Button type="submit" loading={busy}>
          {promoteEmail ? "Grant access" : "Create admin"}
        </Button>
      </form>
    </Card>
  );
}

export default function AdminsPage() {
  const { user } = useAdminAuth();
  const [params] = useSearchParams();
  const promote = params.get("promote");
  const { data, loading, error, refetch } = useAsync(() => api.listUsers({ role: "admin", limit: 200 }), []);

  return (
    <>
      <PageTitle title="Admin · Admins & access" />
      <PageHeader
        title="Admins & access"
        description="Only root admins can create admins or change what an admin can do. Scopes combine: one person can be Finance and Content at once."
      />
      <PageBody>
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-fg/40">
              <ShieldCheck size={14} /> Current admins
            </h2>
            {loading && <Skeleton className="h-40 w-full" />}
            {error && <ErrorState error={error} onRetry={refetch} />}
            <Card className="divide-y divide-surface/6">
              {data?.map((a) => (
                <AdminRow key={a.id} admin={a} selfId={user?.id} onSaved={refetch} />
              ))}
            </Card>
          </div>
          <CreateAdmin key={promote || "new"} promoteEmail={promote} onCreated={refetch} />
        </div>
      </PageBody>
    </>
  );
}
