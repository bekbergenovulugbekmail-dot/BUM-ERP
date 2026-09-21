-- Qo'shimcha litsenziya muddati tugashiga yaqin ogohlantirish.
--
-- Nega kerak: trial uchun 10/5/3/1 kunlik ogohlantirish bor edi, qo'shimcha (pullik) litsenziya esa
-- jim tugardi — kompaniya egasi xodim tizimga kira olmay qolgandan keyin biladi.
--
-- `warning_days` — oxirgi yuborilgan ogohlantirish chegarasi (`subscriptions.trial_warning_days` bilan
-- bir xil naqsh): har chegara bir marta yuboriladi, litsenziya uzaytirilganda null ga qaytadi.
--
-- Faqat QO'SHADI: mavjud litsenziyalarda null.
alter table "licenses" add column if not exists "warning_days" integer;
