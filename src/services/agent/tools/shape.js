// Shared shaping for tool results.
//
// Money is stored in integer minor units everywhere in this app. Handing the
// model a bare `4200000` invites it to say "4,200,000" — so every amount
// crosses the boundary already formatted, with the number it should quote and
// the raw value beside it for arithmetic.

export function money(cents, currency = "USD") {
  if (cents == null) return null;
  const amount = cents / 100;
  return {
    display: `${currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    amount,
    currency,
    cents,
  };
}
