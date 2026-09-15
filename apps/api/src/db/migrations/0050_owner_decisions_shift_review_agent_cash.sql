ALTER TABLE "cash_accounts" ADD COLUMN "delivery_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "cash_difference" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "difference_review" varchar(16);--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "difference_reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "difference_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "difference_review_note" text;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_difference_reviewed_by_users_id_fk" FOREIGN KEY ("difference_reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ca_delivery_agent_key" ON "cash_accounts" USING btree ("company_id","delivery_agent_id") WHERE "cash_accounts"."delivery_agent_id" is not null;