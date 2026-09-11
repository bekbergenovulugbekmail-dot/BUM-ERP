/**
 * Chop etish sozlamalari: POS cheki shabloni va mahsulot etiketkalari.
 *
 * `settings` jadvalida JSON (`print.receipt`, `print.labels`; guruh `print`). O'qish — kompaniyaning har bir
 * a'zosi (kassir chek va etiketka chiqaradi, `settings.view` shart emas), saqlash — `settings.manage`.
 * Saqlangan qiymat standart bilan birlashtiriladi: shablonga yangi maydon qo'shilsa eski sozlama buzilmaydi.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  DEFAULT_LABEL_SETTINGS,
  DEFAULT_RECEIPT_TEMPLATE,
  LABEL_LIMITS,
  LABEL_TEMPLATE_DEFAULTS,
  RECEIPT_LOGO_MAX_LENGTH,
  type LabelSettings,
  type LabelTemplate,
  type ReceiptTemplate,
} from "@bum/shared";
import { settings } from "../../db/schema/platform.js";
import type { DbOrTx, Tx } from "../../db/transaction.js";
import type { RequestMeta } from "../../shared/audit.js";
import { upsertCompanySetting } from "./settings.service.js";
import type { TenantContext } from "./tenant.js";

export const RECEIPT_SETTING_KEY = "print.receipt";
export const LABELS_SETTING_KEY = "print.labels";

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ─── Chek ────────────────────────────────────────────────────────────────────

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
  const parsed = storedReceiptSchema.safeParse(parseJson(raw));
  return parsed.success ? { ...DEFAULT_RECEIPT_TEMPLATE, ...parsed.data } : DEFAULT_RECEIPT_TEMPLATE;
}

// ─── Etiketkalar ─────────────────────────────────────────────────────────────

const millimeters = z.number().min(LABEL_LIMITS.minMm).max(LABEL_LIMITS.maxMm);

const labelTemplateShape = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Etiketka id noto'g'ri"),
  name: z.string().trim().min(1).max(60),
  layout: z.enum(["roll", "a4"]),
  widthMm: millimeters,
  heightMm: millimeters,
  columns: z.number().int().min(1).max(LABEL_LIMITS.maxColumns),
  gapMm: z.number().min(0).max(LABEL_LIMITS.maxGapMm),
  codeType: z.enum(["barcode", "qr", "none"]),
  showCompanyName: z.boolean(),
  showName: z.boolean(),
  showPrice: z.boolean(),
  showSku: z.boolean(),
  showCodeText: z.boolean(),
  showBorder: z.boolean(),
  fontSize: z.enum(["sm", "md", "lg"]),
} satisfies Record<keyof LabelTemplate, z.ZodType>;

export const labelSettingsSchema = z
  .strictObject({
    defaultTemplateId: z.string(),
    templates: z.array(z.strictObject(labelTemplateShape)).min(1).max(LABEL_LIMITS.maxTemplates),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const template of value.templates) {
      if (ids.has(template.id)) {
        ctx.addIssue({ code: "custom", message: `Takroriy etiketka id: ${template.id}`, path: ["templates"] });
      }
      ids.add(template.id);
    }
    if (!ids.has(value.defaultTemplateId)) {
      ctx.addIssue({ code: "custom", message: "Standart etiketka ro'yxatda yo'q", path: ["defaultTemplateId"] });
    }
  });

const storedLabelsSchema = z.object({
  defaultTemplateId: z.string(),
  templates: z.array(z.object(labelTemplateShape).partial().required({ id: true, name: true })),
});

export function parseLabelSettings(raw: string | null | undefined): LabelSettings {
  if (!raw) return DEFAULT_LABEL_SETTINGS;
  const stored = storedLabelsSchema.safeParse(parseJson(raw));
  if (!stored.success) return DEFAULT_LABEL_SETTINGS;
  const merged = labelSettingsSchema.safeParse({
    defaultTemplateId: stored.data.defaultTemplateId,
    templates: stored.data.templates.map((template) => ({ ...LABEL_TEMPLATE_DEFAULTS, ...template })),
  });
  return merged.success ? merged.data : DEFAULT_LABEL_SETTINGS;
}

// ─── O'qish va saqlash ───────────────────────────────────────────────────────

export async function getPrintSettings(conn: DbOrTx, tenant: TenantContext) {
  const rows = await conn
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, tenant.company.id), inArray(settings.key, [RECEIPT_SETTING_KEY, LABELS_SETTING_KEY])));
  const valueOf = (key: string) => rows.find((row) => row.key === key)?.value;
  return {
    receipt: parseReceiptTemplate(valueOf(RECEIPT_SETTING_KEY)),
    labels: parseLabelSettings(valueOf(LABELS_SETTING_KEY)),
  };
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

export async function saveLabelSettings(tx: Tx, tenant: TenantContext, labels: LabelSettings, meta: RequestMeta) {
  await upsertCompanySetting(
    tx,
    tenant,
    { key: LABELS_SETTING_KEY, value: JSON.stringify(labels), group: "print", description: "Etiketka shablonlari" },
    meta,
  );
  return labels;
}
