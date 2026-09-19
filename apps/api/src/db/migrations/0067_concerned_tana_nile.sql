CREATE TYPE "public"."delivery_return_pickup_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "delivery_return_pickup_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pickup_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drpi_quantity_positive" CHECK ("delivery_return_pickup_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_return_pickups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"agent_id" uuid,
	"task_id" uuid,
	"created_by" uuid,
	"status" "delivery_return_pickup_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"refund_method" varchar(16) DEFAULT 'balance' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"return_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drp_refund_method" CHECK ("delivery_return_pickups"."refund_method" in ('cash', 'card', 'bank', 'balance'))
);
--> statement-breakpoint
ALTER TABLE "delivery_return_pickup_items" ADD CONSTRAINT "delivery_return_pickup_items_pickup_id_delivery_return_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."delivery_return_pickups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickup_items" ADD CONSTRAINT "delivery_return_pickup_items_order_item_id_sales_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickup_items" ADD CONSTRAINT "delivery_return_pickup_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_task_id_delivery_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_return_pickups" ADD CONSTRAINT "delivery_return_pickups_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drpi_pickup_item_key" ON "delivery_return_pickup_items" USING btree ("pickup_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drp_company_number_key" ON "delivery_return_pickups" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "drp_company_status_idx" ON "delivery_return_pickups" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "drp_agent_idx" ON "delivery_return_pickups" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "drp_customer_idx" ON "delivery_return_pickups" USING btree ("customer_id","created_at");