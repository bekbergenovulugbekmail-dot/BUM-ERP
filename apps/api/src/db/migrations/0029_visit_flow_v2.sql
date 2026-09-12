ALTER TYPE "public"."agent_location_event_type" ADD VALUE 'visit_exit';--> statement-breakpoint
ALTER TYPE "public"."visit_no_order_reason" ADD VALUE 'not_needed';--> statement-breakpoint
ALTER TYPE "public"."visit_no_order_reason" ADD VALUE 'store_closed';--> statement-breakpoint
ALTER TABLE "agent_visit_photos" ADD COLUMN "content" "bytea";--> statement-breakpoint
ALTER TABLE "agent_visit_photos" ADD COLUMN "content_type" varchar(50);--> statement-breakpoint
ALTER TABLE "agent_visits" ADD COLUMN "timer_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD COLUMN "paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD COLUMN "outside_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD COLUMN "outside_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_visits" ADD COLUMN "invalidated_at" timestamp with time zone;