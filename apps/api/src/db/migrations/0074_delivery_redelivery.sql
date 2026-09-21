-- Qisman yetkazilgan yetkazmaning QOLGAN qismini qayta yetkazish (yangi yetkazma).
--
-- Nega kerak: shu paytgacha qisman yetkazilgan yetkazmaning qoldig'i faqat omborga qaytarilardi
-- (sotuv va qarz kamayadi). Mijoz qolganini keyin olib kelishni so'rasa, buyurtmani qayta ochishdan
-- boshqa yo'l yo'q edi. Endi qoldiq uchun yangi yetkazma ochiladi va buyurtma o'zgarmaydi
-- (ORDER != DELIVERY): zaxira, qarz va jurnal qaytadan yozilmaydi — tovar allaqachon jo'natilgan.
--
-- `origin_task_id` — qaysi yetkazmaning qoldig'i. Qoldiq bir vaqtda faqat bitta tirik yetkazmada
-- bo'ladi: qayta yetkazma ochiq bo'lsa, asl yetkazmadan omborga qaytarib bo'lmaydi (xizmat qatlami
-- tekshiradi), shuning uchun miqdor ikki marta hisoblanmaydi.
--
-- Faqat QO'SHADI: mavjud yetkazmalarda null.
alter table "delivery_tasks" add column if not exists "origin_task_id" uuid references "delivery_tasks"("id") on delete set null;

create index if not exists "dt_origin_task_idx" on "delivery_tasks" ("origin_task_id") where "origin_task_id" is not null;
