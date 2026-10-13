// Small shared input checks. Kept here so the places that create an account
// (sign-up, an admin creating another admin) agree on what a valid one is.

// Deliberately the same loose shape support requests already use: something,
// an @, something, a dot, something -- no whitespace. Real verification is the
// confirmation email; this only stops obvious junk ("not-an-email") becoming
// an account that can never be reached or recovered.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 path limit

export function isValidEmail(value) {
  return typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value.trim());
}
