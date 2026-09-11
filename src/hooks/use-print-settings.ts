/**
 * Chop etish sozlamalari (chek shabloni, etiketkalar) — `GET /api/company/print-settings`.
 * Kompaniyaning har bir a'zosi o'qiydi; kam o'zgaradi — kesh 5 daqiqa.
 */
import {
  DEFAULT_LABEL_SETTINGS,
  DEFAULT_RECEIPT_TEMPLATE,
  type LabelSettings,
  type ReceiptTemplate,
} from "@bum/shared";
import { useApiQuery } from "@/lib/query.ts";

export type PrintSettings = { receipt: ReceiptTemplate; labels: LabelSettings };

export const PRINT_SETTINGS_PATH = "/api/company/print-settings";

export function usePrintSettings() {
  const query = useApiQuery<PrintSettings>(PRINT_SETTINGS_PATH, undefined, { staleTime: 5 * 60_000 });
  return {
    receipt: query.data?.receipt ?? DEFAULT_RECEIPT_TEMPLATE,
    labels: query.data?.labels ?? DEFAULT_LABEL_SETTINGS,
    isLoaded: query.data !== undefined || query.isError,
  };
}
