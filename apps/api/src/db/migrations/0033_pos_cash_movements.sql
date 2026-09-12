CREATE TABLE "pos_cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"device_id" uuid,
	"type" varchar(8) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"category" varchar(64),
	"notes" text,
	"expense_id" uuid,
	"cashier_id" uuid,
	"cashier_name" varchar(200),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pcm_type" CHECK ("pos_cash_movements"."type" in ('in', 'out')),
	CONSTRAINT "pcm_kind" CHECK ("pos_cash_movements"."kind" in ('collection', 'change_fund', 'expense', 'other_in', 'other_out')),
	CONSTRAINT "pcm_amount_positive" CHECK ("pos_cash_movements"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "cash_in" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "cash_out" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cash_movements" ADD CONSTRAINT "pos_cash_movements_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pcm_shift_idx" ON "pos_cash_movements" USING btree ("shift_id","occurred_at");--> statement-breakpoint
CREATE INDEX "pcm_company_occurred_idx" ON "pos_cash_movements" USING btree ("company_id","occurred_at");--> statement-breakpoint
-- Yangi ruxsat mavjud Direktor rollariga (yangi kompaniyalarda — DEFAULT_ROLES); takror ishlaganda ikkilanmaydi
UPDATE "roles" SET "permissions" = array_append("permissions", 'pos.cash.expense')
WHERE "name" = 'Direktor' AND NOT ('pos.cash.expense' = ANY("permissions"));