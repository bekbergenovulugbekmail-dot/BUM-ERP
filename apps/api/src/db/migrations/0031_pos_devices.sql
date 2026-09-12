CREATE TYPE "public"."pos_sync_op_status" AS ENUM('applied', 'rejected');--> statement-breakpoint
CREATE TABLE "pos_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(8) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"registered_by" uuid,
	"app_version" varchar(32),
	"platform" varchar(32),
	"last_seen_at" timestamp with time zone,
	"last_pull_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"op_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"cashier_id" uuid,
	"status" "pos_sync_op_status" NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"client_created_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "ps_one_open_per_warehouse";--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_operations" ADD CONSTRAINT "pos_sync_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_operations" ADD CONSTRAINT "pos_sync_operations_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_operations" ADD CONSTRAINT "pos_sync_operations_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_company_code_key" ON "pos_devices" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_token_hash_key" ON "pos_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pos_devices_company_idx" ON "pos_devices" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pso_device_op_key" ON "pos_sync_operations" USING btree ("device_id","op_id");--> statement-breakpoint
CREATE INDEX "pso_company_received_idx" ON "pos_sync_operations" USING btree ("company_id","received_at");--> statement-breakpoint
CREATE INDEX "pso_device_status_idx" ON "pos_sync_operations" USING btree ("device_id","status");--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ps_one_open_per_device" ON "pos_shifts" USING btree ("device_id") WHERE "pos_shifts"."status" = 'open' and "pos_shifts"."device_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ps_one_open_per_warehouse" ON "pos_shifts" USING btree ("company_id","warehouse_id") WHERE "pos_shifts"."status" = 'open' and "pos_shifts"."device_id" is null;--> statement-breakpoint
-- Mavjud "Direktor" rollariga desktop kassa qurilmalarini boshqarish ruxsati (takror ishlasa o'zgarmaydi)
UPDATE "roles" SET "permissions" = array_append("permissions", 'pos.devices.manage')
WHERE "name" = 'Direktor' AND NOT ('pos.devices.manage' = ANY("permissions"));