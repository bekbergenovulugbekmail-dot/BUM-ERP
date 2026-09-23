-- FIKSATSIYALANGAN OYLIK TARIXI + KPI MAQSAD/BONUS QOIDALARI (1 va 3-vazifalar).
--
-- Hammasi QO'SHADI: mavjud ustunlar o'zgarmaydi, eski qoidalar avvalgidek ishlaydi.
-- `bonus_type` sukut bo'yicha 'tiered' — bu hozirgi progressiv bosqich hisobi, ya'ni
-- mavjud bizneslarning oyligi bir tiyinga ham o'zgarmaydi.

-- ─── 1. Fiksatsiyalangan oylik tarixi ───────────────────────────────────────
-- Nega kerak: oylik o'zgarsa OLDINGI oy hisob-kitobi buzilmasligi kerak. Shuning uchun
-- o'zgarish "qaysi oydan boshlab" (effective_month) bilan yoziladi va maosh tayyorlashda
-- shu oyga AMAL QILGAN stavka olinadi.
create table if not exists "employee_salary_history" (
  "id" uuid primary key default gen_random_uuid(),
  "company_id" uuid not null references "companies"("id") on delete restrict,
  "employee_id" uuid not null references "employees"("id") on delete cascade,
  -- O'zgarishdan oldingi va keyingi stavka (tarix uchun ikkalasi ham saqlanadi)
  "old_salary" numeric(18, 2) not null default 0,
  "new_salary" numeric(18, 2) not null default 0,
  -- "2026-09" — shu oydan boshlab amal qiladi
  "effective_month" varchar(7) not null,
  "reason" text,
  "changed_by" uuid references "users"("id") on delete set null,
  "created_at" timestamp with time zone default now() not null,
  constraint "esh_salary_non_negative" check ("old_salary" >= 0 and "new_salary" >= 0),
  constraint "esh_month_format" check ("effective_month" ~ '^[0-9]{4}-[0-9]{2}$')
);

create index if not exists "esh_company_employee_idx"
  on "employee_salary_history" ("company_id", "employee_id", "effective_month");

-- ─── 2. KPI qoidasiga maqsad va bonus turi ──────────────────────────────────
do $$ begin
  create type "kpi_bonus_type" as enum ('tiered', 'fixed', 'achievement');
exception
  when duplicate_object then null;
end $$;

alter table "kpi_rules" add column if not exists "name" varchar(120);
alter table "kpi_rules" add column if not exists "description" text;
-- Maqsad (plan): bajarilish = haqiqiy / maqsad
alter table "kpi_rules" add column if not exists "target" numeric(18, 4);
-- 'tiered'      — hozirgi progressiv bosqichlar (sukut, eski xatti-harakat)
-- 'fixed'       — maqsad bajarilsa belgilangan summa, bajarilmasa 0
-- 'achievement' — summa × bajarilish foizi (shift bilan)
alter table "kpi_rules" add column if not exists "bonus_type" "kpi_bonus_type" not null default 'tiered';
-- 100% bajarilishdagi summa ('fixed' va 'achievement' uchun)
alter table "kpi_rules" add column if not exists "bonus_amount" numeric(18, 2) not null default 0;
-- Bir nechta KPI bo'lganda ulush (foiz). NULL — ulush yo'q, summa to'liq hisoblanadi.
alter table "kpi_rules" add column if not exists "weight" numeric(5, 2);
-- Bajarilish shifti (masalan 120%) — ortiqcha bajarish cheksiz pul bermasin
alter table "kpi_rules" add column if not exists "max_achievement" numeric(5, 2);
-- Qoida qaysi oydan amal qiladi; NULL — doim
alter table "kpi_rules" add column if not exists "effective_month" varchar(7);

alter table "kpi_rules" drop constraint if exists "kpi_rule_target_positive";
alter table "kpi_rules" add constraint "kpi_rule_target_positive"
  check ("target" is null or "target" > 0);

alter table "kpi_rules" drop constraint if exists "kpi_rule_bonus_non_negative";
alter table "kpi_rules" add constraint "kpi_rule_bonus_non_negative"
  check ("bonus_amount" >= 0);

alter table "kpi_rules" drop constraint if exists "kpi_rule_weight_range";
alter table "kpi_rules" add constraint "kpi_rule_weight_range"
  check ("weight" is null or ("weight" > 0 and "weight" <= 100));

alter table "kpi_rules" drop constraint if exists "kpi_rule_max_achievement_range";
alter table "kpi_rules" add constraint "kpi_rule_max_achievement_range"
  check ("max_achievement" is null or "max_achievement" >= 0);

alter table "kpi_rules" drop constraint if exists "kpi_rule_effective_month_format";
alter table "kpi_rules" add constraint "kpi_rule_effective_month_format"
  check ("effective_month" is null or "effective_month" ~ '^[0-9]{4}-[0-9]{2}$');

-- Maqsadga asoslangan turlar uchun maqsad majburiy (bosqichli turga tegmaydi)
alter table "kpi_rules" drop constraint if exists "kpi_rule_target_required";
alter table "kpi_rules" add constraint "kpi_rule_target_required"
  check ("bonus_type" = 'tiered' or "target" is not null);

-- ─── 3. Oylik varaqasidagi KPI qatoriga SNAPSHOT ────────────────────────────
-- Oy yopilgandan keyin qoida o'zgarsa ham eski oy hisoboti o'zgarmasligi uchun
-- maqsad, bajarilish foizi va ulush o'sha payt qanday bo'lsa shunday yoziladi.
alter table "salary_kpi_lines" add column if not exists "target" numeric(18, 4);
alter table "salary_kpi_lines" add column if not exists "achievement_percent" numeric(9, 2);
alter table "salary_kpi_lines" add column if not exists "weight" numeric(5, 2);
alter table "salary_kpi_lines" add column if not exists "bonus_type" "kpi_bonus_type";
