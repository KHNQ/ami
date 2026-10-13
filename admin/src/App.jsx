import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout.jsx";
import { useAdminAuth } from "./context/AdminAuthContext.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { Spinner } from "@shared/components/ui/Spinner.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";

// Everything past the login screen is lazy. A content admin who only ever
// opens the blog should not be downloading the reports or audit-log bundles.
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage.jsx"));
const AdminOrdersPage = lazy(() => import("./pages/AdminOrdersPage.jsx"));
const AdminOrderDetailPage = lazy(() => import("./pages/AdminOrderDetailPage.jsx"));
const ManualOrderPage = lazy(() => import("./pages/ManualOrderPage.jsx"));
const ChequesPage = lazy(() => import("./pages/ChequesPage.jsx"));
const ProformasPage = lazy(() => import("./pages/ProformasPage.jsx"));
const NetworkTreePage = lazy(() => import("./pages/NetworkTreePage.jsx"));
const AdminsPage = lazy(() => import("./pages/AdminsPage.jsx"));
const AdminProductsPage = lazy(() => import("./pages/AdminProductsPage.jsx"));
const AdminProductDetailPage = lazy(() => import("./pages/AdminProductDetailPage.jsx"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage.jsx"));
const AdminSupportPage = lazy(() => import("./pages/AdminSupportPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const AdminReportsPage = lazy(() => import("./pages/AdminReportsPage.jsx"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx"));
const AdminLogsPage = lazy(() => import("./pages/AdminLogsPage.jsx"));
const AiActivityPage = lazy(() => import("./pages/AiActivityPage.jsx"));
const PayoutsPage = lazy(() => import("./pages/PayoutsPage.jsx"));
const BlogPage = lazy(() => import("./pages/BlogPage.jsx"));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage.jsx"));

function RouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <Spinner />
    </div>
  );
}

/**
 * Gates a route on a permission. The API refuses regardless -- this exists so
 * that someone who reaches a URL they can't use sees an explanation instead
 * of a page that renders and then fills with 403s.
 */
function Require({ permission, children }) {
  const { can } = useAdminAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        title="Not available to your role"
        description={`This section needs the "${permission}" permission. Ask a root admin if you need access.`}
      />
    );
  }
  return children;
}

export default function App() {
  const { status } = useAdminAuth();

  if (status === "loading") return <RouteFallback />;
  if (status !== "authed") return <LoginPage />;

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<Require permission="reports.read"><AdminDashboardPage /></Require>} />

          <Route path="orders" element={<Require permission="orders.read_all"><AdminOrdersPage /></Require>} />
          <Route path="orders/manual" element={<Require permission="orders.create_manual"><ManualOrderPage /></Require>} />
          <Route path="orders/:id" element={<Require permission="orders.read_all"><AdminOrderDetailPage /></Require>} />

          <Route path="cheques" element={<Require permission="cheques.read"><ChequesPage /></Require>} />
          <Route path="proformas" element={<Require permission="sales.read"><ProformasPage /></Require>} />

          <Route path="products" element={<Require permission="catalogue.write"><AdminProductsPage /></Require>} />
          <Route path="products/:id" element={<Require permission="catalogue.write"><AdminProductDetailPage /></Require>} />

          <Route path="users" element={<Require permission="users.read"><AdminUsersPage /></Require>} />
          <Route path="users/:id/network" element={<Require permission="network.read_all"><NetworkTreePage /></Require>} />
          <Route path="admins" element={<Require permission="admins.manage"><AdminsPage /></Require>} />
          <Route path="support" element={<Require permission="support.read_all"><AdminSupportPage /></Require>} />
          <Route path="blog" element={<Require permission="content.write"><BlogPage /></Require>} />
          <Route path="knowledge" element={<Require permission="content.write"><KnowledgePage /></Require>} />
          <Route path="settings" element={<Require permission="settings.read"><SettingsPage /></Require>} />
          <Route path="reports" element={<Require permission="reports.read"><AdminReportsPage /></Require>} />
          <Route path="notifications" element={<Require permission="logs.read"><NotificationsPage /></Require>} />
          <Route path="logs" element={<Require permission="logs.read"><AdminLogsPage /></Require>} />
          <Route path="ai-activity" element={<Require permission="logs.read"><AiActivityPage /></Require>} />
          <Route path="payouts" element={<Require permission="money.read"><PayoutsPage /></Require>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
