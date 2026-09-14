ALTER TABLE "cash_accounts" ADD COLUMN "show_in_pos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "outgoing_commission_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "reference_type" varchar(50);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD COLUMN "commission_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD COLUMN "show_in_pos" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_company_reference_key" ON "expenses" USING btree ("company_id","reference_type","reference_id") WHERE "expenses"."reference_type" IS NOT NULL;