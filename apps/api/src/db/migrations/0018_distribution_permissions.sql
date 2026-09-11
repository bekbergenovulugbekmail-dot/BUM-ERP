-- CRM va Distributsiya alohida bo'limlar: savdo agentlari, marshrutlar va tashriflar endi distribution.* ruxsatlari bilan.
-- Mavjud rollar kirishni yo'qotmasligi uchun crm.* bor rollarga mos distribution.* qo'shiladi (takror ishlasa o'zgarmaydi).
UPDATE "roles" SET "permissions" = array_append("permissions", 'distribution.view')
WHERE 'crm.view' = ANY("permissions") AND NOT ('distribution.view' = ANY("permissions"));
--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'distribution.manage')
WHERE 'crm.manage' = ANY("permissions") AND NOT ('distribution.manage' = ANY("permissions"));
