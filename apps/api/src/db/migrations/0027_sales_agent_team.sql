ALTER TABLE "sales_reps" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD COLUMN "supervisor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_supervisor_user_id_users_id_fk" FOREIGN KEY ("supervisor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Mavjud kompaniyalar rollariga yangi ruxsatlar (faqat yo'q bo'lsa qo'shiladi — takror ishlasa o'zgarmaydi)
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.agents.manage')
 WHERE "name" IN ('Direktor', 'Supervayzer', 'Savdo menejeri', 'HR menejeri')
   AND NOT ('sales_agent.agents.manage' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.customer.edit')
 WHERE "name" = 'Direktor' AND NOT ('sales_agent.customer.edit' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.customer.location.edit')
 WHERE "name" = 'Direktor' AND NOT ('sales_agent.customer.location.edit' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales_agent.customer.photo.create')
 WHERE "name" = 'Direktor' AND NOT ('sales_agent.customer.photo.create' = ANY("permissions"));