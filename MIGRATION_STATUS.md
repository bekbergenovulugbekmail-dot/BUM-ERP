# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 11 / 16 PHASE tugallandi, PHASE 4 jarayonda, keyingi — PHASE 13 |
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
| 9 | Xarid | ✅ tugallandi |
| 10 | Savdo va POS | ✅ tugallandi |
| 11 | CRM | ✅ tugallandi |
| 12 | Ishlab chiqarish | ✅ tugallandi |
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
| `purchase/orders.ts` `receiveGoods` | Mahsulot, birlik va narx mijozdan olinadi — boshqa mahsulotni istalgan narxda "qabul qilish", boshqa buyurtma qatori, ortiqcha qabul mumkin; birlik konversiyasi e'tiborsiz |
| `purchase/orders.ts` `recordPayment` | Ortiqcha to'lov; boshqa ta'minotchi buyurtmasiga to'lov; "bank" usulida pul naqd kassadan yechiladi; to'xtatilgan kompaniyada ham yozadi |
| `purchase/orders.ts` `cancel` | Qisman qabul qilingan buyurtma bekor qilinadi — tovar omborda, qarz qoladi |
| `purchase/orders.ts` `create`, `suppliers.create` | Mahsulot/birlik tekshirilmaydi; to'xtatilgan kompaniyada ham yozadi; buyurtma raqami takrorlanadi |
| `sales/pos.ts` `completePOSSale` | Chek ombori mijozdan (smenadagidan boshqa ombor); zaxira yetmasa jimgina 0 ga tushadi; narx/chegirma mijozdan; qisman to'lovda jurnal kassani to'liq summaga debetlaydi; mijozsiz qarzga sotish; karta naqd kassaga |
| `sales/pos.ts` `closeShift`, `getShifts`, `getOpenShift` | Istalgan foydalanuvchi istalgan smenani yopadi, qayta yopadi; kassa farqi yo'q; o'qish ruxsatsiz |
| `sales/orders.ts` `create` | Mijoz, mahsulot, POS smenasi tekshirilmaydi (boshqa kompaniya mijozi); `isPOS` mijozdan; soliq stavkasi mijozdan va `taxIncluded` e'tiborsiz (chakana narxda soliq ikki marta) |
| `sales/orders.ts` `ship`, `cancel`, `recordPayment` | Tannarx yaratilgan paytdagi; konversiyasiz zaxira; kredit limiti tekshirilmaydi; yetkazilgan buyurtma bekor qilinadi (zaxira va tushum qoladi); ortiqcha to'lov; POS to'lovi jurnalga yozilmaydi |
| `crm/leads.ts` `updateStage`, `update` | Boshqa kompaniya mijozi lidga bog'lanadi; agent tekshirilmaydi |
| `crm/distribution.ts` `updateRoute`, `createVisit`, `updateVisit` | Boshqa kompaniya agenti; hafta kunlari tekshirilmaydi; yakunlangan tashrif va ko'rsatkichlari istalgancha o'zgaradi |
| `crm/salesReps.ts` `create`, `getStats`, `remove` | Kod takrorlanadi; statistika noto'g'ri (har agentga barcha buyurtmalar, savdo doim 0); bog'langan agent o'chiriladi |
| `manufacturing/*` ruxsatlar | `production.manage` / `production.approve` katalogda yo'q — "Ishlab chiqarish menejeri" roli hech narsa qila olmaydi; o'qishlar ruxsatsiz |
| `manufacturing/boms.ts` `addBOMItem`, `deleteBOM` | Mahsulot o'z retseptiga tarkib; retseptlar sikli; buyurtmalari bor retsept o'chiriladi |
| `manufacturing/orders.ts` `completeOrder` | Xomashyo tannarxi AVCO emas, yaratilgandagi xarid narxi; zaxira yetmasa jimgina 0 ga; boshqa buyurtma materiali qabul qilinadi; konversiyasiz; ishlab chiqarilgan miqdor 0 bo'lishi mumkin |
| `manufacturing/orders.ts` `addTimeLine`, `createWorkCenter` | Yakunlangan buyurtmaga vaqt qo'shilib tannarx o'zgaradi; ish markazi kodi takrorlanadi |

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

