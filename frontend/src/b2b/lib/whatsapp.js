import { ORG_CONTACT } from "../../lib/orgInfo.js";

// WhatsApp is the default business channel in this market -- a "send this to
// WhatsApp" button converts far better than an email form, and the message
// has to arrive already filled in or the visitor abandons at the keyboard.
//
// The number is taken from the org record rather than hardcoded, so it
// changes in one place, and stripped to digits because wa.me rejects the
// spaces and dashes a human-readable phone number carries.
function businessNumber() {
  const raw = ORG_CONTACT.phones?.[0] || "";
  const digits = String(raw).replace(/\D/g, "");
  // Iranian numbers are written locally as 021-… ; wa.me needs the country
  // code, so a leading 0 is swapped for 98.
  if (digits.startsWith("0")) return `98${digits.slice(1)}`;
  return digits;
}

function link(text) {
  const number = businessNumber();
  const base = number ? `https://wa.me/${number}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function whatsappCatalog(pageNumber) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/catalog` : "";
  return link(
    `Ashkan Products 2024 — interactive catalog (12 pages)${
      pageNumber ? `, page ${pageNumber}` : ""
    }: ${url} — every device is clickable, with 3D, ROI and proforma.`
  );
}

export function whatsappGeneral(message) {
  return link(message);
}
