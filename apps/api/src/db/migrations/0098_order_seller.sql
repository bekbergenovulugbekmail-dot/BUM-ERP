-- Sotuvchi (2026-09-27): chekni qaysi xodim sotgani — kassir (created_by), kassa (pos_shifts.cash_account_id), qurilma
-- (device_id) va yaratgandan ALOHIDA tushuncha. Bir kassada ko'p sotuvchi. Eski buyurtmalar — NULL (qayta yozilmaydi).
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "seller_employee_id" uuid REFERENCES "employees"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "so_company_seller_idx" ON "sales_orders" ("company_id", "seller_employee_id", "order_date") WHERE "seller_employee_id" IS NOT NULL;
-- KPI Rule Builder ko'rsatkichlari (qattiq kodlangan bonus yo'q — qoidalar builder'da)
ALTER TYPE "kpi_metric" ADD VALUE IF NOT EXISTS 'seller_sales_amount';
ALTER TYPE "kpi_metric" ADD VALUE IF NOT EXISTS 'seller_receipt_count';
ALTER TYPE "kpi_metric" ADD VALUE IF NOT EXISTS 'seller_gross_profit';
