-- MIJOZ BALANSIDAN PUL AYIRISH (2-vazifa).
--
-- Muammo: balansga pul QO'SHISH (`deposit`) bor edi, lekin ortiqcha to'lovni mijozga
-- QAYTARISH uchun alohida tur yo'q edi — buni "adjustment" (qo'lda tuzatish) bilan yozish
-- moliyaviy ma'noni buzardi: tuzatish pul harakati emas, qaytarish esa haqiqiy pul chiqimi.
--
-- Faqat QO'SHADI: mavjud qatorlar va turlar o'zgarmaydi.
alter type "customer_balance_tx_type" add value if not exists 'withdrawal';
