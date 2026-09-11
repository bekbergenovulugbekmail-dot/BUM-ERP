# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 7 / 16 PHASE tugallandi, PHASE 4 jarayonda, keyingi — PHASE 9 |
| Ishlab turgan ilova | Hali to'liq Convex'da — frontend yangi API'ga ulanmagan |

**Holat belgilari:** ✅ tugallandi · 🟡 jarayonda · ⬜ boshlanmagan

> Eslatma: 16 PHASE ro'yxati asl rejadan emas — asl reja boshqa qurilmadagi
> sessiyada qolgan. Ro'yxat commitlar va `convex/` modullari asosida qayta
> tuzilgan va tasdiqlangan. Asl reja topilsa, shu ro'yxat almashtiriladi.

## Umumiy ko'rinish

| # | PHASE | Holat |
|---|---|---|
| 1 | Monorepo skeleti | ✅ tugallandi |
| 2 | PostgreSQL sxemasi | ✅ tugallandi |
| 3 | API poydevori | ✅ tugallandi |
| 4 | Auth va sessiyalar | 🟡 jarayonda (SMS tiklash — Eskiz ulangach) |
| 5 | Platforma: kompaniya, filial, rol, admin | ✅ tugallandi |
| 6 | Katalog | ✅ tugallandi |
| 7 | Ombor | ✅ tugallandi |
| 8 | Moliya | ✅ tugallandi |
| 9 | Xarid | ⬜ boshlanmagan |
| 10 | Savdo va POS | ⬜ boshlanmagan |
| 11 | CRM | ⬜ boshlanmagan |
| 12 | Ishlab chiqarish | ⬜ boshlanmagan |
| 13 | HR | ⬜ boshlanmagan |
| 14 | Dashboard, hisobot, AI, bildirishnoma, fayl | ⬜ boshlanmagan |
| 15 | Ma'lumotni Convex'dan ko'chirish | ⬜ boshlanmagan |
| 16 | Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish | ⬜ boshlanmagan |

## Yakuniy qarorlar (2026-09-11)

