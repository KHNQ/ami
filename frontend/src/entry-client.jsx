import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { AppProviders } from "./components/layout/AppProviders.jsx";
import { splitLocalePath } from "./i18n/config.js";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { SSRDataContext } from "./lib/ssrDataContext.js";
import { PwaLayer } from "./components/pwa/PwaLayer.jsx";

// entry-server.jsx (for `/` and `/products/:id`) embeds the data it
// fetched as `window.__SSR_DATA__` so the client's first render matches
// the server's exactly -- no refetch-then-flash, no hydration mismatch.
// Every other route never has this set, so it's undefined -> SSRDataContext
// stays null -> pages fall back to their normal useAsync fetch.
const ssrData = typeof window !== "undefined" ? window.__SSR_DATA__ : undefined;

// The locale lives in the URL as a prefix (`/fa/products/123`). Handing it to
// the router as a basename means every <Route path> and every <Link to> in the
// app stays written unprefixed, and the prefix is added and stripped in exactly
// one place. The alternative -- wrapping the whole route table in an optional
// `:locale` segment -- would make every path in the app conditional.
const { locale } = splitLocalePath(window.location.pathname);
const basename = locale === "en" ? undefined : `/${locale}`;

const tree = (
  <StrictMode>
    <AppProviders siteConfig={ssrData?.siteConfig} locale={locale}>
      <BrowserRouter basename={basename}>
        <ToastProvider>
          <AuthProvider>
            <SSRDataContext.Provider value={ssrData ?? null}>
              <App />
              {/* Client-only: install/update/offline all depend on browser
                  APIs that have no server equivalent, and rendering it in
                  entry-server would guarantee a hydration mismatch. */}
              <PwaLayer />
            </SSRDataContext.Provider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </AppProviders>
  </StrictMode>
);

const container = document.getElementById("root");

// SSR'd pages arrive with markup already in #root -- hydrate over it.
// Every other route (the vast majority of the app) gets a plain client
// render, exactly as before entry-client.jsx replaced main.jsx.
if (container.hasChildNodes()) {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}
