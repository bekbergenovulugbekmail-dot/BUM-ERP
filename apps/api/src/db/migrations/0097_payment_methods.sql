-- Boshqariladigan to'lov usullari (2026-09-27): kanonik turlar (cash/card/bank/transfer) ustidagi SOZLAMA qatlami.
-- Yangi pul hisobi yaratilmaydi: usul mavjud terminal yoki hisobga faqat havola qiladi. Eski to'lovlar qayta yozilmaydi
-- (payment_method_id — NULL, tarixiy to'lov usuli `method`/`terminal_id` bo'yicha ko'rinadi).
CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "name" varchar(100) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "terminal_id" uuid REFERENCES "payment_terminals"("id") ON DELETE RESTRICT,
  "cash_account_id" uuid REFERENCES "cash_accounts"("id") ON DELETE RESTRICT,
  "show_in_pos" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pm_kind_valid" CHECK ("kind" in ('cash', 'card', 'bank', 'transfer')),
  -- Naqd usul hisobga bog'lanmaydi (kassani smena belgilaydi); terminal — faqat karta
  CONSTRAINT "pm_cash_unbound" CHECK ("kind" <> 'cash' OR ("terminal_id" IS NULL AND "cash_account_id" IS NULL)),
  CONSTRAINT "pm_terminal_card" CHECK ("terminal_id" IS NULL OR "kind" = 'card')
);
CREATE UNIQUE INDEX IF NOT EXISTS "pm_company_name_key" ON "payment_methods" ("company_id", "name");
CREATE INDEX IF NOT EXISTS "pm_company_active_idx" ON "payment_methods" ("company_id", "is_active");

-- Usul qaysi kassalarda ruxsat etilgan; bo'sh — barcha kassalarda
CREATE TABLE IF NOT EXISTS "payment_method_kassas" (
  "payment_method_id" uuid NOT NULL REFERENCES "payment_methods"("id") ON DELETE CASCADE,
  "cash_account_id" uuid NOT NULL REFERENCES "cash_accounts"("id") ON DELETE CASCADE,
  PRIMARY KEY ("payment_method_id", "cash_account_id")
);

ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "payment_method_id" uuid REFERENCES "payment_methods"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "cp_payment_method_idx" ON "customer_payments" ("company_id", "payment_method_id") WHERE "payment_method_id" IS NOT NULL;