- **Ierarxiya:** bootstrap admin (`.env` dan seed, o'chirilmaydi) → platforma admini biznes egasi uchun login/parol ochadi → biznes egasi o'z kompaniyasidagi xodimlar uchun login/parol ochadi → xodim faqat o'z parolini (eski parol bilan) o'zgartiradi
- **Qo'shimcha platforma adminlari:** faqat bootstrap admin tayinlaydi va olib tashlaydi
- **O'zi ro'yxatdan o'tish:** standart holatda yopiq; platforma admini sozlamalardan yoqadi/o'chiradi
- **Takliflar (invitations):** kerak emas — `invitations` jadvali sxemada qoladi, API yozilmaydi; Eskiz ulangach PHASE 14 da
- **Cheklovlar:** ega faqat o'z kompaniyasi xodimini ko'radi va boshqaradi; hech kim o'ziga rol ko'tara olmaydi; parol o'zgarsa barcha sessiyalar bekor; har amal audit jurnaliga
- **Mustaqil ish:** foydalanuvchi ruxsat so'ramasdan barcha PHASE larni oxirigacha davom ettirishni tasdiqlagan

## Convex (ishlab turgan ilova) xavfsizlik teshiklari

Ko'chirish paytida topilgan. Yangi API'da hammasi yopilgan.

**Convex kodida yopildi** — `main` da `3f958f1` (feat'da `8ab75e2`), `convex/rbac.test.ts` 10 ta test:
`admin.updateRole` (global rol), `admin.updateUserRole` (o'ziga Superadmin), `companies.updateMember` (o'zini Business Owner), `admin.createRole` / `deleteRole`, `admin.toggleUserActive` (egani bloklash), `admin.createAuditLog` (internal qilindi).

> ⚠️ **Production'ga deploy qilinmagan.** Bu muhitda faqat dev deployment (`cheerful-toad-597`) kaliti bor.
> Kuchga kirishi uchun `main` dan production kaliti bilan `npx convex deploy` qilish kerak.

**Convex'da hali ochiq** (frontend PHASE 16 da yangi API'ga ko'chganda yo'qoladi):

| Joy | Muammo |
|---|---|
| `products/units.ts` `create`, `addConversion`, `seedDefaultUnits` | **Autentifikatsiya umuman yo'q** — tizimga kirmagan odam ham global birlik/konversiya yaratadi |
| `products/units.ts` `listConversions` | Barcha kompaniyalarning konversiyalarini qaytaradi |
| `products/products.ts` `getByBarcode` | Global indeksdan birinchi mahsulot — boshqa kompaniyada shu kod bo'lsa o'zinikini topmaydi (xato) |
| `admin.upsertCompany` | Kompaniyasi yo'q foydalanuvchi "default" kompaniyani o'zgartiradi; ruxsat tekshiruvi yo'q |
| `admin.upsertSetting`; `companies.updateCompany`, `createBranch`, `updateBranch` | Ruxsat tekshiruvi yo'q |
| `admin.listUsers`, `companies.platformListAllUsers` | Foydalanuvchi hujjati to'liq (PIN xeshi) brauzerga |
| `companies.platformGetSettings` | Autentifikatsiyasiz ochiq |
| `warehouse/stock.ts` `recordMovement`, `transferStock` | Ruxsat tekshiruvi yo'q — har qanday a'zo (Kassir ham) zaxirani o'zgartiradi; o'tkazmada tannarxni mijoz yuboradi |
| `warehouse/warehouses.ts` `seedDefault` | Ruxsat tekshiruvi yo'q |
| `warehouse/inventoryCounts.ts` `applyAdjustments` | Hisob yaratilgandagi eski farqni yozadi — orada bo'lgan sotuv/kirim yo'qoladi; bekor qilingan hisobni ham qo'llaydi |
| a'zoning `allowedWarehouseIds` | Saqlanadi, lekin hech qayerda tekshirilmaydi |
| `finance/expenses.ts` `updateStatus` | Istalgan holatga o'tkazadi (to'langanni qaytadan kutilayotganga); "to'landi" kassadan pul chiqarmaydi va jurnalga yozmaydi |
| `finance/cashAccounts.ts` `recordTransaction` (`type: "transfer"`) | Balansdan pul yechiladi, lekin hech qayerga tushmaydi |
| `finance/journalHelper.ts` `recordCashTransaction` | Xarid/savdo to'lovlarida kassa balansi manfiyga tushadi |
| `finance/accounts.ts` `seedDefaultAccounts` | Ruxsat tekshiruvi yo'q (frontend sahifa ochilganda chaqiradi) |
| xarajat va jurnal raqamlari (`nextExpNumber`, `nextJENumber`) | Parallel yaratishda bir xil raqam |

## Foydalanuvchi boshqaruvi ierarxiyasi (yangi API)

| Kim | Nima qila oladi | Himoya |
|---|---|---|
| **Bootstrap admin** | Hamma narsa; qo'shimcha platforma adminlarini tayinlaydi | `.env` dan `db:seed`, argon2id. API orqali o'zgartirilmaydi, bloklanmaydi, o'chirilmaydi. Bazada: CHECK, partial unique, trigger |
| **Platforma admini** | Kompaniya + egasini yaratadi; kompaniyani to'xtatadi; oddiy foydalanuvchilarni boshqaradi; statistika, audit, sozlamalar; o'lchov birliklari | Bootstrap admin, boshqa platforma adminlari va o'z hisobiga tegolmaydi |
| **Kompaniya egasi** | O'z kompaniyasiga xodim qo'shadi, parolini tiklaydi, a'zoligini yangilaydi; rollar, sozlamalar, audit | Boshqa kompaniya xodimi → 404; egalik rollarini berolmaydi |
| **Xodim** | O'z paroli; roliga qarab kompaniya amallari (RBAC) | Xato joriy parol: 5 ta / 15 daqiqa |

**RBAC** (`modules/company/tenant.ts`): ruxsat faol a'zolikning roli bo'yicha; `Superadmin` / `Business Owner` — barcha ruxsatlar; `requirePermission` faqat katalogdagi `Permission`; rol tahrirlovchi faqat o'zida bor ruxsatni bera oladi; to'xtatilgan, tugatilgan yoki sinov muddati o'tgan kompaniyada yozish 403.

## Tayyor API endpointlar

