-- ROLLARDA "MAS'UL BO'LGANLARI" SCOPE (5-vazifa).
--
-- Muammo: rol ruxsati faqat "ko'rish / yaratish / tahrirlash / o'chirish" edi. Agent yoki
-- dostavshik BUTUN kompaniyaning ma'lumotini ko'rib turardi — mas'uliyat chegarasi yo'q edi.
--
-- Yechim: har ruxsat uchun ixtiyoriy SCOPE. `{"sales.view": "responsible"}` — xodim faqat
-- o'ziga biriktirilganini ko'radi. Ustun BO'SH bo'lsa hech narsa o'zgarmaydi (hamma narsa
-- ko'rinadi), shuning uchun mavjud rollar va bizneslar avvalgidek ishlaydi.
alter table "roles" add column if not exists "scopes" jsonb not null default '{}'::jsonb;
