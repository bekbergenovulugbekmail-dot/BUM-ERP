-- AGENT / DOSTAVSHIK PULINI TOPSHIRISH: SUBMIT → ACCEPT / REJECT (6-vazifa).
--
-- Muammo: topshirish DARHOL pul o'tkazmasi qilardi — qabul qiluvchi ko'rib chiqmasdan,
-- rad eta olmasdan. Sanoq farq chiqsa (agent 3 000 000 dedi, kassada 2 800 000) buni
-- qaytarishning yo'li yo'q edi.
--
-- Yechim: topshirish HUJJAT bo'ladi. Pul FAQAT qabul qilinganda ko'chadi, shuning uchun
-- rad etishda hech qanday buxgalteriya yozuvini qaytarish (reversal) kerak emas —
-- yozuv umuman yaratilmagan bo'ladi. Bu ikki marta hisoblanishning oldini oladi.
--
-- Karta/terminal tushumi: u jismonan agentda bo'lmaydi (bank/karta hisobiga to'g'ridan-to'g'ri
-- tushadi), shuning uchun qabul qilishda IKKINCHI marta ko'chirilmaydi — faqat solishtirish
-- (reconciliation) uchun yoziladi.
create table if not exists "cash_handovers" (
  "id" uuid primary key default gen_random_uuid(),
  "company_id" uuid not null references "companies"("id") on delete restrict,

  -- Kim topshiryapti: savdo agenti yoki yetkazuvchi (ikkalasining o'z jadvali bor)
  "sales_rep_id" uuid references "sales_reps"("id") on delete restrict,
  "delivery_agent_id" uuid references "delivery_agents"("id") on delete restrict,

  "number" varchar(32) not null,
  "status" varchar(16) not null default 'submitted',

  -- Topshirilayotgan summalar
  "cash_amount" numeric(18, 2) not null default 0,
  "card_amount" numeric(18, 2) not null default 0,
  "total_amount" numeric(18, 2) not null default 0,

  -- Qabul qilinganda kassaga ko'chirilgan naqd (farq bo'lsa topshirilganidan kam bo'lishi mumkin)
  "accepted_cash_amount" numeric(18, 2),
  "to_cash_account_id" uuid references "cash_accounts"("id") on delete set null,
  "cash_transaction_id" uuid,

  "notes" text,
  "reject_reason" text,

  "submitted_by" uuid references "users"("id") on delete set null,
  "submitted_at" timestamp with time zone default now() not null,
  "reviewed_by" uuid references "users"("id") on delete set null,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,

  constraint "handover_one_holder" check (("sales_rep_id" is null) <> ("delivery_agent_id" is null)),
  constraint "handover_status" check ("status" in ('submitted', 'accepted', 'rejected', 'cancelled')),
  constraint "handover_amounts_non_negative" check ("cash_amount" >= 0 and "card_amount" >= 0 and "total_amount" >= 0),
  constraint "handover_total_matches" check ("total_amount" = "cash_amount" + "card_amount"),
  constraint "handover_positive" check ("total_amount" > 0),
  -- Qabul qilingan naqd topshirilganidan oshmasin
  constraint "handover_accepted_within" check ("accepted_cash_amount" is null or ("accepted_cash_amount" >= 0 and "accepted_cash_amount" <= "cash_amount")),
  -- Rad etishda sabab majburiy
  constraint "handover_reject_reason" check ("status" <> 'rejected' or ("reject_reason" is not null and length(btrim("reject_reason")) > 0))
);

create unique index if not exists "handover_company_number_key" on "cash_handovers" ("company_id", "number");
create index if not exists "handover_company_status_idx" on "cash_handovers" ("company_id", "status");
create index if not exists "handover_rep_idx" on "cash_handovers" ("company_id", "sales_rep_id");
create index if not exists "handover_agent_idx" on "cash_handovers" ("company_id", "delivery_agent_id");

-- Bitta topshiruvchida bir vaqtda faqat BITTA ko'rib chiqilmagan topshirish bo'lsin —
-- takroriy yuborish (ikki marta bosish, qayta urinish) dublikat yaratmasin.
create unique index if not exists "handover_one_open_per_rep"
  on "cash_handovers" ("company_id", "sales_rep_id")
  where "status" = 'submitted' and "sales_rep_id" is not null;
create unique index if not exists "handover_one_open_per_agent"
  on "cash_handovers" ("company_id", "delivery_agent_id")
  where "status" = 'submitted' and "delivery_agent_id" is not null;
