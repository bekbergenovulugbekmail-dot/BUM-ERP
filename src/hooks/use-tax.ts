/**
 * Soliqni avtomatik hisoblash yoqilganmi (kompaniya sozlamasi `tax.auto`).
 *
 * O'chirilgan bo'lsa soliq BARCHA yangi hujjatlarda 0 bo'ladi — server shunday hisoblaydi,
 * shuning uchun interfeys ham soliq maydonlarini ko'rsatmaydi (sotuv, xarid, kassa, mahsulot kartochkasi).
 * Sozlama o'qilmaguncha `true` qaytadi: eski xatti-harakat saqlanadi va maydonlar "sakrab" ketmaydi.
 */
import { useApiQuery } from "@/lib/query.ts";

const PATH = "/api/company/settings";

export function useTaxEnabled(): boolean {
  const rows = useApiQuery<{ settings: { key: string; value: string }[] }>(PATH, { group: "finance" }).data?.settings;
  return rows?.find((row) => row.key === "tax.auto")?.value !== "false";
}
