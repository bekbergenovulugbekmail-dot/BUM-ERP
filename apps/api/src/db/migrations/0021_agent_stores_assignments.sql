CREATE TABLE "route_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"assign_date" date NOT NULL,
	"delivery_date" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contact_name" varchar(200);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_route_id_distribution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."distribution_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ra_route_date_key" ON "route_assignments" USING btree ("route_id","assign_date");--> statement-breakpoint
CREATE INDEX "ra_company_rep_date_idx" ON "route_assignments" USING btree ("company_id","sales_rep_id","assign_date");