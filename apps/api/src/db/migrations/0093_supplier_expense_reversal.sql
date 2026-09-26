-- Audit AUD-013 (2026-09-26): ta'minotchi to'lovi va to'langan xarajatni BEKOR QILISH — o'chirish emas, holat +
-- teskari yozuvlar (kassa, jurnal, bank komissiyasi, buyurtma, ta'minotchi balansi). FAQAT QO'SHUVCHI.
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "sp_status_known" CHECK ("status" IN ('posted', 'reversed'));--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
ALTER TYPE "expense_status" ADD VALUE IF NOT EXISTS 'reversed';
