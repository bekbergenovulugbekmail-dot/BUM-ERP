# Audit tekshiruv ro'yxati

Belgilar: ⬜ tekshirilmagan · 🔎 kod o'qildi · 🧪 avtomatik test (API/DB) · 🌐 brauzer E2E ·
✅ o'tdi · ❌ muammo (ISSUES da ID) · ➖ tegishli emas

## A. Moliyaviy zanjirlar (3-bo'lim)

| Zanjir | Double entry | Balans | Ombor | Qarz | To'lov | Bekor | Hisobot | Holat |
|---|---|---|---|---|---|---|---|---|
| Mijoz: sotuv → kredit → to'lov → taqsimot → balans → kassa → jurnal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅🧪🌐 |
| Ta'minotchi: xarid → qarz → to'lov → kassa → jurnal | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Xarajat → to'lov → kassa → jurnal | ⬜ | ⬜ | ➖ | ➖ | ⬜ | ⬜ | ⬜ | ⬜ |
| O'tkazma: manba → maqsad → jurnal | ⬜ | ⬜ | ➖ | ➖ | ➖ | ⬜ | ⬜ | ⬜ |
| Depozit: mijoz → to'lov → balans → kassa | ⬜ | ⬜ | ➖ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Qaytarish: sotuv → ombor → balans → to'lov → jurnal | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Yetkazma: sotuv → yetkazma → naqd → balans | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

## B. Majburiy reconciliation senariysi (7-bo'lim)

| Qadam | Kutilgan | Holat |
|---|---|---|
| Sotuv 1 000 000 | qarz 1 000 000, ombor −, jurnal DR1100/CR4000 + DR5000/CR1200 | ✅🧪 |
| To'lov 400 000 | qarz 600 000, kassa +400 000, DR kassa/CR1100 | ✅🧪 |
| To'lovni bekor qilish | qarz 1 000 000, kassa −400 000, jurnal teskari | ✅🧪🌐 |
| Sotuvni bekor qilish | qarz 0, ombor tiklanadi, jurnal teskari | ✅🧪 |

Dalil: `apps/api/test/audit-payment-reversal.test.ts` (har qadamda kesh = jurnal subhisobi = 1100, aylanma balans
teng), `e2e/audit-customer-debt.spec.ts`.

## C. 50 modul (4-bo'lim)

| # | Modul | Holat | # | Modul | Holat |
|---|---|---|---|---|---|
| 1 | Authentication | ⬜ | 26 | Expenses | ⬜ |
| 2 | Tenant isolation | ✅🔎🌐 | 27 | Transfers | ⬜ |
| 3 | Company | ⬜ | 28 | Accounting | ⬜ |
| 4 | Users | ⬜ | 29 | Journal | 🔎 (kontragent, davr qulfi) 🧪 |
| 5 | Employees | ⬜ | 30 | Stock | ⬜ |
| 6 | Roles | ⬜ | 31 | Reservation | ⬜ |
| 7 | Permissions | ⬜ | 32 | Warehouse | ⬜ |
| 8 | Subscription | ⬜ | 33 | Inventory | ⬜ |
| 9 | Licenses | ⬜ | 34 | Delivery | ⬜ |
| 10 | Modules | ⬜ | 35 | Sales Agent | ⬜ |
| 11 | Products | ⬜ | 36 | Delivery Agent | ⬜ |
| 12 | Categories | ⬜ | 37 | Routes | ⬜ |
| 13 | Units | ⬜ | 38 | KPI | ⬜ |
| 14 | Prices | ⬜ | 39 | HR | ⬜ |
| 15 | Purchase | ⬜ | 40 | Reports | ⬜ |
| 16 | Purchase return | ⬜ | 41 | Documents | ⬜ |
| 17 | Suppliers | ⬜ | 42 | Nakladnoy | ⬜ |
| 18 | Sales | ⬜ | 43 | PDF | ⬜ |
| 19 | Sales return | ⬜ | 44 | Import | ⬜ |
| 20 | Customers | ⬜ | 45 | Export | ⬜ |
| 21 | Customer debt | ✅🧪🌐 | 46 | Notifications | ⬜ |
| 22 | Payments | ✅🧪🌐 | 47 | Audit logs | ⬜ |
| 23 | Payment allocation | ✅🧪 | 48 | Security | ⬜ |
| 24 | Cash | 🔎❌→✅ AUD-010/012 🧪 | 49 | Backup/restore | ⬜ |
| 25 | Bank | ⬜ | 50 | Production readiness | ⬜ |

## D. 7 biznes turi (5-bo'lim): 0 → mahsulot → xarid → ombor → sotuv → qarz → to'lov → qaytarish → hisobot → kun yopilishi

| Biznes | Mahsulot | Xarid | Ombor | Sotuv | Qarz | To'lov | Qaytarish | Hisobot | Kun yopilishi | Holat |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 Supermarket (POS) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 02 Minimarket | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 03 Ulgurji | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 04 Distribyutor | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 05 Sotuv agenti | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 06 Yetkazma | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 07 Aralash | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
