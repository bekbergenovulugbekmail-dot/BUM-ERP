DROP INDEX "desktop_releases_version_key";--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD COLUMN "platform" varchar(16) DEFAULT 'desktop' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_releases_platform_version_key" ON "desktop_releases" USING btree ("platform","version");--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_platform" CHECK ("desktop_releases"."platform" in ('desktop', 'android'));