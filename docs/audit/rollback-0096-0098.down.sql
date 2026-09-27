-- ROLLBACK 0096–0098 (TAYYORLANGAN, ISHGA TUSHIRILMAGAN). Faqat kod oldingi versiyaga qaytarilgach va yangi
-- ob'ektlarda ma'lumot yo'qligi tekshirilgach (payment_methods bo'sh, cash_account_id/seller_employee_id/payment_method_id NULL).
-- Odatda KERAK EMAS: sxema oldinga mos — eski kod yangi ustunlarni e'tiborsiz qoldiradi.
BEGIN;
-- 0098
DROP INDEX IF EXISTS "so_company_seller_idx";
ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "seller_employee_id";
-- kpi_metric qiymatlari (seller_*) PostgreSQL'da o'chirilmaydi; zararsiz — eski kod ularni ishlatmaydi.
-- 0097
DROP INDEX IF EXISTS "cp_payment_method_idx";
ALTER TABLE "customer_payments" DROP COLUMN IF EXISTS "payment_method_id";
DROP TABLE IF EXISTS "payment_method_kassas";
DROP TABLE IF EXISTS "payment_methods";
-- 0096
DROP INDEX IF EXISTS "ps_one_open_per_kassa";
DROP INDEX IF EXISTS "ps_one_open_per_warehouse";
CREATE UNIQUE INDEX "ps_one_open_per_warehouse" ON "pos_shifts" USING btree ("company_id","warehouse_id") WHERE "status" = 'open' AND "device_id" IS NULL;
ALTER TABLE "pos_devices" DROP COLUMN IF EXISTS "cash_account_id";
ALTER TABLE "pos_shifts" DROP COLUMN IF EXISTS "opening_balance";
ALTER TABLE "pos_shifts" DROP COLUMN IF EXISTS "cash_account_id";
DROP INDEX IF EXISTS "ca_company_warehouse_idx";
DROP INDEX IF EXISTS "ca_company_code_key";
ALTER TABLE "cash_accounts" DROP COLUMN IF EXISTS "code";
ALTER TABLE "cash_accounts" DROP COLUMN IF EXISTS "warehouse_id";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1790530000000, 1790540000000, 1790550000000);
COMMIT;
