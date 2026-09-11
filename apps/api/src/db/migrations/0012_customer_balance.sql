CREATE TYPE "public"."customer_balance_tx_type" AS ENUM('deposit', 'change', 'sale_payment', 'refund');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'balance';--> statement-breakpoint
CREATE TABLE "customer_balance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "customer_balance_tx_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"method" "payment_method",
	"order_id" uuid,
	"payment_id" uuid,
	"pos_shift_id" uuid,
	"cash_account_id" uuid,
	"journal_entry_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cbt_amount_non_zero" CHECK ("customer_balance_transactions"."amount" <> 0),
	CONSTRAINT "cbt_balance_after_non_negative" CHECK ("customer_balance_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "balance" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_payment_id_customer_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_pos_shift_id_pos_shifts_id_fk" FOREIGN KEY ("pos_shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_balance_transactions" ADD CONSTRAINT "customer_balance_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cbt_company_customer_idx" ON "customer_balance_transactions" USING btree ("company_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "cbt_order_idx" ON "customer_balance_transactions" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_balance_non_negative" CHECK ("customers"."balance" >= 0);--> statement-breakpoint
-- Mavjud kompaniyalarning hisoblar rejasiga 2300 "Mijozlar avanslari" (servis yo'q bo'lsa ham qo'shadi)
INSERT INTO "accounts" ("company_id", "code", "name", "type", "subtype", "currency")
SELECT c."id", '2300', 'Mijozlar avanslari (balans)', 'liability', 'customer_advance', c."currency"
FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."subtype" = 'customer_advance')
ON CONFLICT DO NOTHING;