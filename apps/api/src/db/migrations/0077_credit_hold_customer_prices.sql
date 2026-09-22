-- GO-LIVE: kredit to'xtatish (credit hold) va mijoz × mahsulot kelishilgan narxi.
--
-- Faqat QO'SHADI: mavjud ustunlar, indekslar va ma'lumotlar o'zgarmaydi, hech narsa o'chirilmaydi.
-- Eski yozuvlar standart qiymat bilan avvalgidek ishlaydi (`credit_status = 'ok'` — hech kim bloklanmaydi).

-- ─── Kredit holati ──────────────────────────────────────────────────────────
--
-- Nega kerak: kredit limiti "qancha" ni cheklaydi, lekin muddati o'tgan qarzi bor mijozga nasiya
-- berishni TO'XTATISH mexanizmi yo'q edi — yagona yo'l mijozni butunlay faolsizlantirish edi
-- (u holda naqd sotuv va qarz to'lash ham bloklanardi).
--
--   ok   — cheklovsiz (standart, mavjud xatti-harakat)
--   hold — nasiya sotuv rad etiladi; NAQD sotuv va qarzni to'lash ISHLAYDI
alter table "customers" add column if not exists "credit_status" varchar(16) not null default 'ok';
alter table "customers" add column if not exists "credit_hold_reason" text;
alter table "customers" add column if not exists "credit_hold_at" timestamp with time zone;
alter table "customers" add column if not exists "credit_hold_by" uuid;

alter table "customers" drop constraint if exists "customers_credit_status_check";
alter table "customers" add constraint "customers_credit_status_check" check ("credit_status" in ('ok', 'hold'));

alter table "customers" drop constraint if exists "customers_credit_hold_by_fk";
alter table "customers" add constraint "customers_credit_hold_by_fk"
  foreign key ("credit_hold_by") references "users"("id") on delete set null;

-- Bloklangan mijozlar ro'yxati kompaniya ichida tez topilsin
create index if not exists "customers_company_credit_status_idx"
  on "customers" ("company_id", "credit_status") where "credit_status" <> 'ok';

-- ─── Mijoz × mahsulot kelishilgan narxi ─────────────────────────────────────
--
-- Nega kerak: ulgurjida narx har mijoz bilan alohida kelishiladi. Ilgari yagona yo'l har qatorga
-- qo'lda narx yozish edi (`sales.edit` hammaga kerak bo'lardi va narx nazorati yo'qolardi).
--
-- Birlik bo'yicha: bitta mahsulotga "dona" va "blok" uchun har xil kelishilgan narx bo'lishi mumkin.
-- Tarix saqlanadi: narx o'chirilmaydi, `effective_to` bilan yopiladi va yangisi qo'shiladi.
create table if not exists "customer_prices" (
  "id" uuid primary key default gen_random_uuid(),
  "company_id" uuid not null references "companies"("id") on delete cascade,
  "customer_id" uuid not null references "customers"("id") on delete cascade,
  "product_id" uuid not null references "products"("id") on delete cascade,
  -- Qaysi birlik uchun kelishilgan (dona, blok ...). Buyurtma qatori shu birlikda bo'lsa qo'llanadi.
  "unit_id" uuid not null references "units"("id"),
  -- Narx sotuv valyutasida emas, KOMPANIYA asosiy valyutasida: kurs bilan qayta hisoblanmaydi
  "price" numeric(18, 4) not null,
  "effective_from" date not null,
  -- null — muddatsiz (bekor qilinmaguncha amalda)
  "effective_to" date,
  "is_active" boolean not null default true,
  "notes" text,
  "created_by" uuid references "users"("id") on delete set null,
  "updated_by" uuid references "users"("id") on delete set null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "customer_prices_price_non_negative" check ("price" >= 0),
  constraint "customer_prices_period_check" check ("effective_to" is null or "effective_to" >= "effective_from")
);

-- Narx hal qilish so'rovi: kompaniya + mijoz + mahsulot + birlik, sana bo'yicha
create index if not exists "cp_company_customer_product_idx"
  on "customer_prices" ("company_id", "customer_id", "product_id", "unit_id");
create index if not exists "cp_company_product_idx" on "customer_prices" ("company_id", "product_id");

-- Bir vaqtning o'zida bitta amaldagi narx: ochiq muddatli faol narx (mijoz+mahsulot+birlik) yagona
create unique index if not exists "cp_open_active_key"
  on "customer_prices" ("company_id", "customer_id", "product_id", "unit_id")
  where "is_active" and "effective_to" is null;
