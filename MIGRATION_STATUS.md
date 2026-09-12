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
- **Testlar:** `category-scope` (3), avtomatik SKU, `customer-balance` (3), `print-settings` (2), `cashback` (2), `currencies` (2), `product-currency` (1), `purchase-currency` (2), `pos-currency` (3), `sales-currency` (2), `distribution` (4), `inventory-journal` (1), `sales-agent` (3), `sales-agent-stores` (2), `sales-agent-location` (3 — sifat va shubhali nuqtalar, supervayzer ruxsatlari va kompaniya chegarasi, siyosat va saqlash muddati), `sales-agent-visits` (2 — geofence/sifat/ochiq tashrif/sabab, rasmlar va supervayzer ro'yxati), `sales-agent-orders` (2 — katalog, idempotent qoralama, geofence/qoldiq/bekor qilish; nasiya, kredit limiti rad va tasdiq, yetkazish kuni, tashrif natijasi), `sales-agent-promotions` (2), `sales-agent-dashboard` (2), `sales-agent-security` (2); API jami 247 (55 fayl); frontend unit 11 (3 fayl)

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
| F | Katalog, dona/blok, draft (idempotent), yetkazish kuni, nasiya, kredit limiti, geofence bilan buyurtma | ✅ |
| G | Aksiyalar (serverda hisoblash) | ✅ |
| H | Agent dashboardi, prospektlar, supervayzer tafsiloti va lokatsiya tarixi | ✅ |
| I | Offline kesh, xavfsizlik testlari, E2E, yakuniy hisobot | ✅ (brauzer E2E — qilinmadi, pastda) |

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
- **D va E** commit `2fad8d7`, production'ga deploy qilindi (API va web SUCCESS; yangi endpointlar 401, bundle'da yangi matnlar)

**F — Agent buyurtmasi** (migratsiya 0024):
- jadval `agent_orders` (1:1 `sales_orders`): agent, do'kon, tashrif, mijoz so'rov identifikatori (`ao_rep_request_key` — takror buyurtma yo'q), to'lov turi (`cash`/`card`/`credit`) va muddati, dona/blok qatorlari, yuborilgan joy va masofa, kredit tasdig'i (`pending`/`approved`/`rejected`)
- `GET /api/sales-agent/catalog` — faqat sotiladigan faol mahsulotlar (kategoriya cheklovi bilan), sahifalab, qidiruv; dona narxi (valyuta kursi bilan asosiy valyutada), blok — mahsulot sotuv birligi yoki mahsulotga xos konversiya (narxi = dona × koeffitsient), ombordagi mavjud qoldiq; rasm — imzolangan havola
- `PUT /orders/drafts/:clientRequestId` — qoralama: birinchi so'rov yaratadi, takroriysi o'sha buyurtmani yangilaydi; miqdor serverda (dona + blok × koeffitsient), narx — prays-list (agent narx/chegirma o'zgartira olmaydi); yuborilgan buyurtmani o'zgartirish — 409
- `POST /orders/:id/submit` — bitta tranzaksiya: hudud, joy sifati, do'kon koordinatasi majburiy (`store_location_missing`), geofence (buzilsa — buyurtma yaratilmaydi; hodisa, audit `GEO_FENCE_ORDER_ATTEMPT` do'kon va agent koordinatalari, masofa, radius bilan va supervayzerlarga "Geo-fence buzilishi" bildirishnomasi), yetkazish kuni (`assigned` — bugungi marshrut biriktirishidagi kun, agent o'zgartira olmaydi; `choose` — bugundan `maxDeliveryDays` gacha, majburiy), nasiya muddati (siyosat), joriy narx bilan qayta hisob, qoldiq (`out_of_stock`), kredit limiti (qarz + jo'natilmagan tasdiqlangan buyurtmalar + shu buyurtma; siyosat `block` — 400 `credit_limit`, `approval` — tasdiq kutadi va supervayzerga bildirishnoma), ochiq tashrifga bog'lash, tasdiqlash. Qayta yuborish natijani o'zgartirmaydi. Audit: `ORDER_CREATED`, `ORDER_SUBMITTED`, `CREDIT_ORDER`, `ORDER_CANCELLED`
- zaxira chiqimi, qarz va jurnal — mavjud jo'natish qoidasi bo'yicha (ombor "jo'natish"da); tizimda zaxira band qilinmaydi, shuning uchun yuborishda qoldiq tasdiqlangan-jo'natilmagan buyurtmalarni hisobga olmaydi
- supervayzer: `GET /supervisor/orders?approval=&date=`, `POST /supervisor/orders/:id/approve` (qoldiq qayta tekshiriladi) va `/reject` (sabab bilan, buyurtma bekor qilinadi)
- tashrif: shu tashrifda yuborilgan buyurtma bo'lsa yakunlash sababsiz, natija `ordered`
- web agent: do'kon sahifasida "Buyurtma berish"/"Qoralamani davom ettirish" va so'nggi buyurtmalar; buyurtma sahifasi — qidiruv, dona va blok tugmalari, darhol jami, to'lov turi va muddat, yetkazish kuni (siyosat bo'yicha), qoralama har o'zgarishda qurilmada saqlanadi (yangilash/tarmoq uzilishi), "Saqlash" va tasdiqlash oynasi (do'kon, masofa, qarz, qolgan kredit, yetkazish, to'lov, qatorlar, jami), yuborishda yangi GPS o'lchovi; server sabablari uz/ru/kk xabarlarga aylanadi
- web Distributsiya → "Agent buyurtmalari": tasdiq kutayotganlar va kun bo'yicha yuborilganlar, tasdiqlash va rad etish
- **F** commit `213ef2b`, production'ga deploy qilindi (API va web SUCCESS; `/catalog`, `/supervisor/orders` 401; bundle'da buyurtma matnlari)

**G — Aksiyalar** (migratsiya 0025):
- jadvallar: `promotions` (mahsulot, turi, minimal miqdor, bepul miqdor yoki foiz, sanalar, faollik; CHECK — qoida va sanalar to'g'riligi), `order_promotions` (buyurtmada qo'llangan qoida nusxasi, to'langan va bepul miqdor, chegirma summasi)
- turlar: `buy_x_get_y` — har `minQuantity` uchun `freeQuantity` bepul (10 → 1, 20 → 2); `percent_discount` — `minQuantity` dan foiz chegirma (mijoz chegirmasidan kattasi). Bir mahsulotga bir nechta aksiya bo'lsa mijoz uchun eng foydalisi
- hisoblash faqat serverda: agent faqat dona/blok yuboradi; qoralama saqlash va yuborishda aksiya qayta hisoblanadi, bepul miqdor narxsiz alohida qator sifatida qo'shiladi (`orders.service` — `trustedPricing`: server hisoblagan narx uchun `sales.edit` talab qilinmaydi), qoldiq tekshiruvi bepul miqdorni ham qo'shadi; yuborishda har aksiya uchun audit `PROMOTION_APPLIED`
- boshqarish (`promotions.manage` — Supervayzer, Savdo menejeri, Direktor): `GET/POST /api/sales-agent/supervisor/promotions`, `PATCH/DELETE /supervisor/promotions/:id`; buyurtmada qo'llangan aksiyani o'chirish rad etiladi (faolsizlantirish). Audit `PROMOTION_CREATED/UPDATED/DELETED`
- agent: `GET /api/sales-agent/promotions?filter=active|upcoming|ending_soon`; katalog mahsulotlarida faol aksiyalar
- web agent: "Aksiyalar" bo'limi (filtrlar, qoida matni, sanalar); katalogda "AKSIYA" belgisi va qoida; tasdiqlash oynasida qo'llangan aksiyalar (bepul miqdor yoki chegirma)
- web Distributsiya → "Aksiyalar": ro'yxat, yaratish/tahrirlash, faollik, o'chirish

