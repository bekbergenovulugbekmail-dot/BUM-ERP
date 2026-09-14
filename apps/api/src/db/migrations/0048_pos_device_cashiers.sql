CREATE TABLE "pos_device_cashiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pos_device_cashiers" ADD CONSTRAINT "pos_device_cashiers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_device_cashiers" ADD CONSTRAINT "pos_device_cashiers_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_device_cashiers" ADD CONSTRAINT "pos_device_cashiers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdc_device_user_key" ON "pos_device_cashiers" USING btree ("device_id","user_id");--> statement-breakpoint
CREATE INDEX "pdc_company_user_idx" ON "pos_device_cashiers" USING btree ("company_id","user_id");--> statement-breakpoint
-- Mavjud kassalar to'xtamasligi uchun tarixdan bog'lanishlar (faqat qo'shish; mavjud ma'lumot o'zgarmaydi):
-- qurilmani ro'yxatdan o'tkazgan foydalanuvchi
INSERT INTO "pos_device_cashiers" ("company_id", "device_id", "user_id")
SELECT d."company_id", d."id", d."registered_by"
FROM "pos_devices" d
JOIN "users" u ON u."id" = d."registered_by"
WHERE d."registered_by" IS NOT NULL
ON CONFLICT ("device_id", "user_id") DO NOTHING;--> statement-breakpoint
-- shu qurilmadan amal yuborgan kassirlar
INSERT INTO "pos_device_cashiers" ("company_id", "device_id", "user_id")
SELECT DISTINCT o."company_id", o."device_id", o."cashier_id"
FROM "pos_sync_operations" o
JOIN "users" u ON u."id" = o."cashier_id"
WHERE o."cashier_id" IS NOT NULL
ON CONFLICT ("device_id", "user_id") DO NOTHING;--> statement-breakpoint
-- shu qurilmada smena ochgan kassirlar
INSERT INTO "pos_device_cashiers" ("company_id", "device_id", "user_id")
SELECT DISTINCT s."company_id", s."device_id", s."cashier_id"
FROM "pos_shifts" s
JOIN "pos_devices" d ON d."id" = s."device_id"
JOIN "users" u ON u."id" = s."cashier_id"
WHERE s."device_id" IS NOT NULL AND s."cashier_id" IS NOT NULL
ON CONFLICT ("device_id", "user_id") DO NOTHING;--> statement-breakpoint
-- qurilmada telefon va parol bilan kirgan kassirlar (audit jurnali)
INSERT INTO "pos_device_cashiers" ("company_id", "device_id", "user_id")
SELECT DISTINCT d."company_id", d."id", a."user_id"
FROM "audit_logs" a
JOIN "pos_devices" d ON d."id"::text = a."resource_id"
JOIN "users" u ON u."id" = a."user_id"
WHERE a."action" = 'POS_CASHIER_LOGIN' AND a."resource" = 'pos_devices' AND a."user_id" IS NOT NULL
ON CONFLICT ("device_id", "user_id") DO NOTHING;