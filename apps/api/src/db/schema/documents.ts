/**
 * Hujjat shablonlari — nakladnoy va boshqa qog'ozlarning KO'RINISHI.
 *
 * Shablon PREZENTATSIYA qatlami: u "qaysi qiymat qayerda va qanday ko'rinsin" deydi.
 * Qiymatning o'zi har doim hujjat ma'lumotidan (sotuv, yetkazma, xarid) olinadi, shuning
 * uchun shablonni tahrirlash bilan summani o'zgartirib bo'lmaydi.
 *
 * `schema` — tekshirilgan JSON: sahifa, bo'limlar, elementlar, bog'lanishlar, shartlar.
 * Ichida HTML, JS yoki SQL BO'LMAYDI (server oq ro'yxat bo'yicha tozalaydi).
 */
import { relations, sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { DocumentType } from "@bum/shared";
import { companies, users } from "./platform.js";
import { pk, timestamps } from "./_shared.js";

export const documentTemplates = pgTable(
  "document_templates",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    documentType: varchar("document_type", { length: 40 }).$type<DocumentType>().notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    /** `archived` — o'chirilmaydi: qaysi hujjat qaysi shablon bilan chiqarilgani bilinib tursin. */
    status: varchar("status", { length: 16 }).$type<"active" | "archived">().notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(false),
    /** Hozir amalda bo'lgan versiya; hujjat shu versiya bo'yicha chiziladi. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => documentTemplateVersions.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("dt_company_type_idx").on(t.companyId, t.documentType),
    index("dt_company_status_idx").on(t.companyId, t.status),
    uniqueIndex("dt_one_default_per_type")
      .on(t.companyId, t.documentType)
      .where(sql`${t.isDefault} and ${t.status} = 'active'`),
    check("dt_status_valid", sql`${t.status} in ('active', 'archived')`),
  ],
);

export const documentTemplateVersions = pgTable(
  "document_template_versions",
  {
    id: pk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => documentTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    schema: jsonb("schema").notNull(),
    /** Nima o'zgargani — tarixda ko'rinadi ("Logo qo'shildi"). */
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dtv_template_version_key").on(t.templateId, t.version),
    index("dtv_company_idx").on(t.companyId),
    check("dtv_version_positive", sql`${t.version} > 0`),
  ],
);

export const documentTemplatesRelations = relations(documentTemplates, ({ many, one }) => ({
  versions: many(documentTemplateVersions),
  currentVersion: one(documentTemplateVersions, {
    fields: [documentTemplates.currentVersionId],
    references: [documentTemplateVersions.id],
  }),
}));

export const documentTemplateVersionsRelations = relations(documentTemplateVersions, ({ one }) => ({
  template: one(documentTemplates, { fields: [documentTemplateVersions.templateId], references: [documentTemplates.id] }),
}));
