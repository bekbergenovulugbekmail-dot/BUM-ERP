-- Kassa hujjatlari (2026-09-26): o'tkazma, to'lov usulini ayirboshlash va tuzatish, valyuta ayirboshlash,
-- kategoriyali kirim — har biri HUJJAT (raqam, sabab, mas'ul, tasdiqlagan), pul harakati esa mavjud yagona manbada
-- (cash_transactions + journal). Bekor qilish — teskari yozuvlar, o'chirish yo'q. FAQAT QO'SHUVCHI.

CREATE TABLE IF NOT EXISTS "cash_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "name" varchar(120) NOT NULL,
  "direction" varchar(8) NOT NULL,
  "parent_id" uuid REFERENCES "cash_categories"("id") ON DELETE SET NULL,
  "counter_account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cc_direction_known" CHECK ("direction" IN ('in', 'out'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cc_company_direction_name_key" ON "cash_categories" ("company_id", "direction", "name");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cash_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "number" varchar(32) NOT NULL,
  "kind" varchar(24) NOT NULL,
  "status" varchar(16) DEFAULT 'posted' NOT NULL,
  "doc_date" date NOT NULL,
  "from_cash_account_id" uuid REFERENCES "cash_accounts"("id") ON DELETE RESTRICT,
  "to_cash_account_id" uuid REFERENCES "cash_accounts"("id") ON DELETE RESTRICT,
  "amount" numeric(18, 2) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "to_amount" numeric(18, 2),
  "to_currency" varchar(3),
  -- Kurs SNAPSHOT: kelishilgan kurs (to_amount / amount) va hisob kursi (kompaniya kursi shu paytda)
  "deal_rate" numeric(18, 6),
  "book_rate_from" numeric(18, 4),
  "book_rate_to" numeric(18, 4),
  "base_amount" numeric(18, 2) NOT NULL,
  -- Kurs yoki usul farqi (asosiy valyutada): musbat — daromad, manfiy — xarajat
  "difference" numeric(18, 2) DEFAULT '0' NOT NULL,
  "category_id" uuid REFERENCES "cash_categories"("id") ON DELETE RESTRICT,
  "counterparty_type" varchar(16),
  "counterparty_name" varchar(200),
  "responsible_employee_id" uuid,
  "reason" text NOT NULL,
  "reference" varchar(100),
  "notes" text,
  -- Tuzatish: qaysi yozuv tuzatilmoqda (masalan, to'lov usuli noto'g'ri tanlangan mijoz to'lovi) — asl yozuv o'zgarmaydi
  "corrects_type" varchar(40),
  "corrects_id" uuid,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "request_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "reversed_at" timestamp with time zone,
  "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reversal_reason" text,
  "reversal_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cd_kind_known" CHECK ("kind" IN ('transfer', 'method_exchange', 'method_correction', 'currency_exchange', 'income', 'expense')),
  CONSTRAINT "cd_status_known" CHECK ("status" IN ('posted', 'reversed')),
  CONSTRAINT "cd_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "cd_accounts_differ" CHECK ("from_cash_account_id" IS NULL OR "to_cash_account_id" IS NULL OR "from_cash_account_id" <> "to_cash_account_id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cd_company_number_key" ON "cash_documents" ("company_id", "number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cd_company_request_key" ON "cash_documents" ("company_id", "request_id") WHERE "request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cd_company_date_idx" ON "cash_documents" ("company_id", "doc_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cd_from_idx" ON "cash_documents" ("from_cash_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cd_to_idx" ON "cash_documents" ("to_cash_account_id");
