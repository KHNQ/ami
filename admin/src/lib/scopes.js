// What each staff scope is for, in plain words. The permission lists
// themselves come from the API (GET /admin/roles) so this file never has to be
// kept in step with src/lib/permissions.js -- only the human description lives
// here.
export const SCOPES = [
  {
    value: "FINANCE_ADMIN",
    label: "Finance",
    blurb: "Money: orders, cheques, payouts, proformas and lease requests, pricing and lease terms.",
  },
  {
    value: "USERS_ADMIN",
    label: "Users",
    blurb: "People: accounts, referral networks, applicants and the support inbox.",
  },
  {
    value: "CONTENT_ADMIN",
    label: "Content",
    blurb: "The public site: blog posts and the assistant's answers. (Stock, Settings and SEO are not included.)",
  },
];

/** "Root admin", "Finance + Content", … for a stored staff_role. */
export function describeRole(staffRole) {
  if (!staffRole || staffRole === "root") return staffRole === "root" ? "Root admin" : "Staff";
  return staffRole
    .split(",")
    .map((s) => SCOPES.find((x) => x.value === s)?.label ?? s)
    .join(" + ");
}

/** Stored staff_role -> array of scopes (or ["root"]). */
export function scopesOf(staffRole) {
  if (!staffRole) return [];
  if (staffRole === "root") return ["root"];
  return staffRole.split(",").filter(Boolean);
}
