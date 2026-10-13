import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import { BareLayout } from "./components/layout/BareLayout.jsx";
import { AuthLayout } from "./components/layout/AuthLayout.jsx";
import { RequireAuth, RedirectIfAuthed } from "./components/layout/RouteGuards.jsx";
import { DeviceLoader } from "./components/ui/DeviceLoader.jsx";
import { ScrollToTop } from "./components/layout/ScrollToTop.jsx";
import { ReferralCapture } from "./components/layout/ReferralCapture.jsx";

// The public storefront. Its home page is the app's entry point, so -- like
// the old HomePage before it -- it is imported eagerly rather than lazily:
// it IS the first paint, and code-splitting the thing you always need only
// adds a round trip before anything appears.
import { StorefrontLayout } from "./b2b/layout/StorefrontLayout.jsx";
import StoreHomePage from "./b2b/pages/StoreHomePage.jsx";

// The signed-in dashboard. The storefront owns `/`, so this is not a second
// home page -- it is the "what is happening with my account" screen: open
// quotes, recent orders, and the things waiting on you.
const AccountHomePage = lazy(() => import("./pages/AccountHomePage.jsx"));

const DevicesPage = lazy(() => import("./b2b/pages/DevicesPage.jsx"));
const DevicePage = lazy(() => import("./b2b/pages/DevicePage.jsx"));
const CatalogPage = lazy(() => import("./b2b/pages/CatalogPage.jsx"));
const ComparePage = lazy(() => import("./b2b/pages/ComparePage.jsx"));
const FeaturePages = {
  Installations: lazy(() =>
    import("./b2b/pages/featurePages.jsx").then((m) => ({ default: m.InstallationsPage }))
  ),
  Affiliate: lazy(() =>
    import("./b2b/pages/featurePages.jsx").then((m) => ({ default: m.AffiliatePage }))
  ),
  Tools: lazy(() => import("./b2b/pages/featurePages.jsx").then((m) => ({ default: m.ToolsPage }))),
};

// Everything below is reached by navigating, never needed for the first
// paint of the storefront home screen -- code-splitting it keeps the
// initial JS payload to "the app shell + the home page" instead of the
// whole route tree (admin included). React.lazy + Suspense turns each of
// these into its own chunk that's fetched on demand.
const ProductDetailPage = lazy(() => import("./pages/ProductDetailPage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const SignupPage = lazy(() => import("./pages/SignupPage.jsx"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage.jsx"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage.jsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const NetworkPage = lazy(() => import("./pages/NetworkPage.jsx"));
const NodeDetailPage = lazy(() => import("./pages/NodeDetailPage.jsx"));
const SpaceTreePage = lazy(() => import("./pages/SpaceTreePage.jsx"));
const OrdersPage = lazy(() => import("./pages/OrdersPage.jsx"));
const OrderDetailPage = lazy(() => import("./pages/OrderDetailPage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));
const AdminRedirectPage = lazy(() => import("./pages/AdminRedirectPage.jsx"));
const ContactPage = lazy(() => import("./pages/ContactPage.jsx"));
const SocialsPage = lazy(() => import("./pages/SocialsPage.jsx"));
const CategoryPage = lazy(() => import("./pages/CategoryPage.jsx"));
const PartnersPage = lazy(() => import("./pages/PartnersPage.jsx"));
const OurStoryPage = lazy(() => import("./pages/OurStoryPage.jsx"));
const CareersPage = lazy(() => import("./pages/CareersPage.jsx"));
const BlogIndexPage = lazy(() => import("./b2b/pages/BlogPages.jsx").then((m) => ({ default: m.BlogIndexPage })));
const BlogPostPage = lazy(() => import("./b2b/pages/BlogPages.jsx").then((m) => ({ default: m.BlogPostPage })));

// Admin is its own world (layout + 10 pages) that only ever loads for the
// handful of admin accounts -- split as a group so a regular user's browser
// never even requests it.

function RouteFallback() {
  // DeviceLoader shows the plain spinner unless three.js is *already* loaded,
  // so this never turns a route transition into a 600KB download -- see the
  // note in DeviceLoader.jsx.
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center">
      <DeviceLoader size={120} />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <ScrollToTop />
      <ReferralCapture />
      <Routes>
        <Route element={<AuthLayout />}>
          <Route element={<RedirectIfAuthed />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
        </Route>

        <Route element={<BareLayout />}>
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/c/:slug" element={<CategoryPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/our-story" element={<OurStoryPage />} />
          <Route path="/careers" element={<CareersPage />} />
          <Route path="/socials" element={<SocialsPage />} />
          <Route path="/admin" element={<AdminRedirectPage />} />
        </Route>

        {/* One shell for the whole site.
         *
         * The signed-in screens used to live under their own AppLayout: a
         * 560px dark-glass column with its own TopBar, while the public site
         * was a full-bleed light storefront. Crossing between them read as
         * leaving one product and arriving at another. They now share the
         * storefront's chrome -- same header, same footer, same canvas, same
         * container -- and the dock inside it is what distinguishes a
         * signed-in session, rather than a whole second design. */}
        <Route element={<StorefrontLayout />}>
          <Route path="/" element={<StoreHomePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DevicePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/installations" element={<FeaturePages.Installations />} />
          <Route path="/affiliate" element={<FeaturePages.Affiliate />} />
          <Route path="/tools" element={<FeaturePages.Tools />} />
          <Route path="/contact" element={<ContactPage />} />
          {/* Support used to be a ticket inbox behind a login. It is now a
              single intake form that anyone can reach, so the old address
              forwards there rather than 404ing for anyone who bookmarked it. */}
          <Route path="/support" element={<Navigate to="/contact" replace />} />
          <Route path="/blog" element={<BlogIndexPage />} />
          <Route path="/blog/:slug" element={<BlogPostPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/account" element={<AccountHomePage />} />
            {/* Wallet is switched off for now. The route is kept and
                redirects rather than being deleted: existing links, the PWA
                shortcut and any bookmarked balance would otherwise land on
                the 404 page, which reads as the site being broken rather
                than the feature being unavailable. */}
            <Route path="/wallet" element={<Navigate to="/orders" replace />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/network/:nodeId" element={<NodeDetailPage />} />
            <Route path="/space/:spaceId" element={<SpaceTreePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
          </Route>
        </Route>


        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
