CREATE TABLE "territories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "distribution_routes" ADD COLUMN "territory_id" uuid;--> statement-breakpoint
ALTER TABLE "territories" ADD CONSTRAINT "territories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terr_company_name_key" ON "territories" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "terr_company_active_idx" ON "territories" USING btree ("company_id","is_active");--> statement-breakpoint
ALTER TABLE "distribution_routes" ADD CONSTRAINT "distribution_routes_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dr_company_territory_idx" ON "distribution_routes" USING btree ("company_id","territory_id");