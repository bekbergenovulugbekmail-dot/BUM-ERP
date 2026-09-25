-- Moliya auditi (2026-09-25): kontragent subhisobi va to'lovni bekor qilish.
-- FAQAT QO'SHUVCHI: mavjud qatorlar o'chirilmaydi va o'zgarmaydi (backfill faqat yangi ustunlarni to'ldiradi).

-- 1) Jurnal qatorida kontragent — mijoz/ta'minotchi qarzi YAGONA manbadan (jurnaldan) hisoblanadi
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "party_type" varchar(16);--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "party_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "jl_party_pair" CHECK (("party_type" IS NULL) = ("party_id" IS NULL));--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "jl_party_type_known" CHECK ("party_type" IS NULL OR "party_type" IN ('customer', 'supplier'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jl_company_party_idx" ON "journal_lines" ("company_id", "party_type", "party_id") WHERE "party_id" IS NOT NULL;--> statement-breakpoint

-- Backfill: mijoz nazorat hisoblari (debitor, avans, keshbek) — hujjat id'si bo'yicha
UPDATE "journal_lines" jl
SET "party_type" = 'customer', "party_id" = src.customer_id
FROM "journal_entries" je
JOIN "accounts" a ON a."company_id" = je."company_id"
CROSS JOIN LATERAL (
  SELECT customer_id FROM (
    SELECT so."customer_id" FROM "sales_orders" so WHERE so."id" = je."reference_id"
    UNION ALL
    SELECT so."customer_id" FROM "sales_returns" sr JOIN "sales_orders" so ON so."id" = sr."order_id" WHERE sr."id" = je."reference_id"
    UNION ALL
    SELECT cp."customer_id" FROM "customer_payments" cp WHERE cp."id" = je."reference_id"
    UNION ALL
    SELECT cbt."customer_id" FROM "customer_balance_transactions" cbt WHERE cbt."id" = je."reference_id"
    UNION ALL
    SELECT cct."customer_id" FROM "customer_cashback_transactions" cct WHERE cct."id" = je."reference_id"
  ) found
  WHERE customer_id IS NOT NULL
  LIMIT 1
) src
WHERE jl."entry_id" = je."id"
  AND a."id" = jl."account_id"
  AND a."subtype" IN ('receivable', 'customer_advance', 'cashback_liability')
  AND je."reference_id" IS NOT NULL
  AND jl."party_id" IS NULL;--> statement-breakpoint

-- Backfill: ta'minotchi (kreditor) — qabul, to'lov, qaytarish
UPDATE "journal_lines" jl
SET "party_type" = 'supplier', "party_id" = src.supplier_id
FROM "journal_entries" je
JOIN "accounts" a ON a."company_id" = je."company_id"
CROSS JOIN LATERAL (
  SELECT supplier_id FROM (
    SELECT pr."supplier_id" FROM "purchase_receipts" pr WHERE pr."id" = je."reference_id"
    UNION ALL
    SELECT sp."supplier_id" FROM "supplier_payments" sp WHERE sp."id" = je."reference_id"
    UNION ALL
    SELECT prt."supplier_id" FROM "purchase_returns" prt WHERE prt."id" = je."reference_id"
  ) found
  LIMIT 1
) src
WHERE jl."entry_id" = je."id"
  AND a."id" = jl."account_id"
  AND a."subtype" = 'payable'
  AND je."reference_id" IS NOT NULL
  AND jl."party_id" IS NULL;--> statement-breakpoint

-- 2) Mijoz to'lovi: bekor qilish holati (o'chirish EMAS — asl yozuv saqlanadi, teskari yozuv qo'shiladi)
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "cp_status_known" CHECK ("status" IN ('posted', 'reversed'));--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "cp_reversal_complete" CHECK ("status" = 'posted' OR ("reversed_at" IS NOT NULL AND "reversal_reason" IS NOT NULL));--> statement-breakpoint

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "pay_status_known" CHECK ("status" IN ('posted', 'reversed'));--> statement-breakpoint

-- 3) Buyurtmasiz to'lovning hujjatlarga taqsimoti — bekor qilishda aynan shu summalar qaytariladi
CREATE TABLE IF NOT EXISTS "customer_payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "payment_id" uuid NOT NULL REFERENCES "customer_payments"("id") ON DELETE RESTRICT,
  "order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE RESTRICT,
  "amount" numeric(18, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cpa_amount_positive" CHECK ("amount" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cpa_payment_idx" ON "customer_payment_allocations" ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cpa_order_idx" ON "customer_payment_allocations" ("order_id");