Xatolar doim `{ code, message }`. Unique buzilishi 409, FK 409, CHECK 400. Yozish endpointlari noma'lum maydonlarni 400 bilan rad etadi. Pul/miqdor — satr (`"12500.5000"`), son yoki satr qabul qilinadi.

### Auth, ro'yxatdan o'tish, ommaviy

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/health` | — | — |
| POST | `/api/auth/login`, `/api/auth/logout` | — | `signIn`, `signOut` |
| GET | `/api/auth/me` | sessiya | `users.getCurrentUser` |
| POST | `/api/auth/password` | sessiya (bootstrap admindan tashqari) | — |
| GET/POST/PUT | `/api/auth/security`, `/pin`, `/pin/change`, `/pin/remove`, `/pin/verify`, `/auto-lock` | sessiya | `pin.*` |
| GET/POST | `/api/registration` | — (POST faqat yoqilgan bo'lsa) | `isRegistrationEnabled`, `registerCompany` |
| GET | `/api/public/companies/:slug`, `/:slug/access` | — / sessiya | `getCompanyBySlug`, `verifyTenantAccess` |

### Platforma admini (`/api/platform`)

| Metod | Yo'l | Convex |
|---|---|---|
| GET/POST | `/companies` (`?status=`) | `platformListCompanies`, `platformCreateCompany` |
| GET | `/companies/:companyId` | `platformGetCompany` |
| POST | `/companies/:companyId/status` | `platformUpdateCompanyStatus` |
| GET | `/stats`, `/audit-logs`, `/users` | `platformGetStats`, `platformListAuditLogs`, `platformListAllUsers` |
| PATCH/POST | `/users/:userId`, `/users/:userId/password`, `/users/:userId/status` | `userAdmin.resetUserPassword` va yangi |
| POST | `/users/:userId/platform-admin` (**faqat bootstrap admin**) | `platformGrantAdmin` / `platformRevokeAdmin` |
| GET/PUT | `/settings` | `platformGetSettings`, `platformSaveSettings` |

### Kompaniya (`/api/company`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET / PATCH | `/` | a'zo / `company.manage` | `getActiveCompany`, `updateCompany` |
| GET / POST | `/mine`, `/switch` | sessiya / faol a'zo | `listMyCompanies`, `switchCompany` |
| GET / POST / PATCH | `/branches`, `/branches/:branchId` | a'zo / `branches.manage` | `listBranches`, `createBranch`, `updateBranch` |
| GET | `/employees` | `users.view` | `listMembers`, `admin.listUsers` |
| POST / PATCH / POST | `/employees`, `/employees/:userId`, `/employees/:userId/password` | kompaniya egasi | `createUserAccount`, `updateMember`, `resetUserPassword` |
| GET / POST / PATCH / DELETE | `/roles`, `/roles/:roleId` | a'zo / `roles.manage` | `admin.*Role` |
| GET | `/audit-logs` | `audit.view` | `admin.listAuditLogs` |
| GET / PUT | `/settings`, `/settings/:key` | `settings.view` / `settings.manage` (`modules` — `modules.manage`) | `admin.getSettings`, `upsertSetting` |

### Katalog (`/api/catalog`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/units` | sessiya | `units.list` |
| POST / PATCH | `/units`, `/units/:unitId` | platforma admini | `units.create` |
| GET / POST / DELETE | `/unit-conversions` (`?productId=`), `/unit-conversions/:id` | a'zo / `products.manage` | `units.listConversions`, `addConversion` |
| GET / POST / PATCH / DELETE | `/categories` (`?includeInactive=`), `/categories/:id` | a'zo / `products.manage` | `categories.*` |
| GET / POST / PATCH / DELETE | `/brands` (`?isActive=`), `/brands/:id` | a'zo / `products.manage` | `brands.*` |
| GET | `/products` (`?search=&categoryId=&brandId=&isActive=&limit=&cursor=`) | `products.view` | `products.list` |
| GET | `/products/:productId` (partiyalar bilan), `/products/by-barcode/:barcode` | `products.view` | `getById`, `getByBarcode` |
| POST / PATCH / DELETE | `/products`, `/products/:productId` | `products.create` / `.edit` / `.delete` | `create`, `update`, `remove` |
| POST | `/products/import` (JSON qatorlar) | `products.create` | frontend CSV import |
| GET | `/products/export` (CSV) | `products.view` | frontend CSV export |
| POST | `/products/:productId/batches` | `warehouse.manage` | `addBatch` |
| GET | `/batches/expiring` (`?daysAhead=30`) | `warehouse.view` | `getExpiringBatches` |

