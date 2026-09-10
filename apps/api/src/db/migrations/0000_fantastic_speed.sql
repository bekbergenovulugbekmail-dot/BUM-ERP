CREATE TYPE "public"."audit_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'trial', 'pending', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."costing_method" AS ENUM('average', 'fifo', 'fefo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."password_algo" AS ENUM('argon2id', 'scrypt');--> statement-breakpoint
CREATE TYPE "public"."inventory_count_status" AS ENUM('draft', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('receive', 'issue', 'transfer_out', 'transfer_in', 'adjust', 'writeoff', 'return_in', 'return_out', 'count');--> statement-breakpoint
CREATE TYPE "public"."warehouse_zone_type" AS ENUM('zone', 'rack', 'shelf', 'bin');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."cash_account_type" AS ENUM('cash', 'bank');--> statement-breakpoint
CREATE TYPE "public"."cash_tx_type" AS ENUM('in', 'out', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('pending', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('draft', 'posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank', 'card', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'confirmed', 'partial', 'received', 'invoiced', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pos_shift_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."sales_order_status" AS ENUM('draft', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('planned', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('call', 'meeting', 'email', 'note', 'task');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('website', 'referral', 'social', 'cold_call', 'exhibition', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."route_visit_status" AS ENUM('planned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."production_order_status" AS ENUM('draft', 'confirmed', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."work_center_type" AS ENUM('machine', 'labor', 'subcontract');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'half_day', 'holiday', 'on_leave');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'on_leave', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."gender_type" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'unpaid', 'maternity', 'other');--> statement-breakpoint
CREATE TYPE "public"."salary_payment_status" AS ENUM('draft', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."salary_type" AS ENUM('monthly', 'hourly', 'daily');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('info', 'warning', 'error', 'success');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('low_stock', 'expiring_soon', 'pending_approval', 'overdue_payment', 'leave_request', 'po_received', 'production_complete', 'system');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid,
	"user_id" uuid,
	"user_name" varchar(200),
	"action" varchar(100) NOT NULL,
	"resource" varchar(100) NOT NULL,
	"resource_id" varchar(64),
	"details" jsonb,
	"ip_address" varchar(64),
	"user_agent" text,
	"severity" "audit_severity" DEFAULT 'info' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"address" text,
	"city" varchar(100),
	"phone" varchar(20),
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"name" varchar(200) NOT NULL,
	"legal_name" varchar(300),
	"tax_id" varchar(32),
	"phone" varchar(20),
	"email" varchar(255),
	"website" varchar(255),
	"address" text,
	"city" varchar(100),
	"region" varchar(100),
	"country" varchar(2) DEFAULT 'UZ' NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"language" varchar(2) DEFAULT 'uz' NOT NULL,
	"logo_url" text,
	"slug" varchar(40),
	"owner_id" uuid,
	"status" "company_status" DEFAULT 'trial' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_platform_tenant" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspend_reason" text,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_role" varchar(100) NOT NULL,
	"role_id" uuid,
	"branch_id" uuid,
	"allowed_warehouse_ids" uuid[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"company_role" varchar(100) NOT NULL,
	"token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" varchar(200) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid,
	"name" varchar(100) NOT NULL,
	"description" text,
	"color" varchar(16),
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" varchar(64),
	"user_agent" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"group" varchar(50) NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"phone" varchar(20) NOT NULL,
	"name" varchar(200),
	"email" varchar(255),
	"avatar_url" text,
	"password_hash" text,
	"password_algo" "password_algo" DEFAULT 'argon2id' NOT NULL,
	"password_changed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"active_company_id" uuid,
	"pin_hash" text,
	"pin_failed_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"auto_lock_seconds" integer DEFAULT 30 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_number" varchar(64) NOT NULL,
	"supplier_id" uuid,
	"warehouse_id" uuid,
	"manufactured_date" date,
	"expiry_date" date,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_id" uuid NOT NULL,
	"cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_quantity_non_negative" CHECK ("batches"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"parent_id" uuid,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"sku" varchar(64) NOT NULL,
	"barcode" varchar(64),
	"qr_code" varchar(128),
	"description" text,
	"image_key" text,
	"category_id" uuid,
	"brand_id" uuid,
	"manufacturer" varchar(200),
	"base_unit_id" uuid NOT NULL,
	"purchase_unit_id" uuid,
	"sales_unit_id" uuid,
	"purchase_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"sales_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"wholesale_price" numeric(18, 4),
	"retail_price" numeric(18, 4),
	"promo_price" numeric(18, 4),
	"promo_price_end" date,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_included" boolean DEFAULT true NOT NULL,
	"min_stock" numeric(18, 4) DEFAULT '0' NOT NULL,
	"max_stock" numeric(18, 4),
	"reorder_point" numeric(18, 4),
	"track_batch" boolean DEFAULT false NOT NULL,
	"track_expiry" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"costing_method" "costing_method" DEFAULT 'average' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_saleable" boolean DEFAULT true NOT NULL,
	"is_purchaseable" boolean DEFAULT true NOT NULL,
	"is_manufactured" boolean DEFAULT false NOT NULL,
	"weight" numeric(18, 4),
	"weight_unit" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_prices_non_negative" CHECK ("products"."purchase_price" >= 0 AND "products"."sales_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"from_unit_id" uuid NOT NULL,
	"to_unit_id" uuid NOT NULL,
	"factor" numeric(18, 4) NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_conv_factor_positive" CHECK ("unit_conversions"."factor" > 0),
	CONSTRAINT "unit_conv_not_self" CHECK ("unit_conversions"."from_unit_id" <> "unit_conversions"."to_unit_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"name" varchar(60) NOT NULL,
	"short_name" varchar(16) NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"expected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"counted_qty" numeric(18, 4),
	"difference" numeric(18, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "inventory_count_status" DEFAULT 'draft' NOT NULL,
	"counted_by" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"adjustments_made" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"avg_cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_quantity_non_negative" CHECK ("stock_levels"."quantity" >= 0),
	CONSTRAINT "stock_levels_reserved_non_negative" CHECK ("stock_levels"."reserved_qty" >= 0),
	CONSTRAINT "stock_levels_cost_non_negative" CHECK ("stock_levels"."avg_cost_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"zone_id" uuid,
	"batch_id" uuid,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_id" uuid NOT NULL,
	"cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reference_type" varchar(50),
	"reference_id" uuid,
	"notes" text,
	"performed_by" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sm_quantity_not_zero" CHECK ("stock_movements"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "warehouse_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "warehouse_zone_type" DEFAULT 'zone' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"address" text,
	"city" varchar(100),
	"phone" varchar(20),
	"manager_id" uuid,
	"branch_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" "account_type" NOT NULL,
	"subtype" varchar(64),
	"parent_id" uuid,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" "cash_account_type" DEFAULT 'cash' NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"bank_name" varchar(200),
	"account_number" varchar(64),
	"balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"type" "cash_tx_type" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"tx_date" date NOT NULL,
	"description" text NOT NULL,
	"category" varchar(64),
	"reference_type" varchar(50),
	"reference_id" uuid,
	"balance_after" numeric(18, 2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ct_amount_positive" CHECK ("cash_transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"category" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"expense_date" date NOT NULL,
	"account_id" uuid,
	"paid_by" varchar(200),
	"attachment_key" text,
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"reference_type" varchar(50),
	"reference_id" uuid,
	"status" "journal_status" DEFAULT 'posted' NOT NULL,
	"total_debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"notes" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "je_totals_non_negative" CHECK ("journal_entries"."total_debit" >= 0 AND "journal_entries"."total_credit" >= 0),
	CONSTRAINT "je_balanced" CHECK (abs("journal_entries"."total_debit" - "journal_entries"."total_credit") <= 1)
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jl_amounts_non_negative" CHECK ("journal_lines"."debit" >= 0 AND "journal_lines"."credit" >= 0),
	CONSTRAINT "jl_debit_xor_credit" CHECK (("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"ordered_qty" numeric(18, 4) NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poi_ordered_positive" CHECK ("purchase_order_items"."ordered_qty" > 0),
	CONSTRAINT "poi_received_not_over" CHECK ("purchase_order_items"."received_qty" >= 0 AND "purchase_order_items"."received_qty" <= "purchase_order_items"."ordered_qty")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_amounts_non_negative" CHECK ("purchase_orders"."total_amount" >= 0 AND "purchase_orders"."paid_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"received_qty" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"batch_number" varchar(64),
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pri_qty_positive" CHECK ("purchase_receipt_items"."received_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"receipt_date" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL,
	"payment_date" date NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"reference" varchar(100),
	"notes" text,
	"cash_account_id" uuid,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sp_amount_positive" CHECK ("supplier_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"contact_person" varchar(200),
	"phone" varchar(20),
	"email" varchar(255),
	"address" text,
	"tax_id" varchar(32),
	"bank_account" varchar(64),
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"total_debt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_purchased" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL,
	"payment_date" date NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"reference" varchar(100),
	"notes" text,
	"cash_account_id" uuid,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cp_amount_positive" CHECK ("customer_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"address" text,
	"tax_id" varchar(32),
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"credit_limit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"total_debt" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_purchased" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"cashier_id" uuid,
	"cashier_name" varchar(200),
	"status" "pos_shift_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_cash" numeric(18, 2) DEFAULT '0' NOT NULL,
	"closing_cash" numeric(18, 2),
	"total_sales" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cash" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_card" numeric(18, 2) DEFAULT '0' NOT NULL,
	"receipt_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "soi_qty_positive" CHECK ("sales_order_items"."quantity" > 0),
	CONSTRAINT "soi_price_non_negative" CHECK ("sales_order_items"."unit_price" >= 0 AND "sales_order_items"."cost_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"customer_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"status" "sales_order_status" DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"delivery_date" date,
	"currency" varchar(3) DEFAULT 'UZS' NOT NULL,
	"exchange_rate" numeric(18, 4) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_pos" boolean DEFAULT false NOT NULL,
	"pos_shift_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "so_amounts_non_negative" CHECK ("sales_orders"."total_amount" >= 0 AND "sales_orders"."paid_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"type" "activity_type" DEFAULT 'note' NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"customer_id" uuid,
	"lead_id" uuid,
	"activity_date" date NOT NULL,
	"due_date" date,
	"status" "activity_status" DEFAULT 'planned' NOT NULL,
	"outcome" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_segment_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"color" varchar(16) DEFAULT '#64748b' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distribution_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"sales_rep_id" uuid,
	"description" text,
	"days" integer[] DEFAULT '{}' NOT NULL,
	"color" varchar(16),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"company_name" varchar(200),
	"phone" varchar(20),
	"email" varchar(255),
	"source" "lead_source" DEFAULT 'other' NOT NULL,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"estimated_value" numeric(18, 2),
	"customer_id" uuid,
	"sales_rep_id" uuid,
	"expected_close_date" date,
	"notes" text,
	"lost_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"visit_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"sales_rep_id" uuid,
	"visit_date" date NOT NULL,
	"status" "route_visit_status" DEFAULT 'planned' NOT NULL,
	"customers_visited" integer DEFAULT 0 NOT NULL,
	"orders_created" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"user_id" uuid,
	"region" varchar(100),
	"monthly_target" numeric(18, 2) DEFAULT '0' NOT NULL,
	"commission" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"bom_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_id" uuid NOT NULL,
	"scrap_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bi_quantity_positive" CHECK ("bom_items"."quantity" > 0),
	CONSTRAINT "bi_no_self_reference" CHECK (true)
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"version" varchar(32) DEFAULT '1' NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '1' NOT NULL,
	"unit_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boms_quantity_positive" CHECK ("boms"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"planned_qty" numeric(18, 4) NOT NULL,
	"actual_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pm_qty_non_negative" CHECK ("production_materials"."planned_qty" >= 0 AND "production_materials"."actual_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"number" varchar(32) NOT NULL,
	"bom_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"planned_qty" numeric(18, 4) NOT NULL,
	"produced_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" "production_order_status" DEFAULT 'draft' NOT NULL,
	"planned_date" date NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_material_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_labor_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_mfg_planned_positive" CHECK ("production_orders"."planned_qty" > 0),
	CONSTRAINT "po_mfg_produced_non_negative" CHECK ("production_orders"."produced_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_time_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"work_center_id" uuid NOT NULL,
	"planned_hours" numeric(18, 4) DEFAULT '0' NOT NULL,
	"actual_hours" numeric(18, 4) DEFAULT '0' NOT NULL,
	"cost_per_hour" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ptl_hours_non_negative" CHECK ("production_time_lines"."planned_hours" >= 0 AND "production_time_lines"."actual_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"type" "work_center_type" DEFAULT 'machine' NOT NULL,
	"cost_per_hour" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"check_in" time,
	"check_out" time,
	"work_hours" numeric(18, 4) DEFAULT '0' NOT NULL,
	"overtime" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" "attendance_status" DEFAULT 'present' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "att_hours_non_negative" CHECK ("attendances"."work_hours" >= 0 AND "attendances"."overtime" >= 0)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"parent_id" uuid,
	"manager_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(32) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"department_id" uuid,
	"position_id" uuid,
	"manager_id" uuid,
	"user_id" uuid,
	"hire_date" date NOT NULL,
	"birth_date" date,
	"gender" "gender_type",
	"address" text,
	"passport_number" varchar(32),
	"inn" varchar(32),
	"bank_account" varchar(64),
	"base_salary" numeric(18, 2) DEFAULT '0' NOT NULL,
	"salary_type" "salary_type" DEFAULT 'monthly' NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"photo_key" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emp_salary_non_negative" CHECK ("employees"."base_salary" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "leave_type" DEFAULT 'annual' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(18, 4) NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"approved_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lv_date_order" CHECK ("leaves"."start_date" <= "leaves"."end_date"),
	CONSTRAINT "lv_days_positive" CHECK ("leaves"."days" > 0)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"level" varchar(64),
	"min_salary" numeric(18, 2),
	"max_salary" numeric(18, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_salary_range" CHECK ("positions"."min_salary" IS NULL OR "positions"."max_salary" IS NULL OR "positions"."min_salary" <= "positions"."max_salary")
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"base_salary" numeric(18, 2) DEFAULT '0' NOT NULL,
	"work_days" numeric(18, 4) DEFAULT '0' NOT NULL,
	"actual_days" numeric(18, 4) DEFAULT '0' NOT NULL,
	"overtime" numeric(18, 4) DEFAULT '0' NOT NULL,
	"overtime_pay" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bonus" numeric(18, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_salary" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "salary_payment_status" DEFAULT 'draft' NOT NULL,
	"paid_date" date,
	"approved_by" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sal_amounts_non_negative" CHECK ("salary_payments"."net_salary" >= 0 AND "salary_payments"."tax" >= 0 AND "salary_payments"."deductions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" varchar(64),
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "notification_type" DEFAULT 'system' NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" varchar(300) NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"related_type" varchar(50),
	"related_id" uuid,
	"link" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_base_unit_id_units_id_fk" FOREIGN KEY ("base_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_purchase_unit_id_units_id_fk" FOREIGN KEY ("purchase_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sales_unit_id_units_id_fk" FOREIGN KEY ("sales_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_units_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_units_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_zone_id_warehouse_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."warehouse_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_zones" ADD CONSTRAINT "warehouse_zones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_zones" ADD CONSTRAINT "warehouse_zones_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_pos_shift_id_pos_shifts_id_fk" FOREIGN KEY ("pos_shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_segment_members" ADD CONSTRAINT "customer_segment_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_segment_members" ADD CONSTRAINT "customer_segment_members_segment_id_customer_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."customer_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_segment_members" ADD CONSTRAINT "customer_segment_members_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_segments" ADD CONSTRAINT "customer_segments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_routes" ADD CONSTRAINT "distribution_routes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_routes" ADD CONSTRAINT "distribution_routes_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_route_id_distribution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."distribution_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_customers" ADD CONSTRAINT "route_customers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_visits" ADD CONSTRAINT "route_visits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_visits" ADD CONSTRAINT "route_visits_route_id_distribution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."distribution_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_visits" ADD CONSTRAINT "route_visits_sales_rep_id_sales_reps_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_time_lines" ADD CONSTRAINT "production_time_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_time_lines" ADD CONSTRAINT "production_time_lines_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."production_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_time_lines" ADD CONSTRAINT "production_time_lines_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_approved_by_employees_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_company_occurred_idx" ON "audit_logs" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "branches_company_idx" ON "branches" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_company_code_key" ON "branches" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_key" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_legacy_id_key" ON "companies" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_members_company_user_key" ON "company_members" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_members_user_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invitations_company_idx" ON "invitations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "invitations_status_idx" ON "invitations" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "prc_user_idx" ON "password_reset_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prc_expires_idx" ON "password_reset_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_bucket_window_key" ON "rate_limits" USING btree ("bucket","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_company_name_key" ON "roles" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "roles_company_idx" ON "roles" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_company_key_key" ON "settings" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "settings_company_group_idx" ON "settings" USING btree ("company_id","group");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_legacy_id_key" ON "users" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "users_active_company_idx" ON "users" USING btree ("active_company_id");--> statement-breakpoint
CREATE INDEX "batches_company_product_idx" ON "batches" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "batches_company_expiry_idx" ON "batches" USING btree ("company_id","expiry_date");--> statement-breakpoint
CREATE INDEX "brands_company_idx" ON "brands" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_company_name_key" ON "brands" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "categories_company_idx" ON "categories" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "categories_company_parent_idx" ON "categories" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_sku_key" ON "products" USING btree ("company_id","sku");--> statement-breakpoint
CREATE INDEX "products_company_barcode_idx" ON "products" USING btree ("company_id","barcode");--> statement-breakpoint
CREATE INDEX "products_company_category_idx" ON "products" USING btree ("company_id","category_id");--> statement-breakpoint
CREATE INDEX "products_company_brand_idx" ON "products" USING btree ("company_id","brand_id");--> statement-breakpoint
CREATE INDEX "products_company_active_idx" ON "products" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "products_legacy_id_key" ON "products" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "unit_conv_company_idx" ON "unit_conversions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_conv_unique" ON "unit_conversions" USING btree ("company_id","from_unit_id","to_unit_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_name_key" ON "units" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "units_legacy_id_key" ON "units" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ici_count_product_key" ON "inventory_count_items" USING btree ("count_id","product_id");--> statement-breakpoint
CREATE INDEX "ici_company_idx" ON "inventory_count_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ic_company_warehouse_idx" ON "inventory_counts" USING btree ("company_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "ic_company_status_idx" ON "inventory_counts" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_levels_company_product_warehouse_key" ON "stock_levels" USING btree ("company_id","product_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_levels_company_warehouse_idx" ON "stock_levels" USING btree ("company_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "sm_company_product_occurred_idx" ON "stock_movements" USING btree ("company_id","product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sm_company_warehouse_occurred_idx" ON "stock_movements" USING btree ("company_id","warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sm_reference_idx" ON "stock_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "wz_company_warehouse_idx" ON "warehouse_zones" USING btree ("company_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_company_code_key" ON "warehouses" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "warehouses_company_idx" ON "warehouses" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_legacy_id_key" ON "warehouses" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_code_key" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "accounts_company_type_idx" ON "accounts" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "accounts_company_parent_idx" ON "accounts" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE INDEX "ca_company_type_idx" ON "cash_accounts" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "ca_company_default_idx" ON "cash_accounts" USING btree ("company_id","is_default");--> statement-breakpoint
CREATE INDEX "ct_company_account_date_idx" ON "cash_transactions" USING btree ("company_id","cash_account_id","tx_date");--> statement-breakpoint
CREATE INDEX "ct_reference_idx" ON "cash_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_company_number_key" ON "expenses" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "expenses_company_status_idx" ON "expenses" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "expenses_company_date_idx" ON "expenses" USING btree ("company_id","expense_date");--> statement-breakpoint
CREATE UNIQUE INDEX "je_company_number_key" ON "journal_entries" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "je_company_date_idx" ON "journal_entries" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "je_company_status_idx" ON "journal_entries" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "je_company_reference_key" ON "journal_entries" USING btree ("company_id","reference_type","reference_id") WHERE "journal_entries"."status" <> 'voided' AND "journal_entries"."reference_type" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "jl_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "jl_company_account_idx" ON "journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "poi_order_idx" ON "purchase_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "poi_company_product_idx" ON "purchase_order_items" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_company_number_key" ON "purchase_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "po_company_status_idx" ON "purchase_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "po_company_supplier_idx" ON "purchase_orders" USING btree ("company_id","supplier_id");--> statement-breakpoint
CREATE INDEX "po_company_date_idx" ON "purchase_orders" USING btree ("company_id","order_date");--> statement-breakpoint
CREATE INDEX "pri_receipt_idx" ON "purchase_receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "pri_company_product_idx" ON "purchase_receipt_items" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "pr_company_order_idx" ON "purchase_receipts" USING btree ("company_id","order_id");--> statement-breakpoint
CREATE INDEX "pr_company_date_idx" ON "purchase_receipts" USING btree ("company_id","receipt_date");--> statement-breakpoint
CREATE INDEX "sp_company_supplier_idx" ON "supplier_payments" USING btree ("company_id","supplier_id");--> statement-breakpoint
CREATE INDEX "sp_company_date_idx" ON "supplier_payments" USING btree ("company_id","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_code_key" ON "suppliers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "suppliers_company_active_idx" ON "suppliers" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "cp_company_customer_idx" ON "customer_payments" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "cp_company_date_idx" ON "customer_payments" USING btree ("company_id","payment_date");--> statement-breakpoint
CREATE INDEX "cp_order_idx" ON "customer_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_code_key" ON "customers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "customers_company_active_idx" ON "customers" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "customers_company_phone_idx" ON "customers" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "ps_company_warehouse_idx" ON "pos_shifts" USING btree ("company_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "ps_company_status_idx" ON "pos_shifts" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ps_one_open_per_warehouse" ON "pos_shifts" USING btree ("company_id","warehouse_id") WHERE "pos_shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "soi_order_idx" ON "sales_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "soi_company_product_idx" ON "sales_order_items" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "so_company_number_key" ON "sales_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "so_company_status_idx" ON "sales_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "so_company_customer_idx" ON "sales_orders" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "so_company_date_idx" ON "sales_orders" USING btree ("company_id","order_date");--> statement-breakpoint
CREATE INDEX "so_pos_shift_idx" ON "sales_orders" USING btree ("pos_shift_id");--> statement-breakpoint
CREATE INDEX "act_company_date_idx" ON "activities" USING btree ("company_id","activity_date");--> statement-breakpoint
CREATE INDEX "act_company_status_idx" ON "activities" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "act_customer_idx" ON "activities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "act_lead_idx" ON "activities" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "csm_segment_customer_key" ON "customer_segment_members" USING btree ("segment_id","customer_id");--> statement-breakpoint
CREATE INDEX "csm_company_idx" ON "customer_segment_members" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cs_company_name_key" ON "customer_segments" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "dr_company_active_idx" ON "distribution_routes" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "dr_company_rep_idx" ON "distribution_routes" USING btree ("company_id","sales_rep_id");--> statement-breakpoint
CREATE INDEX "leads_company_stage_idx" ON "leads" USING btree ("company_id","stage");--> statement-breakpoint
CREATE INDEX "leads_company_rep_idx" ON "leads" USING btree ("company_id","sales_rep_id");--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rc_route_customer_key" ON "route_customers" USING btree ("route_id","customer_id");--> statement-breakpoint
CREATE INDEX "rc_company_idx" ON "route_customers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "rv_company_date_idx" ON "route_visits" USING btree ("company_id","visit_date");--> statement-breakpoint
CREATE INDEX "rv_company_route_idx" ON "route_visits" USING btree ("company_id","route_id");--> statement-breakpoint
CREATE INDEX "rv_company_rep_idx" ON "route_visits" USING btree ("company_id","sales_rep_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_company_code_key" ON "sales_reps" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "sr_company_active_idx" ON "sales_reps" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "bi_bom_idx" ON "bom_items" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bi_company_product_idx" ON "bom_items" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boms_company_product_version_key" ON "boms" USING btree ("company_id","product_id","version");--> statement-breakpoint
CREATE INDEX "boms_company_active_idx" ON "boms" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "pm_order_idx" ON "production_materials" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pm_company_product_idx" ON "production_materials" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_mfg_company_number_key" ON "production_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "po_mfg_company_status_idx" ON "production_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "po_mfg_company_product_idx" ON "production_orders" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX "po_mfg_company_date_idx" ON "production_orders" USING btree ("company_id","planned_date");--> statement-breakpoint
CREATE INDEX "ptl_order_idx" ON "production_time_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ptl_company_idx" ON "production_time_lines" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wc_company_code_key" ON "work_centers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "wc_company_active_idx" ON "work_centers" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "att_employee_date_key" ON "attendances" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "att_company_date_idx" ON "attendances" USING btree ("company_id","attendance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "dept_company_code_key" ON "departments" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "dept_company_parent_idx" ON "departments" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emp_company_code_key" ON "employees" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "emp_company_status_idx" ON "employees" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "emp_company_dept_idx" ON "employees" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE INDEX "lv_company_status_idx" ON "leaves" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "lv_company_employee_idx" ON "leaves" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "lv_company_start_idx" ON "leaves" USING btree ("company_id","start_date");--> statement-breakpoint
CREATE INDEX "pos_company_dept_idx" ON "positions" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sal_employee_month_key" ON "salary_payments" USING btree ("employee_id","month");--> statement-breakpoint
CREATE INDEX "sal_company_month_idx" ON "salary_payments" USING btree ("company_id","month");--> statement-breakpoint
CREATE INDEX "sal_company_status_idx" ON "salary_payments" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "notif_company_user_read_idx" ON "notifications" USING btree ("company_id","user_id","is_read");--> statement-breakpoint
CREATE INDEX "notif_company_global_idx" ON "notifications" USING btree ("company_id","is_global");--> statement-breakpoint
CREATE INDEX "notif_company_created_idx" ON "notifications" USING btree ("company_id","created_at");