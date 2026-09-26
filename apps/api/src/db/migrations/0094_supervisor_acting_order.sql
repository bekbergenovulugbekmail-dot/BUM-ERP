-- Supervayzer agent nomidan buyurtma (2026-09-26): buyurtma agentniki (`sales_rep_id` — KPI, marshrut, mijoz), lekin uni
-- supervayzer kiritgan (`acting_user_id`; `sales_orders.created_by` ham supervayzer). GPS/tashrif shartini chetlab o'tish
-- faqat sabab bilan (`submit_override_reason`) va alohida audit yozuvi bilan. FAQAT QO'SHUVCHI.
ALTER TABLE "agent_orders" ADD COLUMN IF NOT EXISTS "acting_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent_orders" ADD COLUMN IF NOT EXISTS "submit_override_reason" text;
