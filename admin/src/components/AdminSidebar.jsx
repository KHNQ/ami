import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, ShoppingBag, PlusCircle, ReceiptText, Inbox, Boxes,
  Users, LifeBuoy, ShieldCheck,
  FileText, SlidersHorizontal, BarChart3, Send, ScrollText, Brain, Bot, HandCoins,
} from "lucide-react";
import { cn } from "@shared/lib/cn.js";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";

// The control room's navigation.
//
// Previously this was sixteen pills in one horizontally-scrolling strip. That
// is a phone pattern, and it fails badly for a tool people work in all day:
// half the destinations were off-screen and nothing expressed which ones are
// the same job.
//
// Grouping is the fix. Five groups named after the job being done, so someone
// looking for a walk-in sale scans one heading rather than sixteen labels.
//
// Every item still declares the permission its page needs, and this remains
// presentation only -- every route re-checks server-side. Hiding a tab is a
// courtesy so a content admin isn't offered nine links that 403; it is not the
// security control.
export const NAV_GROUPS = [
  {
    label: "Commerce",
    items: [
      { to: "/", label: "Overview", end: true, permission: "reports.read", icon: LayoutDashboard },
      { to: "/orders", label: "Orders", permission: "orders.read_all", icon: ShoppingBag },
      { to: "/orders/manual", label: "New walk-in", permission: "orders.create_manual", icon: PlusCircle },
      { to: "/proformas", label: "Proformas", permission: "sales.read", icon: Inbox, badge: "proformas" },
      { to: "/products", label: "Stock", permission: "catalogue.write", icon: Boxes },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/cheques", label: "Cheques", permission: "cheques.read", icon: ReceiptText },
      { to: "/payouts", label: "Network payouts", permission: "money.read", icon: HandCoins },
      { to: "/reports", label: "Reports", permission: "reports.read", icon: BarChart3 },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/users", label: "People", permission: "users.read", icon: Users },
      { to: "/support", label: "Support requests", permission: "support.read_all", icon: LifeBuoy, badge: "support" },
      { to: "/admins", label: "Admins & access", permission: "admins.manage", icon: ShieldCheck },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/blog", label: "Blog", permission: "content.write", icon: FileText },
      {
        to: "/knowledge",
        label: "AI knowledge",
        permission: "content.write",
        icon: Brain,
        badge: "gaps",
        // Hidden outright when the assistant is switched off for the
        // deployment: curating answers for something that cannot answer is
        // busywork, and the pages behind these links 503.
        feature: "ai_chat_enabled",
      },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/settings", label: "Settings & SEO", permission: "settings.read", icon: SlidersHorizontal },
      { to: "/notifications", label: "Messages", permission: "logs.read", icon: Send },
      { to: "/logs", label: "Audit log", permission: "logs.read", icon: ScrollText },
      { to: "/ai-activity", label: "Assistant activity", permission: "logs.read", icon: Bot, feature: "ai_chat_enabled" },
    ],
  },
];

function NavItem({ item, badgeCount, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors",
          isActive ? "bg-surface/10 text-fg" : "text-fg/55 hover:bg-surface/6 hover:text-fg/85"
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The active marker is a rail on the inline edge rather than a
              filled pill. At this density sixteen filled pills would be a
              wall of colour; a 2px rail reads instantly and costs nothing. */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-1 start-0 w-[2px] rounded-full transition-opacity",
              isActive ? "bg-brand-gradient opacity-100" : "opacity-0"
            )}
          />
          <Icon size={15} className={cn("shrink-0", isActive ? "text-brand-green" : "text-fg/35")} />
          <span className="flex-1 truncate">{item.label}</span>
          {badgeCount > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-amber-500">
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function AdminSidebar({ badges = {}, features = {}, onNavigate }) {
  const { can } = useAdminAuth();

  // Two filters, and they answer different questions: `can` is "may this
  // person see it", `feature` is "does this deployment run it at all".
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => can(i.permission) && (!i.feature || features[i.feature])),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="flex flex-col gap-5 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-fg/30">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavItem key={item.to} item={item} badgeCount={badges[item.badge]} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
