CREATE TABLE "pos_sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"op_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"reference_type" varchar(40),
	"reference_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"cogs" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sri_qty_positive" CHECK ("sales_return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"pos_shift_id" uuid,
	"device_id" uuid,
	"total_amount" numeric(18, 2) NOT NULL,
	"cogs" numeric(18, 2) DEFAULT '0' NOT NULL,
	"refund_method" varchar(16) NOT NULL,
	"refund_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"balance_restored" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cashback_restored" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cashback_reversed" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sr_refund_method" CHECK ("sales_returns"."refund_method" in ('cash', 'card', 'balance')),
	CONSTRAINT "sr_amounts_non_negative" CHECK ("sales_returns"."total_amount" >= 0 AND "sales_returns"."refund_amount" >= 0 AND "sales_returns"."balance_restored" >= 0 AND "sales_returns"."cashback_restored" >= 0 AND "sales_returns"."cashback_reversed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_quantity_non_negative";--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "total_returns" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN "returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_sync_conflicts" ADD CONSTRAINT "pos_sync_conflicts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_conflicts" ADD CONSTRAINT "pos_sync_conflicts_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_conflicts" ADD CONSTRAINT "pos_sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_order_item_id_sales_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_pos_shift_id_pos_shifts_id_fk" FOREIGN KEY ("pos_shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "psc_company_open_idx" ON "pos_sync_conflicts" USING btree ("company_id","resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "psc_device_op_idx" ON "pos_sync_conflicts" USING btree ("device_id","op_id");--> statement-breakpoint
CREATE INDEX "sri_return_idx" ON "sales_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "sri_order_item_idx" ON "sales_return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_company_number_key" ON "sales_returns" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "sr_order_idx" ON "sales_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sr_shift_idx" ON "sales_returns" USING btree ("pos_shift_id");--> statement-breakpoint
CREATE INDEX "sr_company_created_idx" ON "sales_returns" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "soi_returned_qty_range" CHECK ("sales_order_items"."returned_qty" >= 0 AND "sales_order_items"."returned_qty" <= "sales_order_items"."quantity");