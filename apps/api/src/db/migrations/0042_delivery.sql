CREATE TYPE "public"."delivery_collection_method" AS ENUM('cash', 'card', 'bank');--> statement-breakpoint
CREATE TYPE "public"."delivery_failure_reason" AS ENUM('customer_absent', 'address_not_found', 'no_answer', 'goods_not_ready', 'payment_issue', 'customer_refused', 'vehicle_issue', 'other');--> statement-breakpoint
CREATE TYPE "public"."delivery_payment_review" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."delivery_payment_status" AS ENUM('not_required', 'pending', 'paid', 'partial', 'mismatch');--> statement-breakpoint
CREATE TYPE "public"."delivery_payment_type" AS ENUM('cash', 'card', 'bank', 'credit');--> statement-breakpoint
CREATE TYPE "public"."delivery_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."delivery_proof_kind" AS ENUM('photo', 'signature');--> statement-breakpoint
CREATE TYPE "public"."delivery_task_status" AS ENUM('ready', 'assigned', 'accepted', 'out_for_delivery', 'arrived', 'delivering', 'delivered', 'partially_delivered', 'failed', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_vehicle_type" AS ENUM('foot', 'bicycle', 'motorcycle', 'car', 'van', 'truck');--> statement-breakpoint
CREATE TABLE "delivery_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" uuid,
	"code" varchar(20) NOT NULL,
	"supervisor_user_id" uuid,
	"branch_id" uuid,
	"territory" varchar(100),
	"delivery_zone" varchar(200),
	"vehicle_type" "delivery_vehicle_type",
	"vehicle_number" varchar(20),
	"max_load_kg" numeric(10, 2),
	"working_schedule" jsonb,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "da_max_load_positive" CHECK ("delivery_agents"."max_load_kg" is null or "delivery_agents"."max_load_kg" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"action" varchar(40) NOT NULL,
	"from_status" "delivery_task_status",
	"to_status" "delivery_task_status",
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy" numeric(8, 2),
	"distance_meters" integer,
	"note" text,
	"details" jsonb,
	"client_request_id" uuid,
	"offline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_location_latest" (
	"delivery_agent_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy" numeric(8, 2),
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspicious" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delivery_agent_id" uuid NOT NULL,
	"user_id" uuid,
	"work_session_id" uuid,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy" numeric(8, 2),
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspicious" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"customer_payment_id" uuid NOT NULL,
	"method" "delivery_collection_method" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"collected_by" uuid,
	"collected_at" timestamp with time zone NOT NULL,
	"client_request_id" uuid NOT NULL,
	"offline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dpay_amount_positive" CHECK ("delivery_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "delivery_proof_kind" NOT NULL,
	"content" "bytea" NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"signer_name" varchar(200),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy" numeric(8, 2),
	"distance_meters" integer,
	"taken_at" timestamp with time zone NOT NULL,
	"uploaded_by" uuid,
	"client_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_task_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"delivered_qty" numeric(18, 4),
	"returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dti_quantity_positive" CHECK ("delivery_task_items"."quantity" > 0),
	CONSTRAINT "dti_delivered_range" CHECK ("delivery_task_items"."delivered_qty" is null or ("delivery_task_items"."delivered_qty" >= 0 and "delivery_task_items"."delivered_qty" <= "delivery_task_items"."quantity")),
	CONSTRAINT "dti_returned_range" CHECK ("delivery_task_items"."returned_qty" >= 0 and "delivery_task_items"."returned_qty" + coalesce("delivery_task_items"."delivered_qty", 0) <= "delivery_task_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "delivery_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"delivery_agent_id" uuid,
	"status" "delivery_task_status" DEFAULT 'ready' NOT NULL,
	"priority" "delivery_priority" DEFAULT 'normal' NOT NULL,
	"scheduled_date" date NOT NULL,
	"window_start" time,
	"window_end" time,
	"route_order" integer,
	"payment_type" "delivery_payment_type" DEFAULT 'cash' NOT NULL,
	"expected_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"collected_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_status" "delivery_payment_status" DEFAULT 'pending' NOT NULL,
	"payment_review" "delivery_payment_review" DEFAULT 'none' NOT NULL,
	"payment_reviewed_by" uuid,
	"payment_reviewed_at" timestamp with time zone,
	"payment_review_note" text,
	"customer_note" text,
	"delivery_note" text,
	"supervisor_note" text,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"delivering_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failure_reason" "delivery_failure_reason",
	"failure_comment" text,
	"cancel_reason" text,
	"arrival_latitude" numeric(9, 6),
	"arrival_longitude" numeric(9, 6),
	"arrival_accuracy" numeric(8, 2),
	"arrival_distance_meters" integer,
	"confirm_latitude" numeric(9, 6),
	"confirm_longitude" numeric(9, 6),
	"confirm_accuracy" numeric(8, 2),
	"confirm_distance_meters" integer,
	"otp_hash" varchar(64),
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"otp_verified_at" timestamp with time zone,
	"signer_name" varchar(200),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dt_window_pair" CHECK (("delivery_tasks"."window_start" is null) = ("delivery_tasks"."window_end" is null) and ("delivery_tasks"."window_start" is null or "delivery_tasks"."window_start" < "delivery_tasks"."window_end")),
	CONSTRAINT "dt_amounts_non_negative" CHECK ("delivery_tasks"."expected_amount" >= 0 and "delivery_tasks"."collected_amount" >= 0),
	CONSTRAINT "dt_route_order_positive" CHECK ("delivery_tasks"."route_order" is null or "delivery_tasks"."route_order" >= 1),
	CONSTRAINT "dt_otp_attempts_non_negative" CHECK ("delivery_tasks"."otp_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delivery_agent_id" uuid NOT NULL,
	"user_id" uuid,
	"status" "agent_work_session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"start_latitude" numeric(9, 6) NOT NULL,
	"start_longitude" numeric(9, 6) NOT NULL,
	"start_accuracy" numeric(8, 2) NOT NULL,
	"ended_at" timestamp with time zone,
	"end_latitude" numeric(9, 6),
	"end_longitude" numeric(9, 6),
	"end_accuracy" numeric(8, 2),
	"end_reason" "agent_work_session_end_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "delivery_required" boolean;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_supervisor_user_id_users_id_fk" FOREIGN KEY ("supervisor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_task_id_delivery_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_latest" ADD CONSTRAINT "delivery_location_latest_delivery_agent_id_delivery_agents_id_fk" FOREIGN KEY ("delivery_agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_location_latest" ADD CONSTRAINT "delivery_location_latest_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_locations" ADD CONSTRAINT "delivery_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_locations" ADD CONSTRAINT "delivery_locations_delivery_agent_id_delivery_agents_id_fk" FOREIGN KEY ("delivery_agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_locations" ADD CONSTRAINT "delivery_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_locations" ADD CONSTRAINT "delivery_locations_work_session_id_delivery_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."delivery_work_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_payments" ADD CONSTRAINT "delivery_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_payments" ADD CONSTRAINT "delivery_payments_task_id_delivery_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_payments" ADD CONSTRAINT "delivery_payments_customer_payment_id_customer_payments_id_fk" FOREIGN KEY ("customer_payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_payments" ADD CONSTRAINT "delivery_payments_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_task_id_delivery_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_task_items" ADD CONSTRAINT "delivery_task_items_task_id_delivery_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_task_items" ADD CONSTRAINT "delivery_task_items_order_item_id_sales_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."sales_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_task_items" ADD CONSTRAINT "delivery_task_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_delivery_agent_id_delivery_agents_id_fk" FOREIGN KEY ("delivery_agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_payment_reviewed_by_users_id_fk" FOREIGN KEY ("payment_reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_work_sessions" ADD CONSTRAINT "delivery_work_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_work_sessions" ADD CONSTRAINT "delivery_work_sessions_delivery_agent_id_delivery_agents_id_fk" FOREIGN KEY ("delivery_agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_work_sessions" ADD CONSTRAINT "delivery_work_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "da_company_user_key" ON "delivery_agents" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "da_company_code_key" ON "delivery_agents" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "da_company_active_idx" ON "delivery_agents" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "de_task_request_key" ON "delivery_events" USING btree ("task_id","client_request_id") WHERE "delivery_events"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX "de_task_occurred_idx" ON "delivery_events" USING btree ("task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "de_company_occurred_idx" ON "delivery_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "dll_company_idx" ON "delivery_location_latest" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "dl_company_agent_recorded_idx" ON "delivery_locations" USING btree ("company_id","delivery_agent_id","recorded_at");--> statement-breakpoint
CREATE INDEX "dl_company_recorded_idx" ON "delivery_locations" USING btree ("company_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dpay_company_request_key" ON "delivery_payments" USING btree ("company_id","client_request_id");--> statement-breakpoint
CREATE INDEX "dpay_task_idx" ON "delivery_payments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "dpay_company_collected_idx" ON "delivery_payments" USING btree ("company_id","collected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dp_task_request_key" ON "delivery_proofs" USING btree ("task_id","client_request_id");--> statement-breakpoint
CREATE INDEX "dp_task_idx" ON "delivery_proofs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dti_task_order_item_key" ON "delivery_task_items" USING btree ("task_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dt_company_number_key" ON "delivery_tasks" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "dt_order_open_key" ON "delivery_tasks" USING btree ("order_id") WHERE "delivery_tasks"."status" in ('ready', 'assigned', 'accepted', 'out_for_delivery', 'arrived', 'delivering');--> statement-breakpoint
CREATE INDEX "dt_company_status_date_idx" ON "delivery_tasks" USING btree ("company_id","status","scheduled_date");--> statement-breakpoint
CREATE INDEX "dt_company_agent_date_idx" ON "delivery_tasks" USING btree ("company_id","delivery_agent_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "dt_company_date_idx" ON "delivery_tasks" USING btree ("company_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "dt_company_order_idx" ON "delivery_tasks" USING btree ("company_id","order_id");--> statement-breakpoint
CREATE INDEX "dt_company_customer_idx" ON "delivery_tasks" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "dt_company_review_idx" ON "delivery_tasks" USING btree ("company_id","payment_review") WHERE "delivery_tasks"."payment_review" = 'pending';--> statement-breakpoint
CREATE INDEX "dws_company_agent_started_idx" ON "delivery_work_sessions" USING btree ("company_id","delivery_agent_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dws_agent_active_key" ON "delivery_work_sessions" USING btree ("delivery_agent_id") WHERE "delivery_work_sessions"."status" = 'active';--> statement-breakpoint
-- Dostavka: "Dostavka agenti" (DELIVERY_AGENT) roli mavjud kompaniyalar va global rollar uchun, mavjud rollarga dostavka ruxsatlari. Takror ishlasa o'zgarmaydi.
INSERT INTO "roles" ("company_id", "name", "description", "color", "permissions", "is_system")
SELECT c."id", 'Dostavka agenti', 'DELIVERY_AGENT — yetkazuvchi ish joyi: o''z yetkazmalari, mijozlari va to''lovlari', '#f43f5e',
  ARRAY['delivery.accept', 'delivery.start', 'delivery.arrive', 'delivery.confirm', 'delivery.fail', 'delivery.collect_payment', 'delivery.view_debt']::text[], true
FROM "companies" c
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "roles" ("company_id", "name", "description", "color", "permissions", "is_system")
SELECT NULL, 'Dostavka agenti', 'DELIVERY_AGENT — yetkazuvchi ish joyi: o''z yetkazmalari, mijozlari va to''lovlari', '#f43f5e',
  ARRAY['delivery.accept', 'delivery.start', 'delivery.arrive', 'delivery.confirm', 'delivery.fail', 'delivery.collect_payment', 'delivery.view_debt']::text[], true
WHERE EXISTS (SELECT 1 FROM "roles" WHERE "company_id" IS NULL)
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY[
    'delivery.view', 'delivery.manage', 'delivery.assign', 'delivery.reassign', 'delivery.accept', 'delivery.start', 'delivery.arrive',
    'delivery.confirm', 'delivery.fail', 'delivery.return', 'delivery.collect_payment', 'delivery.view_debt', 'delivery.view_location',
    'delivery.manage_routes', 'delivery.view_reports'
  ]::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" = 'Direktor';--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY[
    'delivery.view', 'delivery.manage', 'delivery.assign', 'delivery.reassign', 'delivery.return', 'delivery.view_location',
    'delivery.manage_routes', 'delivery.view_reports'
  ]::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" = 'Supervayzer';--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['delivery.view', 'delivery.manage', 'delivery.assign', 'delivery.reassign', 'delivery.manage_routes', 'delivery.view_reports']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" = 'Savdo menejeri';--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['delivery.view', 'delivery.return']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" = 'Ombor menejeri';--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'delivery.view')
WHERE "name" IN ('Auditor', 'Ko''ruvchi') AND NOT ('delivery.view' = ANY("permissions"));