### Ombor (`/api/inventory`)

Har amalda a'zoning `allowedWarehouseIds` ruxsati tekshiriladi (bo'sh — barcha omborlar). Miqdor mahsulotning asosiy birligida.

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/warehouses` (`?includeInactive=`), `/warehouses/:warehouseId` | a'zo | `warehouses.list`, `getById` |
| POST / PATCH | `/warehouses`, `/warehouses/:warehouseId` | `warehouses.manage` | `create`, `update` |
| GET | `/stock` (`?warehouseId=&search=&lowStockOnly=`) | `warehouse.view` | `getWarehouseStock` |
| GET | `/stock/stats` (`?warehouseId=`), `/stock/products/:productId` | `warehouse.view` | `getWarehouseStats`, `getProductStock` |
| GET | `/stock/movements` (`?warehouseId=&productId=&type=&limit=&cursor=`) | `warehouse.view` | `getMovements` |
| POST | `/stock/movements` (receive, issue, adjust, writeoff, return_in, return_out) | `receive` — `warehouse.receive`; boshqalar — `warehouse.manage` | `recordMovement` |
| POST | `/stock/transfers` | `warehouse.transfer` | `transferStock` |
| GET | `/counts` (`?warehouseId=&status=`), `/counts/:countId` | `warehouse.view` | `inventoryCounts.list`, `getById` |
| POST / PATCH | `/counts`, `/counts/:countId/items`, `/counts/:countId/items/:itemId`, `/counts/:countId/status` | `warehouse.count` | `create`, `updateItem`, `updateStatus` |
| POST | `/counts/:countId/apply` | `warehouse.count` + `warehouse.manage` | `applyAdjustments` |

### Moliya (`/api/finance`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| POST | `/setup` (standart hisoblar va kassalar; idempotent) | `finance.manage` | `accounts.seedDefaultAccounts` |
| GET / POST / PATCH | `/accounts` (`?type=&includeInactive=`), `/accounts/:accountId` | `finance.view` / `finance.manage` | `accounts.list`, `create` |
| GET | `/reports/trial-balance`, `/reports/profit-loss` (`?dateFrom=&dateTo=`) | `finance.view` | yangi (frontend P&L o'zi hisoblardi) |
| GET | `/journal` (`?dateFrom=&dateTo=&status=&referenceType=&limit=&cursor=`), `/journal/:entryId` | `finance.view` | yangi |
| POST | `/journal` (qo'lda yozuv), `/journal/:entryId/void` | `finance.manage` / `finance.approve` | yangi |
| GET | `/dashboard` | `finance.view` | `cashAccounts.getDashboardStats` |
| GET / POST / PATCH | `/cash-accounts` (`?includeInactive=`), `/cash-accounts/:cashAccountId` | `finance.view` / `finance.manage` | `cashAccounts.list`, `createAccount` |
| GET | `/cash-accounts/:cashAccountId/transactions` (`?dateFrom=&dateTo=&limit=&cursor=`) | `finance.view` | `getTransactions` |
| POST | `/cash-transactions` (in/out, ixtiyoriy `counterAccountId`), `/cash-transfers` | `finance.manage` | `recordTransaction` |
| GET | `/expenses` (`?status=&category=&dateFrom=&dateTo=&limit=&cursor=`), `/expenses/stats` | `finance.view` | `expenses.list`, `getStats` |
| POST / PATCH / DELETE | `/expenses`, `/expenses/:expenseId` | `finance.manage` | `create`, `remove` |
| POST | `/expenses/:expenseId/status` (`paid` — kassa chiqimi + jurnal) | `finance.approve` | `updateStatus` |

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432). `bumerp` — 6 ta migratsiya, ma'lumot yo'q; `bumerp_test` — testlar.
- **MinIO** — 9000/9001; `bum-erp` bucket va `STORAGE_*` hali yo'q.
- **Migratsiya:** `pnpm --filter @bum/api db:migrate`
- **Seed:** `.env` ga `BOOTSTRAP_ADMIN_PHONE`, `BOOTSTRAP_ADMIN_PASSWORD` — `pnpm --filter @bum/api db:seed` (bootstrap admin + 14 global rol + 9 standart o'lchov birligi; idempotent)
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`
- **Testlar:** `pnpm --filter @bum/api test` — 164 ta; Convex: `pnpm exec vitest run --project convex` — 10 ta

