import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Boxes, Home, LogOut, MoreHorizontal, Package, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { useAiChat } from "../../context/AiChatContext.jsx";
import { useAiEnabled } from "../ai/useAiEnabled.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";
import {
  ACCOUNT_SECTIONS,
  SECTION_GROUPS,
  groupLabel,
  sectionBlurb,
  sectionLabel,
  sectionsInGroup,
} from "../../b2b/data/sections.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/sheet.jsx";
import { GradientButtonGroup } from "@/components/cult/gradient-button-group.jsx";

// The signed-in dock.
//
// Two things changed here. It now renders over the STOREFRONT as well as the
// account screens -- the storefront is the home page, so a customer who signs
// in and lands on `/` was previously left with no dock at all and had to go
// through the header to reach their orders.
//
// And it is now the site's organiser rather than five account links: four
// destinations plus a More sheet that lists every storefront section and
// every account screen from one registry (b2b/data/sections.js). That is
// what makes it safe for the home page to stop carrying nine sections
// inline -- there is a single, complete index of the site one tap away.
//
// The assistant is an ACTION, not a route: it opens an overlay over wherever
// you already are, which is the whole point of a context-aware assistant. So
// it carries no `to`, is never the active tab, and does not move the pill.
const ROUTES = [
  { to: "/", labelKey: "nav.home", icon: Home, end: true },
  { to: "/devices", labelKey: "nav.devices", icon: Boxes },
  { to: "/orders", labelKey: "nav.orders", icon: Package },
];

// Styled against the storefront's deep panels rather than the old commerce
// app's dark glass. The dock sits over a light canvas now, so `bg-base-850`
// -- which is near-white in the light theme -- would have vanished into it.
export function BottomNav() {
  // useLocation, never window.location: this renders inside SSR'd trees
  // where `window` doesn't exist, and it has to re-render on navigation.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { openChat } = useAiChat();
  const { isAuthed, logout } = useAuth();
  const t = useT();
  const aiEnabled = useAiEnabled();
  const [moreOpen, setMoreOpen] = useState(false);

  // Any navigation closes the sheet -- otherwise tapping a link changes the
  // page behind a panel that stays open over it.
  useEffect(() => setMoreOpen(false), [pathname]);

  const items = [
    ...(aiEnabled
      ? [
          ...ROUTES.slice(0, 2),
          { action: "ai", labelKey: "ai.navLabel", icon: Sparkles },
          ...ROUTES.slice(2),
        ]
      : ROUTES),
    { action: "more", labelKey: "nav.more", icon: MoreHorizontal },
  ];

  const matched = items.findIndex((i) => i.to && (i.end ? pathname === i.to : pathname.startsWith(i.to)));
  // Anywhere that is not one of the four gets to the current page THROUGH
  // the sheet, so that is what should read as active -- falling back to
  // Home would claim you are on the home page from eight other routes.
  const activeIndex = matched >= 0 ? matched : items.length - 1;

  function signOut() {
    logout();
    navigate("/");
  }

  // Signed-out visitors get the storefront's own header and never this dock.
  // Every account destination in it is behind a login. Placed after the
  // hooks, never before: an early return above them would change the hook
  // order between renders.
  if (!isAuthed) return null;

  // The dock is cult-ui's `gradient-button-group`: a recessed metal tray with
  // an inset well and a spinning gold ring behind the active tile. Its tiles
  // are icon-only by design, so each carries an aria-label -- and the labels
  // that used to sit under the icons now live in the More sheet, which is a
  // complete index of the site anyway.
  //
  // The theme toggle it ships with is switched off here: the storefront header
  // already has one, and two toggles that disagree about which is authoritative
  // is worse than none.
  const groupItems = items.map((item) => ({
    id: item.to ?? item.action,
    label: t(item.labelKey),
    icon: <item.icon size={24} strokeWidth={1.6} />,
  }));

  function onSelect(id) {
    const item = items.find((i) => (i.to ?? i.action) === id);
    if (!item) return;
    if (item.action === "ai") openChat();
    else if (item.action === "more") setMoreOpen(true);
    else navigate(item.to);
  }

  return (
    <>
      {/* `fixed`, not `sticky`. The dock is mounted after the footer, and a
          sticky element still occupies its place in the flow -- so it added a
          dock-sized blank band BELOW the footer (the white space under it), and
          the page scrolled past where its content ended. Fixed takes it out of
          the flow; the footer reserves clearance for it (StoreFooter's
          `clearDock`) so the last line is never hidden behind it. */}
      <nav
        aria-label={t("nav.primary")}
        className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2 pt-2 pb-3"
      >
        <div className="pointer-events-auto">
          <GradientButtonGroup
            items={groupItems}
            value={items[activeIndex] ? (items[activeIndex].to ?? items[activeIndex].action) : undefined}
            onSelect={onSelect}
            showThemeToggle={false}
            scaleClassName="scale-[0.58] sm:scale-[0.7] md:scale-[0.8] lg:scale-[0.86]"
            tileClassName="h-[68px] w-[68px]"
          />
        </div>
      </nav>

      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} onSignOut={signOut} />
    </>
  );
}

