import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { LanguageSwitcher } from "../../components/ui/LanguageSwitcher.jsx";
import { ThemeToggle } from "../../components/ui/ThemeToggle.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { PillButton } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { HEADER_NAV, sectionLabel } from "../data/sections.js";
import { useT } from "../../i18n/I18nProvider.jsx";
import logoUrl from "../../assets/ashkan-medical-logo.webp";
import { Button } from "@/components/shadcn/button.jsx";
import { Separator } from "@/components/shadcn/separator.jsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/shadcn/sheet.jsx";

// One list, shared with the footer, the home page's directory and the
// bottom dock's More sheet -- see b2b/data/sections.js for why.
const NAV = HEADER_NAV;

export function StoreHeader() {
  const t = useT();
  const { openRfq } = useStorefront();
  const { isAuthed } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Any navigation closes the drawer. Without this, tapping a link on a
  // phone changes the page behind a sheet that stays open over it.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-panel/90 backdrop-blur-xl">
      <div className="b2b-container flex items-center justify-between gap-4 py-3">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <img src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-xl object-contain" />
          <span className="hidden leading-tight sm:block">
            <b className="block text-[13px] font-black tracking-tight text-ink">ASHKAN MEDICAL</b>
            <span className="block text-[9px] font-bold tracking-[0.18em] text-ink-2">
              {t("store.header.since")}
            </span>
          </span>
          <span className="ms-1 hidden rounded-full border border-brand-green/25 bg-brand-green/10 px-2 py-1 text-[9px] font-black tracking-wide text-brand-green 2xl:inline">
            FDA ✓ CE ✓ ISO 13485 ✓
          </span>
        </Link>

        <nav className="hidden items-center gap-4 xl:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "border-b-2 py-1.5 text-[13px] font-bold transition-colors",
                  isActive
                    ? "border-brand-green text-ink"
                    : "border-transparent text-ink-2 hover:border-brand-green/40 hover:text-ink"
                )
              }
            >
              {sectionLabel(t, item)}
            </NavLink>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle className="border-line bg-panel-2 text-ink max-sm:hidden" />
          <LanguageSwitcher className="max-sm:hidden" compact />
          <PillButton as={Link} to="/devices#search" variant="white" size="sm" className="max-2xl:hidden">
            <Search className="h-3.5 w-3.5" />
            {t("store.header.smartSearch")}
          </PillButton>
          <PillButton size="sm" onClick={() => openRfq()} className="max-sm:hidden">
            {t("store.cta.requestProforma")}
          </PillButton>
          {/* The commerce app is a different product behind the same brand.
              One link, not a second nav -- a clinic that has bought is
              looking for their portal, everyone else is not. */}
          <PillButton
            as={Link}
            to={isAuthed ? "/account" : "/login"}
            variant="white"
            size="sm"
            className="max-xl:hidden"
          >
            {isAuthed ? t("store.header.myPortal") : t("common.signIn")}
          </PillButton>

          {/* Radix Sheet rather than a conditionally rendered <div>: it traps
              focus, closes on Escape, locks the background scroll and marks
              the page behind it inert -- all of which a hand-rolled drawer
              has to get right and usually does not. */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("store.header.openMenu")}
                className="h-10 w-10 rounded-full border-line bg-panel-2 text-ink xl:hidden"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(20rem,88vw)] border-line bg-panel">
              <SheetHeader className="text-start">
                <SheetTitle className="text-sm font-black text-ink">Ashkan Medical Idea</SheetTitle>
                <SheetDescription className="text-[12px] text-ink-2">
                  {t("store.header.credentials")}
                </SheetDescription>
              </SheetHeader>

              <nav className="grid gap-1 px-4">
                {NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "rounded-xl px-3 py-2.5 text-sm font-bold",
                        isActive ? "bg-panel-2 text-ink" : "text-ink-2"
                      )
                    }
                  >
                    {sectionLabel(t, item)}
                  </NavLink>
                ))}
              </nav>

              <Separator className="my-2 bg-line" />

              <div className="grid gap-2 px-4 pb-4">
                <PillButton fullWidth onClick={() => openRfq()}>
                  {t("store.cta.requestProforma")}
                </PillButton>
                <div className="flex items-center gap-2">
                  <ThemeToggle className="border-line bg-panel-2 text-ink" />
                  <LanguageSwitcher compact />
                </div>
                <Link
                  to={isAuthed ? "/account" : "/login"}
                  className="rounded-xl px-3 py-2.5 text-sm font-bold text-ink-2"
                >
                  {isAuthed ? t("store.header.myPortal") : t("common.signIn")}
                </Link>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
