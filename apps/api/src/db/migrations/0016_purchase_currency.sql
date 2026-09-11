CREATE TABLE "purchase_order_currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poc_amounts_non_negative" CHECK ("purchase_order_currencies"."total_amount" >= 0 AND "purchase_order_currencies"."paid_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"debt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"book_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "sales_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "sales_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD COLUMN "exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD COLUMN "foreign_total" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "base_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "fx_amount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_currencies" ADD CONSTRAINT "purchase_order_currencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_currencies" ADD CONSTRAINT "purchase_order_currencies_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_balances" ADD CONSTRAINT "supplier_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_balances" ADD CONSTRAINT "supplier_balances_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poc_order_currency_key" ON "purchase_order_currencies" USING btree ("order_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "sb_supplier_currency_key" ON "supplier_balances" USING btree ("supplier_id","currency");--> statement-breakpoint
CREATE INDEX "sb_company_supplier_idx" ON "supplier_balances" USING btree ("company_id","supplier_id");--> statement-breakpoint
-- Mavjud buyurtmalar: jami va to'langani asosiy valyuta qatori sifatida
INSERT INTO "purchase_order_currencies" ("company_id", "order_id", "currency", "total_amount", "paid_amount")
SELECT po."company_id", po."id", c."currency", po."total_amount", po."paid_amount"
FROM "purchase_orders" po
JOIN "companies" c ON c."id" = po."company_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Mavjud ta'minotchi qarzi — asosiy valyutada (qarz = kitob qiymati)
INSERT INTO "supplier_balances" ("company_id", "supplier_id", "currency", "debt", "book_value")
SELECT s."company_id", s."id", c."currency", s."total_debt", s."total_debt"
FROM "suppliers" s
JOIN "companies" c ON c."id" = s."company_id"
WHERE s."total_debt" <> 0
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "supplier_payments" SET "base_amount" = "amount" WHERE "base_amount" = 0;--> statement-breakpoint
UPDATE "purchase_receipt_items" SET "foreign_total" = "line_total" WHERE "foreign_total" = 0;--> statement-breakpoint
-- Hisoblar rejasiga 4200 "Kurs farqi daromadi" va 5700 "Kurs farqi xarajati"
INSERT INTO "accounts" ("company_id", "code", "name", "type", "subtype", "currency")
SELECT c."id", v.code, v.name, v.type::"account_type", v.subtype, c."currency"
FROM "companies" c
CROSS JOIN (VALUES
  ('4200', 'Kurs farqi daromadi', 'income', 'fx_gain'),
  ('5700', 'Kurs farqi xarajati', 'expense', 'fx_loss')
) AS v(code, name, type, subtype)
WHERE EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."company_id" = c."id" AND a."subtype" = v.subtype)
ON CONFLICT DO NOTHING;