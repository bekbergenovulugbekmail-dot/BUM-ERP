-- KPI qoidasiga PLAN chegarasi: plan bajarilmasa foiz berilmaydi.
--
-- Nega kerak: hozirgi hisob PROGRESSIV — har bosqich faqat o'z oralig'iga tushgan qismga qo'llanadi.
-- Shu bilan "planni bajarsa BUTUN summadan foiz, bajarmasa umuman yo'q" qoidasini ifodalab bo'lmaydi
-- (bosqich bilan faqat plandan ORTIQCHA qismga foiz chiqadi).
--
-- `min_value` — shu qiymatdan kam bo'lsa qoida bo'yicha pul hisoblanmaydi (0). NULL — chegara yo'q,
-- ya'ni mavjud qoidalar oldingidek ishlaydi: boshqa bizneslarning hisob-kitobi o'zgarmaydi.
--
-- Faqat QO'SHADI, hech narsa o'chirilmaydi va qayta yozilmaydi.
alter table "kpi_rules" add column if not exists "min_value" numeric(18, 4);

alter table "kpi_rules" drop constraint if exists "kpi_rule_min_value_non_negative";
alter table "kpi_rules" add constraint "kpi_rule_min_value_non_negative"
  check ("min_value" is null or "min_value" >= 0);
