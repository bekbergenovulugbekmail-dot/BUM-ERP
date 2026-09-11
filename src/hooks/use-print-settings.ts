/**
 * Chop etish sozlamalari (chek shabloni) — `GET /api/company/print-settings`.
 * Kompaniyaning har bir a'zosi o'qiydi; kam o'zgaradi — kesh 5 daqiqa.
 */
import { DEFAULT_RECEIPT_TEMPLATE, type ReceiptTemplate } from "@bum/shared";
import { useApiQuery } from "@/lib/query.ts";

export type PrintSettings = { receipt: ReceiptTemplate };

export const PRINT_SETTINGS_PATH = "/api/company/print-settings";

export function usePrintSettings() {
  const query = useApiQuery<PrintSettings>(PRINT_SETTINGS_PATH, undefined, { staleTime: 5 * 60_000 });
  return {
    receipt: query.data?.receipt ?? DEFAULT_RECEIPT_TEMPLATE,
    isLoaded: query.data !== undefined || query.isError,
  };
}
