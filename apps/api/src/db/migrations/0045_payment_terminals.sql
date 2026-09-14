CREATE TABLE "payment_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"network" varchar(20) NOT NULL,
	"provider" varchar(100),
	"cash_account_id" uuid NOT NULL,
	"branch_id" uuid,
	"terminal_identifier" varchar(64),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pt_network_valid" CHECK ("payment_terminals"."network" in ('uzcard', 'humo', 'visa', 'mastercard', 'unionpay', 'other'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source" varchar(24) NOT NULL,
	"idempotency_key" varchar(120),
	"customer_id" uuid,
	"order_id" uuid,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_total_positive" CHECK ("payments"."total_amount" > 0),
	CONSTRAINT "pay_source_valid" CHECK ("payments"."source" in ('pos', 'pos_device', 'delivery', 'sales_payment', 'pos_customer_payment'))
);
--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD COLUMN "ledger_account_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "terminal_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pt_company_active_idx" ON "payment_terminals" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_company_name_key" ON "payment_terminals" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_company_identifier_key" ON "payment_terminals" USING btree ("company_id","terminal_identifier") WHERE "payment_terminals"."terminal_identifier" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_company_idempotency_key" ON "payments" USING btree ("company_id","idempotency_key") WHERE "payments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pay_company_order_idx" ON "payments" USING btree ("company_id","order_id");--> statement-breakpoint
CREATE INDEX "pay_company_customer_idx" ON "payments" USING btree ("company_id","customer_id");--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_ledger_account_id_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_terminal_id_payment_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."payment_terminals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cp_payment_idx" ON "customer_payments" USING btree ("payment_id");