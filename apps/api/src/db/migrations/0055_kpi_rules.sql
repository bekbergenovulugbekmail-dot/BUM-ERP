CREATE TYPE "public"."kpi_metric" AS ENUM('delivery_count', 'delivery_amount', 'delivery_weight_kg', 'agent_sales_amount', 'agent_order_count', 'agent_visit_count', 'agent_collected_amount', 'cashier_receipt_count', 'cashier_sales_amount', 'warehouse_receipt_count', 'warehouse_issue_count');--> statement-breakpoint
CREATE TYPE "public"."kpi_rate_type" AS ENUM('percent', 'per_unit');--> statement-breakpoint
CREATE TABLE "kpi_rule_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"from_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"to_value" numeric(18, 4),
	"rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_tier_range" CHECK ("kpi_rule_tiers"."to_value" is null or "kpi_rule_tiers"."to_value" > "kpi_rule_tiers"."from_value"),
	CONSTRAINT "kpi_tier_non_negative" CHECK ("kpi_rule_tiers"."from_value" >= 0 AND "kpi_rule_tiers"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "kpi_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"position_id" uuid,
	"employee_id" uuid,
	"metric" "kpi_metric" NOT NULL,
	"rate_type" "kpi_rate_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_rule_one_target" CHECK (("kpi_rules"."position_id" is null) <> ("kpi_rules"."employee_id" is null))
);
--> statement-breakpoint
CREATE TABLE "salary_kpi_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"salary_payment_id" uuid NOT NULL,
	"metric" "kpi_metric" NOT NULL,
	"metric_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_rule_tiers" ADD CONSTRAINT "kpi_rule_tiers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_rule_tiers" ADD CONSTRAINT "kpi_rule_tiers_rule_id_kpi_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."kpi_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_rules" ADD CONSTRAINT "kpi_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_rules" ADD CONSTRAINT "kpi_rules_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_rules" ADD CONSTRAINT "kpi_rules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_rules" ADD CONSTRAINT "kpi_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_kpi_lines" ADD CONSTRAINT "salary_kpi_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_kpi_lines" ADD CONSTRAINT "salary_kpi_lines_salary_payment_id_salary_payments_id_fk" FOREIGN KEY ("salary_payment_id") REFERENCES "public"."salary_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_kpi_lines" ADD CONSTRAINT "salary_kpi_lines_rule_id_kpi_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."kpi_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_tier_rule_idx" ON "kpi_rule_tiers" USING btree ("rule_id","from_value");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_rule_position_metric_key" ON "kpi_rules" USING btree ("company_id","position_id","metric") WHERE "kpi_rules"."position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_rule_employee_metric_key" ON "kpi_rules" USING btree ("company_id","employee_id","metric") WHERE "kpi_rules"."employee_id" is not null;--> statement-breakpoint
CREATE INDEX "kpi_rule_company_idx" ON "kpi_rules" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_line_salary_metric_key" ON "salary_kpi_lines" USING btree ("salary_payment_id","metric");--> statement-breakpoint
CREATE INDEX "kpi_line_company_idx" ON "salary_kpi_lines" USING btree ("company_id");