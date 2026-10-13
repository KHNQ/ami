import { LazyMotion, domMax } from "framer-motion";
import { ThemeProvider } from "../../context/ThemeContext.jsx";
import { SiteConfigProvider } from "../../context/SiteConfigContext.jsx";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { ErrorBoundary } from "../ErrorBoundary.jsx";
import { AiChatProvider } from "../../context/AiChatContext.jsx";

// Shared by both entry-client.jsx (browser) and entry-server.jsx (SSR for
// `/`, `/products/:id`, `/c/:slug` and the marketing pages) -- everything that
// doesn't depend on which Router (Browser vs Memory) is wrapping it. See
// entry-client.jsx's history for why LazyMotion uses `strict` and
// ErrorBoundary sits this far outside.
//
// `domMax`, not `domAnimation`. The difference is layout projection --
// `layoutId`, the shared-element morph where one element appears to become
// another. Several components depend on it (the cult-ui popover morphing out
// of its trigger, the bottom dock's active pill sliding between tabs), and
// under `domAnimation` that does not error: it silently degrades to a
// crossfade, which is the worst kind of bug because the animation still
// "works". Measured cost of the upgrade: vendor-motion 78KB -> 125KB raw,
// 27.5KB -> 40.8KB gzipped.
//
// SiteConfigProvider is above LazyMotion because the feature flags decide what
// renders at all (a buy button versus a "visit us" panel), and that decision
// should not be inside an animation boundary.
export function AppProviders({ children, siteConfig, locale, catalog }) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider initialLocale={locale} initialCatalog={catalog}>
          <SiteConfigProvider initial={siteConfig}>
            <LazyMotion features={domMax} strict>
              {/* Inside LazyMotion so the overlay can animate, and above the
                  router's children so the bottom nav and any page can open
                  the same single assistant. */}
              <AiChatProvider>{children}</AiChatProvider>
            </LazyMotion>
          </SiteConfigProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
