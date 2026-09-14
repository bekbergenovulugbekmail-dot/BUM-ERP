/**
 * Aktiv kompaniya, a'zoliklar va ruxsatlar — `/api/company`.
 *
 * Convex mosligi: companies.listMyCompanies → useMyCompanies, companies.getActiveCompany → useActiveCompany,
 * companies.switchCompany → useSwitchCompany. ID maydoni `_id` emas, `id`.
 */
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CompanyModuleStates, Permission } from "@bum/shared";
import { api, type ApiError } from "@/lib/api.ts";
import { useApiQuery } from "@/lib/query.ts";

export type CompanyStatus = "active" | "trial" | "pending" | "suspended" | "cancelled";

export type MyCompany = {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  status: CompanyStatus;
  isActive: boolean;
  currency: string;
  trialEndsAt: string | null;
  companyRole: string;
  membershipActive: boolean;
  isCurrent: boolean;
};

export type ActiveCompany = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  currency: string;
  language: string;
  logoUrl: string | null;
  slug: string | null;
  status: CompanyStatus;
  isActive: boolean;
  ownerId: string | null;
  trialEndsAt: string | null;
  createdAt: string;
};

export type ActiveCompanyResponse = {
  company: ActiveCompany;
  membership: { companyRole: string; branchId: string | null; allowedWarehouseIds: string[] };
  permissions: Permission[];
  /** Kompaniya modullari holati (o'chiq — menyu va sahifa yashiriladi, API MODULE_DISABLED). */
  modules?: CompanyModuleStates;
};

/** `undefined` — yuklanmoqda. */
export function useMyCompanies(enabled = true): MyCompany[] | undefined {
  return useApiQuery<{ companies: MyCompany[] }>(enabled ? "/api/company/mine" : null).data?.companies;
}

export function useActiveCompany(enabled = true) {
  return useApiQuery<ActiveCompanyResponse>(enabled ? "/api/company" : null);
}

/** Ruxsat tekshiruvi UI uchun (yashirish/ko'rsatish); asosiy himoya — serverda. */
export function usePermissions() {
  const { data, isLoading } = useActiveCompany();
  const permissions = data?.permissions;
  const can = useCallback((permission: Permission) => permissions?.includes(permission) ?? false, [permissions]);
  return { permissions, can, isLoading };
}

export function useSwitchCompany() {
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (companyId) => api.post("/api/company/switch", { companyId }),
    // Tenant almashdi — oldingi kompaniya ma'lumotlari keshda qolmasligi kerak
    onSuccess: () => queryClient.resetQueries(),
  });
}