**H — Agent bosh sahifasi, yangi mijozlar, supervayzer tafsiloti** (migratsiya 0026):
- `GET /api/sales-agent/dashboard` (serverda): bugungi savdo, buyurtmalar soni, nasiya savdo, yig'ilgan to'lov (bugun agent buyurtmalariga), bugungi marshrut do'konlari / tashrif qilingan / buyurtma bergan / qolgan; oylik plan — bajarilgan, foiz, qolgan, qolgan kunlar (bugun bilan), kuniga kerak; bugungi plan (kun boshidagi qoldiq / qolgan kunlar) va qolgani; eng yaxshi kun, oydagi buyurtmalar, faol agentlar orasida oylik o'rin, oydagi yangi mijozlar. Savdo — agent yuborgan va tasdiqlangan/jo'natilgan/yetkazilgan buyurtmalar
- jadval `agent_prospects`: agent yuborgan potentsial do'kon (nomi, telefon, manzil, izoh, joylashuv), holat `new`/`converted`/`rejected`. Agent: `GET/POST /prospects` (soatiga 50 tagacha, faqat o'zinikini ko'radi). Supervayzer (`sales_agent.supervise`): `GET /supervisor/prospects?status=`, `POST /supervisor/prospects/:id/convert` (mijoz yaratiladi — aloqa, manzil, koordinata, izoh bilan, ixtiyoriy marshrutga qo'shiladi), `/reject` (sabab bilan). Audit `PROSPECT_CREATED/CONVERTED/REJECTED`
- `GET /supervisor/agents/:salesRepId` (`sales_agent.location.view`): bugungi marshrut do'konlari va tashrif holati, ochiq tashrif, bugungi savdo va buyurtmalar
- web agent: bosh sahifa (bugungi savdo va plan, 4 ko'rsatkich, tashriflar progress, oylik plan, ko'rsatkichlar), "Yangi mijoz topish" sahifasi (joriy joylashuv bilan)
- web Distributsiya: "Yangi mijozlar" (mijozga aylantirish marshrut tanlab, rad etish, xaritada ko'rish); Monitoring'da agent tanlanganda tafsilot kartasi (savdo, buyurtmalar, tashriflar, ochiq tashrif, do'konlar holati) va do'konlar xaritada holat rangida
- cheklov: "yangi ochilgan savdo nuqtalari"ni xarita provayderidan qidirish (spetsifikatsiyaning 28-bosqichi) qilinmadi — alohida Yandex Geosearch kaliti va shartlari kerak; ochilish sanasi ishonchli emasligi sababli agent o'zi "yangi mijoz" sifatida qo'shadi

**I — Oflayn, xavfsizlik testlari, yakuniy tekshiruv:**
- service worker (`public/sw.js`): agent o'qish ma'lumotlari (profil, siyosat, bugungi marshrut, do'konlar, katalog, qarzdorlar, aksiyalar, bosh sahifa, buyurtmalar, ochiq tashrif, yangi mijozlar) — tarmoq birinchi, internet bo'lmasa oxirgi nusxa; yozish so'rovlari (buyurtma yuborish, lokatsiya, tashrif) keshlanmaydi va navbatga qo'yilmaydi — geofence/kredit faqat serverda, internet bilan. Supervayzer ma'lumotlari va rasm havolalari keshlanmaydi. Tizimdan chiqishda agent keshi tozalanadi
- **tuzatildi:** avvalgi service worker barcha `/api/*` GET javoblarini (ERP ma'lumotlari) Cache Storage'da saqlab qo'yardi va chiqishdan keyin ham qolardi; kesh nomi `erp-assets-v2` — eski kesh faollashtirishda o'chadi, API endi faqat yuqoridagi agent ro'yxati bo'yicha keshlanadi
- agent ish joyida oflayn banner (uz/ru/kk); qoralama qurilmada saqlanadi (F bosqichi)
- xavfsizlik testlari `sales-agent-security` (2): autentifikatsiyasiz 401; agent supervayzer va ERP (moliya, sotuv, katalog, distributsiya) API'lariga 403; boshqa agent/kompaniya do'koni, buyurtmasi, tashrifi — 404; soxta `insideGeofence`/`distanceMeters` — 400, uzoqdan — 403; boshqa agent nomidan lokatsiya — 400; lokatsiya cheklovi (13-nuqta 429)
- frontend unit testlar: `order-draft` (3 — server/qurilma nusxasi ustunligi, yangi identifikator, tozalash), `types` (3 — taymer, masofa, aksiya qoidasi matni)
- brauzer E2E (Playwright) — o'rnatilmagan va bajarilmagan; API oqimlari `app.inject` integratsiya testlarida HTTP darajasida tekshirilgan
- **G–I** commit `4fd9e13`, production'ga deploy qilindi (API va web SUCCESS; `/dashboard`, `/prospects`, `/supervisor/promotions`, `/supervisor/prospects` 401; bundle'da yangi ekranlar; `sw.js` — `erp-assets-v2`). Lokal: API 247/247 (55 fayl, `--maxWorkers=2`), frontend unit 11/11, web tsc, lint va `vite build` o'tdi

### Sotuv agenti tizimi — MASTER IMPLEMENTATION PROMPT (2026-09-12)

Foydalanuvchi `BUMERP_SOTUVAGE.docx` (68 bo'lim) yubordi: pullik xarita API'si yo'q, agent Xodimlar bo'limidan yaratiladi, ish sessiyasi, majburiy rasmlar va minimal tashrif vaqti, Mijozlar bo'limi, hisobotlar, kengaytirilgan xavfsizlik testlari. Hujjat o'zi tasdiq: audit → reja → BLOCKER bo'lmasa to'xtamasdan. Production ma'lumotini o'chirish, destruktiv migratsiya — alohida tasdiqsiz qilinmaydi.

| # | Bosqich | Holat |
|---|---|---|
| V1 | Xodimlar → "Sotuv agenti qo'shish" (xodim + login + rol + a'zolik + agent bir tranzaksiyada); faolsizlantirish/ishdan bo'shatish kirishni bloklaydi | ✅ |
| V2 | Pullik xarita API'si olib tashlandi: sxematik SVG xarita, "Xaritada ochish" — qurilma ilovasi | ✅ |
| V3 | Ish sessiyasi: "Ishni boshlash/yakunlash", lokatsiya faqat ish vaqtida | ✅ |
| V4 | Tashrif v2: majburiy vitrina/polka rasmi (kamera), minimal vaqt, hududdan chiqish siyosati, BUYURTMA / BUYURTMA YO'Q | ✅ |
| V5 | Mijozlar bo'limi (tarix, tahrirlash, joylashuv, rasm), 5 bandli menyu | ✅ |
| V6 | Katalog UX (brend, rasm, mahsulot oynasi, pastki "Buyurtmani yakunlash") | ✅ |
| V7 | Hisobotlar (FROM/TO), bildirishnoma qabul qiluvchilari, radius 100/200/300/500 | ✅ (hisobotlar V5 da, radius V4 da) |
| V8 | Audit nomlari, chegara/xavfsizlik/buxgalteriya testlari, yakuniy hisobot | ✅ |

**V1 — Agentni Xodimlar bo'limidan yaratish** (migratsiya 0027):
- ruxsat `sales_agent.agents.manage` (Direktor, Supervayzer, Savdo menejeri, HR menejeri); Direktorga `sales_agent.customer.edit`, `customer.location.edit`, `customer.photo.create` (V5 da ishlatiladi). Migratsiya mavjud rollarga takror ishlasa o'zgarmaydigan qilib qo'shadi
- `sales_reps.employee_id` (HR xodimi) va `supervisor_user_id`
- `POST /api/sales-agent/team` — bitta tranzaksiyada: foydalanuvchi (telefon login, parol hash, "Sotuv agenti" roli va kompaniya a'zoligi), HR xodimi ("Savdo" bo'limi, "Sotuv agenti" lavozimi — bo'lmasa yaratiladi), savdo agenti (hudud, supervayzer, oylik plan). Telefon band — 409, hech narsa yaratilmaydi. Audit `SALES_AGENT_CREATED` (parolsiz)
- `GET /team` (lavozim, holat, hudud, supervayzer, login holati), `GET /team/supervisors`, `PATCH /team/:salesRepId` — faolsizlantirish: HR holati `terminated`, kompaniya a'zoligi o'chadi, sessiyalar bekor qilinadi, boshqa faol a'zoligi bo'lmasa foydalanuvchi bloklanadi (eski cookie 401, kirish 403); qayta faollashtirish tiklaydi. Audit `SALES_AGENT_DEACTIVATED/ACTIVATED/UPDATED`
- HR: xodim `terminated` qilinsa yoki o'chirilsa — bog'langan login bloklanadi, savdo agenti faolsizlanadi (yetim foydalanuvchi qolmaydi)
- web: HR → Xodimlar va Distributsiya → Savdo agentlari oynalarida "Sotuv agenti qo'shish" (uz/ru/kk)

**V2 — Pullik xarita API'siz:**
- Yandex Maps va `VITE_YANDEX_MAPS_API_KEY` olib tashlandi. `MapView` — tashqi so'rovsiz SVG sxema (nuqtalar, yo'l, geofence doiralari, masshtab), nuqta tanlanganda "Xaritada ochish"
- `mapAppUrl()` — Android `geo:`, iOS Apple Maps, boshqalarda OpenStreetMap havolasi (API kaliti yo'q)
- GPS — telefon brauzeridan; geofence faqat serverda

**V3 — Ish sessiyasi** (migratsiya 0028):
- jadval `agent_work_sessions` (boshlanish/tugash vaqti va joyi, holat `active`/`ended`, sabab `agent`/`auto`/`deactivated`; bir agentda bitta faol — `aws_rep_active_key`); `agent_locations.work_session_id`
- `GET /api/sales-agent/work-session`, `POST /work-session/start` (yangi GPS, sifat siyosat bo'yicha; takror — o'sha sessiya 200), `POST /work-session/end` (ochiq tashrif bo'lsa 409; jonli joy o'chiriladi). Audit `WORK_SESSION_START/END`
- ish vaqtidan tashqarida: `POST /location` — 409 `work_session_required`, nuqta saqlanmaydi; tashrif boshlash/yakunlash, rasm va buyurtma yuborish ham 409
- 16 soatdan uzoq ochiq sessiya soatlik tozalashda yopiladi (`auto`); agent faolsizlantirilsa yoki HR'da ishdan bo'shatilsa — `deactivated`
- supervayzer: agentlar ro'yxatida "Ishda · HH:MM dan" / "Ish vaqti emas", agent tafsiloti va lokatsiya tarixida kunlik ish sessiyalari
- web agent: bosh sahifada "Ishni boshlash/yakunlash" kartasi, Sotuv va do'kon sahifasida ixcham holat; lokatsiya kuzatuvi faqat faol sessiyada ishlaydi
- testlar: `sales-agent-team` (2), `sales-agent-work-session` (2); agent testlari ish sessiyasini boshlab ishlaydi
- **V1–V3** commit `2ac23ab`, production'ga deploy qilindi (API va web SUCCESS). Lokal: API 251/251 (57 fayl), web tsc va lint o'tdi

**V4 — Tashrif oqimi v2** (migratsiya 0029):
- siyosat: `minVisitMinutes` (standart 10), `storefrontPhotoRequired` va `shelfPhotoRequired` (standart yoqilgan), `visitExitPolicy` (`pause` standart / `invalidate` / `flag`), `orderRequiresVisit` (standart yoqilgan); eski `photoRequired` o'rniga. Geofence radiusi uchun 100/200/300/500 m tugmalari
- `agent_visits`: `timer_started_at` (vitrina rasmi), `paused_seconds`, `outside_since`, `outside_count`, `invalidated_at`; sabablar `not_needed` ("Mahsulot kerak emas"), `store_closed` ("Do'kon yopiq"); hodisa turi `visit_exit`
- rasm: faqat ochiq tashrifda, do'kon hududida (joy majburiy, sifat va geofence serverda), avval vitrina — taymer shundan boshlanadi; mijozning `insideGeofence` kabi maydonlari rad (strict). Fayl saqlash (S3) sozlanmagan bo'lsa `POST /visits/:id/photos/direct` — base64, 3 MB gacha, turi baytlardan (JPEG/PNG/WebP), bazada (`agent_visit_photos.content`); ko'rish `.../content` (agent — o'ziniki, supervayzer — kompaniya; `private, no-store`)
- hududdan chiqish: lokatsiya nuqtalaridan (shubhali nuqtalar hisobga olinmaydi) — chiqishda hodisa `visit_exit` va audit `VISIT_OUTSIDE_GEOFENCE`; `pause` — tashqaridagi vaqt tashrif vaqtidan chiqariladi, `invalidate` — tashrifga rasm/buyurtma yo'q, faqat yopiladi, `flag` — qayd
- BUYURTMA: `submit` — shu do'konda ochiq tashrif (`visit_required`), bekor emas (`visit_invalid`), vitrina va polka rasmi, minimal vaqt (`visit_too_short`, qolgan soniya bilan) — hammasi serverda; muvaffaqiyatli yuborishda tashrif `ordered` natija bilan yopiladi
- BUYURTMA YO'Q: sabab majburiy; vitrina rasmi har doim, polka va minimal vaqt — "Do'kon yopiq" dan tashqari; bekor bo'lgan tashrif sababsiz yopiladi
- web agent: tashrif paneli — qadamlar (vitrina → polka → qo'shimcha rasmlar, faqat kamera `capture="environment"`), vitrinadan taymer va minimal vaqtgacha qolgan vaqt, hududdan chiqish ogohlantirishi, BUYURTMA / BUYURTMA YO'Q tugmalari; yuborish yoki yopishdan keyin bugungi marshrutga qaytadi
- web Distributsiya: siyosatda "Tashrif" bo'limi; Tashriflar jadvalida "bekor", hududdan chiqishlar soni va tashqaridagi daqiqalar
- cheklov: brauzer galereyadan tanlashni to'liq taqiqlay olmaydi (`capture` — Android Chrome va iOS Safari'da kamerani ochadi, ba'zi brauzerlarda galereya ham taklif qilinadi); rasm vaqti va joyi server tomonidan yoziladi, EXIF'ga ishonilmaydi
- testlar: `sales-agent-visit-flow` (2) — standart siyosat bilan to'liq oqim; boshqa agent testlari tashrif oqimisiz siyosat bilan (`test/agent-policy.ts`); frontend `visit-timer` (3)
- **V4** commit `71e860e`, production'ga deploy qilindi (API va web SUCCESS; `.../photos/:id/content` 401, bundle'da tashrif oqimi)

**V5 — Mijozlar bo'limi va 5 bandli menyu** (migratsiya 0030) + **Hisobotlar** (V7 ning bir qismi):
- agent menyusi aniq 5 band: Bosh sahifa, Sotuv, Mijozlar, Aksiyalar, Hisobotlar; eski "Do'konlar" va "Qarzdorlar" havolalari Mijozlar'ga yo'naltiriladi
- "Sotuv agenti" roliga `sales_agent.customer.edit`, `customer.location.edit`, `customer.photo.create` (spetsifikatsiya RBAC); migratsiya mavjud rollarga takror ishlasa o'zgarmaydigan qilib qo'shadi, kompaniya rolni tahrirlab olib qo'yishi mumkin
- `GET /api/sales-agent/customers/:id/history` — buyurtmalar soni (agentniki alohida), savdo, o'rtacha buyurtma, buyurtmalar oralig'i (kun), to'lovlar, agentning o'z tashriflari; so'nggi 20 ta buyurtma/to'lov/tashrif; oxirgi vitrina rasmi
- `PATCH /customers/:id` — faqat mas'ul shaxs, telefon, manzil, izoh (limit, chegirma, muddat — 400); audit `CUSTOMER_UPDATED` (`source: sales_agent`)
- `PUT /customers/:id/location` — ish vaqtida, sifatli GPS; koordinata bo'lsa faqat undan geofence radiusi ichida (403), bo'lmasa birinchi saqlash; audit `CUSTOMER_LOCATION_UPDATE` (oldingi va yangi koordinata, siljish)
- `POST /customers/:id/photo`, `GET /customers/:id/photo` — vitrina rasmi (kamera, mijoz hududida, turi baytlardan, 3 MB), jadval `customer_photos`, har mijozda oxirgi 5 tasi; audit `CUSTOMER_PHOTO_ADDED`
- boshqa agentning mijozi — 404; ruxsat olib qo'yilsa — 403
- `GET /api/sales-agent/reports?from=&to=` (93 kungacha, standart — joriy oy): sotuv (to'lov turi, kunlar, top 10 mahsulot va mijoz), tashriflar (natija, bekor, o'rtacha vaqt, sabablar), plan (oylik reja davr kunlariga taqsimlanadi), qarz (joriy holat va davrda yig'ilgan to'lov), aksiyalar; faqat sessiyadagi agent (so'rovdagi `salesRepId` e'tiborsiz)
- web agent: Mijozlar (Hammasi / Qarzdorlar / Kechikkan, qidiruv, muddat rangi), mijoz profilida tahrirlash oynasi, "Joylashuvni saqlash", vitrina rasmi va tarix (ko'rsatkichlar, Buyurtmalar/To'lovlar/Tashriflar); Hisobotlar — FROM/TO, tez davrlar, bo'limlar (uz/ru/kk)
- testlar: `sales-agent-customers` (2), `sales-agent-reports` (2), frontend `report-range` (2)
- **V5** commit `c7c6766`, production'ga deploy qilindi (API va web SUCCESS; `/reports`, `/customers/:id/history` 401, bundle'da yangi bo'limlar)

**V6 — Katalog va buyurtma sahifasi:**
- `GET /api/sales-agent/catalog` — `brandId` filtri; har mahsulotda `brandName`, `categoryName`, `imageUrl` (fayl saqlash bo'lsa imzolangan 5 daqiqalik havola, aks holda null); `GET /catalog/filters` — agentga ko'rinadigan (kategoriya cheklovi bilan) sotiladigan mahsulotlardagi kategoriya va brendlar
- web: yuqorida do'kon va buyurtma jami; qidiruv (debounce, server sahifalash) + kategoriya/brend tanlovi; kartada rasm, "-10%" yoki "AKSIYA" belgisi, brend · kategoriya, dona/blok narxi, tanlangan miqdor; kartani bosganda mahsulot oynasi (katta rasm, narxlar, qoldiq, aksiya qoidasi, dona/blok) — "SAQLASH" ro'yxatga qaytaradi (qidiruv, filtr va sahifa saqlanadi); nasiya izohi (buyurtma izohi); pastda "BUYURTMANI YAKUNLASH" → tasdiqlash oynasi
- qoralama izohi qurilmada ham saqlanadi (eski nusxalar mos)

**V7 — Bosh sahifa, bildirishnoma oluvchilar, kredit limiti:**
- `GET /dashboard` — `customers` (bugungi marshrutdagi mijozlar: buyurtma bergan/bermagan, qarzdorlar soni, kechikkanlar, jami qarz), `averageOrderToday`, `topProducts` (oyning top 5 mahsuloti)
- siyosat `notificationRecipients` (`geofence`, `approval`, `creditLimit` — foydalanuvchi ID'lari; bo'sh — standart: `sales_agent.supervise` va to'liq huquqli a'zolar); saqlashda faqat kompaniyaning faol a'zolari (`recipient_invalid`); `GET /policy/recipients` — nomzodlar (faol a'zolar, rol)
- kredit limiti oshsa (siyosat `block`): buyurtma rad etiladi, lekin tanlangan oluvchilarga "Kredit limiti oshdi" bildirishnomasi va audit `CREDIT_LIMIT_EXCEEDED` saqlanadi (xato tranzaksiyadan keyin qaytariladi)
- web: bosh sahifada o'rtacha buyurtma, bugungi mijozlar (marshrutda / buyurtma berdi / buyurtmasiz), qarzdorlar havolasi, oyning top mahsulotlari; Distributsiya → Agent siyosati → "Bildirishnomalar" (hodisa bo'yicha oluvchilar)
- testlar: `sales-agent-catalog-notify` (2)

**V8 — Audit nomlari, chegara va xavfsizlik testlari, yakuniy tekshiruv:**
- sotuv agenti audit hodisalari spetsifikatsiya nomlarida: `GEOFENCE_BLOCK`, `GEOFENCE_ORDER_ATTEMPT`, `VISIT_START`, `VISIT_END`, `STORE_PHOTO`, `SHELF_PHOTO` (boshqa rasmlar — `VISIT_PHOTO`), `ORDER_DRAFT`, `ORDER_SUBMIT`, `ORDER_CANCEL`, `NO_ORDER`; `WORK_SESSION_START/END`, `CREDIT_ORDER`, `PROMOTION_APPLIED`, `CUSTOMER_UPDATED`, `CUSTOMER_LOCATION_UPDATE` avvaldan. Bazadagi eski yozuvlar o'zgartirilmaydi (qaytarib bo'lmaydigan o'zgartirish yo'q)
- qarorlar: `LOGIN`/`LOGOUT` — mavjud auth nomlari (`login_success`, `login_failed`, `logout`) saqlandi (ERP audit ro'yxati buzilmasin); `LOCATION_UPDATE` auditga har nuqta uchun yozilmaydi — iz `agent_locations` da (ish sessiyasiga bog'langan), aks holda audit jurnali lokatsiya saqlash muddati va maxfiylik siyosatini chetlab o'tardi
- `sales-agent-boundaries` (3): geofence 199/200 m — ruxsat, 201 m — rad (tashrif va buyurtma, `distanceMeters` aniq); eskirgan va aniqligi past joy — rad; soxta `distanceMeters`/`insideGeofence` — 400; agent HR, moliya va admin API'lariga — 403; boshqa agent/kompaniya mijozi — 404; soxta `companyId`/`agentId`/`salesRepId` — so'rovda e'tiborsiz, tanada 400; buxgalteriya — agentning nasiya buyurtmasi mavjud jo'natish oqimida bitta qarz (30 000) va bitta muvozanatli jurnal yozuvi, takroriy yuborish va jo'natish yangi yozuv yaratmaydi
- service worker: Mijozlar tarixi va hisobotlar oflayn o'qish keshiga qo'shildi; ish sessiyasi holati va rasmlar keshlanmaydi
- HR → Xodimlar'dagi "Sotuv agenti qo'shish" tugmasi i18n orqali; `GET /api/hr/employees` da sotuv agenti uchun `salesRepId`, `agentRegion`, `supervisorName` — ro'yxat kartasida hudud va supervayzer (spetsifikatsiya 44-bo'lim)
- uz/ru/kk kalitlari to'liq mos (agent 350, distribution 251, map 7 — skript bilan tekshirildi)
- Lokal yakuniy tekshiruv: API 262/262 (62 fayl, `--maxWorkers=2`), frontend unit 16/16, API va web `tsc`, ESLint, `vite build` — o'tdi
- **V6–V8** commit `6652467`, production'ga deploy qilindi (API va web SUCCESS; `/catalog/filters`, `/policy/recipients`, `/reports` 401; bundle'da katalog filtrlari, bildirishnoma oluvchilari, "BUYURTMANI YAKUNLASH"; `sw.js` yangilangan)
- qolgan: production'da S3; telefonda qo'lda sinov (kamera, GPS, menyu); native ilova (fondagi kuzatuv, faqat kamera); agent bo'yicha yetkazish siyosati; bazadagi rasmlar saqlash muddati (foydalanuvchi tasdig'i bilan); bum-erp.uz TLS/DNS

## BUM POS KASSA — offline desktop kassa (2026-09-12)

Foydalanuvchi alohida Windows desktop kassa so'radi: POS (yuqori menyu — ombor, valyuta, sinxron bo'lmagan cheklar, qaytarish), sotuv tarixi, kassa, xarid, ombor, mahsulot harakati, inventarizatsiya, etiketka, ma'lumotlar (mijozlar, yetkazib beruvchilar, yuridik/jismoniy shaxslar, narxlar), analitika, sozlamalar. Asosiy afzallik — to'liq offline ishlash (sotuv va xarid), internet qaytganda sinxron.

