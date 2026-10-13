// All money is integer minor units (cents). Invariant 6: commission amounts
// always round DOWN; residual fractions accumulate to trex_net, never to
// the payout pool.

export function bpOf(amountCents, bp) {
  // floor(amount * bp / 10000), done in integer arithmetic to avoid float drift.
  return Math.floor((amountCents * bp) / 10000);
}

export function pctBpToFraction(bp) {
  return bp / 10000;
}

export function assertNonNegativeInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer (cents), got ${value}`);
  }
}