function LinkRow({ section }) {
  const t = useT();
  const { to, icon: Icon, end } = section;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex min-w-0 items-center gap-3 rounded-2xl border p-3 transition-colors",
          isActive
            ? "border-brand-green/30 bg-brand-green/8"
            : "border-line bg-panel hover:border-brand-green/25"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
              isActive ? "bg-brand-green text-white" : "bg-panel-2 text-ink-2"
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13px] font-black text-ink">{sectionLabel(t, section)}</b>
            <span className="block truncate text-[11.5px] text-ink-2">
              {sectionBlurb(t, section)}
            </span>
          </span>
        </>
      )}
    </NavLink>
  );
}

// The site index. Both halves in one panel: from a customer's point of view
// "my orders" and "the catalogue" are the same site, and splitting them
// across two menus is what produced the header-vs-dock divide in the first
// place.
function MoreSheet({ open, onOpenChange, onSignOut }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="b2b max-h-[86dvh] overflow-y-auto rounded-t-[28px] border-line bg-canvas"
      >
        <SheetHeader className="text-start">
          <SheetTitle className="text-sm font-black text-ink">
            {t("nav.everywhere")}
          </SheetTitle>
          <SheetDescription className="text-[12px] text-ink-2">
            {t("nav.everywhereBody")}
          </SheetDescription>
        </SheetHeader>

        {/* `min-w-0` on every column, not just the rows inside them. A grid
            track is `auto`-sized by default, which means it refuses to
            shrink below its content -- so the truncating rows never got the
            chance to truncate and the fourth column ran off the screen. */}
        <div className="grid gap-5 px-4 pb-6 sm:grid-cols-2 lg:grid-cols-4">
          {SECTION_GROUPS.map((group) => (
            <div key={group} className="min-w-0">
              <h3 className="text-[10px] font-extrabold tracking-[0.14em] text-ink-3 uppercase">
                {groupLabel(t, group)}
              </h3>
              <div className="mt-2 grid gap-2">
                {sectionsInGroup(group).map((s) => (
                  <LinkRow key={s.to} section={s} />
                ))}
              </div>
            </div>
          ))}

          <div className="min-w-0">
            <h3 className="text-[10px] font-extrabold tracking-[0.14em] text-ink-3 uppercase">
              {t("nav.yourAccount")}
            </h3>
            <div className="mt-2 grid gap-2">
              {ACCOUNT_SECTIONS.map((s) => (
                <LinkRow key={s.to} section={s} />
              ))}
              <button
                type="button"
                onClick={onSignOut}
                className="flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-start hover:border-red-400/40"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-300">
                  <LogOut className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[13px] font-black text-ink">
                    {t("common.signOut")}
                  </b>
                  <span className="block truncate text-[11.5px] text-ink-2">
                    {t("nav.signOutBlurb")}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-line px-4 py-3 text-center">
          <Link to="/" className="text-[11.5px] font-bold text-ink-2 hover:text-ink">
            Ashkan Medical Idea · FDA · CE · ISO 13485
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
