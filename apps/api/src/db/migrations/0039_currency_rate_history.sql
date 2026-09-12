ALTER TABLE "exchange_rates" ADD COLUMN "old_rate" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD COLUMN "device_id" uuid;--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['currency_rates.view', 'currency_rates.manage']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
) WHERE "name" IN ('Direktor', 'Buxgalter', 'Moliya menejeri');--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'currency_rates.view')
WHERE "name" IN ('Kassir', 'Savdo menejeri', 'Auditor', 'Ko''ruvchi') AND NOT ('currency_rates.view' = ANY("permissions"));