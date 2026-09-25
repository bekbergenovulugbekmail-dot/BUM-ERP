-- Mijozning bank orqali to'lovi (2026-09-26): bitta hujjat — qarzgacha to'lov + qolgani avans (2300).
-- FAQAT QO'SHUVCHI: mavjud qatorlar o'zgarmaydi.

-- 1) To'lov hujjati manbasi: bank tushumi
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "pay_source_valid";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "pay_source_valid" CHECK ("source" in ('pos', 'pos_device', 'delivery', 'sales_payment', 'pos_customer_payment', 'bank_receipt'));--> statement-breakpoint
-- Bank hujjati raqami va izohi hujjat sarlavhasida (avans qismi customer_payments ga yozilmaydi)
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reference" varchar(100);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cash_account_id" uuid REFERENCES "cash_accounts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "payment_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pay_company_bank_reference_key" ON "payments" ("company_id", "cash_account_id", "reference")
  WHERE "source" = 'bank_receipt' AND "reference" IS NOT NULL AND "status" = 'posted';--> statement-breakpoint

-- 2) Avans (hamyon) kirimi to'lov hujjatiga bog'lanadi va BEKOR QILINADI (o'chirilmaydi)
ALTER TABLE "customer_balance_transactions" ADD COLUMN IF NOT EXISTS "payment_header_id" uuid REFERENCES "payments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'posted';--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD COLUMN IF NOT EXISTS "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "cbt_status_known" CHECK ("status" IN ('posted', 'reversed'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cbt_payment_header_idx" ON "customer_balance_transactions" ("payment_header_id") WHERE "payment_header_id" IS NOT NULL;--> statement-breakpoint
ALTER TYPE "customer_balance_tx_type" ADD VALUE IF NOT EXISTS 'deposit_reversal';
