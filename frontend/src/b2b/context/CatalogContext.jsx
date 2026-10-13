import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { SSRDataContext } from "../../lib/ssrDataContext.js";
import { useFeature } from "../../context/SiteConfigContext.jsx";
import { mergeDevices, sellableDevices } from "../lib/mergeProducts.js";

// One fetch of the product catalogue for the whole storefront.
//
// Every surface needs it -- the grid, the device page, the comparison table,
// the ROI model, the quote flows (which have to send a real product id) --
// and each of them fetching independently would mean five requests for one
// list, five loading states, and five chances to disagree about what is in
// stock.
//
// The provider never blocks rendering. It starts from the bundled catalogue,
// which is complete enough to render every page, and swaps in the live rows
// when they arrive. That is what keeps the marketing site up when the API is
// not.

const CatalogContext = createContext(null);

export function CatalogProvider({ children }) {
  const ssrData = useContext(SSRDataContext);
  const pricesVisible = useFeature("show_prices");

  // Seeded from the server render when there is one, so the first client
  // paint already has live stock and product ids rather than showing the
  // bundled fallback and then flipping.
  const [products, setProducts] = useState(() => ssrData?.products || null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Deliberately unfiltered by status.
    //
    // Asking for `status=active` would leave a discontinued device simply
    // absent from the response -- which is indistinguishable from "the API
    // is unreachable", and the fallback for that case is to keep showing
    // the bundled catalogue. The device would therefore stay on sale after
    // an admin retired it. Fetching every row lets mergeProducts see the
    // discontinued status explicitly and drop it, while a genuinely empty
    // or failed response still falls back intact.
    api
      .listProducts({ limit: 100 })
      .then((rows) => {
        if (!cancelled) setProducts(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        // Deliberately not surfaced as an error state on the page. The
        // bundled catalogue is already rendered and correct enough to sell
        // from; an error banner over a working storefront would cost more
        // than the stale stock figure it warns about.
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => {
    const merged = mergeDevices(products);
    const devices = sellableDevices(merged);
    const byId = new Map(devices.map((d) => [d.id, d]));
    return {
      devices,
      // Falls back to the bundled record rather than undefined: a device id
      // that has been discontinued can still arrive from a bookmark or a
      // catalogue hotspot, and the page needs something to render.
      getDevice: (id) => byId.get(id) || merged.find((d) => d.id === id) || merged[0],
      hasDevice: (id) => byId.has(id),
      // True once real rows are in hand. Call sites use it to decide
      // whether a stock figure is worth showing as fact.
      live: Array.isArray(products) && products.length > 0,
      loading: products === null && !error,
      pricesVisible,
      total: devices.length,
    };
  }, [products, error, pricesVisible]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalogue() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalogue must be used inside <CatalogProvider>");
  return ctx;
}
