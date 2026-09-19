CREATE TYPE "public"."allowance_kind" AS ENUM('transport', 'meal', 'phone', 'housing', 'other');--> statement-breakpoint
CREATE TABLE "employee_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "allowance_kind" DEFAULT 'other' NOT NULL,
	"label" varchar(100),
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"start_month" varchar(7) NOT NULL,
	"end_month" varchar(7),
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eal_amount_non_negative" CHECK ("employee_allowances"."amount" >= 0),
	CONSTRAINT "eal_period_order" CHECK ("employee_allowances"."end_month" is null or "employee_allowances"."end_month" >= "employee_allowances"."start_month")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payout_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "salary_payments" ADD COLUMN "allowances" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eal_company_employee_idx" ON "employee_allowances" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "eal_company_period_idx" ON "employee_allowances" USING btree ("company_id","start_month");