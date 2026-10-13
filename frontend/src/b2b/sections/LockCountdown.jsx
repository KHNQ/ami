import { useEffect, useState } from "react";
import { PRICE_LOCK_DAYS, formatCountdown, lockRemaining } from "../lib/finance.js";
import { useT } from "../../i18n/I18nProvider.jsx";

// A live countdown on a price lock.
//
// It counts down from when the visitor actually locked the rate, so it is a
// real deadline rather than a permanently-resetting urgency prop. Ticks once
// a second only while more than an hour remains is *not* what happens here:
// it ticks every second throughout, because inside the last hour the seconds
// are the point, and one interval per mounted card is cheap.
export function LockCountdown({ startedAt, days = PRICE_LOCK_DAYS, className }) {
  const t = useT();
  const [remaining, setRemaining] = useState(() => lockRemaining(startedAt, days));

  useEffect(() => {
    setRemaining(lockRemaining(startedAt, days));
    const id = setInterval(() => setRemaining(lockRemaining(startedAt, days)), 1000);
    return () => clearInterval(id);
  }, [startedAt, days]);

  return (
    <span className={`b2b-tnum font-black ${className || ""}`}>{formatCountdown(remaining, t)}</span>
  );
}
