ALTER TABLE "cash_accounts" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
CREATE INDEX "ca_company_employee_idx" ON "cash_accounts" USING btree ("company_id","employee_id");