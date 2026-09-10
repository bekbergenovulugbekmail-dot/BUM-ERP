/**
 * Bildirishnomalar.
 *
 * Real-time yetkazish (audit Faza 11): SSE oqimi orqali — WebSocket emas.
 * `is_global = true` bo'lsa kompaniyaning barcha a'zolariga tegishli.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { legacyId, pk, timestamps } from "./_shared.js";

export const notificationType = pgEnum("notification_type", [
  "low_stock",
  "expiring_soon",
  "pending_approval",
  "overdue_payment",
  "leave_request",
  "po_received",
  "production_complete",
  "system",
]);

export const notificationSeverity = pgEnum("notification_severity", [
  "info",
  "warning",
  "error",
  "success",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    legacyId: legacyId(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /** NULL + is_global = kompaniya bo'ylab bildirishnoma. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),

    type: notificationType("type").notNull().default("system"),
    severity: notificationSeverity("severity").notNull().default("info"),
    title: varchar("title", { length: 300 }).notNull(),
    message: text("message").notNull(),

    isRead: boolean("is_read").notNull().default(false),
    isGlobal: boolean("is_global").notNull().default(false),

    relatedType: varchar("related_type", { length: 50 }),
    relatedId: uuid("related_id"),
    link: varchar("link", { length: 500 }),
    ...timestamps(),
  },
  (t) => [
    index("notif_company_user_read_idx").on(t.companyId, t.userId, t.isRead),
    index("notif_company_global_idx").on(t.companyId, t.isGlobal),
    index("notif_company_created_idx").on(t.companyId, t.createdAt),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  company: one(companies, { fields: [notifications.companyId], references: [companies.id] }),
}));
