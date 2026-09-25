-- Qaytarish turlari (2026-09-26, Z1): "Yetkazilmadi" (yetkazishda rad etish / qisman yetkazish) — alohida hujjat turi,
-- sotuvdan keyingi qaytarishdan ajratiladi. Tovar holati (disposition): sotuvga, karantin, shikastlangan, hisobdan
-- chiqarish, ta'minotchiga qaytarish uchun. FAQAT QO'SHUVCHI: eski qatorlar "return" / "sellable" bo'lib qoladi.
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "kind" varchar(24) DEFAULT 'return' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "delivery_task_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sr_kind_known" CHECK ("kind" IN ('return', 'delivery_refusal'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sr_company_kind_idx" ON "sales_returns" ("company_id", "kind", "created_at");--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN IF NOT EXISTS "disposition" varchar(16) DEFAULT 'sellable' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD COLUMN IF NOT EXISTS "disposition_warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sri_disposition_known" CHECK ("disposition" IN ('sellable', 'quarantine', 'damaged', 'write_off', 'supplier_return'));
