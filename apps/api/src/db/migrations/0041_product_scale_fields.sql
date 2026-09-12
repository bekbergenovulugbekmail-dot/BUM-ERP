ALTER TABLE "products" ADD COLUMN "is_weighted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "plu_code" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "products_company_plu_key" ON "products" USING btree ("company_id","plu_code") WHERE "products"."plu_code" is not null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_plu_range" CHECK ("products"."plu_code" is null or "products"."plu_code" between 1 and 999999);--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['scale.view', 'scale.manage', 'scale.sync']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" IN ('Direktor', 'Ombor menejeri');--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['scale.view', 'scale.sync']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" = 'Savdo menejeri';--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'scale.view')
WHERE "name" IN ('Kassir', 'Auditor', 'Ko''ruvchi') AND NOT ('scale.view' = ANY("permissions"));