### Xarid (`/api/purchase`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/suppliers` (`?includeInactive=&search=`), `/suppliers/:supplierId` | `purchase.view` | `suppliers.list`, `getById` |
| POST / PATCH | `/suppliers`, `/suppliers/:supplierId` | `purchase.create` / `purchase.edit` | `create`, `update` |
| GET | `/orders` (`?supplierId=&status=&dateFrom=&dateTo=&search=&limit=&cursor=`), `/orders/:orderId` (qatorlar, qabullar, to'lovlar) | `purchase.view` | `orders.list`, `getById` |
| POST / PATCH | `/orders`, `/orders/:orderId` (faqat qoralama) | `purchase.create` / `purchase.edit` | `create` |
| POST | `/orders/:orderId/confirm`, `/orders/:orderId/cancel` | `purchase.approve` / `purchase.cancel` | `confirm`, `cancel` |
| POST | `/orders/:orderId/receipts` | `warehouse.receive` + ombor ruxsati | `receiveGoods` |
| GET / POST | `/payments` (`?supplierId=&orderId=`) | `purchase.view` / `purchase.approve` | `recordPayment` |

### Savdo va POS (`/api/sales`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/customers` (`?search=&includeInactive=&limit=`), `/customers/:customerId` (oxirgi buyurtma va to'lovlar) | `sales.view` | `customers.list`, `getById` |
| POST / PATCH | `/customers`, `/customers/:customerId` | `crm.manage` | `create`, `update` |
| GET | `/orders` (`?status=&customerId=&warehouseId=&isPos=&shiftId=&dateFrom=&dateTo=&search=&limit=&cursor=`), `/orders/stats`, `/orders/:orderId` | `sales.view` | `orders.list`, `getStats`, `getById` |
| POST / PATCH | `/orders`, `/orders/:orderId` (faqat qoralama) | `sales.create` / `sales.edit` (narx/chegirma o'zgartirish — `sales.edit`) | `create` |
| POST | `/orders/:orderId/confirm`, `/orders/:orderId/ship` | `sales.approve` + ombor ruxsati | `confirm`, `ship` |
| POST | `/orders/:orderId/cancel` / `/orders/:orderId/return` | `sales.cancel` / `sales.refund` | `cancel` / yangi |
| GET / POST | `/payments` (`?customerId=&orderId=`) | `sales.view` / `finance.manage` | `recordPayment` |
| GET | `/pos/shifts` (`?warehouseId=&status=`), `/pos/shifts/open?warehouseId=`, `/pos/shifts/:shiftId` | `pos.use` | `getShifts`, `getOpenShift` |
| POST | `/pos/shifts`, `/pos/shifts/:shiftId/close` (kassirning o'zi yoki `sales.approve`) | `pos.use` | `openShift`, `closeShift` |
| POST | `/pos/sales` | `pos.use` | `completePOSSale` |

### CRM (`/api/crm`)

O'qish — `crm.view`, yozish — `crm.manage`.

| Metod | Yo'l | Convex |
|---|---|---|
| GET / POST / PATCH / DELETE | `/sales-reps` (`?includeInactive=`), `/sales-reps/stats`, `/sales-reps/:salesRepId` | `salesReps.*` |
| GET / POST / PATCH / DELETE | `/leads` (`?stage=&salesRepId=&search=`), `/leads/stats`, `/leads/:leadId` | `leads.list`, `getStats`, `create`, `update`, `remove` |
| POST | `/leads/:leadId/stage` (`convertToCustomer` — yutilganda mijoz yaratish) | `leads.updateStage` |
| GET / POST / PATCH / DELETE | `/activities` (`?customerId=&leadId=&status=&type=`), `/activities/:activityId` | `activities.*` |
| GET / POST / PATCH / DELETE | `/routes` (`?includeInactive=`), `/routes/:routeId` (mijozlar bilan) | `distribution.listRoutes`, `getRoute`, `createRoute`, `updateRoute`, `deleteRoute` |
| POST / PUT / DELETE | `/routes/:routeId/customers`, `/routes/:routeId/customers/order`, `/routes/:routeId/customers/:memberId` | `addCustomerToRoute`, `removeCustomerFromRoute` |
| GET / POST / PATCH | `/visits` (`?routeId=&salesRepId=&status=&dateFrom=&dateTo=`), `/visits/:visitId` | `listVisits`, `createVisit`, `updateVisit` |

### Ishlab chiqarish (`/api/manufacturing`)

O'qish — `manufacturing.view`, yozish — `manufacturing.manage`, tasdiqlash — `manufacturing.approve`.

| Metod | Yo'l | Convex |
|---|---|---|
| GET / POST / PATCH / DELETE | `/boms` (`?productId=&includeInactive=`), `/boms/:bomId` | `boms.listBOMs`, `getBOM`, `createBOM`, `updateBOM`, `deleteBOM` |
| POST / PATCH / DELETE | `/boms/:bomId/items`, `/boms/:bomId/items/:itemId` | `addBOMItem`, `updateBOMItem`, `deleteBOMItem` |
| GET / POST / PATCH / DELETE | `/work-centers` (`?includeInactive=`), `/work-centers/:workCenterId` | `listWorkCenters`, `createWorkCenter`, `deleteWorkCenter` |
| GET | `/orders` (`?status=&productId=&dateFrom=&dateTo=`), `/orders/stats`, `/orders/:orderId` | `listOrders`, `getStats`, `getOrder` |
| POST | `/orders`, `/orders/:orderId/confirm` (approve), `/start`, `/cancel`, `/complete` | `createOrder`, `confirmOrder`, `startOrder`, `cancelOrder`, `completeOrder` |
| POST / DELETE | `/orders/:orderId/time-lines`, `/orders/:orderId/time-lines/:timeLineId` | `addTimeLine` |

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432). `bumerp` — 8 ta migratsiya, ma'lumot yo'q; `bumerp_test` — testlar.
- **MinIO** — 9000/9001; `bum-erp` bucket va `STORAGE_*` hali yo'q.
- **Migratsiya:** `pnpm --filter @bum/api db:migrate`
- **Seed:** `.env` ga `BOOTSTRAP_ADMIN_PHONE`, `BOOTSTRAP_ADMIN_PASSWORD` — `pnpm --filter @bum/api db:seed` (bootstrap admin + 14 global rol + 9 standart o'lchov birligi; idempotent)
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`
- **Testlar:** `pnpm --filter @bum/api test` — 186 ta; Convex: `pnpm exec vitest run --project convex` — 10 ta

---

## PHASE 1 — Monorepo skeleti ✅

pnpm workspace; `packages/shared`; `apps/api`; `docker-compose.yml`; `.env.example`. Commitlar: `c5c082a`, `070367f`.

## PHASE 2 — PostgreSQL sxemasi ✅

61 jadval, 10 domen. Pul/miqdor `numeric`; `company_id NOT NULL`; `legacy_id` (API ga chiqmaydi); DB darajasidagi CHECK/unique. Migratsiyalar: `0000` sxema; `0001` NULLS NOT DISTINCT; `0002` bootstrap admin himoyasi; `0003` bitta asosiy filial; `0004` bitta asosiy ombor; `0005` moliya yaxlitligi (buxgalteriya yozuvi balansi — kechiktirilgan trigger, bitta asosiy kassa); `0006` xarid (qabul qatori qiymati, ta'minotchi ichida noyob to'lov reference); `0007` savdo (noyob mijoz to'lovi reference).

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

## PHASE 9 — Xarid ✅

- **Convex manbasi:** `convex/purchase/` — `suppliers.ts`, `orders.ts`; sahifa `purchase`
- **Ko'chirilgan modullar** (`modules/purchase/`):
  - `suppliers.service.ts` — ta'minotchilar (kod noyob, faqat kompaniya valyutasi, qarzi bor ta'minotchini faolsizlantirib bo'lmaydi), buyurtma statistikasi
  - `orders.service.ts` — buyurtmalar: `draft → confirmed → partial → received → paid`, `draft/confirmed → cancelled` (to'lov bo'lsa emas). Summalar butun sonlarda (miqdor × narx → chegirma → soliq → tiyin), `PO-2026-0001`. **Qabul** bitta tranzaksiyada: qabul hujjati, buyurtma qatori, zaxira (`moveStock`, asosiy birlikka konversiya), partiya (kuzatiladigan mahsulotda raqam va muddat shart), ta'minotchi qarzi, jurnal DR tovar zaxirasi / CR kreditorlar. Tannarx va qarz — qator summasidan (chegirma va soliq bilan), oxirgi qabul tiyin qoldig'ini yopadi
  - `payments.service.ts` — to'lov bitta tranzaksiyada: kassa/bank chiqimi (bank usulida bank hisobidan), jurnal DR kreditorlar / CR kassa yoki bank, buyurtmaning to'langan summasi, ta'minotchi qarzi. Ortiqcha to'lov yo'q; tovar kelmasdan to'lov — avans (qarz manfiy); `reference` bo'yicha takroriy yuborish ikkinchi to'lov yaratmaydi
  - `catalog/conversions.ts` — birlik → asosiy birlik koeffitsienti (mahsulotga xos konversiya ustun)
  - Audit: `SUPPLIER_CREATED/UPDATED`, `PURCHASE_ORDER_CREATED/UPDATED/CONFIRMED/CANCELLED`, `PURCHASE_GOODS_RECEIVED`, `SUPPLIER_PAYMENT_RECORDED`
- **Convex'dan ataylab farqlar:** yuqoridagi "Convex'da hali ochiq" jadvalidagi xarid qatorlari yopilgan; "paid" faqat to'liq qabul + to'liq to'lovda (Convex qabulsiz "paid" qilib, keyin qabulni to'sib qo'yardi); to'lov `purchase.approve` (Convex `purchase.create`)
- **Zaxira o'zgarishi:** nol tannarxli kirim (bepul tovar) ham o'rtacha tannarxni kamaytiradi (`moveStock`)
- **Testlar:** `purchase` (4 — aniq summalar, qisman/to'liq qabul, konversiya va partiya), `purchase-payments` (3 — avans, bank, idempotentlik)
- **Eslatma:** `invoiced` holati va qabulni bekor qilish (qaytarish) oqimi Convex'da ham yo'q edi — yozilmadi; ta'minotchiga qaytarish PHASE 10 dagi savdo qaytarishlari bilan birga ko'rib chiqiladi

## PHASE 10 — Savdo va POS ✅

- **Convex manbasi:** `convex/sales/` — `customers.ts`, `orders.ts`, `pos.ts`; sahifalar `sales`, `pos`
- **Ko'chirilgan modullar** (`modules/sales/`):
  - `customers.service.ts` — mijozlar (`C-0001` advisory lock bilan, faqat kompaniya valyutasi, qarzli mijozni faolsizlantirib bo'lmaydi), oxirgi buyurtma va to'lovlar
  - `orders.service.ts` — buyurtmalar `draft → confirmed → shipped → delivered → returned`, `draft/confirmed → cancelled` (to'lovsiz). Narx — prays-list (birlik konversiyasi bilan), chegirma — mijozniki; o'zgartirish `sales.edit`. Soliq mahsulotdan, `taxIncluded` bo'lsa narx ichidan. **`dispatchOrder`** (savdo va POS uchun umumiy): kredit limiti, zaxira chiqimi (`moveStock`, shu lahzadagi AVCO), tannarx qatorga yoziladi, mijoz qarzi, jurnal DR debitorlar / CR sotuv daromadi + DR tovar tannarxi / CR tovar zaxirasi. **Qaytarish** (Convex'da yo'q edi): zaxira sotuvdagi tannarxda qaytadi, teskari yozuvlar, pul qaytarish (yoki mijozga avans), ochiq smena yig'indilaridan ayriladi
  - `payments.service.ts` — mijoz to'lovi: kassa/bank kirimi, jurnal DR kassa yoki bank / CR debitorlar, buyurtma (jo'natilgan + to'liq → delivered), mijoz qarzi; ortiqcha to'lov yo'q; `reference` takrorlanmaydi
  - `pos.service.ts` — smenalar (bitta omborda bitta ochiq, kassir — sessiyadagi foydalanuvchi, yopishda kutilgan kassa va farq), chek: buyurtma + `dispatchOrder` + to'lov + smena yig'indilari bitta tranzaksiyada; qaytim faqat naqdda; mijozsiz chek to'liq to'lanadi; smenada kassirning o'zi yoki `sales.approve`
  - `shared/line-amounts.ts` — xarid, savdo va POS uchun umumiy qator hisobi (`taxIncluded` bilan)
  - `finance/cash.service.ts` `resolvePaymentAccount` — naqd → asosiy kassa; karta, bank, o'tkazma → bank hisobi (xarid to'lovlari ham)
  - Audit: `CUSTOMER_CREATED/UPDATED`, `SALES_ORDER_CREATED/UPDATED/CONFIRMED/SHIPPED/CANCELLED/RETURNED`, `CUSTOMER_PAYMENT_RECORDED`, `POS_SHIFT_OPENED/CLOSED`, `POS_SALE_COMPLETED`
- **Buxgalteriya modeli:** har sotuv (POS ham) debitorlar orqali o'tadi, har to'lov — alohida yozuv. POS chekida ikkalasi bir tranzaksiyada, natijada debitorlar nolga qaytadi
- **Convex'dan ataylab farqlar:** yuqoridagi "Convex'da hali ochiq" jadvalidagi savdo/POS qatorlari yopilgan. Diqqat — xatti-harakat o'zgarishi: `taxIncluded` mahsulotda POS endi soliqni narx ustiga qo'shmaydi (chek summasi = javondagi narx)
- **Testlar:** `sales` (3 — soliq ichida/ustiga, kredit limiti, zaxira), `sales-payments` (3 — qisman to'lov, qaytarish AVCO bilan, avans), `pos` (3 — naqd/karta, rad etishlar, smena yopish)
- **Eslatma:** zaxira rezervi (`reserved_qty`) Convex'da ham yo'q edi — tasdiqlangan buyurtma zaxirani band qilmaydi, jo'natishda tekshiriladi; qisman qaytarish va smenaga kassa kirim/chiqimi keyinroq

## PHASE 11 — CRM ✅

- **Convex manbasi:** `convex/crm/` — `leads.ts`, `activities.ts`, `salesReps.ts`, `distribution.ts`; sahifa `crm`
- **Ko'chirilgan modullar** (`modules/crm/`):
  - `sales-reps.service.ts` — agentlar (`SR-001`, `userId` kompaniya a'zosi bo'lishi shart, bog'langan agent faqat faolsizlantiriladi), statistika: shu oydagi lidlar, ochiq lidlar, yutilgan lidlar summasi, yakunlangan tashriflar va ularning savdosi
  - `leads.service.ts` — lidlar, bosqichlar (yutilganda mavjud mijozga bog'lash yoki `convertToCustomer` bilan yangi mijoz; yo'qotilganda sabab shart; qayta ochilganda sabab tozalanadi), statistika (bosqichlar bo'yicha, ochiq va yutilgan summa)
  - `activities.service.ts` — faoliyatlar (vazifa standart "planned", qolganlari "done"; mijoz/lid shu kompaniyaniki; tahrirlash)
  - `distribution.service.ts` — marshrutlar (hafta kunlari 0–6, tashriflari bor marshrut faqat faolsizlantiriladi), marshrut mijozlari (tartib, qayta tartiblash), tashriflar (`planned → in_progress → completed`, bekor qilish; yakunlangani o'zgarmaydi; tashrif qilingan mijozlar marshrutdagidan ko'p emas)
  - Audit: `SALES_REP_*`, `LEAD_CREATED/UPDATED/STAGE_CHANGED/DELETED`, `ACTIVITY_*`, `ROUTE_*`, `ROUTE_CUSTOMER_ADDED/REMOVED`, `ROUTE_CUSTOMERS_REORDERED`, `VISIT_CREATED/UPDATED`
- **Convex'dan ataylab farqlar:** yuqoridagi "Convex'da hali ochiq" jadvalidagi CRM qatorlari yopilgan; barcha o'qishlar `crm.view`; yozishlar to'xtatilgan kompaniyada 403
- **Testlar:** `crm` (3 — agentlar va statistika, lid → mijoz, marshrut va tashriflar)
- **Eslatma:** `customer_segments` jadvali sxemada bor, lekin Convex'da funksiyasi yo'q edi — API yozilmadi; tashrif ko'rsatkichlari (buyurtmalar soni, summa) hozircha qo'lda kiritiladi — savdo buyurtmasi tashrifga bog'lanmagan

## PHASE 12 — Ishlab chiqarish ✅

- **Convex manbasi:** `convex/manufacturing/` — `boms.ts`, `orders.ts`; sahifa `manufacturing`
- **Ko'chirilgan modullar** (`modules/manufacturing/`):
  - `boms.service.ts` — retseptlar va tarkibi: mahsulot o'z retseptiga tarkib bo'lmaydi, retseptlar zanjiri sikl hosil qilmaydi, birlik konversiyasi tekshiriladi, mahsulot + versiya noyob, buyurtmalari bor retsept faqat faolsizlantiriladi
  - `work-centers.service.ts` — ish markazlari (`WC-001`, soatlik narx, vaqt yozuvlari bor markaz faqat faolsizlantiriladi)
  - `orders.service.ts` — buyurtmalar `draft → confirmed → in_progress → completed`, bekor qilish (yakunlanmagan). Yaratishda materiallar retseptdan: miqdor × (reja / retsept chiqishi) × (1 + chiqindi %), taxminiy tannarx ombordagi AVCO dan (qoldiq yo'q bo'lsa xarid narxi). Vaqt yozuvlari mehnat tannarxini yangilaydi. **Yakunlash** bitta tranzaksiyada: xomashyo chiqimi (`moveStock`, haqiqiy AVCO, konversiya bilan; yetmasa xato), tayyor mahsulot kirimi (tannarx = xomashyo + mehnat → AVCO), mehnat tannarxi jurnali DR tovar zaxirasi / CR ish haqi xarajatlari
  - Audit: `BOM_*`, `BOM_ITEM_*`, `WORK_CENTER_*`, `PRODUCTION_ORDER_CREATED/STATUS_CHANGED/COMPLETED`, `PRODUCTION_TIME_ADDED/DELETED`
- **Convex'dan ataylab farqlar:** yuqoridagi "Convex'da hali ochiq" jadvalidagi ishlab chiqarish qatorlari yopilgan
- **Testlar:** `manufacturing` (3 — retsept sikli va ish markazlari, to'liq tannarx zanjiri, xomashyo yetmasligi va ruxsatlar)
- **Eslatma:** xomashyo va tayyor mahsulot bitta "Tovar zaxirasi" hisobida — ular orasida jurnal yozuvi yo'q; mehnat tannarxi "Ish haqi xarajatlari" dan zaxiraga o'tkaziladi (maosh PHASE 13 da shu hisobga yoziladi)

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
  - `purchase/order-detail-drawer.tsx`: qabulda faqat `orderItemId`, `receivedQty`, `batchNumber`, `expiryDate` yuboriladi (mahsulot/narx serverda); to'lov `POST /api/purchase/payments` (`reference` — ikki marta bosishdan himoya); `suppliers-table.tsx`: valyuta faqat kompaniyaniki
  - `pos/page.tsx`: chek summasini serverdan olish (soliq `taxIncluded` bo'yicha — frontend hozir soliqni ustiga qo'shadi), `unitPrice`/`taxRate` yubormaslik, `warehouseId` smenadan; `shift-open-dialog.tsx`: `cashierName` keraksiz; `shift-close-dialog.tsx`: kassa farqini ko'rsatish
  - `sales/create-order-dialog.tsx`: `taxRate` yubormaslik, `qty` → `quantity`; `order-detail-drawer.tsx`: qaytarish tugmasi (`/return`), to'lovda `reference`
  - `crm/leads-pipeline.tsx`: `company` → `companyName`, "yutildi"da `convertToCustomer`, "yo'qotildi"da sabab; `activities-section.tsx`: `date` → `activityDate`, `listRecent` → `GET /api/crm/activities`; `distribution-section.tsx`: `date` → `visitDate`, tashrif holati ketma-ketligi
  - `manufacturing/*`: miqdor va narxlar satr; `completeOrder` da `actualMaterials` faqat shu buyurtma materiallari; yakunlash xatosida (zaxira yetmasa) xabarni ko'rsatish

---

## Keyingi qadam

1. **PHASE 13 (HR)** — bo'limlar, lavozimlar, xodimlar, davomat, ta'tillar, maosh (tayyorlash va tasdiqlash ajratilgan, to'lov — kassa + jurnal)
2. **Production:** Convex tuzatishini (`main` `3f958f1`) production kaliti bilan deploy qilish
3. **Lokal:** `.env` ga `BOOTSTRAP_ADMIN_*` qo'shib `db:seed`
