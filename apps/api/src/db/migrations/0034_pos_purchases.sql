CREATE TABLE "purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"currency" varchar(3),
	"foreign_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prti_qty_positive" CHECK ("purchase_return_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"return_date" date NOT NULL,
	"device_id" uuid,
	"total_amount" numeric(18, 2) NOT NULL,
	"refund_method" varchar(16),
	"refund_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cash_account_id" uuid,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prt_refund_method" CHECK ("purchase_returns"."refund_method" is null or "purchase_returns"."refund_method" in ('cash', 'card')),
	CONSTRAINT "prt_amounts_non_negative" CHECK ("purchase_returns"."total_amount" >= 0 AND "purchase_returns"."refund_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_cash_movements" DROP CONSTRAINT "pcm_kind";--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD COLUMN "reference_type" varchar(40);--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prti_return_idx" ON "purchase_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "prti_order_item_idx" ON "purchase_return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prt_company_number_key" ON "purchase_returns" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "prt_order_idx" ON "purchase_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "prt_company_date_idx" ON "purchase_returns" USING btree ("company_id","return_date");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "poi_returned_not_over" CHECK ("purchase_order_items"."returned_qty" >= 0 AND "purchase_order_items"."returned_qty" <= "purchase_order_items"."received_qty");--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pcm_kind" CHECK ("pos_cash_movements"."kind" in ('collection', 'change_fund', 'expense', 'other_in', 'other_out', 'supplier_payment', 'supplier_refund'));--> statement-breakpoint
-- Yangi ruxsat mavjud Direktor va Xarid menejeri rollariga (yangi kompaniyalarda — DEFAULT_ROLES); takror ishlaganda ikkilanmaydi
UPDATE "roles" SET "permissions" = array_append("permissions", 'purchase.return')
WHERE "name" IN ('Direktor', 'Xarid menejeri') AND NOT ('purchase.return' = ANY("permissions"));