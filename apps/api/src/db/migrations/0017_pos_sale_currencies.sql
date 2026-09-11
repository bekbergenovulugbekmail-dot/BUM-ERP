ALTER TABLE "customer_payments" ADD COLUMN "foreign_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "price_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "price_rate" numeric(18, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "currency_total" numeric(18, 2) DEFAULT '0' NOT NULL;