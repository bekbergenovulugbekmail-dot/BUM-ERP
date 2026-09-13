ALTER TABLE "customers" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "district" varchar(100);--> statement-breakpoint
CREATE INDEX "customers_company_region_idx" ON "customers" USING btree ("company_id","city","district");