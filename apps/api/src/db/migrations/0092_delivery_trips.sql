-- Yetkazma reysi (2026-09-26): tanlangan yetkazmalarning O'ZGARMAS snapshoti — mijoz nakladnoylari, omborchining yig'ma
-- ro'yxati (×2) va yetkazuvchining marshrut varag'i shu bitta snapshotdan chiqadi (jami bir-biriga teng).
-- Terish/yuklash faqat QAYD (Z2): ombordan chiqim avvalgidek yetkazma "boshlash"ida. FAQAT QO'SHUVCHI.
CREATE TABLE IF NOT EXISTS "delivery_trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "number" varchar(32) NOT NULL,
  "trip_date" date NOT NULL,
  "delivery_agent_id" uuid NOT NULL REFERENCES "delivery_agents"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "status" varchar(20) DEFAULT 'picking' NOT NULL,
  "snapshot" jsonb NOT NULL,
  "total_amount" numeric(18, 2) NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "loaded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "loaded_at" timestamp with time zone,
  "out_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dtr_status_known" CHECK ("status" IN ('picking', 'loaded', 'out_for_delivery', 'cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dtr_company_number_key" ON "delivery_trips" ("company_id", "number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dtr_company_date_idx" ON "delivery_trips" ("company_id", "trip_date");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_trip_tasks" (
  "trip_id" uuid NOT NULL REFERENCES "delivery_trips"("id") ON DELETE CASCADE,
  "task_id" uuid NOT NULL REFERENCES "delivery_tasks"("id") ON DELETE RESTRICT,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "position" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  PRIMARY KEY ("trip_id", "task_id")
);--> statement-breakpoint
-- Bitta yetkazma bir vaqtda faqat bitta faol reysda
CREATE UNIQUE INDEX IF NOT EXISTS "dtt_active_task_key" ON "delivery_trip_tasks" ("task_id") WHERE "active";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_trip_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "trip_id" uuid NOT NULL REFERENCES "delivery_trips"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "product_name" varchar(300) NOT NULL,
  "product_sku" varchar(100),
  "unit_name" varchar(32) NOT NULL,
  "required_qty" numeric(18, 4) NOT NULL,
  "picked_qty" numeric(18, 4),
  "pick_status" varchar(20) DEFAULT 'pending' NOT NULL,
  "note" text,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dtl_status_known" CHECK ("pick_status" IN ('pending', 'picked', 'partially_picked', 'missing')),
  CONSTRAINT "dtl_required_positive" CHECK ("required_qty" > 0),
  CONSTRAINT "dtl_picked_range" CHECK ("picked_qty" IS NULL OR ("picked_qty" >= 0 AND "picked_qty" <= "required_qty"))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dtl_trip_product_unit_key" ON "delivery_trip_lines" ("trip_id", "product_id", "unit_name");
