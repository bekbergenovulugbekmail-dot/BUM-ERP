CREATE TYPE "public"."license_status" AS ENUM('active', 'pending_payment', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."license_type" AS ENUM('included', 'additional');--> statement-breakpoint
CREATE TYPE "public"."subscription_payment_kind" AS ENUM('subscription', 'license');--> statement-breakpoint
CREATE TYPE "public"."subscription_payment_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan_kind" AS ENUM('main', 'additional_license');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "license_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"license_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_id" uuid,
	"event" varchar(40) NOT NULL,
	"license_type" "license_type" NOT NULL,
	"status" "license_status" NOT NULL,
	"plan_id" uuid,
	"plan_name" varchar(120),
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"start_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"payment_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" uuid,
	"subscription_id" uuid NOT NULL,
	"plan_id" uuid,
	"license_type" "license_type" NOT NULL,
	"status" "license_status" NOT NULL,
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"start_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_additional_plan" CHECK ("licenses"."license_type" = 'included' or "licenses"."plan_id" is not null),
	CONSTRAINT "licenses_price_non_negative" CHECK ("licenses"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event" varchar(40) NOT NULL,
	"status" "subscription_status" NOT NULL,
	"plan_id" uuid,
	"plan_name" varchar(120),
	"price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"duration_months" integer DEFAULT 0 NOT NULL,
	"bonus_months" integer DEFAULT 0 NOT NULL,
	"effective_months" integer DEFAULT 0 NOT NULL,
	"start_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"included_licenses" integer,
	"payment_id" uuid,
	"payment_reference" varchar(200),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "subscription_payment_kind" NOT NULL,
	"plan_id" uuid NOT NULL,
	"license_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"status" "subscription_payment_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"reference" varchar(200),
	"note" text,
	"requested_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_amount_non_negative" CHECK ("subscription_payments"."amount" >= 0),
	CONSTRAINT "subscription_payments_license_kind" CHECK (("subscription_payments"."kind" = 'license') = ("subscription_payments"."license_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"kind" "subscription_plan_kind" NOT NULL,
	"name" varchar(120) NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"duration_months" integer NOT NULL,
	"bonus_months" integer DEFAULT 0 NOT NULL,
	"included_licenses" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_duration" CHECK ("subscription_plans"."duration_months" between 1 and 120),
	CONSTRAINT "subscription_plans_bonus" CHECK ("subscription_plans"."bonus_months" between 0 and 120),
	CONSTRAINT "subscription_plans_price_non_negative" CHECK ("subscription_plans"."price" >= 0),
	CONSTRAINT "subscription_plans_included_licenses" CHECK ("subscription_plans"."included_licenses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid,
	"status" "subscription_status" NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"base_duration_months" integer DEFAULT 0 NOT NULL,
	"bonus_months" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"included_licenses" integer DEFAULT 3 NOT NULL,
	"trial_warning_days" integer,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_included_licenses" CHECK ("subscriptions"."included_licenses" between 1 and 10000),
	CONSTRAINT "subscriptions_trial_expires" CHECK ("subscriptions"."status" <> 'trial' or "subscriptions"."expires_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_payment_id_subscription_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_history" ADD CONSTRAINT "license_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_payment_id_subscription_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_history_company_created_idx" ON "license_history" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "license_history_license_idx" ON "license_history" USING btree ("license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_company_user_current_key" ON "licenses" USING btree ("company_id","user_id") WHERE "licenses"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "licenses_company_status_idx" ON "licenses" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "licenses_subscription_idx" ON "licenses" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "licenses_employee_idx" ON "licenses" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "licenses_status_expires_idx" ON "licenses" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "subscription_history_company_created_idx" ON "subscription_history" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_idempotency_key" ON "subscription_payments" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "subscription_payments_company_created_idx" ON "subscription_payments" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_payments_status_idx" ON "subscription_payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_pending_subscription_key" ON "subscription_payments" USING btree ("company_id") WHERE "subscription_payments"."status" = 'pending' and "subscription_payments"."kind" = 'subscription';--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_pending_license_key" ON "subscription_payments" USING btree ("license_id") WHERE "subscription_payments"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "subscription_plans_kind_idx" ON "subscription_plans" USING btree ("kind","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_company_key" ON "subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_expires_idx" ON "subscriptions" USING btree ("status","expires_at");--> statement-breakpoint
-- Boshlang'ich tariflar (keyin faqat bazadan boshqariladi). Takror ishlasa o'zgarmaydi.
INSERT INTO "subscription_plans" ("code", "kind", "name", "price", "duration_months", "bonus_months", "included_licenses", "sort_order") VALUES
  ('main-1m', 'main', '1 oylik', 360000, 1, 0, 3, 1),
  ('main-3m', 'main', '3 oylik', 900000, 3, 0, 3, 2),
  ('main-6m', 'main', '6 oylik', 1800000, 6, 1, 3, 3),
  ('main-12m', 'main', '12 oylik', 3600000, 12, 3, 3, 4),
  ('license-1m', 'additional_license', 'Qo''shimcha xodim — 1 oy', 100000, 1, 0, 0, 11),
  ('license-3m', 'additional_license', 'Qo''shimcha xodim — 3 oy', 300000, 3, 0, 0, 12),
  ('license-6m', 'additional_license', 'Qo''shimcha xodim — 6 oy', 600000, 6, 1, 0, 13),
  ('license-12m', 'additional_license', 'Qo''shimcha xodim — 12 oy', 1200000, 12, 2, 0, 14)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Mavjud kompaniyalar uzilib qolmasin (ma'lumot o'chirilmaydi, o'zgartirilmaydi):
--   sinov muddatli (trial_ends_at bor) — trial, o'sha sana bilan; qolganlari — muddatsiz active;
--   included litsenziyalar — kamida 3, faol a'zolar ko'p bo'lsa shuncha (hech kim kirishdan mahrum bo'lmaydi).
INSERT INTO "subscriptions" ("company_id", "status", "start_at", "expires_at", "included_licenses")
SELECT c."id",
  CASE WHEN c."status" = 'trial' AND c."trial_ends_at" IS NOT NULL THEN 'trial'::subscription_status ELSE 'active'::subscription_status END,
  c."created_at",
  CASE WHEN c."status" = 'trial' AND c."trial_ends_at" IS NOT NULL THEN c."trial_ends_at" ELSE NULL END,
  GREATEST(3, (
    SELECT count(*)::int FROM "company_members" m
    JOIN "users" u ON u."id" = m."user_id"
    WHERE m."company_id" = c."id" AND ((m."is_active" AND u."is_active") OR m."user_id" = c."owner_id")
  ))
FROM "companies" c
ON CONFLICT ("company_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "licenses" ("company_id", "user_id", "employee_id", "subscription_id", "license_type", "status", "start_at", "assigned_at")
SELECT m."company_id", m."user_id",
  (SELECT e."id" FROM "employees" e WHERE e."company_id" = m."company_id" AND e."user_id" = m."user_id" LIMIT 1),
  s."id", 'included', 'active', m."joined_at", now()
FROM "company_members" m
JOIN "users" u ON u."id" = m."user_id"
JOIN "companies" c ON c."id" = m."company_id"
JOIN "subscriptions" s ON s."company_id" = m."company_id"
WHERE (m."is_active" AND u."is_active") OR m."user_id" = c."owner_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "subscription_history" ("company_id", "subscription_id", "event", "status", "start_at", "expires_at", "included_licenses")
SELECT s."company_id", s."id", 'legacy_migrated', s."status", s."start_at", s."expires_at", s."included_licenses"
FROM "subscriptions" s
WHERE NOT EXISTS (SELECT 1 FROM "subscription_history" h WHERE h."subscription_id" = s."id");--> statement-breakpoint
INSERT INTO "license_history" ("company_id", "license_id", "user_id", "employee_id", "event", "license_type", "status", "start_at", "expires_at")
SELECT l."company_id", l."id", l."user_id", l."employee_id", 'legacy_migrated', l."license_type", l."status", l."start_at", l."expires_at"
FROM "licenses" l
WHERE NOT EXISTS (SELECT 1 FROM "license_history" h WHERE h."license_id" = l."id");--> statement-breakpoint
-- Direktor obuna va litsenziyalarni ko'radi (to'lov va litsenziya boshqaruvi — faqat egasi); takror ishlasa ikkilanmaydi
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['subscription.view', 'license.view']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" = 'Direktor';