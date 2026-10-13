import { renderToReadableStream } from "react-dom/server";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StorefrontLayout } from "./b2b/layout/StorefrontLayout.jsx";
import StoreHomePage from "./b2b/pages/StoreHomePage.jsx";
import DevicesPage from "./b2b/pages/DevicesPage.jsx";
import DevicePage from "./b2b/pages/DevicePage.jsx";
import CatalogPage from "./b2b/pages/CatalogPage.jsx";
import { AffiliatePage, InstallationsPage, ToolsPage } from "./b2b/pages/featurePages.jsx";
import { BlogIndexPage, BlogPostPage } from "./b2b/pages/BlogPages.jsx";
import ContactPage from "./pages/ContactPage.jsx";
import ProductDetailPage from "./pages/ProductDetailPage.jsx";
import CategoryPage from "./pages/CategoryPage.jsx";
import PartnersPage from "./pages/PartnersPage.jsx";
import OurStoryPage from "./pages/OurStoryPage.jsx";
import CareersPage from "./pages/CareersPage.jsx";
import { AppProviders } from "./components/layout/AppProviders.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { SSRDataContext } from "./lib/ssrDataContext.js";
import en from "./i18n/locales/en.json";
import fa from "./i18n/locales/fa.json";
import ar from "./i18n/locales/ar.json";
import fr from "./i18n/locales/fr.json";
import itCatalog from "./i18n/locales/it.json";

// Statically imported, unlike on the client: the render is synchronous, so
// there is no opportunity to await a dynamic import mid-tree. This bundle only
// ever runs on the server, so the extra weight never reaches a browser.
const CATALOGS = { en, fa, ar, fr, it: itCatalog };

// Used only by server.js for the two SSR'd routes. Deliberately renders
// HomePage/ProductDetailPage directly (statically imported here, not via
// App.jsx's `lazy()` route table) rather than the full app's <Routes> --
// React.lazy suspends indefinitely under a plain renderToReadableStream
// with no client to resolve the chunk, so going through App.jsx's lazy
// ProductDetailPage route would never actually render real content.
// MemoryRouter (not the newer data-router SSR APIs) is enough here because
// this app's routing is plain declarative <Routes>/<Route> with no
// loaders/actions -- it gives Link/useParams/useNavigate a working Router
// context with zero data-router ceremony.
//
// No head-tag library needed: React 19 hoists <title>/<meta>/<link>
// rendered anywhere in the tree (see HomePage.jsx/ProductDetailPage.jsx)
// to the front of this render's output automatically, both here and on
// the client. server.js splits that leading run out into the real <head>.
export async function render(url, ssrData) {
  const stream = await renderToReadableStream(
    <AppProviders siteConfig={ssrData?.siteConfig} locale={ssrData?.locale} catalog={CATALOGS[ssrData?.locale]}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <AuthProvider>
            <SSRDataContext.Provider value={ssrData}>
              <Routes>
                {/* The storefront is rendered through its real layout, not
                    just its page: the header, the credential strip and the
                    footer carry the copy a crawler and a link-preview bot
                    read first, and they live in the layout. The 3D stage
                    inside it is inert on the server (LazyDeviceStage only
                    probes for WebGL in an effect), so this stays a
                    synchronous render. */}
                <Route element={<StorefrontLayout />}>
                  <Route path="/" element={<StoreHomePage />} />
                  <Route path="/devices" element={<DevicesPage />} />
                  <Route path="/devices/:id" element={<DevicePage />} />
                  <Route path="/catalog" element={<CatalogPage />} />
                  {/* The feature routes. They must be listed HERE as well as
                      in server.js: this table is the SSR router, and a path
                      server.js server-renders but this does not match
                      produces a 27 KB response containing the providers and
                      no page at all -- worse than the plain SPA shell,
                      because it looks like it worked. */}
                  <Route path="/installations" element={<InstallationsPage />} />
                  <Route path="/tools" element={<ToolsPage />} />
                  <Route path="/affiliate" element={<AffiliatePage />} />
                  <Route path="/blog" element={<BlogIndexPage />} />
                  <Route path="/blog/:slug" element={<BlogPostPage />} />
                  <Route path="/contact" element={<ContactPage />} />
                </Route>
                <Route path="/products/:id" element={<ProductDetailPage />} />
                <Route path="/c/:slug" element={<CategoryPage />} />
                <Route path="/partners" element={<PartnersPage />} />
                <Route path="/our-story" element={<OurStoryPage />} />
                <Route path="/careers" element={<CareersPage />} />
              </Routes>
            </SSRDataContext.Provider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </AppProviders>
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  return html;
}
