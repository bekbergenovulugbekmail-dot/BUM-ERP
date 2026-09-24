-- HUJJAT SHABLONLARI: nakladnoy va boshqa qog'ozlarning KO'RINISHI.
--
-- Muammo: hujjat ko'rinishi kodda qotib yozilgan edi. Foydalanuvchi "bu yerga logo qo'y",
-- "SKU ustuni kerak emas", "imzo o'ngda bo'lsin" desa — dasturchi kerak bo'lardi. Yagona
-- sozlanadigan narsa yetkazma nakladnoyining ustunlari edi va u `localStorage` da turardi:
-- brauzer tozalansa yo'qolar, boshqa kompyuterda esa umuman yo'q edi.
--
-- Yechim: shablon — KOMPANIYAGA tegishli MA'LUMOT. JSON ichida faqat elementlar, bog'lanishlar
-- va uslub qiymatlari bo'ladi; HTML, JS yoki SQL EMAS (server oq ro'yxat bo'yicha tekshiradi).
--
-- MOLIYAVIY YAXLITLIK: shablon qiymatni O'ZGARTIRMAYDI. U faqat "qaysi qiymat qayerda va
-- qanday ko'rinsin" deydi; qiymatning o'zi har doim hujjat ma'lumotidan olinadi.
--
-- Versiyalash: har saqlash yangi versiya. Foydalanuvchi yaxshi ishlayotgan nakladnoyni
-- buzib qo'ysa, eski versiyaga qaytadi — shuning uchun versiya O'CHIRILMAYDI.

create table if not exists "document_templates" (
  "id" uuid primary key default gen_random_uuid(),
  "company_id" uuid not null references "companies"("id") on delete restrict,
  -- Qaysi hujjat turi uchun: delivery_waybill | sales_invoice | purchase_order | payslip
  "document_type" varchar(40) not null,
  "name" varchar(120) not null,
  -- active | archived. O'chirish o'rniga arxiv: tarixdagi hujjat qaysi shablon bilan
  -- chiqarilgani bilinib tursin.
  "status" varchar(16) not null default 'active',
  "is_default" boolean not null default false,
  "current_version_id" uuid,
  "created_by" uuid references "users"("id") on delete set null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists "document_template_versions" (
  "id" uuid primary key default gen_random_uuid(),
  "company_id" uuid not null references "companies"("id") on delete restrict,
  "template_id" uuid not null references "document_templates"("id") on delete cascade,
  "version" integer not null,
  -- Sahifa, bo'limlar, elementlar, uslublar, shartlar — hammasi tekshirilgan JSON
  "schema" jsonb not null,
  "note" text,
  "created_by" uuid references "users"("id") on delete set null,
  "created_at" timestamptz not null default now()
);

alter table "document_templates"
  drop constraint if exists "dt_current_version_fk";
alter table "document_templates"
  add constraint "dt_current_version_fk"
  foreign key ("current_version_id") references "document_template_versions"("id") on delete set null;

create index if not exists "dt_company_type_idx" on "document_templates" ("company_id", "document_type");
create index if not exists "dt_company_status_idx" on "document_templates" ("company_id", "status");
-- Bitta hujjat turida bitta standart shablon (kompaniya bo'yicha)
create unique index if not exists "dt_one_default_per_type"
  on "document_templates" ("company_id", "document_type")
  where "is_default" and "status" = 'active';
-- Nom takrorlanmasin (arxivdagilar hisobga olinmaydi)
create unique index if not exists "dt_company_type_name_key"
  on "document_templates" ("company_id", "document_type", lower("name"))
  where "status" = 'active';

create unique index if not exists "dtv_template_version_key"
  on "document_template_versions" ("template_id", "version");
create index if not exists "dtv_company_idx" on "document_template_versions" ("company_id");

alter table "document_templates"
  drop constraint if exists "dt_status_valid";
alter table "document_templates"
  add constraint "dt_status_valid" check ("status" in ('active', 'archived'));

alter table "document_template_versions"
  drop constraint if exists "dtv_version_positive";
alter table "document_template_versions"
  add constraint "dtv_version_positive" check ("version" > 0);
