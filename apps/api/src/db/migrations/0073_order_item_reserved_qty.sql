-- Buyurtma qatori uchun HAQIQATDA band qilingan miqdor (asosiy birlikda).
--
-- Nega kerak: band qilingan miqdor ombordagi qoldiqdan oshmasligi kerak. Qoldiq yetmaganda
-- farqi band QILINMAYDI (oldindan buyurtma) — shuning uchun bo'shatishda qancha band qilingani
-- aynan ma'lum bo'lishi shart, aks holda boshqa buyurtmalarning bandi kamayib ketardi.
--
-- Faqat QO'SHADI: mavjud qatorlarda 0. Eski (bu migratsiyadan oldingi) tasdiqlangan buyurtmalarda
-- `sales_orders.stock_reserved = true` bo'lsa, band qoldiq jadvalida qoladi va qator bo'yicha
-- 0 ko'rinadi; bunday buyurtma jo'natilganda yoki bekor qilinganda band eski usulda — buyurtma
-- miqdori bo'yicha — bo'shatiladi (xizmat qatlamida shu holat alohida qaraladi).
alter table "sales_order_items" add column if not exists "reserved_qty" numeric(18, 4) not null default 0;

alter table "sales_order_items" drop constraint if exists "soi_reserved_qty_non_negative";
alter table "sales_order_items" add constraint "soi_reserved_qty_non_negative" check ("reserved_qty" >= 0);
