/**
 * Chop etish sozlamalari: POS cheki shabloni.
 *
 * `settings` jadvalida JSON (`print.receipt`, guruh `print`). O'qish — kompaniyaning har bir a'zosi
 * (kassir chek chiqaradi, `settings.view` shart emas), saqlash — `settings.manage`.
 * Saqlangan qiymat standart bilan birlashtiriladi: shablonga yangi maydon qo'shilsa eski sozlama buzilmaydi.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_RECEIPT_TEMPLATE, RECEIPT_LOGO_MAX_LENGTH, type ReceiptTemplate } from "@bum/shared";
import { settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { upsertCompanySetting } from "./settings.service.js";
import type { TenantContext } from "./tenant.js";

export const RECEIPT_SETTING_KEY = "print.receipt";

const receiptTemplateShape = {
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  fontSize: z.enum(["sm", "md", "lg"]),
  showLogo: z.boolean(),
  logo: z
    .string()
    .max(RECEIPT_LOGO_MAX_LENGTH, "Logo hajmi juda katta")
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "Logo PNG, JPEG yoki WebP rasm bo'lishi kerak")
    .nullable(),
  logoWidth: z.number().int().min(20).max(100),
  showCompanyName: z.boolean(),
  showAddress: z.boolean(),
  showPhone: z.boolean(),
  showTaxId: z.boolean(),
  headerText: z.string().max(500),
  showCashier: z.boolean(),
  showSku: z.boolean(),
  showTax: z.boolean(),
  showCustomer: z.boolean(),
  showCustomerDebt: z.boolean(),
  showCustomerBalance: z.boolean(),
  showCashback: z.boolean(),
  footerText: z.string().max(1000),
  autoPrint: z.boolean(),
} satisfies Record<keyof ReceiptTemplate, z.ZodType>;

export const receiptTemplateSchema = z.strictObject(receiptTemplateShape);
const storedReceiptSchema = z.object(receiptTemplateShape).partial();

export function parseReceiptTemplate(raw: string | null | undefined): ReceiptTemplate {
  if (!raw) return DEFAULT_RECEIPT_TEMPLATE;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_RECEIPT_TEMPLATE;
  }
  const parsed = storedReceiptSchema.safeParse(json);
  return parsed.success ? { ...DEFAULT_RECEIPT_TEMPLATE, ...parsed.data } : DEFAULT_RECEIPT_TEMPLATE;
}

export async function getPrintSettings(conn: DbOrTx, tenant: TenantContext) {
  const [row] = await conn
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, tenant.company.id), eq(settings.key, RECEIPT_SETTING_KEY)))
    .limit(1);
  return { receipt: parseReceiptTemplate(row?.value) };
}

export async function saveReceiptTemplate(tx: Tx, tenant: TenantContext, template: ReceiptTemplate, meta: RequestMeta) {
  await upsertCompanySetting(
    tx,
    tenant,
    { key: RECEIPT_SETTING_KEY, value: JSON.stringify(template), group: "print", description: "POS cheki shabloni" },
    meta,
  );
  return template;
}
