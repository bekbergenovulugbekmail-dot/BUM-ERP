CREATE TYPE "public"."product_kind" AS ENUM('product', 'raw_material', 'semi_finished');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" "product_kind" DEFAULT 'product' NOT NULL;