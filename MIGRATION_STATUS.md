# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-11 |
| Umumiy holat | 16 / 16 PHASE — kod tayyor; qolgan: brauzerda qo'lda sinov, production deploy va ma'lumot importi |
| Ishlab turgan ilova | Yangi versiya Railway'da ishlayapti: https://bum-web-production.up.railway.app (bum-erp.uz DNS o'zgarishini kutmoqda). Eski Convex versiyasi `main` da |

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
| 4 | Auth va sessiyalar | ✅ tugallandi (SMS tiklash, davriy tozalash) |
| 5 | Platforma: kompaniya, filial, rol, admin | ✅ tugallandi |
| 6 | Katalog | ✅ tugallandi |
| 7 | Ombor | ✅ tugallandi |
| 8 | Moliya | ✅ tugallandi |
| 9 | Xarid | ✅ tugallandi |
| 10 | Savdo va POS | ✅ tugallandi |
| 11 | CRM | ✅ tugallandi |
| 12 | Ishlab chiqarish | ✅ tugallandi |
| 13 | HR | ✅ tugallandi |
| 14 | Dashboard, hisobot, AI, bildirishnoma, fayl | ✅ tugallandi (takliflar — qaror bo'yicha yozilmadi) |
| 15 | Ma'lumotni Convex'dan ko'chirish | ✅ tugallandi (vosita; haqiqiy import production eksportini kutadi) |
| 16 | Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish | ✅ tugallandi (kod va deploy fayllari; production deploy va import foydalanuvchi kalitini kutadi) |

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
| `hr/employees.ts` `listEmployees`, `getEmployee` | Pasport, INN, bank hisobi ruxsatsiz hamma a'zolarga qaytariladi |
| `hr/salary.ts` `updateSalaryPayment` | `hr.manage` bilan holatni "approved"/"paid" qilish — tasdiqlash ruxsati chetlab o'tiladi; tasdiqlangan/to'langan maosh tahrirlanadi |
| `hr/salary.ts` `approveSalaryPayment`, `markSalaryPaid` | Tayyorlagan o'zi tasdiqlaydi; holat tekshirilmaydi; to'lov kassaga va jurnalga yozilmaydi |
| `hr/salary.ts` `generateMonthlySalary` | Davomati yo'q xodimga to'liq oy (butun oy kelmagan bo'lsa ham); soatlik/kunlik stavka e'tiborsiz; parallel dublikat |
| `hr/salary.ts` `updateLeaveStatus`, `createLeave` | `approvedBy` mijozdan; rad etilgan tasdiqlanadi; ta'tillar ustma-ust; kunlar tekshirilmaydi |
| `hr/employees.ts` `createEmployee`, `updateEmployee`, `deleteEmployee`; `createDepartment` | Boshqa kompaniya bo'lim/lavozim/rahbari; o'ziga rahbar; tarixi bor xodim o'chiriladi; kod takrorlanadi |
| `dashboard.getKPIs`, `analytics/reports.ts` | Ruxsat tekshirilmaydi — kassir foyda, kassa va qarzlarni ko'radi; oxirgi 200–500 yozuvdan hisoblanadi (katta kompaniyada noto'g'ri); jo'natilmagan buyurtmalar tushumga qo'shiladi |
| `notifications.create` | Istalgan a'zo butun kompaniyaga istalgan (tashqi) havola bilan bildirishnoma yuboradi |
| `notifications.markRead`, `remove`, `clearRead` | Global bildirishnomani bir xodim o'qisa/o'chirsa — hammada o'qilgan/o'chirilgan |
| `notifications.triggerSmartAlerts` | Istalgan foydalanuvchi cheksiz ishga tushiradi |
| `analytics/ai.ts` `askAssistant` | Faqat autentifikatsiya — kassir foyda va maosh fondini so'rab oladi; so'rovlar soni va tarix uzunligi cheklanmagan (API kaliti hisobidan xarajat) |

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
| POST | `/api/auth/password-reset/request` (`phone`), `/api/auth/password-reset/confirm` (`phone`, `code`, `newPassword`) — Eskiz sozlanmagan bo'lsa 503 | — | — (yangi) |
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
| GET | `/sales-reps` — lidga agent tanlash uchun (faqat faollar: id, nom, kod) | `salesReps.list` |
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

### HR (`/api/hr`)

O'qish — `hr.view` (pasport, INN, bank hisobi — faqat `hr.manage`).

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET / POST / PATCH / DELETE | `/departments`, `/positions` (`?departmentId=`) | `hr.view` / `hr.manage` | `*Department`, `*Position` |
| GET / POST / PATCH / DELETE | `/employees` (`?departmentId=&status=&search=`), `/employees/stats`, `/employees/:employeeId` | `hr.view` / `hr.manage` | `listEmployees`, `getStats`, `getEmployee`, `createEmployee`, `updateEmployee`, `deleteEmployee` |
| GET | `/attendance` (`?employeeId=&month=&date=`), `/attendance/stats?month=` | `hr.view` | `listAttendance`, `getMonthlyStats` |
| PUT | `/attendance`, `/attendance/bulk` | `hr.attendance` | `recordAttendance`, `bulkRecordAttendance` |
| GET / POST / DELETE | `/leaves` (`?employeeId=&status=`), `/leaves/:leaveId` | `hr.view` / `hr.manage` | `listLeaves`, `createLeave` |
| POST | `/leaves/:leaveId/decision` | `hr.approve` | `updateLeaveStatus` |
| GET | `/salaries` (`?month=&employeeId=&status=`), `/salaries/summary?month=` | `hr.view` | `listSalaryPayments`, `getMonthSummary` |
| POST / PATCH / DELETE | `/salaries/generate`, `/salaries/:salaryId` (faqat qoralama) | `hr.salary` | `generateMonthlySalary`, `updateSalaryPayment` |
| POST | `/salaries/:salaryId/approve`, `/revert`, `/pay` (kassa + jurnal) | `hr.approve` (tayyorlagan o'zi emas) | `approveSalaryPayment`, `markSalaryPaid` |

### Analitika (`/api/analytics`)

Hammasi `analytics.view`; `days` — 1…366 (standart 30).

| Metod | Yo'l | Convex |
|---|---|---|
| GET | `/dashboard` | `dashboard.getKPIs` |
| GET | `/reports/sales`, `/reports/expenses`, `/reports/purchases`, `/reports/overview` (`?days=`) | `getSalesSummary`, `getExpenseSummary`, `getPurchaseSummary`, `getBIOverview` |
| GET | `/reports/stock`, `/reports/stock-velocity` (`?days=`), `/reports/top-customers` (`?days=&limit=`) | `getStockSummary`, `getStockVelocity`, `getTopCustomers` |

### Bildirishnomalar (`/api/notifications`)

Kompaniyaning faol a'zosi; yuborish — `company.manage`.

| Metod | Yo'l | Convex |
|---|---|---|
| GET | `/` (`?unreadOnly=&limit=`), `/unread-count` | `list`, `unreadCount` |
| POST / DELETE | `/:notificationId/read`, `/read-all`, `/clear-read`, `/:notificationId` (o'zidan yopish) | `markRead`, `markAllRead`, `clearRead`, `remove` |
| POST | `/refresh` (aqlli ogohlantirishlar, 5 daqiqada bir) | `triggerSmartAlerts` |
| POST | `/` (havola faqat ichki yo'l) | `create` |

### AI yordamchi (`/api/ai`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/status` (`{ enabled }`) | sessiya | — |
| POST | `/assistant` (`question`, `context`, `history` ≤ 20) — soatiga 20 ta; kalit yo'q — 503; AI xizmati xatosi — 502 | `analytics.view` | `analytics.ai.askAssistant` |

### Fayllar (`/api/files`)

`kind`: `product-image` (jpeg/png/webp ≤ 5 MB; `products.edit` / `products.view`), `expense-receipt` (+ pdf ≤ 10 MB; `finance.manage` / `finance.view`), `employee-photo` (≤ 5 MB; `hr.manage` / `hr.view`). Saqlash sozlanmagan bo'lsa — 503.

| Metod | Yo'l | Nima qiladi |
|---|---|---|
| POST | `/uploads` (`kind`, `contentType`, `size`) | Kalit va imzolangan PUT URL (10 daqiqa) — brauzer faylni to'g'ridan-to'g'ri MinIO'ga yuklaydi |
| POST | `/attach` (`kind`, `key`, `targetId`) | Fayl yuklangani, hajmi va turi tekshirilib yozuvga biriktiriladi; eski fayl o'chiriladi |
| POST | `/detach` (`kind`, `targetId`) | Ajratish va faylni o'chirish |
| GET | `/url` (`?kind=&targetId=`) | Ko'rish uchun imzolangan GET URL (5 daqiqa) |

## Lokal muhit

- **PostgreSQL 18** — `docker compose up -d` (`bum-pg`, `postgres`/`bumerp`, 5432). `bumerp` — 11 ta migratsiya, ma'lumot yo'q; `bumerp_test` — testlar.
- **MinIO** — 9000/9001; `bum-erp` bucket yaratilgan (2026-09-11). Fayl endpointlari ishlashi uchun `.env` ga `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (qiymatlar `.env.example` da — lokal MinIO)
- **Migratsiya:** `pnpm --filter @bum/api db:migrate`
- **Seed:** `.env` ga `BOOTSTRAP_ADMIN_PHONE`, `BOOTSTRAP_ADMIN_PASSWORD` — `pnpm --filter @bum/api db:seed` (bootstrap admin + 14 global rol + 9 standart o'lchov birligi; idempotent)
- **API server:** `pnpm --filter @bum/api dev` → `http://localhost:3000`
- **Frontend:** `pnpm dev` → `http://localhost:5173` (`/api` Vite proxy orqali API'ga, `VITE_API_URL` bo'sh)
- **Docker (production'dagidek):** `docker build -f apps/api/Dockerfile -t bum-erp-api .`, `docker build -f Dockerfile.web -t bum-erp-web .`
- **Convex'dan import:** `pnpm --filter @bum/api db:import-convex <ochilgan-eksport-papkasi> [--dry-run] [--report fayl.json]` (PHASE 15)
- **Testlar:** API — `pnpm --filter @bum/api test` — 205 ta; frontend — `pnpm test` — 5 ta; lint — `pnpm lint`

---

## PHASE 1 — Monorepo skeleti ✅

pnpm workspace; `packages/shared`; `apps/api`; `docker-compose.yml`; `.env.example`. Commitlar: `c5c082a`, `070367f`.

## PHASE 2 — PostgreSQL sxemasi ✅

61 jadval, 10 domen. Pul/miqdor `numeric`; `company_id NOT NULL`; `legacy_id` (API ga chiqmaydi); DB darajasidagi CHECK/unique. Migratsiyalar: `0000` sxema; `0001` NULLS NOT DISTINCT; `0002` bootstrap admin himoyasi; `0003` bitta asosiy filial; `0004` bitta asosiy ombor; `0005` moliya yaxlitligi (buxgalteriya yozuvi balansi — kechiktirilgan trigger, bitta asosiy kassa); `0006` xarid (qabul qatori qiymati, ta'minotchi ichida noyob to'lov reference); `0007` savdo (noyob mijoz to'lovi reference); `0008` maosh (hisoblangan summa va soliq stavkasi); `0009` bildirishnoma o'qilganligi har foydalanuvchida.

## PHASE 3 — API poydevori ✅

DB mijozi, tranzaksiya, xatolar, logger, env, `.env` yuklash, migrate, Fastify, dual-stack `HOST=::`. Umumiy yordamchilar: `shared/decimal.ts` (numeric satr validatsiyasi), `shared/cursor.ts` (keyset sahifalash), `shared/numbering.ts` (hujjat raqamlari, advisory lock), `shared/rate-limit.ts`, `shared/audit.ts`.

## PHASE 4 — Auth va sessiyalar ✅

- **Ko'chirilgan:** `modules/auth/` — argon2id (+ Convex lucia Scrypt xeshlari), sessiya (httpOnly cookie, SHA-256, 30 kun / 12 soat), login (rate limit, audit), PIN (5 xato → 5 daqiqa, Convex `reason` kodlari), guard'lar.
- **Testlar:** `auth` (17), `pin` (14), `password` (4), `maintenance` (2 — faqat 1 kundan eski yozuvlar, lock band bo'lsa o'tkazish)
- **SMS orqali parol tiklash** — PHASE 14d da yozildi (`ESKIZ_EMAIL` / `ESKIZ_PASSWORD` bo'lsa yoqiladi)
- **Davriy tozalash** (`shared/maintenance.ts`):
  - server ishga tushganda darhol, keyin har soatda
  - 1 kundan oldin eskirgan yoki bekor qilingan sessiyalar, parol tiklash kodlari va rate limit oynalari o'chiriladi (eng uzun oyna 1 soat)
  - bir nechta API nusxasida bir vaqtda bittasi bajaradi (`pg_try_advisory_xact_lock`)

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
  - `accounts.service.ts` — hisoblar rejasi (16 ta standart hisob — PHASE 13 da "2200 Ish haqidan soliq majburiyati" qo'shildi, eski kompaniyalarga `POST /api/finance/setup`; `subtype` bo'yicha topiladi), kompaniya yaratilganda avtomatik seed (+ "Asosiy kassa", "Asosiy bank hisobi"), hisob yaratish/tahrirlash (ota hisob shu turda, siklsiz; balansli hisobni faolsizlantirib bo'lmaydi), aylanma-saldo va foyda-zarar — jurnal qatorlaridan
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

## PHASE 13 — HR ✅

- **Convex manbasi:** `convex/hr/` — `employees.ts`, `attendance.ts`, `salary.ts` (ta'tillar ham shu yerda); sahifa `hr`
- **Ko'chirilgan modullar** (`modules/hr/`):
  - `org.service.ts` — bo'limlar (kod noyob, ota bo'lim sikli yo'q, boshliq — shu kompaniya xodimi) va lavozimlar (maosh oralig'i bazada CHECK); xodimi, lavozimi yoki ichki bo'limi bor bo'lim / xodimi bor lavozim faqat faolsizlantiriladi
  - `employees.service.ts` — xodimlar (`EMP-0001`; bo'lim, lavozim (bo'limga mos), rahbar (siklsiz), foydalanuvchi (bittaga bitta) tekshiriladi; maxfiy maydonlar faqat `hr.manage` ga; tarixi bor xodim faqat ishdan bo'shatiladi)
  - `attendance.service.ts` — davomat upsert (xodim+sana noyob), ommaviy yozish (bitta begona xodim — butun so'rov rad), vaqt formati va ketma-ketligi, ishdan bo'shatilgan va qabul qilinishidan oldingi sanalar taqiqlangan, oylik statistika
  - `leaves.service.ts` — ta'tillar (kunlar sanalar oralig'idan, ustma-ust tushmaydi), qaror `pending → approved | rejected` bir marta, tasdiqlovchi — sessiyadagi foydalanuvchining xodim yozuvi
  - `salary.service.ts` — maosh hisobi butun sonlarda (oylik/kunlik/soatlik; kelgan, kechikkan, bayram — 1 kun, yarim kun — 0,5, ta'til — 1, haq to'lanmaydigan tasdiqlangan ta'til — 0; ortiqcha ish × 1,5; davomat yuritilmagan oyda to'liq norma), tahrir faqat qoralamada, **vazifalar ajratimi**: tayyorlash `hr.salary`, tasdiqlash/to'lash `hr.approve`, tayyorlagan o'zi tasdiqlay olmaydi (kompaniya egasidan tashqari). To'lov: kassa/bank chiqimi + jurnal DR ish haqi xarajatlari / CR kassa + CR ish haqidan soliq majburiyati
  - Audit: `DEPARTMENT_*`, `POSITION_*`, `EMPLOYEE_CREATED/UPDATED/TERMINATED/DELETED` (maosh va shaxsiy maydonlar qiymatsiz), `ATTENDANCE_RECORDED`, `ATTENDANCE_BULK_RECORDED`, `LEAVE_CREATED/APPROVED/REJECTED/DELETED`, `SALARY_GENERATED/UPDATED/APPROVED/REVERTED/DELETED/PAID`
- **Convex'dan ataylab farqlar:** yuqoridagi "Convex'da hali ochiq" jadvalidagi HR qatorlari yopilgan. Diqqat — xatti-harakat o'zgarishi: davomat yuritiladigan oyda davomati yo'q xodimga maosh hisoblanmaydi (Convex to'liq oy yozardi)
- **Testlar:** `hr` (2 — bog'liqliklar va maxfiylik, davomat va ta'tillar), `salary` (2 — to'liq hisob-tasdiq-to'lov zanjiri, davomatsiz kompaniya va haq to'lanmaydigan ta'til)
- **Eslatma:** ta'til tugagach xodim holati avtomatik "active" ga qaytmaydi (Convex'da ham) — HR qo'lda o'zgartiradi; soliq to'lovi (2200 dan budjetga) moliya jurnalida qo'lda

## PHASE 14 — Dashboard, hisobot, AI, bildirishnoma, fayl ✅

- **Convex manbasi:** `convex/dashboard.ts`, `convex/notifications.ts`, `convex/analytics/reports.ts`, `convex/analytics/ai.ts`; sahifalar `dashboard`, `analytics`, `settings` (bildirishnomalar)
- **14a ✅ Dashboard, hisobotlar, bildirishnomalar:**
  - `modules/analytics/dashboard.service.ts` — bosh sahifa: bugungi va oylik tushum (faqat jo'natilgan/yetkazilgan), bugun kelgan to'lovlar, tannarx va yalpi foyda, zaxira qiymati va kam qolganlar (ombor va birlik bilan), ta'minotchi/mijoz qarzi, kassa/bank, oxirgi savdo va xaridlar, 7 kunlik tushum
  - `modules/analytics/reports.service.ts` — sotuv, zaxira (ABC — mahsulotdan oldingi jamg'arma ulushi bo'yicha), xarajat (tasdiqlangan/to'langan), xarid, umumiy ko'rinish (yalpi marja), eng yaxshi mijozlar, aylanma tezligi (zaxira necha kunga yetadi). Hammasi SQL yig'indilari
  - `modules/notifications/` — global bildirishnomaning o'qilgan/yopilgan holati har foydalanuvchida (`notification_receipts`), shaxsiy bildirishnomalar, yuborish `company.manage` va faqat ichki havola, aqlli ogohlantirishlar (kam zaxira — ombor bilan, 30 kunda tugaydigan partiyalar, kechikkan xarid, to'lov muddati o'tgan savdo — buyurtma sanasi + mijoz muddati, ta'til so'rovlari, kutilayotgan xarajatlar; 6 soat ichida takrorlanmaydi; kompaniyaga 5 daqiqada bir)
  - **Testlar:** `analytics` (1 — to'liq biznes ssenariysi bo'yicha barcha ko'rsatkichlar), `notifications` (2 — har foydalanuvchi holati va izolyatsiya, aqlli ogohlantirishlar)
- **14b ✅ AI yordamchi:**
  - `modules/ai/assistant.service.ts` — tizim promptiga faqat shu kompaniyaning ko'rsatkichlari (sotuv, yalpi/sof foyda, xarajatlar, kassa va bank, qarzlar, ombor, xodimlar), Anthropic Messages API to'g'ridan-to'g'ri (`fetch`, SDK'siz), model `ANTHROPIC_MODEL` (standart `claude-sonnet-5`), foydalanuvchiga soatiga 20 ta, savol ≤ 2000, tarix ≤ 20 xabar; foydalanuvchi konteksti promptda "ko'rsatma emas, ma'lumot" deb belgilanadi
  - **Testlar:** `ai` (1 — tenant izolyatsiyasi promptda, ruxsat, validatsiya, cheklov, 502/503; tashqi API chaqirilmaydi — mijoz almashtiriladi)
- **14c ✅ Fayl saqlash (MinIO / S3):**
  - `shared/storage.ts` — AWS Signature V4 imzolangan URL'lar `node:crypto` bilan (SDK'siz): brauzer faylni saqlashga to'g'ridan-to'g'ri yuklaydi, API orqali o'tmaydi; saqlash ochiq emas — ko'rish ham imzolangan URL (5 daqiqa). Imzo AWS hujjatidagi rasmiy namuna bilan testda, haqiqiy lokal MinIO bilan qo'lda tekshirildi (to'g'ri yuklash 200; boshqa content-type va buzilgan imzo 403; HEAD, GET, DELETE)
  - `modules/files/` — mahsulot rasmi (`image_key`), xarajat cheki (`attachment_key`), xodim surati (`photo_key`): yuklash → biriktirish (kalit shu kompaniya va turga tegishli, fayl haqiqatan yuklangan, hajm va MIME tur saqlashdagi haqiqiy qiymat bo'yicha) → almashtirishda eski fayl o'chadi; har amal auditda (`FILE_ATTACHED`, `FILE_DETACHED`)
  - Convex'dagi `imageUrl` (foydalanuvchi kiritgan tashqi URL — saqlangan XSS va kuzatuv yo'li) o'rniga faqat o'z saqlashimizdagi kalit
  - **Testlar:** `files` (3 — SigV4 rasmiy namuna, to'liq oqim va barcha rad etishlar, PDF chek va 503)
- **14d ✅ SMS orqali parol tiklash (Eskiz):**
  - `shared/sms.ts` — Eskiz mijozi (kirish, yuborish, token eskirsa bir marta qayta kirish); kalit bo'lmasa o'chiq
  - `modules/auth/password-reset.service.ts` — 6 xonali kod (`crypto.randomInt`), bazada faqat SHA-256, 10 daqiqa, bir martalik (parallel ishlatishdan himoya), yangi so'rov oldingilarini bekor qiladi, 5 xatodan keyin kod yonadi; javob raqam ro'yxatdan o'tgan-o'tmaganidan qat'i nazar bir xil (SMS xatosida ham); bloklangan va bootstrap admin hisoblariga kod yuborilmaydi; so'rov raqamga 15 daqiqada 3 ta, IP dan soatiga 10 ta; tasdiqlashda barcha sessiyalar bekor qilinadi; audit `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`
  - **Testlar:** `password-reset` (3 — to'liq oqim va sessiyalar, oshkor qilmaslik va barcha himoyalar, Eskiz mijozi token yangilash)
- **Ataylab yozilmagan:** takliflar (`invitations`) — yakuniy qaror bo'yicha kerak emas (login/parol to'g'ridan-to'g'ri beriladi); jadval sxemada qoladi

## PHASE 15 — Ma'lumotni Convex'dan ko'chirish ✅

Vosita tayyor va sinovdan o'tgan; **haqiqiy ma'lumot hali ko'chirilmagan** — production eksporti kerak (Convex production kaliti).

- **Ishga tushirish:**
  1. Convex loyihasida `npx convex export --path convex-export.zip`
  2. ZIP'ni ochish (`<jadval>/documents.jsonl`)
  3. `pnpm --filter @bum/api db:import-convex convex-export --dry-run` — hisobotni ko'rib chiqish
  4. xuddi shu buyruq `--dry-run` siz
- **Fayllar:** `src/migration/convex-import.ts` (jadval tartibi va qoidalar), `src/migration/convert.ts` (float → aniq o'nlik, sana, telefon, ichki havola), `src/cli/import-convex.ts`
- **Migratsiya 0010:** 53 jadvalga `legacy_id` noyob indeksi (upsert uchun; qolgan 5 tasida sxemada bor edi)
- **Qoidalar:**
  - bitta tranzaksiya — xato bo'lsa hech narsa yozilmaydi; `--dry-run` hammasini bajarib bekor qiladi (hisobot bir xil, balans triggeri ham tekshiriladi)
  - qayta ishga tushirsa bo'ladi: `legacy_id` bo'yicha upsert, ID xaritasi bazadan ham yuklanadi; har yozuv savepoint'da — cheklov buzilishi hisobotga yoziladi, import to'xtamaydi
  - kompaniyasiz yoki bog'liq yozuvi yo'q yozuvlar o'tkazib yuboriladi (sababi bilan)
  - takrorlangan kod/raqam/SKU → "-2" qo'shimchasi; ikkinchi asosiy filial/ombor/kassa va ombordagi ikkinchi ochiq smena olib tashlanadi; takrorlangan qoldiq, davomat, maosh oyi, a'zolik o'tkaziladi
  - pul 2, miqdor/narx 4 kasr xonaga yarimdan yuqoriga yaxlitlanadi; manfiy qoldiq/narx 0 qilinadi (ogohlantirish)
  - buxgalteriya yozuvi qatorlari bilan birga yoziladi, jami qatorlardan qayta hisoblanadi; ±1 so'mdan ko'p balanslanmagan "posted" yozuv qoralama bo'ladi, haqiqiy summalar izohga yoziladi (sarlavha CHECK'i ±1 talab qiladi)
  - bitta hujjatga ikkinchi buxgalteriya yozuvi — hujjat bog'lanishi olinadi (`reference` noyobligi)
  - maosh: Convex hisoblangan summani saqlamagan — `gross = net + tax + deductions`, `tax_rate` shundan
  - rollar: kompaniyada shu nomli rol bo'lsa unga bog'lanadi (ustidan yozilmaydi); eski ruxsat nomlari `LEGACY_PERMISSION_ALIASES` bo'yicha, noma'lumlari tashlanadi; a'zo roli nomlari yangi nomlarga ("owner" → "Business Owner")
  - Convex'dagi `users.roleId` (global rol) ko'chirilmaydi — rol a'zolikda
  - import qilingan kompaniyalarga yetishmayotgan standart hisoblar va kassa qo'shiladi (`seedFinanceDefaults`)
- **Foydalanuvchilar:**
  - lucia scrypt parol xeshlari ko'chiriladi — eski parol bilan kirish ishlaydi, birinchi kirishda argon2id ga o'tadi
  - qayta importda yangi tizimda o'zgargan parol ustidan yozilmaydi
  - parolsiz foydalanuvchi — SMS orqali tiklash yoki admin o'rnatadi
  - PIN (SHA-256) ko'chirilmaydi — qayta o'rnatiladi
  - bootstrap admin maqomi import qilinmaydi
- **Ko'chirilmaydi:**
  - tashqi URL'lar (mahsulot rasmi, logo, avatar, chek, xodim surati) — saqlangan XSS yo'li; fayllar PHASE 14 oqimi bilan qayta yuklanadi
  - bildirishnomadagi tashqi havolalar
  - takliflar, global (kompaniyasiz) birlik konversiyalari
  - `costingMethod` hammasi `average` ga
- **Hisobot:** har jadval uchun o'qildi / yozildi / o'tkazildi va sabablari / ogohlantirishlar. Solishtirish: kompaniya va foydalanuvchi soni, ombor qiymati, mijoz va ta'minotchi qarzi, kassa qoldig'i, posted yozuvlar soni va umumiy debet−kredit farqi. JSON faylga yoziladi.
- **Testlar:** `import-convex` (2):
  - scrypt parol bilan kirish va argon2id ga o'tish, havolalar, yaxlitlash, dublikat kod/asosiy belgi, yetim yozuvlar, tashqi URL'lar, balanslanmagan yozuv, hisoblar rejasini to'ldirish, solishtirish
  - quruq ishga tushirish hech narsa yozmasligi, qayta import dublikatsizligi va o'zgargan parolni saqlashi

## PHASE 16 — Frontend'ni API'ga o'tkazish, deploy, Convex'ni o'chirish ✅

Kod tomoni tugadi. Brauzerda qo'lda sinov, production deploy va ma'lumot importi hali qilinmagan (quyida "Keyingi qadam").

- **Poydevor** (`src/lib`, `src/hooks`):
  - `api.ts` — cookie sessiyali fetch, `ApiError { status, code, message }`; himoyalangan so'rov 401 qaytarsa login sahifasiga
  - `query.ts` — `useApiQuery(path | null, params)`, `useApiMutation(fn, { invalidate })`: muvaffaqiyatli mutatsiyadan keyin ko'rinib turgan so'rovlar qayta olinadi (Convex reaktivligi o'rniga)
  - `use-auth.ts` (`/api/auth/*`, kirish/chiqishda boshqa foydalanuvchi keshi tozalanadi), `use-company.ts` (kompaniyalar, almashtirish — kesh to'liq qayta o'rnatiladi, `can()` ruxsatlar), `auth-gates.tsx`
  - bildirishnomalar har daqiqada va oyna fokusida yangilanadi; qulf ekrani `/api/auth/pin/verify`
  - kirish sahifasida SMS orqali parol tiklash
- **Sahifalar:** hammasi API'da — mahsulot, ombor, xarid, savdo, POS, moliya, HR, CRM, ishlab chiqarish, dashboard, tahlil va AI, sozlamalar, admin panel, onboarding, tenant portal. Har modulda `_lib/types.ts` — javob turlari
- **Yakuniy qarorlar bo'yicha olib tashlandi:** takliflar bo'limi; `admin/bootstrap.tsx` (bootstrap admin faqat `.env` + `db:seed`); standart rol, birlik va hisob "seed" tugmalari; platforma adminining alohida foydalanuvchi yaratishi (ega kompaniya bilan birga ochiladi, xodimlarni ega qo'shadi)
- **Asosiy xatti-harakat o'zgarishlari:**
  - pul va miqdor — satr, hisob-kitob serverda; POS va savdoning oldindan ko'rish summasi serverdagi `computeLine` nusxasi bilan tiyinigacha bir xil
  - tugmalar ruxsatlar bo'yicha yashiriladi (asosiy himoya serverda)
  - mahsulot rasmi — fayl yuklash oqimi (imzolangan URL); CSV import/eksport serverda
  - ombor: `adjust` — ishorali farq; qo'lda harakat va o'tkazma boshqa o'lchov birligida (konversiya bilan) va o'tgan sana bilan
  - to'lovlarda `reference` — ikki marta bosishdan himoya
  - sanalar foydalanuvchining mahalliy kuni bo'yicha (UTC emas)
- **PHASE 16 davomidagi API qo'shimchalari:**
  - `/me` — amaldagi kompaniya holati va sababi (to'xtatilgan yoki sinovi tugagan kompaniyada tenant so'rovlari 403, ekran `/me` dan)
  - `/company/mine` — valyuta va sinov muddati
  - ombor harakati va o'tkazmada `unitId`, o'tkazmada `occurredAt`
  - importer marshrut kunlarini to'g'rilaydi (Convex UI'da 0 = dushanba, API'da 0 = yakshanba)
- **Convex olib tashlandi:** `convex/`, `convex.json`, provider, `convex` / `@convex-dev/*` / `@auth/core` / `@anthropic-ai/sdk` / `bcryptjs` / `convex-test` / `@edge-runtime/vm` paketlari, ESLint plagini, `@/convex` aliaslari. Production Convex `main` branch'da qoladi — eksport va RBAC deploy o'sha yerdan
- **Deploy fayllari:**
  - `apps/api/Dockerfile` — workspace tuzilishi saqlanadi (`@bum/shared` build'siz, Node ≥ 22.18 type stripping). Migratsiya: `node dist/db/migrate.js`. Lokal tekshirildi: image build, `/health`, 401/200 javoblar, konteyner ichida migratsiya
  - `Dockerfile.web` + `deploy/nginx/default.conf.template` — SPA; `/api` shu domenda proksi (`API_UPSTREAM`), Railway `PORT`. Cookie va CORS app.* va admin.* da bir xil ishlaydi
  - API build tuzatildi: TS 6 `rootDir`; `@bum/shared` ichida `.ts` importlari; `AppError` parametr-xossalarisiz
- **Ma'lum cheklovlar (keyingi yaxshilashlar):**
  - 200 ta chegarasi: mahsulot tanlagichlari, xarid statistikasi (oxirgi 200 buyurtma bo'yicha); ABC tahlili — top 50
  - `warehouse.view` ruxsati yo'q kassir POS'da qoldiqni ko'rmaydi (server baribir tekshiradi) — POS uchun alohida qoldiq endpointi kerak
  - ombor qoldiq ro'yxatida mahsulot rasmi yo'q; xodimlar ro'yxatida server qidiruvi yo'q
  - kirgan foydalanuvchi ikkinchi kompaniyani o'zi ocha olmaydi (platforma admini ochadi)
  - `trustProxy: true` — API faqat proksi ortida ochiq bo'lishi kerak (aks holda `X-Forwarded-For` bilan IP limitini aylanib o'tish mumkin)
- **Sahifama-sahifa talablar (bajarildi):**
  - `admin/bootstrap.tsx` keraksiz (`db:seed`); `onboarding` → `/api/registration` (yoqilgan bo'lsa)
  - `users-section.tsx` → `PATCH /api/company/employees/:userId`; `roles-section.tsx` `seedDefaultRoles` tugmasi keraksiz
  - `products/product-form-dialog.tsx`: standart `costingMethod: "fifo"` → `"average"` bo'lishi kerak; `imageUrl` maydoni olib tashlanadi (PHASE 14 gacha); `products/page.tsx` `seedDefaultUnits` chaqiruvi keraksiz; CSV import → `POST /api/catalog/products/import`, export → `GET /api/catalog/products/export`
  - `finance/page.tsx`: `seedDefaultAccounts` chaqiruvi keraksiz; `expenses-section.tsx`: "To'landi" tugmasi faqat tasdiqlangan xarajatda (va kassa tanlash), `byCategory` endi massiv; `cash-accounts-section.tsx`: summalar satr; `profit-loss-section.tsx` → `GET /api/finance/reports/profit-loss`
  - `purchase/order-detail-drawer.tsx`: qabulda faqat `orderItemId`, `receivedQty`, `batchNumber`, `expiryDate` yuboriladi (mahsulot/narx serverda); to'lov `POST /api/purchase/payments` (`reference` — ikki marta bosishdan himoya); `suppliers-table.tsx`: valyuta faqat kompaniyaniki
  - `pos/page.tsx`: chek summasini serverdan olish (soliq `taxIncluded` bo'yicha — frontend hozir soliqni ustiga qo'shadi), `unitPrice`/`taxRate` yubormaslik, `warehouseId` smenadan; `shift-open-dialog.tsx`: `cashierName` keraksiz; `shift-close-dialog.tsx`: kassa farqini ko'rsatish
  - `sales/create-order-dialog.tsx`: `taxRate` yubormaslik, `qty` → `quantity`; `order-detail-drawer.tsx`: qaytarish tugmasi (`/return`), to'lovda `reference`
  - `crm/leads-pipeline.tsx`: `company` → `companyName`, "yutildi"da `convertToCustomer`, "yo'qotildi"da sabab; `activities-section.tsx`: `date` → `activityDate`, `listRecent` → `GET /api/crm/activities`; `distribution-section.tsx`: `date` → `visitDate`, tashrif holati ketma-ketligi
  - `manufacturing/*`: miqdor va narxlar satr; `completeOrder` da `actualMaterials` faqat shu buyurtma materiallari; yakunlash xatosida (zaxira yetmasa) xabarni ko'rsatish
  - `hr/*`: `date` → `attendanceDate`; maosh holatini PATCH bilan emas, `/approve` va `/pay` bilan; tayyorlagan foydalanuvchiga "Tasdiqlash" tugmasini yashirish; xodim ro'yxatida maxfiy maydonlar faqat `hr.manage` bo'lsa
  - `dashboard/page.tsx`: `todayRevenue` → `todayReceipts`, `weeklyRevenue[].day` yo'q (sanadan frontendda); `analytics.view` bo'lmasa bosh sahifada moliyaviy kartochkalarni yashirish
  - `hooks/use-notifications.ts`: `/api/notifications` ga; havolalar tilsiz (`/warehouse`) — frontend `/uz` qo'shadi; `triggerSmartAlerts` → `POST /refresh` (javobda `throttled`)
  - `analytics/ai-assistant-section.tsx`: `POST /api/ai/assistant`; `GET /api/ai/status` bo'yicha bo'limni yashirish; 429/502/503 xabarlarini ko'rsatish
  - Rasm/chek yuklash: `POST /api/files/uploads` → `PUT uploadUrl` (aynan `headers` bilan) → `POST /api/files/attach`; ko'rsatish `GET /api/files/url` (5 daqiqada eskiradi — sahifa ochilganda olinadi); `product-form-dialog.tsx` dagi `imageUrl` maydoni shu oqim bilan almashtiriladi
  - Kirish sahifasiga "Parolni unutdingizmi?" — `POST /api/auth/password-reset/request` → kod va yangi parol → `/confirm` → oddiy kirish (Convex'da bunday sahifa yo'q edi)

## Production'dan keyingi o'zgarishlar (2026-09-11)

Foydalanuvchi talabi bilan, production'da (app.bum-erp.uz) sinov davomida:

- **Kirish sahifalari:** parolni ko'rsatish/yashirish tugmasi; admin havolasi `/uz/admin` ga
- **Avtomatik qulf ekrani olib tashlandi** (30 soniya faolsizlikda bloklardi); xavfsizlik bo'limida faqat parolni almashtirish qoldi
- **Xodimni tahrirlash:** egasi ism, telefon (login — o'zgarsa sessiyalar yopiladi), rol, filial, omborlarni o'zgartiradi; boshqa kompaniyaga ham a'zo xodimning hisob ma'lumotini faqat platforma admini o'zgartiradi. Jadvaldagi rol tanlagichi ochilmaslik xatosi tuzatildi
- **Mas'ul kategoriyalar** (`company_members.allowed_category_ids`, migratsiya 0011, `catalog/category-scope.ts`):
  - bo'sh = barcha kategoriyalar; tanlangan kategoriyaning ichki kategoriyalari ham kiradi; egalik rollari cheklovsiz
  - cheklangan xodim katalog, ombor (qoldiq, harakatlar, inventarizatsiya), xarid va savdoda (POS bilan) faqat o'z kategoriyalaridagi mahsulotlarni ko'radi va ular bilan ishlaydi; kategoriyasiz mahsulot unga ko'rinmaydi
  - amal turi (ko'rish / qo'shish / o'zgartirish) rol ruxsatlari bilan; hujjat ro'yxatida faqat uning mahsuloti qatnashgan buyurtmalar, hujjatdagi boshqa kategoriya qatori bo'lsa tasdiqlash/jo'natish/qabul rad etiladi
  - analitika, dashboard va bildirishnomalar cheklanmaydi (`analytics.view` bilan boshqariladi)
- **Xariddan tezkor qo'shish** (commit `2c78a88`): xarid buyurtmasi oynasida yetkazuvchi va mahsulot ro'yxati oxirida "Yangi … qo'shish"; yetkazuvchi kodi ixtiyoriy (avtomatik `S-0001`), mahsulot SKU ixtiyoriy — kompaniya bo'yicha eng katta raqamli SKU + 1, 1001 dan (advisory lock; importda ham)
- **POS mijozlari va balans** (commit `20f1238`, migratsiya 0012):
  - kassada mijoz tanlash (F4) — telefon raqamlari formatidan qat'i nazar, ism yoki familiya bo'yicha; `POST /api/sales/pos/customers` (`pos.use`, telefon takrori rad)
  - qarzga sotuv, tanlangan mijozning qarzi va balansi ko'rinib turadi
  - mijoz balansi (hamyon, `customers.balance` + `customer_balance_transactions`) — qarz va keshbekdan alohida: kassada to'ldirish, qarzni naqd/karta/bank yoki balansdan to'lash (`POST /api/sales/pos/customers/:id/payments`), chekni balansdan to'lash, naqd qaytimni balansga o'tkazish; qaytarishda balansdan to'langan qism balansga qaytadi
  - buxgalteriya: yangi hisob 2300 "Mijozlar avanslari" (migratsiya mavjud kompaniyalarga ham qo'shadi); kirim DR kassa / CR 2300, sarf DR 2300 / CR 1100; `payment_method` ga `balance`
- **Chek shabloni** (commit `3e03b23`): Sozlamalar → "Chek" — qog'oz 58/80 mm, shrift, logo (data URL, termal uchun kichraytiriladi), sarlavha va pastki matn, kassir/SKU/QQS, mijoz qarzi/balansi/keshbek, avtomatik chop etish; jonli ko'rinish. `GET /api/company/print-settings` (har bir a'zo), `PUT /api/company/print-settings/receipt` (`settings.manage`). POS cheki shu shablon bo'yicha HTML orqali chop etiladi
- **Etiketkalar:** Sozlamalar → "Etiketka" — shablonlar (tayyor 58×40, 40×30, 30×20, A4 70×37; o'z o'lchami 15–150 mm), termal rulon yoki A4 ustunlar, shtrix-kod (CODE128) / QR / kodsiz, ko'rsatiladigan maydonlar, standart shablon; `PUT /api/company/print-settings/labels` (`settings.manage`). Chop etish oynasi — mahsulotlar sahifasidan (bir nechta mahsulot, nusxa soni) va xarid buyurtmasidan (qabul qilingan miqdor bilan)
- **Etiketkalar** commit `45cb213`
- **Keshbek tizimi** (migratsiya 0013):
  - Sozlamalar → "Keshbek": yoqish/o'chirish; keshbek faqat pul bilan to'langan qismiga yoki butun chekka; keshbek bilan to'lash chegarasi (chekning %, 100 — cheklovsiz); chek summasi pog'onalari; kategoriya foizlari (pog'onadan ustun, ichki kategoriyalarga ham). `GET/PUT /api/sales/cashback/settings`
  - mijoz keshbek hisobi pul balansidan alohida (`customers.cashback_balance` + `customer_cashback_transactions`); POS'da mijoz kartasida ko'rinadi, "Keshbekdan" to'lanadi, chekda berilgan keshbek va qoldiq
  - qaytarishda ishlatilgan keshbek qaytadi, berilgani bekor qilinadi (sarflangan bo'lsa — qolgani miqdorida)
  - buxgalteriya: 2400 "Keshbek majburiyati", 5600 "Keshbek xarajatlari"; hisoblash DR 5600 / CR 2400, ishlatish DR 2400 / CR 1100
  - hozircha faqat POS cheklarida (oddiy savdo buyurtmalarida keshbek hisoblanmaydi)
- **Keshbek** commit `fe8ae98`
- **Ko'p valyuta — 1-qism: valyutalar va kurslar** (migratsiya 0014):
  - Sozlamalar → "Valyutalar": asosiy valyuta (kompaniya valyutasi, kursi 1) + 10 tagacha qo'shimcha valyuta; kurs qo'lda yoki Markaziy bankdan
  - Markaziy bank (cbu.uz) kurslari yoqib-o'chiriladi: yoqilganda bank kursi yonma-yon ko'rinadi ("Qo'llash"), manbasi "Markaziy bank" valyuta kursi har kuni birinchi o'qishda yangilanadi, "Hozir yangilash" tugmasi; bank ishlamasa eski kurs qoladi
  - `company_currencies`, kurs tarixi `exchange_rates`; `GET /api/finance/currencies` (har bir a'zo), `GET /currencies/cbu` (503 — bank javob bermasa), `PUT /currencies` va `POST /currencies/refresh` (`settings.manage`); olib tashlangan valyuta nofaol bo'ladi
  - env: `CBU_RATES_URL` (standart cbu.uz JSON)
- **Ko'p valyuta — 2-qism: mahsulot narxi valyutada** (commit `8408b36` — 1-qism; migratsiya 0015):
  - mahsulotda xarid va sotuv narxi valyutasi (`purchase_currency`, `sales_currency`; null — asosiy valyuta); faqat asosiy yoki yoqilgan valyuta
  - savdo buyurtmasi va POS'da narxi boshqa valyutada belgilangan mahsulot joriy kurs bilan asosiy valyutada sotiladi; valyuta o'chirilsa sotib bo'lmaydi
  - mahsulot formasida narx yonida valyuta, so'mdagi taxminiy qiymat va marja; ro'yxat, tafsilot, POS kartochkasi, savdo/xarid oynasi, ombor kirimi, etiketka — kurs bilan
- **Ko'p valyuta — 3-qism: xarid valyutada** (commit `e4dd300` — 2-qism; migratsiya 0016):
  - xarid oynasida yuqorida valyutalar tanlanadi, har qatorda valyuta, xarid narxi va (ixtiyoriy) sotuv narxi — qabulda mahsulotga yoziladi; jami valyuta bo'yicha
  - buyurtma jami va to'langani valyuta bo'yicha (`purchase_order_currencies`); `total_amount` asosiy valyutada (buyurtma kursi)
  - qabulda tannarx va jurnal asosiy valyutada qabul kunidagi kurs bilan; ta'minotchi qarzi o'z valyutasida (`supplier_balances`: qarz + so'mdagi kitob qiymati)
  - to'lov valyutada shu valyutadagi kassa/bankdan; kreditorlar kitob qiymati ulushida, kassa to'lov kursida, farqi — 4200 "Kurs farqi daromadi" / 5700 "Kurs farqi xarajati"
  - valyutali kassa/bank hisoblari (asosiy kassa bo'la olmaydi); kassa amali valyutasi tekshiriladi; dashboard jami asosiy valyutada
- **POS sotuv valyutalari (migratsiya 0017):** kassada sotuv valyutalari tanlanadi
  - bitta valyuta — hamma narx joriy kurs bilan shu valyutada; bir nechta — mahsulot o'z narx valyutasida (tanlanmagan bo'lsa birinchi valyutada)
  - `sales_order_items`: `price_currency`, `price_rate`, `currency_total`; buxgalteriya (`line_total`, jurnal) asosiy valyutada
  - chet valyuta qismi naqd, shu valyutadagi kassaga (`customer_payments.foreign_amount`), qaytim o'sha valyutada; mijozga qisman to'lovda qarz asosiy valyutada
  - balans va keshbek faqat asosiy valyutadagi qismga; qaytarishda valyutadagi to'lov o'z kassasidan qaytadi
  - chek (ekran va termal shablon): qator o'z valyutasida, oxirida har valyuta bo'yicha jami, to'langan va qaytim
  - dastlabki cheklovlar (smena yig'indisi, karta, balans/keshbek faqat asosiy qismga, PDF) — L1 da bartaraf etildi
- **POS sotuv valyutalari** commit `4b9249f`
- **L1 — POS valyuta cheklovlari bartaraf etildi** (migratsiya 0019):
  - smena valyuta bo'yicha: boshlang'ich naqd, naqd va karta tushumi (`pos_shifts.opening_foreign_cash`, `foreign_cash`, `foreign_card`); yopishda har valyuta sanaladi va farqi chiqadi (`closing_foreign_cash`); qaytarishda ochiq smenadan ayriladi
  - chet valyuta qismini karta bilan to'lash — shu valyutadagi bank hisobiga (qoldiqdan oshmaydi)
  - balans va keshbek butun chekka: avval asosiy valyutadagi qismga, qolgani chet valyuta qismlariga asosiy qiymatda; javobda `covered`
  - PDF chek: valyutadagi qatorlar, valyuta bo'yicha jami/to'langan/qaytim, balans va keshbek, qaytim balansga, qarz
- **L1** commit `39f6192`
- **L2 — oddiy savdo buyurtmalari:**
  - buyurtma yaratishda sotuv valyutalari (`saleCurrencies`, POS bilan bir xil qoida, kurs buyurtmada qoladi); buyurtmada valyuta bo'yicha jami va to'langan — asosiy valyutadagi to'lov avval asosiy qismni, ortig'i chet valyuta qismlarini yopadi (`orderCurrencyBuckets`)
  - `POST /api/sales/payments`: `currency` bilan to'lov shu valyutadagi kassa/bankka — buyurtmadagi valyuta qismi buyurtma kursida (qoldiqdan oshmaydi), boshqasi joriy kurs bilan; `method: balance | cashback` — mijoz balansidan va keshbekdan (keshbek sozlamadagi buyurtma ulushi chegarasida)
  - keshbek oddiy buyurtmalarda ham: sozlama "total" — jo'natilganda, "paid" — jo'natilgan va to'liq to'langanda (keshbek bilan to'langani asosdan chiqadi), bir marta; buyurtmada `cashbackEarned`; qaytarishda bekor bo'ladi
  - web: buyurtma oynasida sotuv valyutalari, qator va jami valyutada; buyurtma tafsilotida valyuta bo'yicha jami/to'langan, to'lovda valyuta va "Balansdan"/"Keshbekdan"
- **L2** commit `0494db5`
- **L3 — buxgalteriya va audit bo'shliqlari:**
  - ombordagi qo'lda harakatlar jurnalga tannarxda yoziladi (`postStockJournal`): qabul — DR 1200 / CR 3000 Ustav kapitali (boshlang'ich qoldiq), chiqim va hisobdan chiqarish — DR 5500 / CR 1200, tuzatish (+) — CR 4100; `counterAccountId` bilan qarshi hisob tanlanadi (masalan, 2000 Kreditorlar; begona va zaxira hisobi rad). Harakat oynasida qarshi hisob tanlash (moliya ruxsati bo'lsa)
  - inventarizatsiya qo'llanganda ortiqcha — 4100, kamomad — 5500 (bitta jurnal yozuvi)
  - moliya dashboardi: oylik tushum/chiqim valyutali kassalardan joriy kurs bilan asosiy valyutada
  - tizimdan chiqish (`logout`) audit jurnaliga yoziladi (kirish va xato urinish avval ham yozilardi)
- **Testlar:** `category-scope` (3), avtomatik SKU, `customer-balance` (3), `print-settings` (2), `cashback` (2), `currencies` (2), `product-currency` (1), `purchase-currency` (2), `pos-currency` (3), `sales-currency` (2), `distribution` (4), `inventory-journal` (1), `sales-agent` (3), `sales-agent-stores` (2), `sales-agent-location` (3 — sifat va shubhali nuqtalar, supervayzer ruxsatlari va kompaniya chegarasi, siyosat va saqlash muddati), `sales-agent-visits` (2 — geofence/sifat/ochiq tashrif/sabab, rasmlar va supervayzer ro'yxati); API jami 239 (51 fayl)

## Sotuv agenti loyihasi (2026-09-12)

Foydalanuvchi "MUHIM ARXITEKTURA" hujjatini (44 bosqichli Sales Agent spetsifikatsiyasi) yubordi. Faqat o'qish bilan audit o'tkazildi, reja tasdiqlandi:
xarita — Yandex Maps (`MapProvider` orqasida, kalit env'da), lokatsiya — avval web ilova ochiq paytda, keyin Android (Capacitor).

| # | Bosqich | Holat |
|---|---|---|
| A | CRM va Distributsiya alohida; `distribution.*` ruxsatlari; menyu ruxsat bo'yicha | ✅ |
| L | Oldingi bosqichlar cheklovlarini bartaraf etish (valyuta, smena, PDF, dashboard, ombor kirimi jurnali) | ✅ L1 `39f6192`, L2 `0494db5`, L3 `0f54442` |
| B | Sotuv agenti va Supervayzer rollari; agent ish joyi (mobil, 5 bo'lim, uz/ru/kk) | ✅ |
| C | Do'kon koordinatasi; sana bo'yicha hudud/marshrut; do'konlar, profil, qarzdorlar | ✅ `61f648b` |
| D | Lokatsiya kuzatuvi, sifat tekshiruvi, saqlash muddati; supervayzer xaritasi | ✅ |
| E | Tashrif: boshlash/yakunlash, buyurtmasiz sabab, rasm | ✅ |
| F | Katalog, dona/blok, draft (idempotent), yetkazish kuni, nasiya, kredit limiti, geofence bilan buyurtma | |
| G | Aksiyalar (serverda hisoblash) | |
| H | Agent dashboardi, prospektlar, supervayzer tafsiloti va lokatsiya tarixi | |
| I | Offline kesh, xavfsizlik testlari, E2E, yakuniy hisobot | |

**A — CRM va Distributsiya ajratildi** (migratsiya 0018):
- backend: `modules/distribution/` — `sales-reps.service.ts`, `distribution.service.ts`, `routes.ts` → `/api/distribution` (`distribution.view` / `distribution.manage`); `/api/crm` da faqat lidlar, faoliyatlar va lidga agent tanlash (`GET /sales-reps` — id, nom, kod)
- ruxsatlar: `distribution.view`, `distribution.manage` ("Savdo menejeri"ga ham); migratsiya 0018 `crm.*` bor mavjud rollarga mos `distribution.*` qo'shadi (takror ishlasa o'zgarmaydi)
- web: `/crm` — Pipeline va Faoliyatlar; `/distribution` — Marshrutlar va Savdo agentlari, o'z statistikasi bilan
- menyu va mobil pastki navigatsiya ruxsat bo'yicha (`useVisibleModules`); ruxsatsiz bo'lim havolasi "kirish ruxsati yo'q" sahifasini ko'rsatadi (`ModuleGuard`, uz/ru/kk); "Distributsiya" standart yoqilgan (eski `localStorage` sozlamasi ko'chiriladi)
- ishlatilmagan `src/lib/permissions.ts` nusxasi o'chirildi (yagona manba — `@bum/shared`)

**B — Sotuv agenti roli va ish joyi** (migratsiya 0020):
- ruxsatlar: `sales_agent.use`, `sales_agent.supervise`, `sales_agent.location.view|live|history`, `promotions.manage`; lokatsiya ruxsatlari faqat o'qish rollariga (Auditor, Ko'ruvchi) avtomatik berilmaydi
- rollar: "Sotuv agenti" — faqat `sales_agent.use` (ERP API'lari 403); "Supervayzer" — distributsiya, nazorat, lokatsiya, aksiyalar; Direktorga barcha yangi ruxsatlar, Savdo menejeriga nazorat va aksiyalar. Migratsiya mavjud kompaniyalarga rollarni qo'shadi
- savdo agenti tizim foydalanuvchisiga bog'lanadi (`sales_reps.user_id`, kompaniyada unikal — `sr_company_user_key`); Distributsiya → Savdo agentlari oynasida "Tizim foydalanuvchisi (login)"
- `GET /api/sales-agent/me` — bog'langan FAOL agent profili (`requireAgent`: agent hech qachon so'rovdan olinmaydi)
- web: `/:lng/sales-agent/*` — mobil ish joyi (Bosh sahifa, Sotuv, Qarzdorlar, Do'konlar, Aksiyalar; pastki navigatsiya, til, chiqish), ERP menyusiz; faqat agent ruxsati bor xodim ERP sahifalaridan avtomatik shu yerga o'tadi; bog'lanmagan bo'lsa tushuntirish ekrani. Matnlar `agent` namespace'ida uz/ru/kk
- **B** commit `a69f04c`

**C — Hudud, do'konlar va qarzdorlar** (migratsiya 0021):
- do'kon (mijoz): `contact_name`, `latitude`/`longitude` (numeric 9,6; juftlik va chegara tekshiruvi, "0,0" rad); mijoz oynasida mas'ul shaxs, koordinata va "Joriy joylashuv", kredit limiti, to'lov muddati; mijozni tahrirlash
- `route_assignments` — marshrutni aniq sanaga agentga biriktirish (bir marshrut bir kunda bitta agentda, yetkazish kuni bilan); Distributsiya → "Hudud va kun" (hafta ko'rinishi). `GET/POST /api/distribution/assignments`, `DELETE /assignments/:id`
- agent API (`sales_agent.use`, sana — har doim server sanasi):
  - `GET /api/sales-agent/today` — bugungi marshrut: shu kunga biriktirilgan, bo'lmasa hafta kuni mos o'z marshrutlari (shu kunga boshqa agentga berilganidan tashqari); do'konlar marshrut tartibida
  - `GET /stores` (`scope=today|all`, qidiruv nom/telefon raqamlari/manzil), `GET /stores/:id` — profil: aloqa, qarz, kredit limiti va qolgan kredit, 90 kunlik buyurtmalar, so'nggi buyurtmalar, tashrif kunlari; boshqa agent do'koni — 404
  - `GET /debtors` (`filter=overdue|today|soon|all`) — eng eski to'lanmagan buyurtma muddati (buyurtma sanasi + to'lov muddati) bo'yicha
  - masofa serverda (haversine, `shared/geo.ts`), agent `lat`/`lng` yuboradi
- web agent: Sotuv — bugungi marshrut, do'konlar kartalari (qarz, masofa), yetkazish kuni; Do'konlar — qidiruv, yaqinidan; do'kon profili (qo'ng'iroq, xaritada ochish); Qarzdorlar — filtrlar va kechikish kunlari; lokatsiya holati (faol/aniqlanmoqda/"lokatsiyani yoqish")

**D — Lokatsiya kuzatuvi va monitoring** (migratsiya 0022):
- jadvallar: `agent_locations` (nuqtalar), `agent_location_latest` (har agentning oxirgi joyi, bitta qator), `agent_location_events` (rad etishlar va shubhali holatlar; enum `agent_location_event_type`)
- siyosat `sales_agent.policy` (kompaniya sozlamasi, `@bum/shared` `DEFAULT_SALES_AGENT_POLICY` bilan birlashtiriladi): geofence radiusi 200 m, GPS aniqligi ≤100 m, lokatsiya yoshi ≤120 s, kuzatuv oralig'i 60 s, sakrash tezligi 150 km/soat, saqlash 90 kun, tashrif rasmi, yetkazish kuni rejimi, nasiya muddati, kredit limiti siyosati (oxirgi to'rttasi E/F bosqichlarida qo'llanadi). Umumiy `PUT /api/company/settings/sales_agent.*` rad etiladi
- `POST /api/sales-agent/location` — server tekshiradi: noto'g'ri koordinata yoki kelajak vaqt (`invalid`), eskirgan (`stale`), aniqlik past (`low_accuracy`) — rad, hodisa yoziladi, agentga sabab; imkonsiz tezlikdagi sakrash (`jump`) yoki soxta GPS belgisi (`mock`) — saqlanadi, `suspicious`. Kechikib kelgan eski nuqta oxirgi joyni almashtirmaydi. Agentdan daqiqasiga 12 nuqta
- `POST /location/events` — qurilmada ruxsat berilmadi / aniqlab bo'lmadi: hodisa + audit (`LOCATION_PERMISSION_DENIED`, `LOCATION_UPDATE_FAILURE`)
- supervayzer: `GET /supervisor/agents` (`sales_agent.location.view` — onlayn ≤5 daqiqa, oxirgi joy, aniqlik, bugungi marshrut), `GET /supervisor/live` (`location.live`), `GET /supervisor/agents/:id/history?date=` (`location.history`, har ko'rish auditga `LOCATION_HISTORY_VIEWED`, 5000 nuqtagacha), `GET /supervisor/events` (`sales_agent.supervise`). Savdo menejeri va Ko'ruvchi lokatsiyani ko'rmaydi; boshqa kompaniya agenti — 404
- saqlash muddati: soatlik tozalash (`purgeExpired`) kompaniya siyosatidagi kundan (kamida 7) eski nuqta va hodisalarni o'chiradi
- web agent: kuzatuv layout'da bitta (`useLocationTracking` — ilova ochiq paytda `watchPosition`, siyosat oralig'ida yoki 50 m siljiganda yuboradi); sarlavhada lokatsiya belgisi; ruxsat berilmasa ish joyi bloklanadi ("Lokatsiyani yoqish"); server rad etsa sababi ko'rsatiladi; sahifalar barqaror nuqtadan foydalanadi (ro'yxat har GPS yangilanishida qayta yuklanmaydi)
- web Distributsiya: "Monitoring" (agentlar ro'yxati onlayn/oflayn, xarita, 15 s jonli yangilanish, tanlangan agentning kunlik yo'li, hodisalar) va "Agent siyosati" tablari — ruxsat bo'yicha ko'rinadi; matnlar `distribution` va `map` namespace'larida uz/ru/kk
- xarita: Yandex Maps 2.1 (`src/lib/maps`, `MapProvider` interfeysi), kalit `VITE_YANDEX_MAPS_API_KEY` (`Dockerfile.web` build arg); kalit bo'lmasa xarita o'rniga tushuntirish, ro'yxatlar ishlaydi
- cheklov: brauzer telefon qulflanganda yoki fonda lokatsiya bermaydi — fondagi kuzatuv native (Android) ilovada

**E — Do'konga tashrif** (migratsiya 0023):
- jadvallar: `agent_visits` (boshlanish/yakunlanish vaqti va joyi, do'kongacha masofa, davomiylik, natija, buyurtmasiz sabab va izoh; bir agentda bitta ochiq tashrif — `av_rep_open_key`; yakunlanganda vaqt, natija va davomiylik majburiy — CHECK), `agent_visit_photos` (saqlash kaliti, turi, hajmi, vaqt va joy)
- `POST /api/sales-agent/visits/start` — do'kon agentga ochiq bo'lishi (aks holda 404), joy sifati (400, sabab bilan) va geofence (do'kon koordinatasi bo'lsa: radiusdan uzoq — 403 `details.reason=geofence`, hodisa `geofence_block` va audit `GEO_FENCE_BLOCK`); rad etilgan urinish tranzaksiyada saqlanadi, xato keyin qaytariladi. Ochiq tashrif bo'lsa — 409
- `POST /visits/:id/complete` — faqat o'z ochiq tashrifi; joy sifati; siyosatda rasm majburiy bo'lsa rasmsiz 400; buyurtmasiz sabab majburiy (`no_money`, `has_stock`, `has_debt`, `owner_absent`, `competitor`, `price`, `other` — "Boshqa" uchun izoh); davomiylik serverda. Audit: `VISIT_STARTED`, `VISIT_COMPLETED`, `VISIT_NO_ORDER`. Buyurtma bilan bog'lash ("ordered" natijasi) — F bosqichida
- rasmlar: `POST /visits/:id/photos/uploads` (imzolangan PUT, JPEG/PNG/WebP, 8 MB) → `POST /visits/:id/photos` (kalit shu kompaniyaning `visit-photo/` prefiksida, fayl yuklangan, turi va hajmi; bitta kalit bir marta; tashrifga 20 tagacha; audit `STORE_PHOTO_ADDED`) → ko'rish 5 daqiqalik imzolangan havola (agent — o'z tashrifi, supervayzer — kompaniya). Saqlash sozlanmagan bo'lsa 503. Fayl yuklash tekshiruvlari `files.service` bilan umumiy (`signUpload`, `assertUploadKey`, `headUpload`)
- `GET /today` do'konlarida `visitStatus` (`waiting`/`in_progress`/`ordered`/`visited_no_order`), do'kon profilida `todayVisit`; `GET /visits/current`, `GET /visits?date=`
- supervayzer (`sales_agent.supervise`): `GET /supervisor/visits?date=&salesRepId=` — tashriflar, jami/davom etayotgan/buyurtmali/buyurtmasiz va sabablar bo'yicha son
- tashrifi bor savdo agentini o'chirish rad etiladi (faolsizlantirish)
- web agent: do'kon sahifasida "Tashrifni boshlash" (yangi GPS o'lchovi bilan), ochiq tashrif taymeri, rasm turi va kamera orqali rasm (brauzerda 1600 px JPEG ga siqiladi), "Tashrifni yakunlash" oynasi (sabab, izoh); boshqa do'konda ochiq tashrif bo'lsa havola; Sotuv sahifasida ochiq tashrif banneri va do'kon kartalarida holat
- web Distributsiya → "Tashriflar": kun va agent filtri, ko'rsatkichlar, buyurtmasiz sabablar diagrammasi, jadval (vaqt, davomiylik, natija, masofa) va rasmni ko'rish

### Distributsiya (`/api/distribution`)

O'qish — `distribution.view`, yozish — `distribution.manage`.

| Metod | Yo'l |
|---|---|
| GET / POST / PATCH / DELETE | `/sales-reps` (`?includeInactive=`), `/sales-reps/stats`, `/sales-reps/:salesRepId` |
| GET / POST / PATCH / DELETE | `/routes` (`?includeInactive=`), `/routes/:routeId` (mijozlar bilan) |
| POST / PUT / DELETE | `/routes/:routeId/customers`, `/routes/:routeId/customers/order`, `/routes/:routeId/customers/:memberId` |
| GET / POST / PATCH | `/visits` (`?routeId=&salesRepId=&status=&dateFrom=&dateTo=`), `/visits/:visitId` |
| GET / POST / DELETE | `/assignments` (`?dateFrom=&dateTo=&salesRepId=`), `/assignments/:assignmentId` |

### Sotuv agenti (`/api/sales-agent`)

Agent yo'llari — `sales_agent.use` va tizim foydalanuvchisiga bog'langan faol agent (agent so'rovdan olinmaydi).

| Metod | Yo'l | Ruxsat |
|---|---|---|
| GET | `/me`, `/today`, `/stores`, `/stores/:customerId`, `/debtors` (`?lat=&lng=`) | `sales_agent.use` |
| POST | `/location`, `/location/events` | `sales_agent.use` |
| GET | `/visits/current`, `/visits` (`?date=`), `/visits/:visitId/photos/:photoId/url` | `sales_agent.use` (o'z tashriflari) |
| POST | `/visits/start`, `/visits/:visitId/complete`, `/visits/:visitId/photos/uploads`, `/visits/:visitId/photos` | `sales_agent.use` |
| GET / PUT | `/policy` | o'qish — agent yoki `sales_agent.supervise`; yozish — `sales_agent.supervise` |
| GET | `/supervisor/agents` | `sales_agent.location.view` |
| GET | `/supervisor/live` (`?since=`) | `sales_agent.location.live` |
| GET | `/supervisor/agents/:salesRepId/history` (`?date=`) | `sales_agent.location.history` (audit) |
| GET | `/supervisor/events` (`?date=&type=&salesRepId=&limit=`) | `sales_agent.supervise` |
| GET | `/supervisor/visits` (`?date=&salesRepId=&limit=`), `/supervisor/visits/:visitId/photos/:photoId/url` | `sales_agent.supervise` |

---

## Keyingi qadam

1. **Brauzerda sinov (lokal)** — boshlandi 2026-09-11:
   - tayyor: dev baza migratsiya qilingan, `db:seed` bajarilgan (bootstrap admin `+998900000001`, 14 rol, 9 birlik); `.env` da `BOOTSTRAP_ADMIN_*` va lokal MinIO sozlamalari
   - sinov kompaniyasi "Sinov do'kon", egasi `+998900000002` — parollar faqat `.env` da (`BOOTSTRAP_ADMIN_PASSWORD`, `LOCAL_TEST_OWNER_PASSWORD`)
   - Vite proxy orqali avtomatik smoke test — 21/21: SPA, admin kirishi, kompaniya + ega, mahsulot, kirim, mijoz, buyurtma → tasdiqlash → jo'natish → to'lov, qoldiq 47, dashboard, ogohlantirishlar, chiqish
   - buxgalteriya: aylanma balansi teng (96 000 / 96 000), foyda 12 000, kassa 36 000
   - **topilgan kamchilik:** ombordagi qo'lda kirim (`POST /api/inventory/stock/movements`, `receive`) buxgalteriya yozuvi yaratmaydi — sotuvdan keyin 1200 "Tovar zaxirasi" −24 000 bo'ladi. Qarshi hisob tanlanishi kerak (masalan 3000 kapital — boshlang'ich qoldiq); xarid qabuli esa to'g'ri yozadi
   - qolgan: brauzerda qo'lda — `pnpm --filter @bum/api dev` va `pnpm dev`, `http://localhost:5173` (POS, fayl yuklash, sozlamalar, admin panel)
2. **Production — Railway'ga deploy qilindi (2026-09-11):**
   - Qarorlar: darhol bum-erp.uz ga; Convex ma'lumotlari ko'chirilmaydi (noldan boshlanadi); logto o'chiriladi (Railway panelida foydalanuvchi)
   - Railway loyihasi `bum-erp`, muhit `production`:
     - `bum-api` — `apps/api/Dockerfile` (`RAILWAY_DOCKERFILE_PATH`), `PORT=3000`, ichki manzil `bum-api.railway.internal`, ommaviy domeni yo'q. Konteyner ishga tushishda migratsiya → bootstrap admin seed → server
     - `bum-web` — `Dockerfile.web`, `PORT=8080`, `API_UPSTREAM=http://bum-api.railway.internal:3000`; domenlar: `bum-web-production.up.railway.app`, `bum-erp.uz`, `www.bum-erp.uz`
     - `Postgres--bSX` — ilova bazasi (`bum-api` `DATABASE_URL` shunga havola). Eski `Postgres` — logto'niki
     - eski `BUM-ERP` (bo'sh, build xatosi) va `logto` — o'chirish uchun
   - Deploy usuli: repo ildizidan `railway up --project <id> --environment production --service bum-api|bum-web` (GitHub ulanmagan)
   - Tekshirildi: sahifalar 200, `/api` proksi, bootstrap admin (+998999635353) HTTPS orqali kirdi, cookie `Secure` + `HttpOnly`. Admin paroli foydalanuvchi kompyuterida `Documents\BUM-ERP-production-admin.txt`
   - Tuzatildi: nginx API manzilini har so'rovda DNS orqali aniqlaydi (web API'dan oldin ishga tushganda yiqilardi)
   - **Qolgan:**
     - DNS (foydalanuvchi): `@` → CNAME `lfc59hrl.up.railway.app` (A 95.46.96.77 o'chiriladi), `www` → CNAME `br5m6hjv.up.railway.app`, TXT `_railway-verify` va `_railway-verify.www` (tokenlar `railway domain status <domen> --service bum-web --json` da)
     - Railway tarifida bir xizmatga 2 ta shaxsiy domen — `admin.bum-erp.uz` qo'shilmadi; admin panel `https://bum-erp.uz/uz/admin`. Kirish sahifasidagi "admin.bum-erp.uz" havolasi yangilanishi kerak
     - logto o'chirilgach `auth.bum-erp.uz` va `logto-admin.bum-erp.uz` CNAME yozuvlarini ham o'chirish (osilib qolgan CNAME — subdomen egallash xavfi)
     - fayl saqlash (S3) sozlanmagan — rasm/chek yuklash 503; SMS (Eskiz) va AI kalitlari yo'q — tegishli funksiyalar o'chiq
     - xarita: `bum-web` o'zgaruvchisi `VITE_YANDEX_MAPS_API_KEY` (Yandex kabinetida `bum-erp.uz` domeniga cheklangan JavaScript API kaliti) qo'shilib, web qayta deploy qilinishi kerak — hozir Monitoring xaritasi o'rniga tushuntirish ko'rinadi
     - Convex RBAC tuzatishi (`main` `3f958f1`) — Convex ishlatilmasa kerak emas
3. **PR:** `feat/postgres-migration` → `main` — production'ga o'tish kuni kelishilgach
