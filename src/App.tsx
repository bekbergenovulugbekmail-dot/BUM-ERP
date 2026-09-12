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
import DistributionPage from "./pages/distribution/page.tsx";
import ModuleGuard from "./components/module-guard.tsx";
import SalesAgentLayout from "./pages/sales-agent/layout.tsx";
import AgentDashboardPage from "./pages/sales-agent/dashboard/page.tsx";
import AgentSalesPage from "./pages/sales-agent/sales/page.tsx";
import AgentCustomersPage from "./pages/sales-agent/customers/page.tsx";
import AgentReportsPage from "./pages/sales-agent/reports/page.tsx";
import AgentStorePage from "./pages/sales-agent/stores/store-page.tsx";
import AgentOrderPage from "./pages/sales-agent/stores/order-page.tsx";
import AgentPromotionsPage from "./pages/sales-agent/promotions/page.tsx";
import AgentProspectsPage from "./pages/sales-agent/prospects/page.tsx";
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

          {/* Sotuv agenti ish joyi: mobil, ERP menyusiz */}
          <Route path="sales-agent" element={<SalesAgentLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AgentDashboardPage />} />
            <Route path="sales" element={<AgentSalesPage />} />
            <Route path="customers" element={<AgentCustomersPage />} />
            {/* Eski havolalar: Do'konlar va Qarzdorlar "Mijozlar" bo'limiga birlashtirildi */}
            <Route path="debtors" element={<Navigate to="../customers?filter=debtors" replace />} />
            <Route path="stores" element={<Navigate to="../customers" replace />} />
            <Route path="reports" element={<AgentReportsPage />} />
            <Route path="stores/:customerId" element={<AgentStorePage />} />
            <Route path="stores/:customerId/order" element={<AgentOrderPage />} />
            <Route path="promotions" element={<AgentPromotionsPage />} />
            <Route path="prospects" element={<AgentProspectsPage />} />
          </Route>

          {/* ERP App with layout */}
          <Route element={<ERPApp />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="sales" element={<ModuleGuard module="sales"><SalesPage /></ModuleGuard>} />
            <Route path="pos" element={<ModuleGuard module="pos"><POSPage /></ModuleGuard>} />
            <Route path="products" element={<ModuleGuard module="products"><ProductsPage /></ModuleGuard>} />
            <Route path="warehouse" element={<ModuleGuard module="warehouse"><WarehousePage /></ModuleGuard>} />
            <Route path="purchase" element={<ModuleGuard module="purchase"><PurchasePage /></ModuleGuard>} />
            <Route path="manufacturing" element={<ModuleGuard module="manufacturing"><ManufacturingPage /></ModuleGuard>} />
            <Route path="crm" element={<ModuleGuard module="crm"><CRMPage /></ModuleGuard>} />
            <Route path="distribution" element={<ModuleGuard module="distribution"><DistributionPage /></ModuleGuard>} />
            <Route path="finance" element={<ModuleGuard module="finance"><FinancePage /></ModuleGuard>} />
            <Route path="hr" element={<ModuleGuard module="hr"><HRPage /></ModuleGuard>} />
            <Route path="reports" element={<ModuleGuard module="reports"><AnalyticsPage /></ModuleGuard>} />
            <Route path="analytics" element={<ModuleGuard module="analytics"><AnalyticsPage /></ModuleGuard>} />
            <Route path="ai" element={<ModuleGuard module="ai"><AnalyticsPage /></ModuleGuard>} />
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