Qarorlar (foydalanuvchi, 2026-09-12): **Electron + SQLite**; offline sotuvda lokal qoldiq yetmasa — **ruxsat, sinxronda ziddiyat sifatida belgilanadi**; birinchi reliz — **D0–D2**, keyin qolgani.

| # | Bosqich | Holat |
|---|---|---|
| D0 | Poydevor: qurilma va token, kassir PIN, lokal SQLite, pull/push sinxron, offline smena | ✅ commit `92cf40a`, API deploy (production `/api/pos-device/session` → 401) |
| D1 | POS: yuqori menyu, shtrix-kod, tezkor tugmalar, valyutalar, kechiktirilgan/qisman qaytarish, chek printeri, offline sotuv sinxroni (qoldiq ziddiyati) | ✅ commit `f4fbd55`, API deploy (yangi endpointlar production'da 401) |
| D2 | Sotuv tarixi, kassa (inkassatsiya, smena/kassir/to'lov turi hisobotlari) | ✅ server commit `d38a250`, API deploy (yangi endpointlar production'da 401); desktop kodi — D4 commitida |
| D3 | Xarid (offline, ta'minotchiga qaytarish va to'lov) | ✅ server commit (migratsiya 0034), API deploy; desktop kodi — D4 commitida (bir xil fayllar) |
| D4 | Ombor, mahsulot harakati, inventarizatsiya (offline) | ✅ (pastda) |
| D5 | Etiketka (web shablonlari, etiketka printeri) | ✅ (pastda) |
| D6 | Ma'lumotlar: jismoniy/yuridik shaxslar, rekvizitlar, narxlar (offline tahrir) | ✅ (pastda) |
| D7 | Analitika: ko'rsatkichlar, savdo, kirim-chiqim, qarzdorlik-haqdorlik, mahsulot, kategoriya tannarxi | ✅ (pastda) |
| D8 | Sozlamalar (skrinshot bo'yicha), yangilanish (SHA-256 tekshiruvi bilan) va o'rnatuvchi | ✅ commit `9ce088c` (D6–D8), API va web deploy |
| D9 | Uchdan-uchga offline testlar va yakuniy hisobot | ✅ (pastda) |

**D0 — server** (migratsiya 0031):
- jadvallar `pos_devices` (kompaniya, ombor, nomi, `code` K01/K02…, token SHA-256 xeshi, faollik, versiya, oxirgi pull/push) va `pos_sync_operations` (qurilma + `op_id` unikal, tur, kassir, `applied`/`rejected`, natija yoki xato, qurilmadagi vaqt); `pos_shifts.device_id`
- bir omborda bir nechta kassa: ochiq smena web kassada — ombor bo'yicha bitta, desktopda — qurilma bo'yicha bitta (ikki qisman unikal indeks); web kassaga desktop smenasi ko'rinmaydi
- ruxsat `pos.devices.manage` (Direktor; egasi/admin — hammasi); migratsiya mavjud Direktor rollariga qo'shadi
- `POST /api/pos-device/setup/options` va `/setup/register` — rahbar telefon + parol (mavjud login cheklovlari bilan), kompaniya va ombor tanlash; token bir marta qaytadi. Audit `POS_DEVICE_REGISTERED`
- qurilma so'rovlari `Authorization: Bearer bumpos_…`: `GET /session`, `POST /cashiers/login` (kassirning birinchi kirishi — telefon + parol, `pos.use` va ombor ruxsati; audit `POS_CASHIER_LOGIN`), `POST /pull`, `POST /push`
- `pull`: 10 tur (birliklar, konversiyalar, kategoriya, brend, mahsulot, mijoz, ombor, qurilma ombori qoldig'i, valyutalar, kassirlar) — har biri `(updated_at, id)` kursori (mikrosekund) bo'yicha sahifalab; kassirlar ruxsatlari va `active` (a'zolik, foydalanuvchi, `pos.use`, ombor) bilan; parol/PIN xeshlari yuborilmaydi
- `push`: 100 tagacha amal; har amal `opId` bilan bir marta (takrorda saqlangan javob `duplicate: true`), tartib bilan, har biri o'z tranzaksiyasida; biznes xatosi — rad etiladi va saqlanadi, keyingilari davom etadi; amal vaqti kelajakda 5 daqiqadan / o'tmishda 30 kundan oshmasin; kassir har amalda qayta tekshiriladi. Hozirgi amallar: `shift.open` (qurilmadagi smena ID'si va vaqti bilan), `shift.close`
- web `GET /api/pos/devices`, `PATCH /api/pos/devices/:id` (nomi, o'chirish — token darhol 401). Audit `POS_DEVICE_DEACTIVATED`
- testlar: `pos-device` (3) — ro'yxatdan o'tkazish va ruxsatlar, sahifalab pull va kompaniya izolyatsiyasi, push idempotentligi va rad etishlar

**D0 — desktop** (`apps/desktop`, `@bum/desktop`):
- Electron main (contextIsolation, sandbox, tashqi navigatsiya bloklangan), CommonJS preload faqat `window.bumKassa` (oq ro'yxatdagi `kassa:*` kanallar), React renderer web UI komponentlari va Tailwind mavzusi bilan
- lokal baza — Node'ning `node:sqlite` (native modul yig'ishsiz), `PRAGMA user_version` migratsiyalari; mahsulot/mijoz/qoldiq jadvallari, ma'lumotnomalar, offline navbat (`outbox`), kassir PIN'lari
- token Windows `safeStorage` bilan shifrlangan; server manzili faqat https (localhost bundan mustasno)
- sinxron: avval navbat (50 tadan), keyin pull sahifalab; har siklda kursor 2 daqiqa orqaga suriladi, saqlangan kursor orqaga ketmaydi; offline — navbat saqlanadi; 401 — "qurilma o'chirilgan"; har 30 soniyada va qo'lda
- kassir: birinchi marta onlayn (telefon + parol) → shu qurilma uchun PIN (argon2id, hash-wasm); keyin offline PIN bilan almashish, 5 xatodan keyin 5 daqiqa qulf; server o'chirgan kassir kira olmaydi
- ekranlar: ro'yxatdan o'tkazish (server, rahbar, kompaniya, ombor, kassa nomi), kassir (PIN / birinchi kirish), bosh ekran (sinxron holati, navbat, rad etilgan amallar, offline smena ochish/yopish, keyingi bo'limlar)
- Windows o'rnatuvchi: `electron-builder` NSIS (`pnpm --filter @bum/desktop dist:win`)

**D1 — server** (migratsiya 0032, faqat qo'shimcha; `stock_levels` dagi `quantity >= 0` CHECK olib tashlandi — ma'lumot o'chirilmaydi):
- `push` yangi amallari: `sale.complete` (qurilmadagi chek ID, raqam `K01-000123`, qator ID'lari, narx, chegirma, sotuv lahzasidagi kurslar, yopilgan vaqt), `sale.return` (qisman qaytarish, `K01-Q000004`, `sales.refund`), `customer.create` (qurilmadagi mijoz ID'si)
- offline chek rad etilmaydi (tovar va pul allaqachon berilgan) — nomuvofiqlik `pos_sync_conflicts` ga yoziladi: `stock_shortage` (qoldiq manfiy bo'ladi; faqat shu yo'lda), `price_changed` (kassirda `sales.edit` yo'q, narx prays-listdan farq qilgan), `rate_changed`, `customer_inactive`, `credit_limit`, `balance_insufficient` / `cashback_insufficient` (yetmagani mijoz qarziga), `shift_closed`, `customer_duplicate_phone`
- manfiy qoldiqdan keyingi kirimda o'rtacha tannarx — kirim tannarxi; hech qachon kirim bo'lmagan mahsulot offline sotilsa COGS — xarid narxi
- cheklov buzilishi (23xxx) ham amalni rad etadi (navbat to'xtab qolmaydi); chek/qaytarish/qator ID yoki raqami band — `CONFLICT`
- qisman qaytarish (`sales_returns`, `sales_return_items`, `sales_order_items.returned_qty`): zaxira sotuvdagi tannarx ulushida qaytadi, jurnal (sotuv/debitor, zaxira/tannarx), mijoz qarzi kamayadi, pul faqat to'langani qolgan chek summasidan oshsa qaytadi, balans va keshbekdan to'langani ulushi bilan o'z hisobiga, berilgan keshbek ulushi bekor qilinadi; oxirgi qoldiq aniq summa; hammasi qaytsa `returned`. Smena: `total_returns`, naqd/karta tushumdan ayriladi. Qisman qaytarilgan chekni to'liq qaytarib bo'lmaydi
- web: `POST /api/sales/orders/:id/return-items` (`sales.refund`, raqam `QR-2026-0001`), buyurtmada `returns` ro'yxati; desktop smenasini web'dan yopib bo'lmaydi
- `pull` javobida `config` (kompaniya rekvizitlari, keshbek sozlamasi, chek shabloni) — qurilmadagi xesh bilan bir xil bo'lsa `null`
- `GET /api/pos-device/receipts/:number` — qurilma omboridagi chek (boshqa kassa yoki web) qaytarilgan miqdorlar bilan
- web `GET /api/pos/devices/conflicts` (`resolved=true`), `POST /api/pos/devices/conflicts/:id/resolve` (`pos.devices.manage`, audit)
- testlar: `pos-sale-sync` (4) — offline chek va qoldiq/narx nomuvofiqligi, takror va band raqam; qisman qaytarish va ruxsat, web qaytarish; mijoz, balans va kredit limiti; config xeshi, chekni topish, nomuvofiqliklar. To'liq API: 269/269

**D1 — desktop:**
- chek hisobi `shared/sale-calc.ts` — serverdagi `completeSale` bilan bir xil (qator, soliq ichida/ustiga, sotuv valyutalari, balans avval asosiy qismni, keshbek chegarasi, qaytim, qarz); renderer oldindan ko'rish va main yozuvi bir funksiyadan
- lokal baza v2: cheklar va qaytarishlar (chop etish, tarix), kechiktirilgan cheklar, sinxron bo'lmagan zaxira farqi (ko'rinadigan qoldiq = server + navbatdagi hujjatlar; bajarilgan/rad etilganda tozalanadi)
- kassa ekrani: qidiruv va skaner (USB/Bluetooth), savat (miqdor, `sales.edit` bo'lsa narx), mijoz tanlash/yangi mijoz (offline), balans/keshbekdan to'lov, qaytim balansga, naqd/karta/bank, sotuv valyutalari va chet valyuta qismlari, qoldiq yetmasa ogohlantirish (sotuv yoziladi)
- yuqori menyu: ombor, sotuv valyutasi, sinxron bo'lmagan cheklar (qayta yuborish; bekor qilish — `sales.approve`), mahsulotni qaytarish (shu kassa cheki offline, boshqa kassa/web cheki internet bilan), kechiktirilgan cheklar, pul qutisi, smenani yopish (kutilgan naqd va farq), printer, tugmalar, kassirni almashtirish
- tezkor tugmalar F1–F12, ↑↓, +/−, Delete (Electron standart menyusi o'chirilgan)
- chek: web bilan bir xil termal shablon, dialogsiz tanlangan printerga (58/80 mm, balandlik mazmun bo'yicha), avtomatik chop etish; pul qutisi — drayver, tarmoq printeri (9100) yoki Windows ulashilgan printer (ESC/POS impulsi, shell'siz)
- testlar: 15 (lokal ombor, sinxron, PIN, xizmat — offline chek, kechiktirish, qaytarish, rad etish/qayta yuborish/bekor qilish; chek hisobi — valyuta va balans)

**D2 — server** (migratsiya 0033, faqat qo'shimcha):
- `pos_cash_movements` (smena, qurilma, `in`/`out`, tur, summa, kategoriya, izoh, xarajat hujjati, kassir, qurilmadagi vaqt) va `pos_shifts.cash_in` / `cash_out`; kutilgan naqd = boshlang'ich + naqd tushum + kirim − chiqim (web kassa smena yopish oynasi ham shu qiymatni ko'radi)
- turlar: inkassatsiya, almashtirish puli, boshqa kirim/chiqim — buxgalteriyada harakat emas (POS naqdi kompaniya asosiy kassasida); web'da inkassatsiyani bank/boshqa kassaga o'tkazish (`targetAccountId` → `transferCash`); kassadan xarajat — "to'langan" `EXP-…` hujjati, asosiy kassadan chiqim va jurnal (`postExpensePayment`, web xarajat to'lovi bilan umumiy)
- ruxsat `pos.cash.expense` (Direktor; migratsiya mavjud Direktor rollariga qo'shadi) yoki `finance.manage`
- `push`: `cash.movement`, `customer.payment` (qarz to'lovi qarzdan oshsa — ortig'i balansga, `debt_overpaid`; yopilgan smena — `shift_closed`)
- web kassa desktop smenasiga chek, mijoz to'lovi va naqd harakati yoza olmaydi (va aksincha)
- web: `GET/POST /api/sales/pos/shifts/:shiftId/cash-movements` (`pos.use`)
- qurilma: `GET /api/pos-device/sales?from&to&cursor` — qurilma omboridagi barcha kassa cheklari (kassa kodi, kassir, mijoz)
- testlar: `pos-kassa-sync` (3) — kirim/chiqim, xarajat ruxsati va hujjati, kutilgan naqd va smena farqi, web harakati; qarzdan ortiq to'lov balansga; sotuv tarixi sahifalab va ombor izolyatsiyasi. To'liq API: 272/272 (65 fayl)
- server qismi alohida commit va API deploy; desktop D2–D3 kodi D4 bilan birga commit qilinadi (bir xil fayllarda)

**D2 — desktop** (lokal baza v3: naqd harakatlari, mijoz to'lovlari, yopilgan smenalar):
- kassa bo'limi: X-hisobot qurilmadagi hujjatlardan (tushum turi — naqd/karta/bank/o'tkazma/balans/keshbek/qarz/chet valyuta, qaytarishlar, mijoz to'lovlari, naqd harakatlari, kassirlar, kutilgan naqd, serverga yuborilmaganlar soni); kirim/chiqim (xarajat — ruxsat bilan), mijoz to'lovi (qarz/balans, naqd/karta), smenani yopish — Z-hisobot tarixda saqlanadi, termal chop etiladi
- sotuv tarixi: shu kassa cheklari va qaytarishlari (offline, sana oralig'i, qidiruv, holat), chek tafsiloti, qayta chop etish, tarixdan qaytarishga o'tish; barcha kassalar cheklari — serverdan (internet bilan, sahifalab)
- kassa ekrani menyusidan va bosh sahifadan bo'limlarga o'tish
- testlar: 16

**D3 — server** (migratsiya 0034, faqat qo'shimcha; `pcm_kind` CHECK kengaytirildi):
- `purchase_returns` va `purchase_return_items`, `purchase_order_items.returned_qty` (qabul qilinganidan oshmaydi), `purchase_orders.device_id`; `pos_cash_movements` da `supplier_payment` / `supplier_refund` turlari va hujjatga havola
- ruxsat `purchase.return` (Direktor, Xarid menejeri; migratsiya mavjud rollarga qo'shadi)
- ta'minotchiga qisman qaytarish (web va kassa): zaxira `return_out`, jurnal DR kreditorlar / CR tovar zaxirasi — qabul tannarxi ulushida, ta'minotchi qarzi valyuta bo'yicha kamayadi, oxirgi qoldiq aniq summa; ta'minotchi pul qaytarsa — kassa/bankka kirim va qarz shunga qaytadi. Web: `POST /api/purchase/orders/:id/returns` (raqam `PR-2026-0001`), buyurtmada `returns`
- `push`: `supplier.create`, `purchase.complete` (kassada xarid — bitta tranzaksiyada tasdiqlangan buyurtma `K01-P000001` qurilmadagi ID/qator ID'lari va kurslar bilan, to'liq qabul: zaxira, tannarx, partiya, yangi sotuv narxi, qarz, jurnal; darhol to'lov — naqd smena chiqimi, karta — bank), `purchase.return` (`K01-R000001`, qaytgan naqd — smena kirimi), `supplier.payment` (qarzdan ortig'i avans — `supplier_overpaid`)
- offline to'lovda kassa qoldig'i yetmasa ham chiqim yoziladi; offline qaytarishda qoldiq yetmasa — manfiy qoldiq va `stock_shortage`
- `pull`: `suppliers` (qarz bilan), mahsulotda `trackExpiry`; qurilma: `GET /api/pos-device/purchases/:number`
- testlar: `pos-purchase-sync` (3) — kassada xarid va to'lov, ruxsat va band raqam; qisman qaytarish, qaytgan pul, web qaytarish va chegara; ta'minotchiga ortiqcha to'lov, pull va xaridni topish. To'liq API: 275/275 (66 fayl)

**D3 — desktop** (lokal baza v4: ta'minotchilar, xaridlar, qaytarishlar, ta'minotchiga to'lovlar):
- xarid ekrani: ta'minotchi (qidiruv, offline yangi), mahsulot qidiruvi va skaner (sotilmaydigan xomashyo ham), miqdor, ta'minotchi narxi va valyutasi, yangi sotuv narxi, partiya/yaroqlilik (majburiy bo'lsa), valyuta bo'yicha va asosiy valyutada jami, darhol to'lov (smenadan naqd yoki karta, `purchase.approve`), bugungi xaridlar va sinxron holati
- ta'minotchiga qaytarish (shu kassa xaridi offline, boshqasi — internet bilan), qaytgan pul; ta'minotchiga to'lov dialogi
- ko'rinadigan qoldiq xarid va qaytarish bilan darhol o'zgaradi; ta'minotchi qarzi qurilmada taxminiy yangilanadi
- X/Z-hisobotda ta'minotchilarga to'lov (naqd/karta) va qaytgan pul; kutilgan naqdga ta'sir qiladi
- sinxron: sikl ketayotganda navbatga tushgan hujjat — sikl tugagach darhol yana bir sikl (30 soniyalik davriy sinxronni kutmaydi); qo'lda sinxron ketayotgan sikl tugashini kutib yangisini boshlaydi
- testlar: 18

**D4 — server** (migratsiyasiz):
- `push`: `stock.writeoff` (`K01-W000001`, `warehouse.manage`) — ko'p qatorli hisobdan chiqarish, bitta jurnal (boshqa xarajatlar / tovar zaxirasi); `stock.transfer` (`K01-T000001`, `warehouse.transfer`) — qurilma omboridan boshqa faol omborga, qabul qiluvchida manba o'rtacha tannarxida kirim, qulflar mahsulot/ombor tartibida; `stock.count` (`K01-I000001`, `warehouse.count` + `warehouse.manage`) — darhol yakunlangan inventarizatsiya
- inventarizatsiya farqi SANASH LAHZASIDAGI qoldiqqa nisbatan: kutilgan = joriy qoldiq − sanashdan keyingi harakatlar (qoldiq qatorlari qulf ostida); tuzatma sanash vaqti bilan, ortiqcha/kamomad jurnali; boshqa kassalarning keyingi sotuvlari yo'qolmaydi
- kech yetib kelgan, lekin inventarizatsiyadan OLDIN bo'lgan hujjat (boshqa kassaning offline cheki, xarid, qaytarish, o'tgan sanali web kirim/chiqim yoki ko'chirish): sanoq bu tovarni allaqachon hisobga olgan — hujjat yoziladi, qoldiq esa inventarizatsiya nomidan teskari tuzatma bilan o'zgarmay qoladi (jurnal ham), nomuvofiqlik `count_late_document`. Tranzaksiyadagi harakatlar `moveStock` ichida yig'iladi (qo'shimcha so'rov faqat sinxron va o'tgan sanali harakatda)
- offline chiqimda qoldiq yetmasa — manfiy qoldiq va `stock_shortage` (so'ralgan / bor edi)
- qurilma: `GET /api/pos-device/movements` (qurilma ombori, mahsulot va tur bo'yicha, kursor; hujjat raqami — chek, xarid, qaytarish, inventarizatsiya), `GET /api/pos-device/stock/:productId` (faol omborlar bo'yicha qoldiq); pull qoldig'ida `avgCostPrice`
- testlar: `pos-stock-sync` (2) — hisobdan chiqarish va ko'chirish (nomuvofiqlik, jurnal, tannarx, ruxsatlar, noto'g'ri raqam/ombor, harakatlar sahifalash, omborlar qoldig'i, pull); inventarizatsiya (sanash lahzasidagi farq, keyingi sotuv saqlanishi, kech kelgan oldingi chek va o'tgan sanali web kirim tuzatmasi, band ID, ruxsat, noma'lum mahsulot). To'liq API: 277/277 (67 fayl)
- commit `e649576` (D4–D5 va desktop D2–D3), API deploy

**D4 — desktop** (lokal baza v5: ombor hujjatlari):
- Ombor: qoldiqlar (ko'rinadigan = server + yuborilmagan hujjatlar, "navbatda" farqi), filtrlar (bor, kam qolgan — minimal qoldiq bo'yicha, tugagan, manfiy) va sonlari, o'rtacha tannarx va ombor qiymati (faqat `warehouse.manage`), boshqa omborlardagi qoldiq (internet bilan)
- hisobdan chiqarish (sabab majburiy) va boshqa omborga ko'chirish — skaner/qidiruv, qoldiqdan ko'p bo'lsa ogohlantirish; hujjatlar ro'yxati (tur, qatorlar, sinxron holati, nomuvofiqliklar)
- Mahsulot harakati: serverdagi tarix (barcha kassalar va web, tur filtri, sahifalab) va yuqorida qurilmadagi yuborilmagan hujjatlar; internet bo'lmasa — faqat qurilmadagilar
- Inventarizatsiya: skaner har o'qishda +1, miqdorni qo'lda kiritish, kutilgan qoldiq va farq darhol; qoralama ilova yopilsa ham saqlanadi; to'liq inventarizatsiya — sanalmagan, qoldig'i bor mahsulotlar 0; yakunlashda tasdiq; qoldiq darhol sanalganiga teng ko'rinadi
- sinxron bo'lmagan amallar ro'yxatida hujjat raqami va izoh (sabab, qabul qiluvchi ombor, mahsulotlar soni)
- testlar: 19

**D5 — etiketka:**
- server: pull `config` da etiketka shablonlari (`print.labels`, web: Sozlamalar → Etiketka; sozlanmagan — standart) — xesh o'zgarsa qurilmaga keladi
- desktop: Etiketka bo'limi — shablon tanlash (rulon yoki A4 ustunlar), mahsulot skaner/qidiruv (har o'qish +1 nusxa), bugungi xaridlardan (qabul qilingan miqdor bo'yicha nusxa), nusxa soni, jonli ko'rinish; shtrix-kod/QR va narx (asosiy valyutada) web bilan bir xil shablondan (`label-html`); internet shart emas
- chop etish: alohida etiketka printeri (qurilma sozlamasi, kassa printer oynasida ham), dialogsiz; rulon — sahifa etiketka o'lchamida (mm), A4 — varaq; ko'p etiketka vaqtinchalik fayl orqali (data URL chegarasi yo'q), bir martada 2000 tagacha
- testlar: 20

**D6 — ma'lumotlar** (migratsiya 0035, faqat qo'shimcha ustunlar):
- `customers.party_type` (standart `individual`), `bank_account`, `bank_mfo`; `suppliers.party_type` (standart `legal`), `bank_mfo`; CHECK `individual|legal`
- web: mijoz va ta'minotchi formalarida jismoniy/yuridik shaxs, STIR (JSHSHIR), hisob raqami, MFO; kartochkada turi
- `push`: `customer.create` / `supplier.create` rekvizitlar bilan; `customer.update` (`crm.manage`), `supplier.update` (`purchase.edit`), `product.prices` (`products.edit`) — maydonlar bo'yicha birlashtirish: qurilma har maydon uchun ko'rgan (`from`) va yangi (`to`) qiymatni yuboradi; server qiymati hali `from` bo'lsa yoziladi (xizmat funksiyasi orqali — tekshiruv va audit), allaqachon `to` bo'lsa o'tkaziladi, aks holda server qiymati qoladi va `record_changed` nomuvofiqligi (maydon, asl, qurilma, server qiymatlari). Telefon raqamlar, narx 4 kasrli son sifatida taqqoslanadi; `updated_at` ishlatilmaydi (qarz o'zgarishi ham yangilaydi)
- `pull`: mijoz va ta'minotchida turi, email, manzil, STIR, mas'ul shaxs, rekvizitlar, izoh
- desktop: Ma'lumotlar bo'limi — Mijozlar / Ta'minotchilar (jismoniy/yuridik filtri, qarz/balans/keshbek, rekvizitlar, yangi va tahrir oynasi — offline) va Narxlar (sotuv, chakana, ulgurji, aksiya va muddati, xarid — ruxsat bilan; o'zgarish kassada darhol, "narx navbatda"); tahrirda faqat o'zgargan maydonlar navbatga tushadi, o'zgarish bo'lmasa — hech narsa
- testlar: `pos-reference-sync` (2); desktop 21

**D7 — analitika:**
- server `GET /api/pos-device/analytics?from&to&cashierId` (kassirda `analytics.view`, a'zolik qayta tekshiriladi; davr 366 kungacha): qurilma omboridagi savdo (barcha kassalar va web) — tushum, qaytarish, sotuv lahzasidagi AVCO tannarx va qaytarish tannarxi, yalpi foyda va marja, cheklar, o'rtacha chek, kunlar, kassirlar, to'lov turlari (smena naqd/karta, web to'lovlari, qarzga); to'liq qaytarilgan chek ikki marta ayirilmaydi; ombor — xaridlar, qoldiq qiymati, eng ko'p sotilgan va sotilmayotgan mahsulotlar, kategoriya bo'yicha sotilgan va qoldiq tannarxi; kompaniya — xarajatlar, kirim-chiqim (kassa/bank tranzaksiyalari manbalar bo'yicha, asosiy valyutada), mijozlar qarzi va balansi, ta'minotchilarga qarz va avans
- desktop: Analitika bo'limi (Asosiy ko'rsatkichlar, Savdo, Kirim-chiqim, Qarzdorlik-haqdorlik, Mahsulotlar tahlili, Kategoriya bo'yicha tannarx), davr (bugun, 7/30 kun, bu oy, ixtiyoriy); internet bo'lmasa yoki "Faqat shu kassa" — qurilmadagi hujjatlardan (yuborilmaganlar ham, tannarx joriy o'rtacha bo'yicha taxminiy), manba va qamrov ekranda ko'rinadi
- testlar: `pos-analytics` (1); desktop 22

**D8 — sozlamalar va yangilanish:**
- desktop Sozlamalar (skrinshotdagi tuzilma): yuqorida Sozlamalar / Printer / Marketing / Ombor / Tashkilot / Ruxsatlar / Obuna; "Sozlamalar" ichida chapda — Dastur tili (o'zbek lotin yoki kirill — ekran matni avtomatik o'giriladi, kodlar va raqamlar o'zgarmaydi), Tashqi ko'rinish (yorug'/qorong'i/Windows, shrift o'lchami), Valyutalar (kurslar), Qaynoq tugmalar (F1–F12 yoki Ctrl/Alt + harf, takror tekshiruvi, kassa ekranida darhol), Savdo (qoldiq yetmasa sotishni taqiqlash, avtomatik chop etish, pul qutisi), To'lov (usullarni yoqish/o'chirish — o'chirilgani kassada ko'rinmaydi va chekda qabul qilinmaydi; standart usul), Umumiy (sinxron oralig'i, holati, hozir sinxronlash), Xavfsizlik (harakatsizlikda bloklash — ochiq chek saqlanadi, PIN bilan ochiladi; PIN almashtirish), Ilova versiyasi (tekshirish, yuklab olish, o'rnatish), Tizimdan chiqish
- Printer (chek, etiketka printeri, qog'oz, pul qutisi — sozlash va sinash), Marketing (keshbek qoidalari), Ombor (omborlar, shu kassa ombori), Tashkilot (rekvizitlar, qurilma), Ruxsatlar (joriy kassir ruxsatlari guruhlab, qurilmadagi kassirlar), Obuna (holat va sinov muddati — pull/sessiyadagi `company.status`, `trialEndsAt`)
- server `GET /api/pos-device/app-update` (joriy versiya `x-app-version`): reliz Railway o'zgaruvchilarida — `DESKTOP_LATEST_VERSION`, `DESKTOP_DOWNLOAD_URL` (faqat https), `DESKTOP_SHA256`, ixtiyoriy `DESKTOP_MIN_VERSION` (majburiy yangilanish), `DESKTOP_RELEASE_NOTES`; to'liq sozlanmagan bo'lsa taklif qilinmaydi
- desktop yangilanish: o'rnatuvchi yuklanadi, SHA-256 mos kelmasa saqlanmaydi, o'rnatishdan oldin fayl qayta tekshiriladi, NSIS o'rnatuvchi alohida jarayonda ishga tushadi va ilova yopiladi (lokal baza va navbat foydalanuvchi papkasida saqlanadi). Yangi paket qo'shilmagan
- o'rnatuvchi: `pnpm --filter @bum/desktop dist:win` (electron-builder NSIS, `BUM-POS-KASSA-Setup-<versiya>.exe`); reliz uchun fayl SHA-256 ni `DESKTOP_SHA256` ga yozish kerak
- testlar: `pos-app-update` (1); desktop 23. To'liq API: 281/281 (70 fayl)

**D9 — uchdan-uchga offline sinov va yakuniy holat:**
- `apps/api/test/desktop-offline-e2e.test.ts`: haqiqiy desktop xizmati (lokal SQLite, navbat, PIN) haqiqiy API serverga ulanadi, "internet" o'chirib-yoqiladi:
  - to'liq offline ish kuni — smena, yangi ta'minotchi (yuridik), xarid va smenadan to'lov, yangi mijoz, chek, qisman qaytarish, qoldiqdan ortiq chek, inkassatsiya, hisobdan chiqarish, inventarizatsiya, narx va mijoz tahriri, smena yopish (13 amal navbatda) → internet qaytgach hammasi qabul qilinadi: qoldiq (5 + 10 − 12 + 2 − 7 − 1 = −3, sanoq 0 → 0), ta'minotchi qarzi 35 000, smena kutilgan naqdi 190 000 va farq 0, `stock_shortage` nomuvofiqligi, yangi narx va mijoz manzili; qurilma qoldig'i va narxi serverdagi bilan bir xil, navbat bo'sh
  - push javobi yo'qolganda (server bajardi, qurilma bilmadi) — qayta yuborishda chek ham, qoldiq ham takrorlanmaydi
- sinov haqiqiy xatoni topdi: qurilmani ro'yxatdan o'tkazishda desktop so'rovga ortiqcha `apiUrl` maydonini qo'shardi, serverning qat'iy sxemasi 400 qaytarardi — tuzatildi; desktop soxta serveri endi noma'lum maydonni rad etadi (qayta chiqmasin)
- API tsconfig bu testni o'tkazib yuboradi (desktop kodi o'z tsconfig'ida tekshiriladi); vitest ishga tushiradi

**BUM POS KASSA — yakuniy holat (foydalanuvchi so'ragan 11 bo'lim):**
1. POS — yuqori menyu (ombor, valyuta, sinxron bo'lmagan cheklar, mahsulotni qaytarish), skaner, tezkor tugmalar, kechiktirilgan cheklar, chek printeri va pul qutisi — D1
2. Sotuv tarixi — shu kassa (offline) va barcha kassalar (server) — D2
3. Kassa bo'limi — X/Z-hisobot, kirim-chiqim, xarajat, mijoz to'lovlari — D2
4. Xarid — ta'minotchi, valyutali narx, partiya, darhol to'lov, qaytarish — D3
5. Ombor — qoldiqlar, hisobdan chiqarish, ko'chirish — D4
6. Mahsulotlar harakati — D4
7. Inventarizatsiya — D4
8. Etiketka — D5
9. Ma'lumotlar — mijozlar, yetkazib beruvchilar, yuridik/jismoniy shaxslar, narxlar — D6
10. Analitika — asosiy ko'rsatkichlar, savdo, kirim-chiqim, qarzdorlik-haqdorlik, mahsulotlar tahlili, kategoriya bo'yicha tannarx — D7
11. Sozlamalar — skrinshotdagi tuzilma — D8
- asosiy afzallik: sotuv, xarid, ombor, inventarizatsiya, ma'lumotnoma tahriri va hisobotlar internet bo'lmasa ham ishlaydi; internet qaytganda navbat tartib bilan yuboriladi, har amal bir marta bajariladi, jismonan bo'lgan hujjat rad etilmaydi — farqlar `pos_sync_conflicts` da (web: `GET /api/pos/devices/conflicts`)
- D9 dan keyin ochiq qolganlar (web'da nomuvofiqliklar sahifasi, o'chirilgan yozuvlar, rus tili, reliz joylashtirish, imzo) — D10 da bartaraf etildi

**D10 — cheklovlar bartaraf etildi** (migratsiya 0036, faqat yangi jadvallar):
- web: Sozlamalar → "Kassa qurilmalari" (`pos.devices.manage`) — qurilmalar (kod, nomi va uni o'zgartirish, ombor, versiya va platforma, oxirgi aloqa va onlayn belgisi, oxirgi olish/yuborish, kim ro'yxatga olgan, yoqish/o'chirish — tasdiq bilan) va sinxron nomuvofiqliklari (ochiq / ko'rib chiqilgan, turi nomi, qurilma, sana, hujjat, tafsilotlar mahsulot nomlari bilan, "Ko'rib chiqildi"). `GET /api/pos/devices/conflicts` endi `kindLabel` va `productNames` ham qaytaradi
- o'chirilgan yozuvlar: serverda butunlay o'chiriladigan ma'lumotnomalar (kategoriya, brend, mahsulot birlik konversiyasi) `sync_deletions` ga yoziladi; pull'da yangi `deletions` turi (kursor `deleted_at`), qurilma upsert'lardan keyin lokal nusxani o'chiradi (noma'lum tur e'tiborsiz qoladi). Mahsulot, mijoz, ta'minotchi, ombor serverda o'chirilmaydi — faolsizlantiriladi va bu avvaldan sinxron bo'ladi (kassada ko'rinmaydi)
- desktop relizlari o'z serverimizda (S3/GitHub shart emas): `desktop_releases` + `desktop_release_chunks` (bytea, 4 MB bo'laklar). Admin panel → "Desktop kassa" (platforma admini): .exe yuklash — brauzerdan oqim bilan, jarayon foizi; server "MZ" sarlavhasini, 400 MB chegarani tekshiradi, SHA-256 hisoblaydi, hammasi bitta tranzaksiyada; izoh va majburiy versiya; e'lon qilish (oldingisi arxivga); arxiv; audit `DESKTOP_RELEASE_UPLOADED/UPDATED/PUBLISHED/ARCHIVED`. API: `GET/POST /api/platform/desktop-releases` (`?version=&fileName=`, `application/octet-stream`), `PATCH /:releaseId`, `POST /:releaseId/publish`, `POST /:releaseId/archive`
- qurilma: `GET /api/pos-device/app-update` avval e'lon qilingan relizni taklif qiladi (nisbiy manzil `/api/pos-device/releases/:id/download`), bo'lmasa `DESKTOP_*` o'zgaruvchilari; `GET /api/pos-device/releases/:id/download` — qurilma tokeni bilan, bo'laklar oqimi, `x-content-sha256`. Desktop nisbiy manzilni API manzilidan token bilan yuklaydi (tashqi manzil — faqat https, tokensiz); SHA-256 tekshiruvi o'zgarmadi
- nginx: `/api/platform/desktop-releases` va `/api/pos-device/releases/` — 400 MB, so'rov buferlanmaydi, 15 daqiqa
- rus tili: desktop Sozlamalar → Dastur tili → "Русский" — ekrandagi matn lug'at bo'yicha o'giriladi (`apps/desktop/src/renderer/settings/ru-dictionary.ts`: 831 ibora va 85 qolip `{}` bilan — qolip ichidagi qism ham o'giriladi; kirill o'girish bilan bir xil mexanizm, kirill ↔ rus to'g'ridan-to'g'ri almashadi). Lug'atda yo'q matn (mahsulot nomi, serverdan kelgan xabar, rad etilgan sinxron amal sababi) o'zgarmaydi. Bo'lingan JSX gaplarda so'z tartibi o'zgarmaydi — ba'zi joylarda qisqa neytral shakl
- belgi va imzo: `apps/desktop/build/icon.ico` (16–256 px) — ilova, o'rnatuvchi va o'chirgich belgisi. Imzo: `CSC_LINK` (.pfx) va `CSC_KEY_PASSWORD` muhitda berilsa electron-builder SHA-256 va RFC 3161 vaqt tamg'asi bilan imzolaydi; berilmasa imzosiz yig'iladi (SmartScreen "noma'lum nashriyotchi")
- desktop versiyasi 0.2.0
- testlar: `pos-deletions-releases` (2). To'liq API: 285/285 (72 fayl); desktop 26 (o'chirilgan yozuvlar, nisbiy manzildan token bilan yangilanish, rus lug'ati butunligi va o'girish)
- commit `ddced68`; API va web deploy (2026-09-12, SUCCESS). Production tekshiruvi: `/api/platform/desktop-releases` va `/api/pos-device/releases/:id/download` — 401 (marshrut bor, kirishsiz), nginx 5 MB yuklashni API'ga o'tkazadi (oldingi 3 MB chegarasi — 413 bo'lardi)
- o'rnatuvchi (lokal, git'da emas): `apps/desktop/release/BUM-POS-KASSA-Setup-0.2.0.exe` — 111 681 056 bayt, SHA-256 `989617a1a417441e0fb0f08042770e0ffe00fd7d00fdc53f7dd2393aac9fe162`, `app.asar` 2.8 MB (dev paketlarsiz), imzosiz (sertifikat yo'q)
- 0.2.1 (foydalanuvchi sinovi, 2026-09-12): ro'yxatdan o'tishda `bum-erp.uz` (sxemasiz) — "Server manzili noto'g'ri". Tuzatildi: sxemasiz manzilga https qo'shiladi; tarmoq xatosida sertifikat mos emas / domen topilmadi — aniq xabar; standart manzil `https://www.bum-erp.uz`. O'rnatuvchi `BUM-POS-KASSA-Setup-0.2.1.exe` — 111 681 459 bayt, SHA-256 `44a86d94772a19ff93efd0838cb7a0c56d560b3a141590169d1187ca1862a88e` (imzosiz). Sabab ikkinchisi: `bum-erp.uz` DNS'da hali eski A `95.46.96.77` (sertifikati boshqa domenniki, curl 60), `www.bum-erp.uz` Railway'ga CNAME va ishlaydi. Desktop 27 test, e2e 2/2
- qolgan (foydalanuvchi): `bum-erp.uz` DNS yozuvini Railway'ga o'tkazish (yuqoridagi "Keyingi qadam" → DNS); kod imzolash sertifikati (OV/EV) — sotib olinadi; o'rnatuvchini Admin panel → "Desktop kassa" orqali yuklab e'lon qilish (platforma admini kirishi kerak)

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
| GET / POST | `/work-session`, `/work-session/start`, `/work-session/end` | `sales_agent.use` |
| POST | `/location` (faqat faol ish sessiyasida), `/location/events` | `sales_agent.use` |
| GET / POST / PATCH | `/team`, `/team/supervisors`, `/team/:salesRepId` | `sales_agent.agents.manage` |
| GET | `/customers/:customerId/history`, `/customers/:customerId/photo`, `/reports` (`?from=&to=`) | `sales_agent.use` (o'z mijozi / o'zi) |
| PATCH / PUT / POST | `/customers/:customerId`, `/customers/:customerId/location`, `/customers/:customerId/photo` | `sales_agent.customer.edit` / `.location.edit` / `.photo.create` |
| GET | `/visits/current`, `/visits` (`?date=`), `/visits/:visitId/photos/:photoId/url` | `sales_agent.use` (o'z tashriflari) |
| POST | `/visits/start`, `/visits/:visitId/complete`, `/visits/:visitId/photos/uploads`, `/visits/:visitId/photos`, `/visits/:visitId/photos/direct` | `sales_agent.use` |
| GET | `/visits/:visitId/photos/:photoId/content`, `/supervisor/visits/:visitId/photos/:photoId/content` | agent — o'z tashrifi; supervayzer — `sales_agent.supervise` |
| GET | `/catalog` (`?search=&categoryId=&brandId=&limit=&offset=`), `/catalog/filters`, `/catalog/:productId/image`, `/orders` (`?state=&customerId=`), `/orders/:orderId` | `sales_agent.use` |
| GET | `/policy/recipients` | `sales_agent.supervise` |
| PUT / POST | `/orders/drafts/:clientRequestId`, `/orders/:orderId/submit`, `/orders/:orderId/cancel` | `sales_agent.use` |
| GET / PUT | `/policy` | o'qish — agent yoki `sales_agent.supervise`; yozish — `sales_agent.supervise` |
| GET | `/supervisor/agents` | `sales_agent.location.view` |
| GET | `/supervisor/live` (`?since=`) | `sales_agent.location.live` |
| GET | `/supervisor/agents/:salesRepId/history` (`?date=`) | `sales_agent.location.history` (audit) |
| GET | `/supervisor/events` (`?date=&type=&salesRepId=&limit=`) | `sales_agent.supervise` |
| GET | `/supervisor/visits` (`?date=&salesRepId=&limit=`), `/supervisor/visits/:visitId/photos/:photoId/url` | `sales_agent.supervise` |
| GET / POST | `/supervisor/orders` (`?approval=&date=&salesRepId=`), `/supervisor/orders/:orderId/approve`, `/supervisor/orders/:orderId/reject` | `sales_agent.supervise` |
| GET | `/promotions` (`?filter=active\|upcoming\|ending_soon`) | `sales_agent.use` |
| GET | `/dashboard`, `/prospects` | `sales_agent.use` |
| POST | `/prospects` | `sales_agent.use` |
| GET | `/supervisor/agents/:salesRepId` | `sales_agent.location.view` |
| GET / POST | `/supervisor/prospects` (`?status=`), `/supervisor/prospects/:prospectId/convert`, `/supervisor/prospects/:prospectId/reject` | `sales_agent.supervise` |
| GET / POST / PATCH / DELETE | `/supervisor/promotions` (`?status=`), `/supervisor/promotions/:promotionId` | `promotions.manage` |

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
     - xarita: kalit kerak emas (V2 — sxematik xarita va qurilmaning xarita ilovasi)
     - Convex RBAC tuzatishi (`main` `3f958f1`) — Convex ishlatilmasa kerak emas
3. **PR:** `feat/postgres-migration` → `main` — production'ga o'tish kuni kelishilgach
