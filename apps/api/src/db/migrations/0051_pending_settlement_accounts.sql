ALTER TYPE "public"."cash_account_type" ADD VALUE 'card';--> statement-breakpoint
ALTER TYPE "public"."cash_account_type" ADD VALUE 'ewallet';--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "settles_to_cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "settlement_commission_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_settles_to_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("settles_to_cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;