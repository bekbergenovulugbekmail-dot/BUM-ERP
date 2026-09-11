ALTER TABLE "pos_shifts" ADD COLUMN "opening_foreign_cash" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "foreign_cash" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "foreign_card" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "closing_foreign_cash" jsonb;