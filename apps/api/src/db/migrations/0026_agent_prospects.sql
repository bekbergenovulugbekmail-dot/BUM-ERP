CREATE TYPE "public"."prospect_status" AS ENUM('new', 'converted', 'rejected');--> statement-breakpoint
CREATE TABLE "agent_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(200) NOT NULL,
	"phone" varchar(20),
	"address" text,
	"comment" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy" numeric(8, 2),
	"status" "prospect_status" DEFAULT 'new' NOT NULL,
	"customer_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_prospects" ADD CONSTRAINT "agent_prospects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prospects" ADD CONSTRAINT "agent_prospects_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prospects" ADD CONSTRAINT "agent_prospects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prospects" ADD CONSTRAINT "agent_prospects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prospects" ADD CONSTRAINT "agent_prospects_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apr_company_status_idx" ON "agent_prospects" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "apr_company_rep_idx" ON "agent_prospects" USING btree ("company_id","sales_rep_id","created_at");