---

## PHASE 1 — Monorepo skeleti ✅

pnpm workspace; `packages/shared`; `apps/api`; `docker-compose.yml`; `.env.example`. Commitlar: `c5c082a`, `070367f`.

## PHASE 2 — PostgreSQL sxemasi ✅

61 jadval, 10 domen. Pul/miqdor `numeric`; `company_id NOT NULL`; `legacy_id` (API ga chiqmaydi); DB darajasidagi CHECK/unique. Migratsiyalar: `0000` sxema; `0001` NULLS NOT DISTINCT; `0002` bootstrap admin himoyasi; `0003` bitta asosiy filial; `0004` bitta asosiy ombor; `0005` moliya yaxlitligi (buxgalteriya yozuvi balansi — kechiktirilgan trigger, bitta asosiy kassa).

## PHASE 3 — API poydevori ✅

DB mijozi, tranzaksiya, xatolar, logger, env, `.env` yuklash, migrate, Fastify, dual-stack `HOST=::`. Umumiy yordamchilar: `shared/decimal.ts` (numeric satr validatsiyasi), `shared/cursor.ts` (keyset sahifalash), `shared/numbering.ts` (hujjat raqamlari, advisory lock), `shared/rate-limit.ts`, `shared/audit.ts`.

## PHASE 4 — Auth va sessiyalar 🟡

- **Ko'chirilgan:** `modules/auth/` — argon2id (+ Convex lucia Scrypt xeshlari), sessiya (httpOnly cookie, SHA-256, 30 kun / 12 soat), login (rate limit, audit), PIN (5 xato → 5 daqiqa, Convex `reason` kodlari), guard'lar.
- **Testlar:** `auth` (17), `pin` (14), `password` (4)
- **Qolgan:** SMS orqali parol tiklash — Eskiz ulangach PHASE 14 da; eskirgan `rate_limits` / `sessions` tozalash

## PHASE 5 — Platforma: kompaniya, filial, rol, admin ✅

- **Ko'chirilgan:** `modules/platform/` (bootstrap, kompaniyalar, statistika, sozlamalar), `modules/users/` (ierarxiya), `modules/registration/` (boshqariladigan ro'yxatdan o'tish), `modules/public/` (`/t/:slug`), `modules/audit/`, `modules/company/` (tenant, RBAC, filiallar, a'zolar, rollar, sozlamalar).
- **Ataylab ko'chirilmagan:** takliflar (PHASE 14), `createAuditLog`, `seedDefaultRoles`, `platformSetAdminByEmail`, bir martalik ko'chirish funksiyalari.
- **Testlar:** `bootstrap` (13), `platform-admin` (11), `platform-ops` (10), `platform-admins` (4), `registration` (6), `public` (2), `company-owner` (7), `company` (20), `roles` (10), `company-audit-settings` (6)

## PHASE 6 — Katalog ✅

- **Convex manbasi:** `convex/products/` (products, categories, brands, units); sahifa `products`
- **Ko'chirilgan modullar** (`modules/catalog/`):
  - `units.service.ts` — o'lchov birliklari (platforma; yozish faqat platforma admini; `db:seed` 9 ta standart birlik), birlik konversiyalari (kompaniyaga tegishli, `products.manage`)
  - `categories.service.ts` — kategoriyalar (ota shu kompaniyaniki, sikl taqiqlangan, mahsulot yoki ichki kategoriyasi borini o'chirib bo'lmaydi) va brendlar (nomi noyob, ishlatilayotganini o'chirib bo'lmaydi)
  - `products.service.ts` — mahsulotlar (nom bo'yicha kursorli sahifalash, nom/SKU/shtrix-kod qidiruvi, kompaniya ichidagi shtrix-kod qidiruvi), faolsizlantirish, partiyalar (ombor va ta'minotchi shu kompaniyaniki, sanalar tekshiruvi), muddati yaqinlashgan partiyalar, CSV import (qatorma-qator xatolar) va export (formula injection himoyasi)
  - Audit: `UNIT_CREATED`, `UNIT_UPDATED`, `UNIT_CONVERSION_CREATED`, `UNIT_CONVERSION_DELETED`, `CATEGORY_CREATED/UPDATED/DELETED`, `BRAND_CREATED/UPDATED/DELETED`, `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_DEACTIVATED`, `PRODUCTS_IMPORTED`, `BATCH_CREATED`
