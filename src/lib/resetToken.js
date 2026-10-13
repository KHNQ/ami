// Password-reset tokens are security-bearing bearer credentials, not
// human-typed codes -- deliberately NOT reusing lib/id.js's `newCode()`
// (only ~40 bits from a 32-char alphabet, sized for a person to type in by
// hand) since that's far too low-entropy to resist online guessing.

export function newResetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// SHA-256, not bcrypt: the raw token already has 256 bits of entropy, so a
// fast deterministic hash is the right tool here -- bcrypt's slow cost
// factor exists to protect low-entropy, human-chosen passwords, and paying
// that cost on every reset-token lookup would just be wasted CPU (and a
// cheap way to burn the rate limit budget with garbage tokens).
export function hashResetToken(raw) {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}
