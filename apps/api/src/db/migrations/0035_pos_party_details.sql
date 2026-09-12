ALTER TABLE "suppliers" ADD COLUMN "party_type" varchar(16) DEFAULT 'legal' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "bank_mfo" varchar(16);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "party_type" varchar(16) DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "bank_account" varchar(64);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "bank_mfo" varchar(16);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_party_type" CHECK ("suppliers"."party_type" in ('individual', 'legal'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_party_type" CHECK ("customers"."party_type" in ('individual', 'legal'));