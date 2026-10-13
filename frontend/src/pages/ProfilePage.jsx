import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, LogOut, ShieldCheck, Package, Pencil, Check, X, Sun, Moon, KeyRound, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { api } from "../lib/api.js";
import { setToken } from "../lib/token.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { SectionHead } from "../b2b/ui/primitives.jsx";
import { PageMeta } from "../b2b/ui/PageMeta.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Avatar } from "../components/ui/Avatar.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { ThemeToggle } from "../components/ui/ThemeToggle.jsx";
import { BottomSheet } from "../components/ui/BottomSheet.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

export default function ProfilePage() {
  const t = useT();
  const { user, isAdmin, logout, refreshMe } = useAuth();
  const { theme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(null); // 'password' | 'delete' | null

  async function saveName() {
    setSaving(true);
    try {
      await api.updateProfile({ name });
      await refreshMe();
      toast.success(t("profile.updated"));
      setEditing(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageTransition className="b2b-container flex-1 py-8">
      <PageMeta
        title={t("profile.title")}
        description={t("profile.metaDesc")}
        path="/profile"
        noIndex
      />
      {/* One centred column for the whole page, heading included. The cards
          used to be capped at max-w-3xl but never centred, so on a wide
          screen they sat against the left edge of the container with the
          rest of the viewport empty beside them. `mx-auto` keeps a phone
          layout identical (the column is the full width there) and centres
          the column from the lg breakpoint up. */}
      <div className="mx-auto w-full max-w-3xl">
      <SectionHead
        eyebrow={t("nav.yourAccount")}
        title={t("profile.title")}
        lead={t("profile.lead")}
      />
      <div className="mt-5">
        <Card className="flex items-center gap-4 p-5">
          <Avatar name={user?.name} size={56} />
          <div className="min-w-0 flex-1">
            {!editing ? (
              <div className="truncate text-[17px] font-extrabold text-ink">{user?.name}</div>
            ) : (
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-[14px]" />
            )}
            <div className="mt-0.5 truncate text-[12.5px] text-ink-2">{user?.email}</div>
            <div className="mt-2 flex items-center gap-1.5">
              <Badge tone={user?.role === "admin" ? "pink" : "neutral"}>{user?.role}</Badge>
              <Badge tone={user?.status === "active" ? "success" : "danger"}>
                {t(`status.${user?.status}`)}
              </Badge>
            </div>
          </div>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2"
            >
              <Pencil size={15} />
            </button>
          ) : (
            <div className="flex shrink-0 flex-col gap-1.5">
              <button
                onClick={saveName}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green text-white"
              >
                <Check size={15} />
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setName(user?.name || "");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-panel-2 text-ink-2"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </Card>

        <div className="mt-5 flex flex-col gap-2.5">
          {isAdmin && (
            <Link to="/admin">
              <Card className="b2b-card flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient">
                  <ShieldCheck size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-[14px] font-black text-ink">{t("profile.adminRoom")}</div>
                  <div className="text-[12px] text-ink-2">{t("profile.adminRoomBlurb")}</div>
                </div>
                <ChevronRight size={16} className="text-ink-3 rtl:rotate-180" />
              </Card>
            </Link>
          )}

          <Link to="/orders">
            <Card className="b2b-card flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2">
                <Package size={18} className="text-ink-2" />
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-black text-ink">{t("profile.myOrders")}</div>
                <div className="text-[12px] text-ink-2">{t("profile.myOrdersBlurb")}</div>
              </div>
              <ChevronRight size={16} className="text-ink-3 rtl:rotate-180" />
            </Card>
          </Link>

          <Card className="b2b-card flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2">
              {theme === "dark" ? <Moon size={18} className="text-ink-2" /> : <Sun size={18} className="text-ink-2" />}
            </div>
            <div className="flex-1">
              <div className="text-[14px] font-black text-ink">{t("profile.appearance")}</div>
              <div className="text-[12px] text-ink-2">
                {theme === "dark" ? t("profile.darkMode") : t("profile.lightMode")}
              </div>
            </div>
            <ThemeToggle />
          </Card>

          <button onClick={() => setSheet("password")} className="text-start">
            <Card className="b2b-card flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2">
                <KeyRound size={18} className="text-ink-2" />
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-black text-ink">
                  {t("profile.changePassword")}
                </div>
                <div className="text-[12px] text-ink-2">{t("profile.changePasswordBlurb")}</div>
              </div>
              <ChevronRight size={16} className="text-ink-3 rtl:rotate-180" />
            </Card>
          </button>
        </div>

        <Button
          variant="ghost"
          fullWidth
          className="mt-8 text-red-600 dark:text-red-300"
          onClick={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        >
          <LogOut size={16} /> {t("common.signOut")}
        </Button>

        <button onClick={() => setSheet("delete")} className="mt-2 flex w-full items-center justify-center gap-2 py-3 text-[13.5px] font-bold text-red-600/70 dark:text-red-300/70">
          <Trash2 size={14} /> {t("profile.deleteAccount")}
        </button>
      </div>
      </div>

      <BottomSheet
        open={sheet === "password"}
        onClose={() => setSheet(null)}
        title={t("profile.changePassword")}
      >
        <ChangePasswordForm
          onDone={() => {
            toast.success(t("profile.passwordChanged"));
            setSheet(null);
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "delete"}
        onClose={() => setSheet(null)}
        title={t("profile.deleteAccount")}
      >
        <DeleteAccountForm
          onDeleted={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        />
      </BottomSheet>
    </PageTransition>
  );
}

function ChangePasswordForm({ onDone }) {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    if (newPassword.length < 8) {
      setError(t("profile.newPasswordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await api.changePassword({ current_password: currentPassword, new_password: newPassword });
      // Changing the password retires every session, this one included.
      // The API hands back a token minted at the new version -- storing it
      // keeps this device signed in while any other device is logged out,
      // which is the point of changing it.
      if (res?.token) setToken(res.token);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t("profile.currentPassword")}
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
      <Input
        label={t("auth.newPassword")}
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <Input
        label={t("auth.confirmNewPassword")}
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="text-[13px] font-bold text-red-600 dark:text-red-300">{error}</p>}
      <Button size="lg" fullWidth loading={loading} disabled={!currentPassword || !newPassword} onClick={submit}>
        {t("profile.changePassword")}
      </Button>
    </div>
  );
}

function DeleteAccountForm({ onDeleted }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await api.deleteAccount({ password });
      onDeleted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] leading-relaxed text-ink-2">
        {t("profile.deleteWarning")}
      </p>
      <Input
        label={t("common.password")}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-[13px] font-bold text-red-600 dark:text-red-300">{error}</p>}
      <Button size="lg" variant="danger" fullWidth loading={loading} disabled={!password} onClick={submit}>
        <Trash2 size={16} /> {t("profile.deleteConfirm")}
      </Button>
    </div>
  );
}
