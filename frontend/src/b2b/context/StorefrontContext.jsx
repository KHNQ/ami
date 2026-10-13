import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCatalogue } from "./CatalogContext.jsx";
import { lockHash } from "../lib/finance.js";

// One store for everything that is shared between distant parts of the
// storefront: the comparison tray, the proforma dialog, and the Rial price
// locks.
//
// These specifically cannot live in the components that trigger them. A
// device card, the catalogue hotspot layer, the compare bar and the device
// page's lease tab all open the same proforma flow, and the comparison tray
// has to survive navigating from the shop grid to a device page and back.
// Prop drilling that through six levels was the alternative.

const StorefrontContext = createContext(null);

const MAX_COMPARE = 3;
const STORAGE_KEY = "ashkan-storefront-v1";

// A visitor's comparison and price locks are persisted rather than kept in
// memory -- coming back tomorrow should find the lock still counting down,
// not a blank page.
function loadPersisted() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function StorefrontProvider({ children }) {
  // Devices are resolved through the catalogue rather than the bundled file
  // so that the comparison tray, the quote flows and the toasts all quote
  // the same live price and carry the same product id the API knows.
  // This provider is mounted inside CatalogProvider (see StorefrontLayout).
  const { getDevice, hasDevice } = useCatalogue();

  const persisted = useRef(null);
  if (persisted.current === null) persisted.current = loadPersisted();

  // Ids only. They are checked against the live catalogue where they are
  // read (see compareDevices below), not here: the catalogue arrives after
  // first render, and a device an admin created is not in any bundled list.
  const [compare, setCompare] = useState(() =>
    (persisted.current.compare || []).slice(0, MAX_COMPARE)
  );
  const [locks, setLocks] = useState(() => persisted.current.locks || {});

  // { deviceId, enquiry, lease } | null. `lease` is { months, upfrontPct }
  // when the dialog was opened from a device's lease tab, and pre-selects
  // that financing in the form.
  const [rfq, setRfq] = useState(null);
  const [toast, setToast] = useState(null);

  // Persist the durable slice only. The open/closed state of a modal is not
  // something to restore a day later -- reopening a dialog nobody asked for
  // is worse than losing it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ compare, locks }));
    } catch {
      // Private browsing / quota. The session still works, it just won't
      // survive a reload -- not worth surfacing to the visitor.
    }
  }, [compare, locks]);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleCompare = useCallback(
    (id) => {
      setCompare((list) => {
        if (list.includes(id)) return list.filter((x) => x !== id);
        if (list.length >= MAX_COMPARE) {
          notify(`Comparison holds ${MAX_COMPARE} devices — remove one first.`, "warning");
          return list;
        }
        return [...list, id];
      });
    },
    [notify]
  );

  const clearCompare = useCallback(() => setCompare([]), []);

  const lockPrice = useCallback(
    (deviceId) => {
      const device = getDevice(deviceId);
      const hash = `LOCK-${lockHash(deviceId)}`;
      setLocks((l) => ({ ...l, [deviceId]: { startedAt: Date.now(), hash } }));
      notify(`Rial rate locked for ${device.name} — reference ${hash}. Valid 7 days.`);
      return hash;
    },
    [notify, getDevice]
  );

  // `enquiry` names a product we do not list -- a machine printed in the
  // catalogue that has no device page. The quote flow then asks about that
  // by name instead of silently substituting the nearest thing we do sell.
  //
  // `lease` ({ months, upfrontPct }) carries what the visitor configured on
  // the lease tab, so the dialog opens already on that financing.
  const openRfq = useCallback((deviceId = null, enquiry = null, lease = null) => {
    setRfq({ deviceId, enquiry, lease });
  }, []);

  const closeRfq = useCallback(() => setRfq(null), []);

  const value = useMemo(
    () => ({
      compare,
      // A stored id for a device we no longer sell would otherwise resolve to
      // a stranger (getDevice falls back to the first device) and put the
      // wrong machine in the comparison.
      compareDevices: compare.filter(hasDevice).map(getDevice),
      maxCompare: MAX_COMPARE,
      toggleCompare,
      clearCompare,
      isComparing: (id) => compare.includes(id),

      locks,
      lockPrice,
      lockFor: (id) => locks[id] || null,

      rfq,
      openRfq,
      closeRfq,

      toast,
      notify,
      dismissToast: () => setToast(null),
    }),
    [
      compare,
      getDevice,
      hasDevice,
      toggleCompare,
      clearCompare,
      locks,
      lockPrice,
      rfq,
      openRfq,
      closeRfq,
      toast,
      notify,
    ]
  );

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

export function useStorefront() {
  const ctx = useContext(StorefrontContext);
  if (!ctx) throw new Error("useStorefront must be used inside <StorefrontProvider>");
  return ctx;
}
