-- Hududlar GEOGRAFIK ma'lumotnomaga aylandi: viloyat → shahar/tuman → mahalla.
--
-- Nega kerak: "hudud" faqat marshrutlar guruhi edi (nomi erkin matn), mijozdagi "Shahar/tuman" va
-- "Mahalla" esa alohida matn maydonlari. Natijada bir joy ikki xil yozilib ketardi va hududlar
-- ro'yxatidagi nom mijoz oynasida ko'rinmasdi.
--
-- Nima o'zgaradi:
--   `kind`      — 'region' (viloyat), 'district' (shahar/tuman), 'neighborhood' (mahalla)
--   `parent_id` — ota hudud (viloyat ichida tuman, tuman ichida mahalla)
-- Mavjud hududlar 'district' bo'lib qoladi — marshrutlar bog'lanishi O'ZGARMAYDI.
--
-- Mijozlarning `city` / `district` matn ustunlari joyida qoladi (dostavka, eksport va saralash ularga
-- tayanadi), lekin endi ular ma'lumotnomadan tanlanadi; ma'lumotnoma esa shu qiymatlardan to'ldiriladi.
alter table "territories" add column if not exists "kind" varchar(20) default 'district' not null;
alter table "territories" add column if not exists "parent_id" uuid references "territories"("id") on delete restrict;

-- Nom endi OTA hudud ichida takrorlanmaydi: turli tumanlarda bir xil nomli mahalla bo'lishi mumkin
drop index if exists "terr_company_name_key";
create unique index if not exists "terr_company_parent_name_key" on "territories" ("company_id","parent_id","name");
create unique index if not exists "terr_company_root_name_key" on "territories" ("company_id","name") where "parent_id" is null;
create index if not exists "terr_company_kind_idx" on "territories" ("company_id","kind");
create index if not exists "terr_company_parent_idx" on "territories" ("company_id","parent_id");

-- Mijozlarda yozilgan shahar/tumanlar ma'lumotnomaga ko'chiriladi (bori qayta qo'shilmaydi).
-- Registri boshqacha yozilganlari BITTA yozuvga yig'iladi (min — barqaror tanlov).
insert into "territories" ("company_id", "name", "kind")
select x."company_id", x."name", 'district'
from (
  select c."company_id" as "company_id",
         min(btrim(c."city")) as "name",
         lower(btrim(c."city")) as "key"
  from "customers" c
  where c."city" is not null and btrim(c."city") <> ''
  group by c."company_id", lower(btrim(c."city"))
) x
where not exists (
  select 1 from "territories" t
  where t."company_id" = x."company_id" and lower(t."name") = x."key"
);

-- Mahallalar — o'z shahri/tumani tagiga (shahri ko'rsatilmagan mijozlar o'tkazib yuboriladi)
insert into "territories" ("company_id", "name", "kind", "parent_id")
select y."company_id", y."name", 'neighborhood', p."id"
from (
  select c."company_id" as "company_id",
         min(btrim(c."district")) as "name",
         lower(btrim(c."district")) as "key",
         lower(btrim(c."city")) as "city_key"
  from "customers" c
  where c."district" is not null and btrim(c."district") <> ''
    and c."city" is not null and btrim(c."city") <> ''
  group by c."company_id", lower(btrim(c."city")), lower(btrim(c."district"))
) y
join "territories" p
  on p."company_id" = y."company_id" and lower(p."name") = y."city_key" and p."kind" = 'district' and p."parent_id" is null
where not exists (
  select 1 from "territories" t
  where t."company_id" = y."company_id" and t."parent_id" = p."id" and lower(t."name") = y."key"
);
