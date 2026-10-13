import { useState } from "react";
import { Link } from "react-router-dom";
import { Network, ShieldPlus } from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { describeRole } from "../lib/scopes.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Avatar } from "@shared/components/ui/Avatar.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { Badge, StatusBadge } from "@shared/components/ui/Badge.jsx";
import { SegmentedControl } from "@shared/components/ui/SegmentedControl.jsx";

const ROLE_FILTERS = [
  { value: "", label: "All" },
  { value: "user", label: "Customers" },
  { value: "admin", label: "Staff" },
];

// The people section: every account, its status and its place in the
// referral network. Granting or changing admin access is not done here -- it
// lives on the Admins page, which only root can open, so the person who can
// suspend an account is never the person who can mint an administrator.
export default function AdminUsersPage() {
  const [role, setRole] = useState("");
  const { data, loading, error, refetch } = useAsync(() => api.listUsers({ role: role || undefined, limit: 100 }), [role]);
  const toast = useToast();
  const { can } = useAdminAuth();

  async function setStatus(userId, status) {
    try {
      await api.setUserStatus(userId, status);
      toast.success(`Marked ${status}`);
      refetch();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title="People" description="Accounts, status and referral networks." />
      <PageBody>
        <PageTitle title="Admin · People" />
        <SegmentedControl options={ROLE_FILTERS} value={role} onChange={setRole} />
        <div className="mt-4">
          {loading && (
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          )}
          {error && <ErrorState error={error} onRetry={refetch} />}
          <Card className="divide-y divide-surface/6">
            {data?.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-3.5">
                <Avatar name={u.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-fg">{u.name}</div>
                  <div className="truncate text-[11px] text-fg/40">{u.email}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {u.role === "admin" ? (
                      <Badge tone="pink">{describeRole(u.staff_role || "root")}</Badge>
                    ) : (
                      <Badge tone="neutral">customer</Badge>
                    )}
                    <StatusBadge status={u.status} />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {can("network.read_all") && (
                    <Link
                      to={`/users/${u.id}/network`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-green"
                    >
                      <Network size={12} /> Network
                    </Link>
                  )}
                  {can("admins.manage") && u.role !== "admin" && (
                    <Link
                      to={`/admins?promote=${encodeURIComponent(u.email)}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-blue"
                    >
                      <ShieldPlus size={12} /> Make admin
                    </Link>
                  )}
                  {can("users.write") &&
                    (u.status === "active" ? (
                      <button onClick={() => setStatus(u.id, "suspended")} className="text-[11px] font-semibold text-amber-400">
                        Suspend
                      </button>
                    ) : (
                      <button onClick={() => setStatus(u.id, "active")} className="text-[11px] font-semibold text-emerald-400">
                        Activate
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </PageBody>
    </>
  );
}
