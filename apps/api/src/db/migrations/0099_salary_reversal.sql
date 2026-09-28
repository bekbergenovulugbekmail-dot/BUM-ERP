-- To'langan maoshni bekor qilish (egasi qarori, 2026-09-28): asl maosh o'zgarmaydi va o'chirilmaydi — kassa va jurnal
-- teskari (kompensatsion) yozuvlari bilan bekor qilinadi, holat `reversed`, kim/qachon/nega saqlanadi. Shu oy uchun
-- to'g'rilangan maosh yaratilishi uchun (xodim, oy) yagonaligi faqat bekor qilinmaganlar orasida.
-- Yangi enum qiymati shu migratsiyada ISHLATILMAYDI (bitta tranzaksiyada qo'shilgan qiymatni ishlatib bo'lmaydi):
-- indeks sharti `reversed_at` ustunida.
ALTER TYPE "public"."salary_payment_status" ADD VALUE IF NOT EXISTS 'reversed';--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
DROP INDEX IF EXISTS "sal_employee_month_key";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sal_employee_month_key" ON "salary_payments" ("employee_id", "month") WHERE "reversed_at" IS NULL;
