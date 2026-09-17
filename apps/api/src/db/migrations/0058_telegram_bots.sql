CREATE TYPE "public"."telegram_bot_kind" AS ENUM('owner', 'customer');--> statement-breakpoint
CREATE TABLE "telegram_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"kind" "telegram_bot_kind" NOT NULL,
	"username" varchar(64),
	"token_cipher" text NOT NULL,
	"webhook_secret" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"phone" varchar(20),
	"user_id" uuid,
	"company_id" uuid,
	"customer_id" uuid,
	"state" jsonb,
	"linked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_bot_secret_key" ON "telegram_bots" USING btree ("webhook_secret");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_bot_company_kind_key" ON "telegram_bots" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "telegram_bot_kind_idx" ON "telegram_bots" USING btree ("kind","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_key" ON "telegram_chats" USING btree ("bot_id","chat_id");--> statement-breakpoint
CREATE INDEX "telegram_chat_company_idx" ON "telegram_chats" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "telegram_chat_customer_idx" ON "telegram_chats" USING btree ("customer_id");