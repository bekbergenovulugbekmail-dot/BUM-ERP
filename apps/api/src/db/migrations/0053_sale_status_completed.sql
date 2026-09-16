CREATE TYPE "public"."sales_fulfillment_method" AS ENUM('counter', 'pickup', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."sales_order_source" AS ENUM('pos', 'sales_agent', 'manual', 'import');--> statement-breakpoint
ALTER TYPE "public"."sales_order_status" ADD VALUE 'completed';--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "source" "sales_order_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "fulfillment_method" "sales_fulfillment_method";