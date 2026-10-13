import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, X, Command } from "lucide-react";
import { cn } from "@shared/lib/cn.js";
import { ThemeToggle } from "@shared/components/ui/ThemeToggle.jsx";
import { Avatar } from "@shared/components/ui/Avatar.jsx";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { AdminSidebar } from "./AdminSidebar.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { describeRole } from "../lib/scopes.js";


// The control room shell.
//
// A fixed sidebar on desktop and a drawer below it. Deliberately NOT the
// storefront's centred phone column: this is a desk tool whose primary
// instrument is a wide table, and the two apps sharing a design system does
// not mean they should share a layout.
//
// No BackgroundGlow here either, unlike the storefront. Decorative bloom
// behind a dense table of figures is noise -- the surface should recede
// completely and let the data be the only thing with contrast.
export function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout, can } = useAdminAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [badges, setBadges] = useState({});
  // Which features this deployment actually runs. Starts empty so a page for
  // something switched off never flashes into the nav before the answer
  // arrives; /site-config is public and cached, so this is one cheap call.
  const [features, setFeatures] = useState({});

  useEffect(() => {
    let cancelled = false;
    api
      .siteConfig()
      .then((res) => !cancelled && res && setFeatures(res))
      .catch(() => {
        // A failed read leaves the optional pages hidden, which is the safe
        // way round: their routes are still reachable by URL for anyone who
        // knows them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the drawer on navigation, or it stays open over the page the
  // visitor just asked for.
  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Counts on the nav items for work that arrives on its own: new support
  // requests and new proforma requests have a person waiting on the other end,
  // so they are the numbers worth surfacing before you click.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (can("support.read_all")) {
        api
          .listSupportRequests({ status: "new", limit: 1 })
          .then((res) => !cancelled && setBadges((b) => ({ ...b, support: res.summary?.find((x) => x.status === "new")?.n || 0 })))
          .catch(() => {});
      }
      if (can("sales.read")) {
        api
          .listQuotes({ status: "new", limit: 1 })
          .then((res) => !cancelled && setBadges((b) => ({ ...b, proformas: res.summary?.quotes?.byStatus?.new || 0 })))
          .catch(() => {});
      }
      // Questions the assistant could not answer. Surfaced in the nav because
      // it is work that arrives on its own and would otherwise be invisible
      // until somebody thought to look.
      // ...but only when the assistant exists at all: with it switched off
      // /ai/* answers 503, and polling a feature that is off just fills the
      // console and the server log with errors.
      if (can("content.write") && features.ai_chat_enabled) {
        api
          .listKnowledge()
          .then((res) => !cancelled && setBadges((b) => ({ ...b, gaps: res.gaps_open || 0 })))
          .catch(() => {});
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [can, features.ai_chat_enabled]);

  return (
    <div className="flex min-h-dvh bg-bg">
      {/* --- desktop sidebar --- */}
      <aside className="sticky top-0 hidden h-dvh w-[228px] shrink-0 flex-col border-e border-surface/8 bg-surface/[0.015] px-3 lg:flex">
        <BrandMark />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminSidebar badges={badges} features={features} />
        </div>
        <UserFooter user={user} onSignOut={() => { logout(); navigate("/", { replace: true }); }} />
      </aside>

      {/* --- mobile drawer --- */}
      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          />
          <aside className="fixed inset-y-0 start-0 z-50 flex w-[264px] flex-col border-e border-surface/10 bg-bg px-3 shadow-2xl lg:hidden">
            <BrandMark onClose={() => setDrawerOpen(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AdminSidebar badges={badges} features={features} onNavigate={() => setDrawerOpen(false)} />
            </div>
            <UserFooter user={user} onSignOut={() => { logout(); navigate("/", { replace: true }); }} />
          </aside>
        </>
      )}

      {/* --- content --- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-surface/8 bg-bg/85 px-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg/60 hover:bg-surface/8 hover:text-fg lg:hidden"
          >
            <Menu size={18} />
          </button>

          <span className="rounded-md border border-brand-green/25 bg-brand-green/8 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-brand-green">
            {describeRole(user?.staff_role)}
          </span>

          <div className="flex-1" />
          <ThemeToggle />
        </header>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function BrandMark({ onClose }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-white">
        <Command size={15} />
      </span>
      <span className="flex-1 text-[14px] font-extrabold tracking-tight text-fg">Control Room</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg/45 hover:bg-surface/8"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function UserFooter({ user, onSignOut }) {
  return (
    <div className="shrink-0 border-t border-surface/8 py-2.5">
      <div className="flex items-center gap-2.5 px-2.5">
        <Avatar name={user?.name} size={26} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-fg/80">{user?.name}</p>
          <p className="truncate text-[11px] text-fg/35">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg/40 hover:bg-surface/8 hover:text-fg"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}

/**
 * The standard page frame: title, one line of context, and actions.
 *
 * Exported from here so every page picks up the same rhythm without each one
 * inventing its own heading size and margins -- which is exactly how a
 * back-office tool ends up looking like sixteen different tools.
 */
export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="border-b border-surface/8 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-extrabold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] text-fg/45">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Standard content padding, so pages don't each pick their own. */
export function PageBody({ children, className }) {
  return <div className={cn("px-5 py-5", className)}>{children}</div>;
}
