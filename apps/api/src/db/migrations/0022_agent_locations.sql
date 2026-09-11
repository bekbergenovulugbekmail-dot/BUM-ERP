CREATE TYPE "public"."agent_location_event_type" AS ENUM('permission_denied', 'update_failure', 'low_accuracy', 'stale', 'invalid', 'jump', 'mock', 'geofence_block');--> statement-breakpoint
CREATE TABLE "agent_location_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "agent_location_event_type" NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy" numeric(8, 2),
	"details" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_location_latest" (
	"sales_rep_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy" numeric(8, 2),
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspicious" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"user_id" uuid,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy" numeric(8, 2),
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspicious" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_location_events" ADD CONSTRAINT "agent_location_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_events" ADD CONSTRAINT "agent_location_events_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_events" ADD CONSTRAINT "agent_location_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_latest" ADD CONSTRAINT "agent_location_latest_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_location_latest" ADD CONSTRAINT "agent_location_latest_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_locations" ADD CONSTRAINT "agent_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_locations" ADD CONSTRAINT "agent_locations_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_locations" ADD CONSTRAINT "agent_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ale_company_occurred_idx" ON "agent_location_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ale_company_rep_occurred_idx" ON "agent_location_events" USING btree ("company_id","sales_rep_id","occurred_at");--> statement-breakpoint
CREATE INDEX "all_company_idx" ON "agent_location_latest" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "al_company_rep_recorded_idx" ON "agent_locations" USING btree ("company_id","sales_rep_id","recorded_at");--> statement-breakpoint
CREATE INDEX "al_company_recorded_idx" ON "agent_locations" USING btree ("company_id","recorded_at");