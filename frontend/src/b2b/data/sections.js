import {
  BookOpen,
  Boxes,
  Calculator,
  Columns3,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Newspaper,
  Package,
  User,
  Users,
} from "lucide-react";

// The storefront's destination registry.
//
// Every place that has to enumerate "where can you go from here" reads this
// file: the header nav, the footer, the home page's directory grid and the
// bottom dock's More sheet. Before this existed each of those carried its
// own hand-written list, which is how the home page ended up rendering the
// full contents of six routes inline -- there was no shared notion of what
// a route WAS, so the easiest way to add a feature was to paste it onto the
// home page.
//
// Each entry carries a `key`, not its words. The label, the title and the
// directory blurb all live in the locale catalogs under `store.section.<key>`
// -- this file is the registry of WHERE you can go and what it looks like,
// and a route's name in five languages is not that. Read them with the
// helpers at the bottom; `nav` marks the handful that earn a slot in the
// desktop header, which has room for about seven.

export const STOREFRONT_SECTIONS = [
  {
    to: "/devices",
    key: "devices",
    icon: Boxes,
    group: "Buying",
    nav: true,
  },
  {
    to: "/catalog",
    key: "catalog",
    icon: BookOpen,
    group: "Buying",
    nav: true,
  },
  {
    to: "/compare",
    key: "compare",
    icon: Columns3,
    group: "Buying",
  },
  {
    to: "/installations",
    key: "installations",
    icon: MapPin,
    group: "Proof",
    nav: true,
  },
  {
    to: "/tools",
    key: "tools",
    icon: Calculator,
    group: "Proof",
  },
  {
    to: "/blog",
    key: "blog",
    icon: Newspaper,
    group: "Proof",
    nav: true,
  },
  {
    to: "/affiliate",
    key: "affiliate",
    icon: Handshake,
    group: "Owning",
    nav: true,
  },
];

// The signed-in half. Kept in the same file because the bottom dock and the
// account dashboard present both halves as one list -- from a customer's
// point of view "my orders" and "the catalogue" are the same site.
export const ACCOUNT_SECTIONS = [
  {
    to: "/account",
    key: "account",
    icon: LayoutDashboard,
    group: "Account",
    end: true,
  },
  {
    to: "/orders",
    key: "orders",
    icon: Package,
    group: "Account",
  },
  {
    to: "/network",
    key: "network",
    icon: Users,
    group: "Account",
  },
  {
    to: "/contact",
    key: "support",
    icon: LifeBuoy,
    group: "Account",
  },
  {
    to: "/profile",
    key: "profile",
    icon: User,
    group: "Account",
  },
];

/** The header's links. */
export const HEADER_NAV = STOREFRONT_SECTIONS.filter((s) => s.nav);

/** Directory groups, in the order a buyer works through them. */
export const SECTION_GROUPS = ["Buying", "Proof", "Owning"];

export function sectionsInGroup(group) {
  return STOREFRONT_SECTIONS.filter((s) => s.group === group);
}

// --- reading a section's words -------------------------------------------
//
// Helpers rather than properties, because a section's copy depends on the
// reader and this module is imported once at boot. Each takes the `t` from
// useT() so the component stays the thing that knows the locale.

export const sectionLabel = (t, section) => t(`store.section.${section.key}.label`);
export const sectionTitle = (t, section) => t(`store.section.${section.key}.title`);
export const sectionBlurb = (t, section) => t(`store.section.${section.key}.blurb`);
/** "Buying" / "Proof" / "Owning" / "Account", translated. */
export const groupLabel = (t, group) => t(`store.group.${group.toLowerCase()}`);
