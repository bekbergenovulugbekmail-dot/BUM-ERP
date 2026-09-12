CREATE TABLE "customer_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_rep_id" uuid,
	"user_id" uuid,
	"content" "bytea" NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"size_bytes" integer NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy" numeric(8, 2) NOT NULL,
	"taken_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cph_company_customer_taken_idx" ON "customer_photos" USING btree ("company_id","customer_id","taken_at");--> statement-breakpoint
-- Mavjud "Sotuv agenti" rollariga mijoz ruxsatlari (spetsifikatsiya RBAC); takror ishlasa o'zgarmaydi
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.customer.edit')
WHERE "name" = 'Sotuv agenti' AND NOT ('sales_agent.customer.edit' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.customer.location.edit')
WHERE "name" = 'Sotuv agenti' AND NOT ('sales_agent.customer.location.edit' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.customer.photo.create')
WHERE "name" = 'Sotuv agenti' AND NOT ('sales_agent.customer.photo.create' = ANY("permissions"));