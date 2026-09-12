CREATE TYPE "public"."promotion_type" AS ENUM('buy_x_get_y', 'percent_discount');--> statement-breakpoint
CREATE TABLE "order_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"rule" jsonb NOT NULL,
	"paid_quantity" numeric(18, 4) NOT NULL,
	"free_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"type" "promotion_type" NOT NULL,
	"product_id" uuid NOT NULL,
	"min_quantity" numeric(18, 4) NOT NULL,
	"free_quantity" numeric(18, 4),
	"discount_percent" numeric(5, 2),
	"starts_at" date NOT NULL,
	"ends_at" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_dates_check" CHECK ("promotions"."ends_at" >= "promotions"."starts_at"),
	CONSTRAINT "promo_rule_check" CHECK ("promotions"."min_quantity" > 0 and (("promotions"."type" = 'buy_x_get_y' and "promotions"."free_quantity" > 0) or ("promotions"."type" = 'percent_discount' and "promotions"."discount_percent" > 0 and "promotions"."discount_percent" <= 100)))
);
--> statement-breakpoint
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "op_order_idx" ON "order_promotions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "op_company_promotion_idx" ON "order_promotions" USING btree ("company_id","promotion_id");--> statement-breakpoint
CREATE INDEX "promo_company_period_idx" ON "promotions" USING btree ("company_id","is_active","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "promo_company_product_idx" ON "promotions" USING btree ("company_id","product_id");