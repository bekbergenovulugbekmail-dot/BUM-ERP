CREATE TYPE "public"."customer_cashback_tx_type" AS ENUM('earn', 'redeem', 'earn_reversal', 'redeem_refund', 'adjustment');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'cashback';--> statement-breakpoint
CREATE TABLE "customer_cashback_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "customer_cashback_tx_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"journal_entry_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cct_amount_non_zero" CHECK ("customer_cashback_transactions"."amount" <> 0),
	CONSTRAINT "cct_balance_after_non_negative" CHECK ("customer_cashback_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "cashback_balance" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_cashback_transactions" ADD CONSTRAINT "customer_cashback_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cashback_transactions" ADD CONSTRAINT "customer_cashback_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cashback_transactions" ADD CONSTRAINT "customer_cashback_transactions_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cashback_transactions" ADD CONSTRAINT "customer_cashback_transactions_payment_id_customer_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cashback_transactions" ADD CONSTRAINT "customer_cashback_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_cashback_transactions" ADD CONSTRAINT "customer_cashback_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cct_company_customer_idx" ON "customer_cashback_transactions" USING btree ("company_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "cct_order_idx" ON "customer_cashback_transactions" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_cashback_non_negative" CHECK ("customers"."cashback_balance" >= 0);--> statement-breakpoint
-- Mavjud kompaniyalarning hisoblar rejasiga 2400 "Keshbek majburiyati" va 5600 "Keshbek xarajatlari"
INSERT INTO "accounts" ("company_id", "code", "name", "type", "subtype", "currency")
SELECT c."id", v.code, v.name, v.type::"account_type", v.subtype, c."currency"
FROM "companies" c
CROSS JOIN (VALUES
  ('2400', 'Keshbek majburiyati', 'liability', 'cashback_liability'),
  ('5600', 'Keshbek xarajatlari', 'expense', 'cashback_expense')
) AS v(code, name, type, subtype)
WHERE EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."subtype" = v.subtype)
ON CONFLICT DO NOTHING;