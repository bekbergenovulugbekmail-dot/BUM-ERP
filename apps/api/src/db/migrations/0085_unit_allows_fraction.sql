-- MIQDOR BUTUN SONMI: "dona" va "blok" 1.5 bo'lmaydi.
--
-- Muammo: hujjat qatorida miqdor maydoni har doim kasr qabul qilardi (`step=0.001`), shuning
-- uchun "1.5 dona" yoki "2.75 blok" yozib bo'lardi. Donalab sotiladigan tovarda bu ma'nosiz
-- va omborda yarim dona qoldiq paydo qilardi.
--
-- Yechim: birlikning O'ZIDA belgi bo'lsin. Kilogramm, litr, metr — kasr bo'ladi (0.5 kg normal);
-- dona, quti, blok, pallet — faqat butun son. Yangi birlik qo'shilsa standart `true` (kasr
-- mumkin) — eski xulq saqlanadi, platforma admini kerak bo'lsa o'zgartiradi.
--
-- Bu PLATFORMA jadvali: birliklar hamma kompaniyada umumiy.

alter table "units" add column if not exists "allows_fraction" boolean not null default true;

-- Standart birliklardan sanaladiganlari butun songa o'tkaziladi (nomi bo'yicha, bir marta)
update "units" set "allows_fraction" = false
 where "allows_fraction" = true
   and lower("name") in ('dona', 'quti', 'blok', 'pallet');
