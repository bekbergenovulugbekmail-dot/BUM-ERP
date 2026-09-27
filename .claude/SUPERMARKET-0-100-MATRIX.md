# SUPERMARKET 0→100 — REMAINING WORK MATRIX (2026-09-27)

Baseline: branch `feat/postgres-migration`, HEAD `14a868b` (origin'dan 20 commit oldinda, push yo'q). Production va staging API —
`5ba4778` kodi (web — `fd12153`). Migratsiyalar 99 (0096–0098 production'da). API testlar 171 fayl, E2E 39 spec.
Qabul qilingan ishlar (qayta yozilmaydi, faqat regressiya): ko'p kassa, to'lov usullari, sotuvchi, kassa/kassir/sotuvchi/usul
hisobotlari, staging 29/29, supermarket 36/36, minimarket 26/26, multi-kassa 7/7.

Dalil manbalari: uchta read-only audit (AUD topilmalari joriy kodda; A–M; N–Z), `.claude/ERP-AUDIT-ISSUES.md`, `MIGRATION_STATUS.md`.

## Modul matritsasi

| # | Modul | Holat | Dalil | Qolgan ish | P |
|---|---|---|---|---|---|
| A | Tenant / obuna | PASS | `/t/:slug`, slug-sessiya, obuna tugasa 403 (`subscription.test`, `tenant-session.test`, e2e tenant/subscription) | — | — |
| B | Xodim / foydalanuvchi / litsenziya | PASS | alohida; Users sahifasi xodim yaratmaydi (e2e employee-single-source); PIN (`pin.test`) | HR "terminate" litsenziyani bo'shatishi testi yo'q | P3 |
| C | Mahsulot | PARTIAL | unikal shtrix-kod (0095), PLU, AVCO/oxirgi narx, tannarx kassirdan yashirin (`cost-visibility`) | server EAN-13 checksum yo'q; sotuv narxi tarixi faqat auditda | P3 |
| D | Xarid | PARTIAL | qabul idempotent (S05), AVCO (S07), jurnal (S30), to'lov/bekor | xarid qaytarish UI yo'q; AUD-022 (qaytarish AVCO ≠ jurnal), AUD-015 (valyutali qaytarish) | P2 |
| E | Ombor | PASS | band qilish shartli UPDATE, o'tkazma requestId, backorder, parallel testlar | AUD-026: offline/qurilma yo'llarida manfiy qoldiq (nomuvofiqlik bilan), reconciliation endpoint yo'q | P3 |
| F | POS | PASS | naqd/karta/bank/aralash/nasiya, skaner, sotuvchi, kassa (acceptance-multi-kassa, staging 29/29) | web POS'da tarozi (PLU vazn) shtrix-kodi yo'q (desktop'da bor) | P3 |
| G | Qaytarish | PARTIAL | qisman/to'liq, requestId, ombor/COGS/jurnal (audit-return-kinds, S13) | AUD-008 (refund:false → manfiy qarz, avans emas); kassir/agent KPI qaytarishni ayirmaydi | P1/P2 |
| H | Mijoz | PARTIAL | narx, limit/hold/override (credit-hold), aging, balance-adjust (finance.approve) | AUD-004 (boshlang'ich qarz P&L'ga), AUD-003 (taqsimlanmagan qism), AUD-009 (reference solishtirilmaydi); customer-prices va balance-import UI yo'q | P1/P2 |
| I | Ta'minotchi | PARTIAL | akt/reconciliation API (AUD-020), to'lov taqsimoti | ta'minotchi aging yo'q; akt/reconciliation UI yo'q; AUD-014 | P2 |
| J | To'lov tizimi | PASS | usullar, kassa ruxsati, idempotentlik, bekor qilish (mijoz/ta'minotchi/xarajat) | AUD-009 | P2 |
| K | Kassa | PASS | ko'p kassa, formula, ortiqcha/kamomad, inkassatsiya (pos-multi-kassa, staging) | AUD-016 (eski smenada "boshqa chiqim" semantikasi) | P2 |
| L | Xarajat | PASS | kassa/bank, jurnal, bekor qilish | kategoriyalar qat'iy ro'yxat | P4 |
| M | Maosh | PARTIAL | hisoblash→tasdiq→to'lov, jurnal, KPI qatorlari | to'langan maoshni bekor qilish yo'q; hisoblash (accrual) yozuvi yo'q; avans/qisman to'lov yo'q | P2 |
| N | KPI | PARTIAL | Rule Builder, seller_* (qaytarish/chegirma hisobga olinadi) | "dona" ko'rsatkichi yo'q (migratsiya kerak); cashier/agent_sales qaytarishni ayirmaydi | P2 |
| O | Sotuv agenti | PASS (API) | 17 test fayli, e2e, PWA + Android | real qurilmada tekshirilmagan | NV |
| P | Zakaz olish | PASS | `sales_agent.use` toggle, holatlar, band qilish | AUD-024 (limitdan oshgan tasdiqlangan zakaz jo'natilmaydi) | P2 |
| Q | Yetkazma | PASS | 11 holat, dalil, A4 yo'l varaqasi (13 test fayli) | AUD-007 (bekor qilingan zakaz vazifasi ochiq), AUD-023 (qaytarilgan zakaz "yetkazildi") | P2 |
| R | Topshirish (handover) | PARTIAL | naqd: kutilgan/qabul/farq/audit/qulf | karta summasi tekshirilmaydi; requestId yo'q; AUD-019 (bog'lanish, raqam poygasi) | P2 |
| S | Hisobotlar | PARTIAL | server CSV, Excel (klient), tannarx ruxsati | analitika hisobotlari server eksportisiz; AUD-025, AUD-002 (dashboard kesh) | P2 |
| T | Chop etish | PASS | 80mm chek, yorliq, A4 nakladnoy/yo'l varaqasi, invoice, xarid hujjati | 58×30 tayyor preset yo'q (sozlanadi) | P4 |
| U | Import/eksport | PARTIAL | dryRun, xato ro'yxati, bitta tranzaksiya | dublikat yangilanmaydi (UPDATE yo'q) | P3 |
| V | Offline | PASS | outbox, opId unikal, nomuvofiqlik, qurilma→kassa | desktop'da usul/sotuvchi tanlash UI yo'q | P3 |
| W | Buxgalteriya yaxlitligi | PASS | D=K, qarz=jurnal, qoldiq=harakat, kassa=harakat (staging, acceptance) | AUD-022 (1200 drift), AUD-018 (kompaniya bo'yicha endpoint yo'q) | P2 |
| X | Audit | PARTIAL | keng qamrov (narx diff, kassa, sotuvchi) | `audit_logs` DB darajasida himoyasiz (trigger — migratsiya) | P2 |
| Y | Xavfsizlik | PASS | strictObject, companyId scope, tenant e2e, 72 xavfsizlik testi | — | — |
| Z | Backup | PARTIAL | production volume backup `d33c4d9c…` (qo'lda), skriptlar | avtomatik jadval yo'q; restore drill izolyatsiyada qilinmagan | P2 |

## Qaror bo'yicha guruhlar

- **Xavfsiz, migratsiyasiz — shu ishda:** AUD-004 (boshlang'ich qarz → kapital opsiyasi), AUD-009, AUD-007 + AUD-023, AUD-019,
  EAN-13 checksum, Bo'lim 4 senariysi (qabul testi).
- **Moliyaviy semantika o'zgaradi — egasi qarori kerak (financial integrity gate):** AUD-008, AUD-022, AUD-016, kassir/agent KPI
  qaytarishi, maoshni bekor qilish va hisoblash yozuvi, AUD-003.
- **Migratsiya kerak — faqat hujjatlashtiriladi:** KPI "dona" (`kpi_metric` + qiymat), `audit_logs` trigger, AUD-024 (tasdiq saqlash).

## Jurnal
- 2026-09-27: matritsa tuzildi (audit only).
- 2026-09-27: xavfsiz guruh bajarildi — `7db0123` AUD-009, `adda945` AUD-007+AUD-023, `5eae428` AUD-019, `c83b70d` AUD-004
  (kapital opsiyasi, mijoz+ta'minotchi), `afd6a84` EAN-13. Bo'lim 4 senariysi allaqachon mavjud: `acceptance-supermarket`
  BONNU FINAL F1–F6 (aynan shu raqamlar) — PASS, qayta yozilmadi. To'liq API 172 fayl / 1234 ✓, frontend 51/312 ✓, tsc/eslint ✓.
- Keyingi: egasi qarori kerak bo'lgan guruh (AUD-008, AUD-003, AUD-016, AUD-022, KPI qaytarish, maosh) va migratsiya hujjatlari.
