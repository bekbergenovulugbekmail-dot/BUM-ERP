import { Suspense, useEffect } from "react";
import { toast } from "sonner";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import BaseSegment from "./components/providers/base-segment.tsx";
import LocaleWrapper from "./components/providers/locale-wrapper.tsx";
import { SAVED_OR_DEFAULT_LOCALE, setLocaleInPath } from "./i18n.ts";
import "./i18n.ts";
import { useServiceWorker } from "./hooks/use-service-worker.ts";
import { listenAndroidBack } from "./lib/native/back-button.ts";
import AppUpdateBanner from "@/components/app-update-banner.tsx";
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
import DeliveryPage from "./pages/delivery/page.tsx";
import DeliveryAgentLayout from "./pages/delivery-agent/layout.tsx";
import DeliveryAgentDashboardPage from "./pages/delivery-agent/dashboard/page.tsx";
import DeliveryAgentTasksPage from "./pages/delivery-agent/tasks/page.tsx";
import DeliveryAgentTaskPage from "./pages/delivery-agent/tasks/task-page.tsx";
import DeliveryAgentCustomersPage from "./pages/delivery-agent/customers/page.tsx";
import DeliveryAgentDebtsPage from "./pages/delivery-agent/debts/page.tsx";
import DeliveryAgentReportsPage from "./pages/delivery-agent/reports/page.tsx";
import ManufacturingPage from "./pages/manufacturing/page.tsx";
import HRPage from "./pages/hr/page.tsx";
import AnalyticsPage from "./pages/analytics/page.tsx";
import SettingsPage from "./pages/settings/page.tsx";
import SubscriptionPage from "./pages/subscription/page.tsx";
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

        {/* Birinchi bo'lak: til (/uz/login) yoki biznes (/bonnu-market/purchase) — `lng` parametri ikkalasini ham bildiradi */}
        <Route
          path="/:lng"
          element={
            <BaseSegment>
              <Outlet />
            </BaseSegment>
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

          {/* Yetkazuvchi (dostavka agenti) ish joyi: mobil, ERP menyusiz */}
          <Route path="delivery-agent" element={<DeliveryAgentLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DeliveryAgentDashboardPage />} />
            <Route path="tasks" element={<DeliveryAgentTasksPage />} />
            <Route path="tasks/:taskId" element={<DeliveryAgentTaskPage />} />
            <Route path="customers" element={<DeliveryAgentCustomersPage />} />
            <Route path="debts" element={<DeliveryAgentDebtsPage />} />
            <Route path="reports" element={<DeliveryAgentReportsPage />} />
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
            <Route path="delivery" element={<ModuleGuard module="delivery"><DeliveryPage /></ModuleGuard>} />
            <Route path="finance" element={<ModuleGuard module="finance"><FinancePage /></ModuleGuard>} />
            <Route path="hr" element={<ModuleGuard module="hr"><HRPage /></ModuleGuard>} />
            <Route path="reports" element={<ModuleGuard module="reports"><AnalyticsPage /></ModuleGuard>} />
            <Route path="analytics" element={<ModuleGuard module="analytics"><AnalyticsPage /></ModuleGuard>} />
            <Route path="ai" element={<ModuleGuard module="ai"><AnalyticsPage /></ModuleGuard>} />
            <Route path="subscription" element={<ModuleGuard module="subscription"><SubscriptionPage /></ModuleGuard>} />
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
  // Android apparat "orqaga" tugmasi: oldingi sahifaga qaytadi, ilovadan chiqmaydi (brauzerda ta'sirsiz)
  useEffect(() => listenAndroidBack({ onConfirmExit: (message) => toast(message) }), []);
  const onAdminSurface = isAdminSubdomain();

  return (
    <DefaultProviders>
      <BrowserRouter>
        {onAdminSurface ? <AdminSubdomainApp /> : <MainApp />}
        {/* Telefon ilovasida yangi APK chiqqanda xabar (brauzerda ko'rinmaydi) */}
        <AppUpdateBanner />
      </BrowserRouter>
    </DefaultProviders>
  );
}