- **Convex'dan ataylab farqlar:**
  - `units.ts` autentifikatsiyasiz edi — endi birlik yozish faqat platforma admini, konversiyalar kompaniyaga tegishli
  - `getByBarcode` kompaniya ichida qidiradi (Convex boshqa kompaniyadagi bir xil kodda xato qilardi)
  - `products.list` / `getById` ruxsat tekshirmasdi — endi `products.view`
  - Narxlar float emas, numeric satr; ko'pi bilan 4 kasr xona
  - `costingMethod`: amalda faqat AVCO — `fifo`/`fefo`/`manual` aniq xato bilan rad etiladi (Convex jimgina AVCO qo'llardi)
  - `imageUrl` (foydalanuvchi kiritgan tashqi URL — saqlangan XSS yo'li) qabul qilinmaydi; rasm fayl saqlash bilan PHASE 14 da (`image_key`)
  - CSV import serverda: noma'lum o'lchov birligi rad etiladi (Convex frontendi jimgina birinchi birlikni qo'yardi); kategoriya/brend nomi bo'yicha bog'lanadi
  - Kategoriyani o'chirishda ichki kategoriyalar tekshiriladi; sikl taqiqlangan; brendni o'chirish qo'shildi
- **Testlar:** `catalog` (7), `products` (8)
- **Eslatma:** partiya qo'shish zaxira qoldig'iga ta'sir qilmaydi (Convex'dagi kabi); zaxira harakatlari PHASE 7 da

## PHASE 7 — Ombor ✅

- **Convex manbasi:** `convex/warehouse/` — `warehouses.ts`, `stock.ts`, `inventoryCounts.ts`; sahifa `warehouse`
- **Ko'chirilgan modullar** (`modules/inventory/`):
  - `warehouses.service.ts` — omborlar (kod noyob, bitta asosiy ombor — bazada ham, filial va mas'ul shu kompaniyaniki, zaxirasi bor yoki asosiy omborni faolsizlantirib bo'lmaydi), `allowedWarehouses` / `assertWarehouseAccess`
  - `stock.service.ts` — **`moveStock`: zaxirani o'zgartiradigan yagona yo'l** (xarid, savdo, POS, ishlab chiqarish ham shuni chaqiradi): qoldiq qatori `FOR UPDATE` bilan qulflanadi, arifmetika PostgreSQL `numeric` da, AVCO faqat tannarxli kirimda, chiqim joriy o'rtacha tannarxda yoziladi, yetmasa aniq xato. Qoldiqlar (kam qolgan, ortiqcha), statistika, kursorli harakatlar jurnali, qo'lda harakat, o'tkazma (qulflar doimiy tartibda — deadlock yo'q)
  - `counts.service.ts` — inventarizatsiya: qoldiqlardan tuziladi, mahsulot qo'shish, sanash, bekor qilish, qo'llash (bir martalik)
  - Audit: `WAREHOUSE_CREATED`, `WAREHOUSE_UPDATED`, `STOCK_MOVEMENT_RECORDED`, `STOCK_TRANSFERRED`, `INVENTORY_COUNT_CREATED`, `INVENTORY_COUNT_ITEM_ADDED`, `INVENTORY_COUNT_STATUS_CHANGED`, `INVENTORY_COUNT_APPLIED`
- **Convex'dan ataylab farqlar:**
  - `recordMovement` / `transferStock` ruxsat tekshirmasdi — endi `warehouse.receive` / `warehouse.manage` / `warehouse.transfer`
  - O'tkazmada qabul qiluvchi omborga manbadagi o'rtacha tannarx yoziladi (Convex mijoz yuborganini yozardi)
  - Inventarizatsiyani qo'llash farqni **joriy** qoldiqqa nisbatan hisoblaydi (Convex eski farqni yozardi — orada sotilgan tovar qoldiqqa qaytib qo'shilardi); bekor qilingan/yakunlangan hisob qo'llanmaydi; qoldig'i yo'q topilma ham qo'llanadi
  - Ombor yaratish `warehouses.manage` (Convex'da `warehouse.manage` — Omborchi ham ombor ochardi); `seedDefault` kerak emas — kompaniya bilan WH-001 yaratiladi
  - `allowedWarehouseIds` amalda qo'llanadi (Convex saqlardi, lekin tekshirmasdi)
  - `stock_movements.type = count` faqat inventarizatsiyadan; `transfer_*` faqat o'tkazmadan — qo'lda yuborib bo'lmaydi
- **Testlar:** `inventory` (8 — parallel chiqimlar qoldiqni manfiyga tushirmasligi ham), `counts` (3)
- **Eslatma:** zonalar (`warehouse_zones`) Convex'da ham ishlatilmagan — API yozilmadi; `reserved_qty` savdo buyurtmalari bilan PHASE 10 da

## PHASE 8 — Moliya ✅

- **Convex manbasi:** `convex/finance/` — `accounts.ts`, `cashAccounts.ts`, `expenses.ts`, `journalHelper.ts`; sahifa `finance`
- **Ko'chirilgan modullar** (`modules/finance/`):
  - `accounts.service.ts` — hisoblar rejasi (15 ta standart hisob, `subtype` bo'yicha topiladi), kompaniya yaratilganda avtomatik seed (+ "Asosiy kassa", "Asosiy bank hisobi"), hisob yaratish/tahrirlash (ota hisob shu turda, siklsiz; balansli hisobni faolsizlantirib bo'lmaydi), aylanma-saldo va foyda-zarar — jurnal qatorlaridan
  - `journal.service.ts` — **`postJournalEntry`: jurnalga yozishning yagona yo'li** (xarid, savdo, POS ham shuni chaqiradi): debet = kredit butun tiyinlarda aniq, har qatorda faqat debet yoki kredit, hisoblar shu kompaniyaniki va faol, bir hujjatga bitta amaldagi yozuv (idempotent), hisob balanslari normal tomonda va qulflar doimiy tartibda. Bekor qilish — `voided`, balanslar qaytariladi. Qo'lda yozuv va kursorli jurnal
  - `cash.service.ts` — **`recordCashTransaction`: kassa balansini o'zgartiradigan yagona yo'l** (`FOR UPDATE`, manfiy balans yo'q, bir hujjatga takroriy yozuv yo'q); kassalar (bitta asosiy — bazada ham), boshlang'ich qoldiq (kirim + DR kassa / CR ustav kapitali), qo'lda kirim/chiqim (qarshi hisob tanlansa jurnal yozuvi), kassalar orasida o'tkazma (kassa ↔ bank bo'lsa jurnal yozuvi), kursorli tranzaksiyalar, dashboard
  - `expenses.service.ts` — xarajatlar: `pending → approved → paid` (paid yakuniy; approved → pending qaytarish), to'lov = kassa chiqimi + DR xarajat hisobi (kategoriya bo'yicha: ijara, maosh, kommunal, transport, qolgani "Boshqa xarajatlar") / CR kassa yoki bank; faqat kutilayotganini tahrirlash, to'langanini o'chirib bo'lmaydi; statistika
  - `shared/numbering.ts` — `EXP-2026-0001`, `JE-2026-00001`: kompaniya + prefiks bo'yicha advisory lock
  - Audit: `ACCOUNT_CREATED/UPDATED`, `JOURNAL_ENTRY_CREATED/VOIDED`, `CASH_ACCOUNT_CREATED/UPDATED`, `CASH_TRANSACTION_RECORDED`, `CASH_TRANSFERRED`, `EXPENSE_CREATED/UPDATED/STATUS_CHANGED/DELETED`
