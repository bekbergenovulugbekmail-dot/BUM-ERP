ALTER TABLE "sales_returns" DROP CONSTRAINT "sr_refund_method";--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "total_bank" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD COLUMN "refunds" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "so_company_client_request_key" ON "sales_orders" USING btree ("company_id","client_request_id") WHERE "sales_orders"."client_request_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sr_refund_method" CHECK ("sales_returns"."refund_method" in ('cash', 'card', 'bank', 'balance', 'mixed'));