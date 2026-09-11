CREATE TYPE "public"."agent_visit_result" AS ENUM('ordered', 'no_order');--> statement-breakpoint
CREATE TYPE "public"."agent_visit_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."visit_no_order_reason" AS ENUM('no_money', 'has_stock', 'has_debt', 'owner_absent', 'competitor', 'price', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_photo_kind" AS ENUM('storefront', 'shelf', 'placement', 'promotion');--> statement-breakpoint
CREATE TABLE "agent_visit_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "visit_photo_kind" NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"size_bytes" integer NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy" numeric(8, 2),
	"taken_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"user_id" uuid,
	"customer_id" uuid NOT NULL,
	"route_id" uuid,
	"visit_date" date NOT NULL,
	"status" "agent_visit_status" DEFAULT 'in_progress' NOT NULL,
	"result" "agent_visit_result",
	"started_at" timestamp with time zone NOT NULL,
	"start_latitude" numeric(9, 6) NOT NULL,
	"start_longitude" numeric(9, 6) NOT NULL,
	"start_accuracy" numeric(8, 2) NOT NULL,
	"start_distance_meters" integer,
	"completed_at" timestamp with time zone,
	"end_latitude" numeric(9, 6),
	"end_longitude" numeric(9, 6),
	"end_accuracy" numeric(8, 2),
	"end_distance_meters" integer,
	"duration_seconds" integer,
	"no_order_reason" "visit_no_order_reason",
	"no_order_comment" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_visits_completion_check" CHECK ("agent_visits"."status" = 'in_progress' or ("agent_visits"."completed_at" is not null and "agent_visits"."result" is not null and "agent_visits"."duration_seconds" is not null))
);
--> statement-breakpoint
ALTER TABLE "agent_visit_photos" ADD CONSTRAINT "agent_visit_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visit_photos" ADD CONSTRAINT "agent_visit_photos_visit_id_agent_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."agent_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visit_photos" ADD CONSTRAINT "agent_visit_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD CONSTRAINT "agent_visits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD CONSTRAINT "agent_visits_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD CONSTRAINT "agent_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD CONSTRAINT "agent_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD CONSTRAINT "agent_visits_route_id_distribution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."distribution_routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avp_company_visit_idx" ON "agent_visit_photos" USING btree ("company_id","visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "avp_storage_key_key" ON "agent_visit_photos" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "av_company_date_idx" ON "agent_visits" USING btree ("company_id","visit_date");--> statement-breakpoint
CREATE INDEX "av_company_rep_date_idx" ON "agent_visits" USING btree ("company_id","sales_rep_id","visit_date");--> statement-breakpoint
CREATE INDEX "av_company_customer_idx" ON "agent_visits" USING btree ("company_id","customer_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "av_rep_open_key" ON "agent_visits" USING btree ("sales_rep_id") WHERE "agent_visits"."status" = 'in_progress';