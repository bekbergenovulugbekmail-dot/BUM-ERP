import { Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import LocaleWrapper from "./components/providers/locale-wrapper.tsx";
import { SAVED_OR_DEFAULT_LOCALE, setLocaleInPath } from "./i18n.ts";
import "./i18n.ts";
import { useServiceWorker } from "./hooks/use-service-worker.ts";
import ERPLayout from "./components/erp-layout.tsx";
import DashboardPage from "./pages/dashboard/page.tsx";
import ProductsPage from "./pages/products/page.tsx";
import WarehousePage from "./pages/warehouse/page.tsx";
import PurchasePage from "./pages/purchase/page.tsx";
import SalesPage from "./pages/sales/page.tsx";
import POSPage from "./pages/pos/page.tsx";
import FinancePage from "./pages/finance/page.tsx";
import CRMPage from "./pages/crm/page.tsx";
import ManufacturingPage from "./pages/manufacturing/page.tsx";
import HRPage from "./pages/hr/page.tsx";
import AnalyticsPage from "./pages/analytics/page.tsx";
import SettingsPage from "./pages/settings/page.tsx";
import OnboardingPage from "./pages/onboarding/page.tsx";
import AdminPage from "./pages/admin/page.tsx";
import TenantPortalPage from "./pages/tenant/page.tsx";
import SelectCompanyPage from "./pages/select-company/page.tsx";
import LoginPage from "./pages/login/page.tsx";
import NotFound from "./pages/NotFound.tsx";
import { isAdminSubdomain } from "./lib/subdomain.ts";

// ─── Loading spinner ──────────────────────────────────────────────────────────
const FullPageSpinner = () => (
  <div className="h-screen flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

// ─── Locale-aware root redirect ───────────────────────────────────────────────
function RootRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={setLocaleInPath(SAVED_OR_DEFAULT_LOCALE, "/", location.search, location.hash)}
      replace
    />
  );
}

function ERPApp() {
  return (
    <ERPLayout>
      <Outlet />
    </ERPLayout>
  );
}

// ─── Admin subdomain router (admin.bum-erp.uz) ───────────────────────────────
// Renders only the Admin Panel on every path. Auth callback is exempted.
function AdminSubdomainApp() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Any locale prefix (/uz, /ru, /kz) */}
        <Route
          path="/:lng/*"
          element={
            <LocaleWrapper>
              <AdminPage />
            </LocaleWrapper>
          }
        />

        {/* Root and everything else → locale-wrapped AdminPage */}
        <Route
          path="*"
          element={
            <LocaleWrapper>
              <AdminPage />
            </LocaleWrapper>
          }
        />
      </Routes>
    </Suspense>
  );
}

// ─── Main ERP router (app.bum-erp.uz) ────────────────────────────────────────
function MainApp() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Root redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* Tenant portal: app.bum-erp.uz/t/:slug */}
        <Route path="/t/:slug" element={<TenantPortalPage />} />

        {/* All localized routes */}
        <Route
          path="/:lng"
          element={
            <LocaleWrapper>
              <Outlet />
            </LocaleWrapper>
          }
        >
          {/* Onboarding: outside ERPLayout */}
          <Route path="onboarding" element={<OnboardingPage />} />

          {/* Login page: BUM ERP branded login */}
          <Route path="login" element={<LoginPage />} />

          {/* Company selector: outside ERPLayout */}
          <Route path="select-company" element={<SelectCompanyPage />} />

          {/* Platform Admin Panel: outside ERPLayout */}
          <Route path="admin" element={<AdminPage />} />

          {/* ERP App with layout */}
          <Route element={<ERPApp />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="pos" element={<POSPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="warehouse" element={<WarehousePage />} />
            <Route path="purchase" element={<PurchasePage />} />
            <Route path="manufacturing" element={<ManufacturingPage />} />
            <Route path="crm" element={<CRMPage />} />
            <Route path="distribution" element={<CRMPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="hr" element={<HRPage />} />
            <Route path="reports" element={<AnalyticsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="ai" element={<AnalyticsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

// ─── Root: pick surface based on hostname ─────────────────────────────────────
export default function App() {
  useServiceWorker();
  const onAdminSurface = isAdminSubdomain();

  return (
    <DefaultProviders>
      <BrowserRouter>
        {onAdminSurface ? <AdminSubdomainApp /> : <MainApp />}
      </BrowserRouter>
    </DefaultProviders>
  );
}
