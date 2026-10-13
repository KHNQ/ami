import logoUrl from "../assets/ashkan-medical-logo.webp";
import { ORG } from "./siteContent.generated.js";

// Company identity, derived from content/ashkan-medical/company.json via
// siteContent.generated.js rather than retyped here -- the address and phone
// numbers in particular were previously duplicated and would have drifted the
// first time either copy was corrected.
export const ORG_NAME = ORG.name;
export const ORG_DESCRIPTION = ORG.description;
export const ORG_LOGO_URL = logoUrl;
export const ORG_CONTACT = {
  email: ORG.email,
  phones: ORG.phones,
  address: ORG.address,
  supportHours: ORG.supportHours,
  map: ORG.map,
};
export const ORG_SOCIAL = ORG.social;

// Same runtime-derivation story as the API host (see lib/api.js): the admin
// console is a separate app on its own port, and hardcoding a hostname here
// would break the moment this is opened from anywhere but the machine that
// built it. VITE_ADMIN_URL wins outright for a real deployment where admin
// lives on its own domain.
const ADMIN_PORT = import.meta.env.VITE_ADMIN_PORT || "5174";

export function adminUrl() {
  const configured = import.meta.env.VITE_ADMIN_URL;
  if (configured) return configured;
  if (typeof window === "undefined") return `http://localhost:${ADMIN_PORT}`;
  return `${window.location.protocol}//${window.location.hostname}:${ADMIN_PORT}`;
}
