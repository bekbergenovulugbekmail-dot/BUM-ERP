CREATE TYPE "public"."currency_rate_source" AS ENUM('manual', 'cbu');--> statement-breakpoint
CREATE TABLE "company_currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(3) NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"source" "currency_rate_source" DEFAULT 'manual' NOT NULL,
	"rate_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cc_rate_positive" CHECK ("company_currencies"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(3) NOT NULL,
	"rate" numeric(18, 4) NOT NULL,
	"source" "currency_rate_source" NOT NULL,
	"rate_date" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "er_rate_positive" CHECK ("exchange_rates"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "company_currencies" ADD CONSTRAINT "company_currencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_currencies" ADD CONSTRAINT "company_currencies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cc_company_code_key" ON "company_currencies" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "er_company_code_date_idx" ON "exchange_rates" USING btree ("company_id","code","rate_date");