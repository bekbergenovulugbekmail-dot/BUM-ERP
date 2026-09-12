CREATE TYPE "public"."agent_order_approval" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."order_payment_type" AS ENUM('cash', 'card', 'credit');--> statement-breakpoint
CREATE TABLE "agent_orders" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"visit_id" uuid,
	"client_request_id" uuid NOT NULL,
	"payment_type" "order_payment_type" DEFAULT 'cash' NOT NULL,
	"payment_due_date" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"submit_latitude" numeric(9, 6),
	"submit_longitude" numeric(9, 6),
	"submit_accuracy" numeric(8, 2),
	"submit_distance_meters" integer,
	"approval_status" "agent_order_approval",
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_orders" ADD CONSTRAINT "agent_orders_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_orders" ADD CONSTRAINT "agent_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_orders" ADD CONSTRAINT "agent_orders_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_orders" ADD CONSTRAINT "agent_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_orders" ADD CONSTRAINT "agent_orders_visit_id_agent_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."agent_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_orders" ADD CONSTRAINT "agent_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ao_rep_request_key" ON "agent_orders" USING btree ("sales_rep_id","client_request_id");--> statement-breakpoint
CREATE INDEX "ao_company_rep_idx" ON "agent_orders" USING btree ("company_id","sales_rep_id","updated_at");--> statement-breakpoint
CREATE INDEX "ao_company_approval_idx" ON "agent_orders" USING btree ("company_id","approval_status");--> statement-breakpoint
CREATE INDEX "ao_visit_idx" ON "agent_orders" USING btree ("visit_id");