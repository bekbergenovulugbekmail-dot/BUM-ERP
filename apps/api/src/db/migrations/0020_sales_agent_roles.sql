-- Sotuv agenti: mavjud kompaniyalar (va global) uchun yangi tizim rollari; Direktor va Savdo menejeriga yangi ruxsatlar;
-- bitta foydalanuvchi — bitta savdo agenti. Takror ishlasa o'zgarmaydi.
INSERT INTO "roles" ("company_id", "name", "description", "color", "permissions", "is_system")
SELECT c."id", r."name", r."description", r."color", r."permissions", true
FROM "companies" c
CROSS JOIN (VALUES
  ('Sotuv agenti', 'Mobil agent ish joyi: marshrut, do''konlar, buyurtma', '#10b981', ARRAY['sales_agent.use']::text[]),
  ('Supervayzer', 'Savdo agentlari nazorati: marshrut, lokatsiya, aksiyalar', '#0891b2', ARRAY[
    'products.view', 'sales.view', 'crm.view', 'distribution.view', 'distribution.manage', 'sales_agent.supervise',
    'sales_agent.location.view', 'sales_agent.location.live', 'sales_agent.location.history', 'promotions.manage', 'analytics.view'
  ]::text[])
) AS r("name", "description", "color", "permissions")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "roles" ("company_id", "name", "description", "color", "permissions", "is_system")
SELECT NULL, r."name", r."description", r."color", r."permissions", true
FROM (VALUES
  ('Sotuv agenti', 'Mobil agent ish joyi: marshrut, do''konlar, buyurtma', '#10b981', ARRAY['sales_agent.use']::text[]),
  ('Supervayzer', 'Savdo agentlari nazorati: marshrut, lokatsiya, aksiyalar', '#0891b2', ARRAY[
    'products.view', 'sales.view', 'crm.view', 'distribution.view', 'distribution.manage', 'sales_agent.supervise',
    'sales_agent.location.view', 'sales_agent.location.live', 'sales_agent.location.history', 'promotions.manage', 'analytics.view'
  ]::text[])
) AS r("name", "description", "color", "permissions")
WHERE EXISTS (SELECT 1 FROM "roles" WHERE "company_id" IS NULL)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY[
    'sales_agent.use', 'sales_agent.supervise', 'sales_agent.location.view', 'sales_agent.location.live',
    'sales_agent.location.history', 'promotions.manage'
  ]::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
)
WHERE "name" = 'Direktor' AND "is_system" = true;
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || ARRAY(
  SELECT p FROM unnest(ARRAY['sales_agent.supervise', 'promotions.manage']::text[]) AS p
  WHERE NOT (p = ANY("roles"."permissions"))
)
WHERE "name" = 'Savdo menejeri' AND "is_system" = true;
--> statement-breakpoint
-- Bitta foydalanuvchiga bir nechta agent bog'langan bo'lsa — eng birinchisi qoladi
UPDATE "sales_reps" s SET "user_id" = NULL
WHERE s."user_id" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "sales_reps" o
  WHERE o."company_id" = s."company_id" AND o."user_id" = s."user_id"
    AND (o."created_at" < s."created_at" OR (o."created_at" = s."created_at" AND o."id" < s."id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sr_company_user_key" ON "sales_reps" USING btree ("company_id","user_id") WHERE "sales_reps"."user_id" is not null;
