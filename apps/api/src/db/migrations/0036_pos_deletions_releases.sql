CREATE TABLE "desktop_release_chunks" (
	"release_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "desktop_release_chunks_release_id_seq_pk" PRIMARY KEY("release_id","seq")
);
--> statement-breakpoint
CREATE TABLE "desktop_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(32) NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"notes" text,
	"min_version" varchar(32),
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"uploaded_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_releases_status" CHECK ("desktop_releases"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "sync_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity" varchar(32) NOT NULL,
	"entity_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_release_chunks" ADD CONSTRAINT "desktop_release_chunks_release_id_desktop_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."desktop_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_releases" ADD CONSTRAINT "desktop_releases_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_deletions" ADD CONSTRAINT "sync_deletions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_releases_version_key" ON "desktop_releases" USING btree ("version");--> statement-breakpoint
CREATE INDEX "sd_company_deleted_idx" ON "sync_deletions" USING btree ("company_id","deleted_at","id");