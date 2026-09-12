ALTER TABLE "desktop_releases" DROP CONSTRAINT "desktop_releases_status";--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "chunk_size" integer DEFAULT 4194304 NOT NULL;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "expected_size" integer;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "expected_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_status" CHECK ("desktop_releases"."status" in ('uploading', 'draft', 'published', 'archived', 'failed'));