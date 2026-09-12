CREATE TYPE "public"."agent_work_session_end_reason" AS ENUM('agent', 'auto', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."agent_work_session_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TABLE "agent_work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
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
ALTER TABLE "agent_locations" ADD COLUMN "work_session_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_work_sessions" ADD CONSTRAINT "agent_work_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_work_sessions" ADD CONSTRAINT "agent_work_sessions_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_work_sessions" ADD CONSTRAINT "agent_work_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aws_company_rep_started_idx" ON "agent_work_sessions" USING btree ("company_id","sales_rep_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "aws_rep_active_key" ON "agent_work_sessions" USING btree ("sales_rep_id") WHERE "agent_work_sessions"."status" = 'active';--> statement-breakpoint
ALTER TABLE "agent_locations" ADD CONSTRAINT "agent_locations_work_session_id_agent_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."agent_work_sessions"("id") ON DELETE set null ON UPDATE no action;