- **Baza darajasida (0005):** posted yozuv tranzaksiya oxirida tekshiriladi (kamida 2 qator, qatorlar = sarlavha jami, debet = kredit; Convex'dan ko'chgan yozuvlarga ±1 so'm); bitta asosiy kassa
- **Convex'dan ataylab farqlar:** yuqoridagi "Convex'da hali ochiq" jadvalidagi moliya qatorlari yopilgan; pul float emas; ro'yxat/statistika so'rovlari `finance.view` talab qiladi; xarajat statistikasi barcha yozuvlardan (Convex oxirgi 500 ta)
- **Testlar:** `finance` (5 — baza triggeri ham), `cash` (5 — parallel chiqimlar ham), `expenses` (4 — parallel raqamlash ham)
- **Eslatma:** ko'p valyuta yo'q (kassa valyutasi kompaniya valyutasi; o'tkazma faqat bir xil valyutada); `attachmentKey` (chek fayli) PHASE 14 da

## PHASE 9 — Xarid ⬜

`convex/purchase/` (suppliers, orders); sahifa `purchase`

## PHASE 10 — Savdo va POS ⬜

`convex/sales/` (customers, orders, pos); sahifalar `sales`, `pos`. Poydevor: kompaniya sozlamalari (POS sozlamalari uchun).

## PHASE 11 — CRM ⬜

`convex/crm/` (leads, activities, salesReps, distribution); sahifa `crm`

## PHASE 12 — Ishlab chiqarish ⬜

`convex/manufacturing/` (boms, orders); sahifa `manufacturing`

## PHASE 13 — HR ⬜

`convex/hr/` (employees, attendance, salary); sahifa `hr`

## PHASE 14 — Dashboard, hisobot, AI, bildirishnoma, fayl ⬜

`convex/dashboard.ts`, `convex/notifications.ts`, `convex/analytics/`; sahifalar `dashboard`, `analytics`. Shu yerga qoldirilgan: takliflar, SMS parol tiklash (Eskiz), mahsulot rasmi (`image_key`, MinIO).

## PHASE 15 — Ma'lumotni Convex'dan ko'chirish ⬜

Poydevor: `legacy_id` ustunlari; login Convex Auth parol xeshlarini qabul qiladi. E'tibor: Convex'dagi `users.roleId` (global rol) yangi modelda a'zolikda (`company_members.role_id`); Convex'dagi `imageUrl` ko'chirilmaydi; `costingMethod` hammasi `average` ga.

## PHASE 16 — Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish ⬜

- **Manba:** `src/` (barcha sahifalar Convex hook'larini ishlatadi); auth kirish nuqtasi `src/hooks/use-auth.ts`
- **E'tibor:**
  - `admin/bootstrap.tsx` keraksiz (`db:seed`); `onboarding` → `/api/registration` (yoqilgan bo'lsa)
  - `users-section.tsx` → `PATCH /api/company/employees/:userId`; `roles-section.tsx` `seedDefaultRoles` tugmasi keraksiz
  - `products/product-form-dialog.tsx`: standart `costingMethod: "fifo"` → `"average"` bo'lishi kerak; `imageUrl` maydoni olib tashlanadi (PHASE 14 gacha); `products/page.tsx` `seedDefaultUnits` chaqiruvi keraksiz; CSV import → `POST /api/catalog/products/import`, export → `GET /api/catalog/products/export`
  - `finance/page.tsx`: `seedDefaultAccounts` chaqiruvi keraksiz; `expenses-section.tsx`: "To'landi" tugmasi faqat tasdiqlangan xarajatda (va kassa tanlash), `byCategory` endi massiv; `cash-accounts-section.tsx`: summalar satr; `profit-loss-section.tsx` → `GET /api/finance/reports/profit-loss`

---

## Keyingi qadam

1. **PHASE 9 (Xarid)** — ta'minotchilar, xarid buyurtmalari, tovar qabul qilish (zaxira `moveStock` + DR tovar zaxirasi / CR kreditorlar), ta'minotchiga to'lov (kassa + jurnal)
2. **Production:** Convex tuzatishini (`main` `3f958f1`) production kaliti bilan deploy qilish
3. **Lokal:** `.env` ga `BOOTSTRAP_ADMIN_*` qo'shib `db:seed`
