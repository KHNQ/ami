// A member's referral link looks like  /devices/<device>?ref=<their code>.
//
// The visitor who follows it may not ask for a proforma on that visit -- they
// browse, close the tab, come back through the home page a day later. So the
// code is remembered, not read from the URL at the moment of asking, and it
// is remembered together with the device it was issued for: a redeem code only
// attaches a buyer to the tree of the device it belongs to, so using it for
// any other device would be wrong however it got here.
//
// localStorage can be absent or throw (private windows, blocked storage, SSR),
// and a referral is never worth failing a page over -- every access is guarded
// and a missing store simply means "no referral".

const KEY = "trex_referral";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

/** Remembers `code` as the referral for `deviceId`. Ignores anything that is not shaped like a code. */
export function rememberReferral(code, deviceId) {
  const clean = typeof code === "string" ? code.trim() : "";
  if (!CODE_PATTERN.test(clean) || !deviceId) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: clean, deviceId, at: Date.now() }));
  } catch {
    /* storage unavailable -- the referral is lost, the visit is not */
  }
}

/** The remembered code, only if it was issued for `deviceId` and has not gone stale. */
export function recallReferral(deviceId) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!stored || stored.deviceId !== deviceId) return null;
    if (Date.now() - stored.at > TTL_MS) return null;
    return stored.code;
  } catch {
    return null;
  }
}

/** The link a member shares for one device. */
export function referralLink(origin, deviceId, code) {
  return `${origin}/devices/${encodeURIComponent(deviceId)}?ref=${encodeURIComponent(code)}`;
}
