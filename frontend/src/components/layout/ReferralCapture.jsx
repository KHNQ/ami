import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { rememberReferral } from "../../lib/referral.js";

// Picks the `?ref=` code off a device link and remembers it.
//
// Lives at the top of the app rather than on the device page, because the
// link is handed out for a device but the visitor may land anywhere a
// redirect or a shared preview sends them.
export function ReferralCapture() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const code = new URLSearchParams(search).get("ref");
    if (!code) return;
    const match = /^\/devices\/([^/]+)/.exec(pathname);
    if (match) rememberReferral(code, decodeURIComponent(match[1]));
  }, [pathname, search]);

  return null;
}
