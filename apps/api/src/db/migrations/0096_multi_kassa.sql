-- Ko'p kassa (2026-09-27): kassa = mavjud naqd hisob (`cash_accounts`), yangi pul tizimi EMAS. FAQAT QO'SHUVCHI:
-- tarixiy smena, to'lov, kassa harakati va jurnal yozuvlari o'zgartirilmaydi, backfill YO'Q. Eski smenalarda
-- `cash_account_id` NULL — bu "tarixiy xulq" (asosiy kassa) degani; ular avvalgidek ishlaydi.
ALTER TABLE "cash_accounts" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN IF NOT EXISTS "code" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ca_company_code_key" ON "cash_accounts" ("company_id", "code") WHERE "code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ca_company_warehouse_idx" ON "cash_accounts" ("company_id", "warehouse_id");--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "cash_account_id" uuid REFERENCES "cash_accounts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "opening_balance" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "pos_devices" ADD COLUMN IF NOT EXISTS "cash_account_id" uuid REFERENCES "cash_accounts"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- Smena qoidasi: kassali smena — BITTA kassada bitta ochiq smena; kassasiz (tarixiy) web smena — omborda bitta (avvalgidek)
DROP INDEX IF EXISTS "ps_one_open_per_warehouse";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ps_one_open_per_warehouse" ON "pos_shifts" ("company_id", "warehouse_id") WHERE "status" = 'open' AND "device_id" IS NULL AND "cash_account_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ps_one_open_per_kassa" ON "pos_shifts" ("cash_account_id") WHERE "status" = 'open' AND "cash_account_id" IS NOT NULL;
