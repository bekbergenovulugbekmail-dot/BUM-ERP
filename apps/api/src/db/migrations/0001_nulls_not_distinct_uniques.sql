DROP INDEX "roles_company_name_key";--> statement-breakpoint
DROP INDEX "settings_company_key_key";--> statement-breakpoint
DROP INDEX "unit_conv_unique";--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_name_key" UNIQUE NULLS NOT DISTINCT("company_id","name");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_key_key" UNIQUE NULLS NOT DISTINCT("company_id","key");--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conv_unique" UNIQUE NULLS NOT DISTINCT("company_id","from_unit_id","to_unit_id","product_id");