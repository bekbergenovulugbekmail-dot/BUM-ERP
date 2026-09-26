# PostgreSQL migratsiyasi — holat

> Convex → PostgreSQL (Fastify + Drizzle) migratsiyasi.
> **Har sessiya oxirida yangilanadi** (qoida `CLAUDE.md` da).

| | |
|---|---|
| Branch | `feat/postgres-migration` |
| Oxirgi yangilanish | 2026-09-26 |
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
| GET | `/modules` (holat; tarix — `modules.manage`) | a'zo | yangi |
| PUT | `/modules/:key` `{enabled, reason?}` — bog'liqliklar tekshiriladi, tarix va audit | `modules.manage` | yangi (avval faqat localStorage) |

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
| GET | `/settlements` — kutilayotgan karta/hamyon puli: qirqilmagan qoldiq, bugungi tushum, qirqim manzili, terminallar | `finance.view` | yangi |
| POST | `/cash-accounts/:cashAccountId/settle` (qirqim: komissiya ushlanib qolgani bank hisobiga) | `finance.manage` | yangi |
| POST | `/cash-accounts/:cashAccountId/set-balance` (qoldiqni to'g'rilash: farq kirim/chiqim, sabab majburiy) | `finance.approve` | yangi |
| GET / POST / PATCH | `/terminals` (`?includeInactive=`), `/terminals/:terminalId` — karta terminali → bank hisobi | `finance.view` / `finance.manage` | yangi |
| GET | `/expenses` (`?status=&category=&dateFrom=&dateTo=&limit=&cursor=`), `/expenses/stats` | `finance.view` | `expenses.list`, `getStats` |
| POST / PATCH / DELETE | `/expenses`, `/expenses/:expenseId` | `finance.manage` | `create`, `remove` |
| POST | `/expenses/:expenseId/status` (`paid` — kassa chiqimi + jurnal) | `finance.approve` | `updateStatus` |
| GET | `/expenses/export` (`?status=&category=&dateFrom=&dateTo=`) — CSV (UTF-8 BOM) | `finance.view` | yangi |
| POST | `/expenses/import` (CSV qatorlari; "kutilmoqda" holatida, yopilgan davr — qator xatosi) | `finance.manage` | yangi |

### Xarid (`/api/purchase`)

| Metod | Yo'l | Kim | Convex |
|---|---|---|---|
| GET | `/suppliers` (`?includeInactive=&search=`), `/suppliers/:supplierId` | `purchase.view` | `suppliers.list`, `getById` |
| POST / PATCH | `/suppliers`, `/suppliers/:supplierId` | `purchase.create` / `purchase.edit` | `create`, `update` |
| POST | `/suppliers/:supplierId/set-debt` (qarzni to'g'rilash: farq boshqa daromad/xarajat, sabab majburiy) | `finance.approve` | yangi |
| GET | `/suppliers/export` (`?includeInactive=`) — CSV (UTF-8 BOM) | `purchase.view` | yangi |
| POST | `/suppliers/import` ({rows, dryRun}; qarz o'zgarmaydi, takroriy kod va STIR — dublikat) | `purchase.create` | yangi |
| GET | `/orders/export` (`?supplierId=&status=&dateFrom=&dateTo=`) — CSV: hujjat qatorlari | `purchase.view` | yangi |
| POST | `/orders/import` ({rows, dryRun}) — qoralama hujjat; qarz, zaxira va jurnal tegilmaydi | `purchase.create` | yangi |
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
| POST | `/customers/:customerId/balance-adjust` (balans, qarz, keshbekni to'g'rilash; sabab majburiy) | `finance.approve` | yangi |
| GET | `/customers/export` (`?includeInactive=`) — CSV (UTF-8 BOM) | `sales.view` | yangi |
| POST | `/customers/import` (CSV qatorlari; pul qiymatlari o'zgarmaydi) | `crm.manage` | yangi |
| GET | `/orders` (`?status=&customerId=&warehouseId=&isPos=&shiftId=&dateFrom=&dateTo=&search=&limit=&cursor=`), `/orders/stats`, `/orders/:orderId` | `sales.view` | `orders.list`, `getStats`, `getById` |
| POST / PATCH | `/orders`, `/orders/:orderId` (faqat qoralama) | `sales.create` / `sales.edit` (narx/chegirma o'zgartirish — `sales.edit`) | `create` |
| POST | `/orders/:orderId/confirm`, `/orders/:orderId/ship` | `sales.approve` + ombor ruxsati | `confirm`, `ship` |
| POST | `/orders/:orderId/cancel` / `/orders/:orderId/return` | `sales.cancel` / `sales.refund` | `cancel` / yangi |
| GET / POST | `/payments` (`?customerId=&orderId=`; POST aralash — `parts[]` + `reference` kaliti) | `sales.view` / `finance.manage` | `recordPayment` |
| GET | `/pos/shifts` (`?warehouseId=&status=`), `/pos/shifts/open?warehouseId=`, `/pos/shifts/:shiftId` | `pos.use` | `getShifts`, `getOpenShift` |
| POST | `/pos/shifts`, `/pos/shifts/:shiftId/close` (kassirning o'zi yoki `sales.approve`) | `pos.use` | `openShift`, `closeShift` |
| GET | `/pos/payment-options` (faol terminallar, bank hisobi ma'lumotisiz) | `pos.use` | yangi |
| POST | `/pos/sales` (aralash `payments[]` terminal bilan, `onCredit` — nasiya, `clientRequestId`) | `pos.use` | `completePOSSale` |

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
| GET | `/employees/export` (`?status=&includeSalary=`) — CSV; pasport, INN, hisob raqami va maosh ustunlari `hr.salary` bilan | `hr.view` | yangi |
| POST | `/employees/import` (CSV qatorlari; login, parol yoki PIN yaratmaydi) | `hr.manage` | yangi |
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
- foydalanuvchi `https://www.bum-erp.uz` bilan kassani ro'yxatdan o'tkazdi — ishladi
- yangi kassa o'rnatish web'dan: Sozlamalar → "Kassa qurilmalari" → "Ilovani o'rnatish" — e'lon qilingan o'rnatuvchi (versiya, hajm, izoh, SHA-256) va "Yuklab olish" (`pos.devices.manage`, sessiya bilan). API: `GET /api/pos/devices` javobida `installer`, `GET /api/pos/devices/installer/:releaseId/download` (kassir — 403, kirishsiz — 401); nginx uzoq yuklab olish qoidasiga qo'shildi. Test `pos-deletions-releases` kengaytirildi. Commit `25848e6`, API va web deploy SUCCESS; production (`www.bum-erp.uz`): yangi marshrut kirishsiz 401, sozlamalar sahifasi 200
- qolgan (foydalanuvchi): `bum-erp.uz` DNS yozuvini Railway'ga o'tkazish (yuqoridagi "Keyingi qadam" → DNS); kod imzolash sertifikati (OV/EV) — sotib olinadi; o'rnatuvchini Admin panel → "Desktop kassa" orqali yuklab e'lon qilish (platforma admini kirishi kerak)

## Desktop POS master prompt (2026-09-12) — audit, reja va bosqichlar

Talablar hujjati: `BUMERP_DESKTOP.docx` — aralash to'lov, tezkor sotuv, 9 mavzu, valyuta kurslari, tarozi, davom ettiriladigan o'rnatuvchi yuklash/yuklab olish.

**Audit (mavjud holat, kod bo'yicha):**
- to'lov: web POS va offline `sale.complete` — bitta asosiy usul (`paymentMethod` + `amountPaid`) + balans/keshbek + har valyutaga bitta naqd/karta; `customer_payments` to'lov taqsimoti vazifasini bajaradi (usul, summa, valyuta, kurs, hisob, jurnal); `pos_shifts` da bank/o'tkazma yig'indisi yo'q; qaytarishda bitta `refundMethod`; web savdoda idempotentlik kaliti yo'q (offline — `opId` bor)
- valyuta: `company_currencies` va `exchange_rates` tarixi (eski kurs saqlanmaydi); hujjatlarda kurs snapshot bor va qayta hisoblanmaydi; `currency_rates.*` ruxsatlari yo'q; kassada faqat ko'rish
- mavzular: faqat yorug'/qorong'i (`.dark`), sozlama qurilma darajasida (kassir bo'yicha emas), ~119 qattiq rang klassi
- tezkor sotuv: yo'q; POS ro'yxati — jadval (rasm, kategoriya tablari yo'q); mahsulot rasmi `imageKey` (S3, production'da sozlanmagan) pull'da yo'q; aksiya narxi (`promoPrice`) kassada ham, serverda ham narx hisobiga qo'llanmaydi
- tarozi: yo'q — tortiladigan mahsulot/PLU maydonlari va serial/USB kutubxonasi yo'q
- o'rnatuvchi: bitta so'rovda oqim bilan yuklash (uzilsa 0% dan), yuklab olishda Range yo'q

| # | Bosqich | Holat |
|---|---------|-------|
| K1 | Davom ettiriladigan o'rnatuvchi: bo'laklab yuklash, HTTP Range bilan yuklab olish, `.part` | ✅ |
| K2 | Aralash to'lov (naqd + karta + bank) — server, offline sinxron, qaytarishda tarkib, smena yig'indilari, idempotentlik | ✅ |
| K3 | Valyuta kurslari — ruxsatlar, tarix (eski → yangi), kassadan tahrirlash, offline holat | ✅ |
| K4 | 9 mavzu, kassir tanlovi, kompaniya qulfi | ✅ |
| K5 | Tezkor sotuv — assortiment, 7/30/90 kunlik top, rasm keshi, kategoriya, aksiya narxi | ✅ |
| K6 | Tarozi — ScaleProvider adapterlari, sozlamalar, sinxron navbati, og'irlik (protokol hujjati bo'lmasa — simulyator va aniq hisobot, soxta "ulandi" yo'q) | ✅ (real uskunada tekshirilmagan) |
| K7 | Premium mavzu tizimi (12 mavzu, `--pos-*` tokenlari, maxsus mavzu, kompaniya qulfi, kassir tanlovi) va kassa ekrani UI/UX | ✅ (haqiqiy sensorli ekranda va to'liq Electron E2E da tekshirilmagan) |

**K1 — davom ettiriladigan o'rnatuvchi** (migratsiya 0037 — faqat yangi ustunlar va holatlar):
- `desktop_releases`: `uploading` (qisman) → `draft` (to'liq, SHA-256 tekshirilgan) → `published` → `archived`; `failed` — SHA-256 mos emas. Ustunlar `chunk_size`, `expected_size`, `expected_sha256`, `error`
- API (platforma admini): `POST /api/platform/desktop-releases/uploads` {version, fileName, size, sha256, chunkSize 1–16 MB} — shu fayl bilan yuklanayotgan sessiya bo'lsa o'shani qaytaradi (davom ettirish), boshqa fayl — 409, `failed` versiya qayta boshlanadi; `GET …/uploads/:id` — serverdagi bo'laklar; `PUT …/uploads/:id/chunks/:index` (octet-stream, `x-chunk-sha256`) — hajm aniq tekshiriladi, yo'lda buzilgan bo'lak 400 (`chunk_checksum`), takroriy bo'lak ustiga yoziladi (ikki marta sanalmaydi), sessiya `FOR SHARE` bilan (yakunlash bilan to'qnashmaydi, bo'laklar parallel); `POST …/complete` — barcha bo'laklar va hajm, SHA-256 serverda bo'laklar bo'yicha, mos kelmasa `failed` (bo'laklar o'chiriladi) va 422 `CHECKSUM_MISMATCH`; `POST …/abort`. Tugallanmagan reliz e'lon qilinmaydi va arxivlanmaydi. Audit `DESKTOP_RELEASE_UPLOAD_STARTED / UPLOADED / UPLOAD_FAILED / UPLOAD_ABORTED`. Xavfsiz fayl nomi (yo'l belgilarisiz), 1 GB chegara
- yuklab olish (qurilma tokeni; web `pos.devices.manage`): `Accept-Ranges`, `ETag` (= SHA-256), bitta oraliq va suffix `Range`, `If-Range` mos kelmasa — butun fayl, fayldan tashqari — 416; xotirada bitta bo'lak. Katta fayl bitta so'rovga bog'lanmaydi (Railway proksi)
- web Admin → "Desktop kassa": fayl SHA-256 si brauzerda bo'laklab (`packages/shared` `Sha256` — `crypto.subtle` butun faylni talab qiladi), 8 MB bo'laklar 3 parallel, har bo'lak SHA-256 bilan, qayta urinish (eksponensial kutish, 6 marta), "To'xtatish" / "Davom ettirish"; sahifa yangilansa shu faylni qayta tanlash yetarli; relizlar ro'yxatida qisman yuklangan qism (MB / MB, %), bekor qilish, yaroqsiz sababi
- desktop: yangilanish `.part` faylga (har bo'lak diskka yozilgach keyingisi o'qiladi); uzilsa keyingi bosishda `Range` + `If-Range` bilan davom etadi; boshqa relizning qismi o'chiriladi; 416 — boshidan; yakunda SHA-256 oqim bilan (100 MB+ xotiraga yuklanmaydi), mos kelmasa qism o'chiriladi; Sozlamalar → Ilova versiyasi: "Yuklab olishni davom ettirish" va yuklangan MB
- relizlar platforma darajasida (kompaniyaga tegishli emas) — himoya: platforma admini, qurilma tokeni yoki kompaniyada `pos.devices.manage`
- testlar: `desktop-release-resumable` (2) — 27% da uzilish va davom, buzilgan va noto'g'ri hajmdagi bo'lak, takroriy bo'lak, 70% dan davom, teskari tartib, SHA-256 va e'lon, Range (27% dan, bo'laklar chegarasi, suffix, If-Range, 416), web Range; SHA-256 mos kelmasa `failed` va e'lon qilinmaydi, qayta boshlash, bekor qilish, parallel sessiyalar; `shared-sha256` (node:crypto bilan solishtirish); desktop 27 — yuklab olish 27% va 70% da uzilib davom etadi (`Range` sarlavhalari va fayl tekshiriladi)

**K2 — aralash to'lov** (migratsiya 0038 — faqat yangi ustunlar, indeks va kengaytirilgan CHECK):
- sxema: `pos_shifts.total_bank` (bank va o'tkazma tushumi — oldin hech qaysi smena yig'indisida yo'q edi), `sales_orders.client_request_id` (kompaniyada unikal, null emas bo'lsa), `sales_returns.refunds` jsonb (`[{method, amount}]`), `refund_method` CHECK: `cash | card | bank | balance | mixed`
- to'lov taqsimoti — mavjud `customer_payments` (har qism: usul, summa, valyuta, kurs, kassa/bank hisobi, jurnal yozuvi) — alohida `sale_payments` jadvali shart emas
- server `completeSale` (web `POST /api/sales/pos/sales` va offline `sale.complete`): ixtiyoriy `payments: [{method: cash|card|bank, amount}]` (har usul bir marta); karta+bank qoldiqdan oshsa — 400, ortig'i faqat naqddan qaytim; mijozsiz qoldiq > 0 — 400 (mijoz bilan — mavjud qarz mantiqi o'zgarmadi); har qism alohida to'lov: naqd → kassa (1010), karta/bank → bank hisobi (1020), har biri o'z kassa harakati va jurnali; smena: naqd, karta, bank alohida; javob va audit `POS_SALE_COMPLETED` da `payments`. Eski `paymentMethod` + `amountPaid` bir qismli to'lov sifatida aynan oldingidek ishlaydi
- idempotentlik: web — `clientRequestId` (smena qulfi ostida tekshiriladi; takror — 409 `details: {duplicate, orderId, number}`, ikkinchi chek/to'lov/jurnal yo'q); offline — mavjud `opId`
- qisman qaytarish (`POST /api/sales/orders/:id/return-items` va offline `sale.return`): ixtiyoriy `refunds: [{method: cash|card|bank|balance, amount}]` — yig'indisi qaytadigan pulga aynan teng (online; aks holda 400 va to'g'ri summa), har usul chekda shu usulda to'langanidan (oldingi qaytarishlar ayirilgan) oshmaydi, balansga — cheklovsiz; offline'da yig'indi server hisobidan farq qilsa (masalan, avval qarz yopiladi) rad etilmaydi — ulush bo'yicha moslanadi. Har qism — alohida kassa harakati va jurnal (havola usul bilan: `sales_return_cash/_card/_bank`), smenadan usul bo'yicha ayriladi; asl sotuv hujjati o'zgarmaydi. Eski `refundMethod` o'zgarishsiz
- to'liq qaytarish (`POST /api/sales/orders/:id/return`): usul ko'rsatilmasa — asl tarkib bo'yicha (naqd — kassaga, karta va bank — bankdan, `sales_refund_cash/_card/_bank`), smena yig'indilari usul bo'yicha
- qurilma chek qidiruvi (`GET /api/pos-device/receipts/:number`): `refundable` — usullar bo'yicha qolgan qaytariladigan pul
- desktop: `sale-calc` server bilan bir xil (summa null — shu usulga qoldiq); kassa oynasida Naqd / Karta / Bank qatorlari (har birida summa, "qoldiq" tugmasi), To'lanadi / To'langan / Qoldiq, qaytim faqat naqddan; hech narsa kiritilmasa — tanlangan usulda aniq summa (tez yakunlash, F-tugmalar); summa kiritilgan bo'lsa F-tugma qolgan summani shu usulga yozadi; "Qarzga (mijoz hisobiga)"; yoqilmagan usul qabul qilinmaydi. Chek hujjatida `payments`, chop etiladigan chekda va chek oynasida har usul alohida, pul qutisi naqd qismi bo'lsa ochiladi. Qaytarish oynasi: chekdagi to'lov tarkibi, "Usullarga taqsimlash" (standart — naqd, karta, bank tartibida to'langanigacha), yig'indi va chegaralar tekshiruvi. X/Z-hisobot: tushum va qaytarish usul bo'yicha (bank ham), kutilgan naqd — faqat naqd qismlari
- to'liq API: 291/291 (75 fayl); desktop 28/28
- testlar: `pos-mixed-payment` (3) — rad etishlar (karta/bank ortiqcha, qoldiq, takroriy usul, to'lovsiz), naqd + karta + bank va qaytim, `customer_payments`, kassa/bank qoldiqlari, 1010/1020/1100/4000, takroriy `clientRequestId`, smena yig'indilari, eski usul va bank; qaytarish taqsimoti, usul chegarasi, yig'indi, ikkinchi qaytarish, to'liq qaytarish tarkibi; offline `sale.complete`/`sale.return` va ulush bo'yicha moslash. Desktop: `sale-calc` (7 kombinatsiya, qoldiq usuli, ortiqcha, qaytim, qarz, takroriy), `kassa-service` (aralash chek, taqsimlangan qaytarish, `refundable`, X-hisobot, smena yig'indilari)

**K3 — valyuta kurslari** (migratsiya 0039 — `exchange_rates.old_rate`, `device_id` va mavjud rollarga ruxsatlar):
- ruxsatlar: `currency_rates.view` (Kassir, Savdo menejeri, Auditor, Ko'ruvchi, Buxgalter, Moliya menejeri, Direktor), `currency_rates.manage` (Buxgalter, Moliya menejeri, Direktor; egalar — hammasi); yangi kompaniyalar — standart rollarda, mavjudlari — migratsiyada
- tarix: har o'zgarishda eski kurs, yangi kurs, kim, qachon, manba (qo'lda / Markaziy bank), kassadan bo'lsa qurilma; `CURRENCIES_UPDATED` auditida kurs o'zgarishlari, bitta kurs — `CURRENCY_RATE_CHANGED` (`oldRate`, `newRate`, qurilma)
- API: `PUT /api/finance/currencies/:code/rate` (`currency_rates.manage`; asosiy valyuta 400, qo'shilmagan 404, o'chirilgani 400, xuddi shu kurs — yozilmaydi), `GET /api/finance/currencies/history?code&limit` (`currency_rates.view`); eski hujjatlar o'z kursi va asosiy valyutadagi summasini saqlaydi — kurs o'zgarsa qayta hisoblanmaydi (sotuv qatori `lineTotal`/`unitPrice` test bilan tekshirildi); tashqi kurs API'siga bog'liqlik yo'q (Markaziy bank — ixtiyoriy, avvalgidek)
- kassa: pull `currencies` da manba, oxirgi o'zgarish vaqti va kim; offline `currency.rate` op (ko'rgan va yangi kurs): server kursi hali ko'rgani — yoziladi (tarixda qurilma), allaqachon yangisi — hech narsa, boshqa — server kursi qoladi va `record_changed` nomuvofiqligi; `GET /api/pos-device/currencies/history?cashierId&code` (kassirda `currency_rates.view`)
- desktop Sozlamalar → Valyuta kurslari: ko'rish ruxsati bilan; kurs, oxirgi o'zgarish (vaqt, kim), manba yoki "kassada o'zgartirildi (yuborilmagan)", internet yo'q bo'lsa — "oxirgi saqlangan kurslar ishlatilmoqda" va oxirgi sinxron vaqti; `currency_rates.manage` bilan — yangi kurs va Saqlash (lokal kurs darhol, keyingi cheklar yangi kurs bilan, navbatga `currency.rate`); tarix — server (internet bilan) va shu kassaning yuborilmaganlari
- web Sozlamalar → Valyutalar: kurs o'zgarishlari tarixi jadvali (eski/yangi, manba, kim, kassa); `settings.manage` bo'lmasa ham `currency_rates.manage` bilan — bitta kursni o'zgartirish
- to'liq API: 293/293 (76 fayl); desktop 28/28
- testlar: `currency-rates` (2) — ruxsatlar, tarix (eski → yangi, kim), takror kurs, 400/404, boshqa kompaniya, audit, eski savdo summasi o'zgarmaydi va yangi savdo yangi kurs bilan; pull maydonlari, `currency.rate` qo'llanishi, nomuvofiqlik, ruxsatsiz rad, qurilma tarixi (kassa nomi). Desktop: kassadan kurs (ruxsat, asosiy valyuta, noto'g'ri kurs, lokal holat, tarix offline, navbat payload)

**K4 — kassa mavzulari** (migratsiyasiz — kompaniya sozlamasi `pos.appearance`):
- 9 mavzu: Yorug', Qorong'i, Ko'k, Yashil, Binafsha, To'q sariq, Yuqori kontrast (qora fon, oq matn, sariq asosiy rang, aniq chegaralar), Klassik POS (kulrang fon, to'rtburchak burchaklar), Windows bo'yicha (tizim yorug'/qorong'i rejimini kuzatadi). `packages/shared` `POS_THEMES` va desktop `shared/themes.ts` — bir xil ro'yxat
- qo'llanishi: desktop `renderer/index.css` dagi `[data-theme]` bloklari — faqat rang tokenlari (fon, matn, karta, asosiy, chegara, sidebar …), har mavzu to'liq to'plam; `html[data-theme]` va qorong'i mavzularda `.dark` — POS, sidebar, kartalar, savat, tugmalar, oynalar, jadvallar, formalar hammasi tokenlar orqali. Hisob, qoldiq, to'lov, sinxronga ta'sir qilmaydi; chop etiladigan chek o'z CSS'i bilan
- kassir tanlovi: qurilmada kassir bo'yicha (`cashierPrefs:<userId>`) — qayta kirganda tiklanadi; kassir kirmagan — qurilma standarti. Kompaniya qulfi (`config.appearance`, pull xeshi o'zgarsa keladi) hammasidan ustun: kassada o'zgartirib bo'lmaydi (`FORBIDDEN`), qulf olinsa kassirning o'z tanlovi qaytadi
- desktop Sozlamalar → Tashqi ko'rinish: 9 ta oldindan ko'rish kartasi (har karta o'z mavzusi tokenlari bilan chiziladi, "Windows bo'yicha" — yorug' va qorong'i yarmi), qulflangan bo'lsa ogohlantirish va kartalar o'chiq
- web Sozlamalar → Kassa qurilmalari → "Kassa ko'rinishi": qulflash va mavzu tanlash; API `GET/PUT /api/pos/devices/appearance` (`pos.devices.manage`)
- to'liq API: 294/294 (77 fayl); desktop 29/29
- testlar: `pos-appearance` (1) — standart, ruxsat, noto'g'ri mavzu, qurilma config va xesh; desktop — kassir tanlovi va tiklanishi, qurilma standarti, qulf ustunligi va rad, qulf olinishi

**K5 — tezkor sotuv** (migratsiya 0040 — faqat yangi `product_images` jadvali):
- assortiment: kompaniya sozlamasi `pos.quickSale` — mahsulotlar tartibi bilan, 200 tagacha; boshqa kompaniya, yo'q yoki sotilmaydigan mahsulot — 400, takrorlar olib tashlanadi, o'chirilgan mahsulot ro'yxatdan tushadi. API `GET/PUT /api/pos/devices/quick-sale` (`pos.devices.manage`); qurilmaga pull `config.quickSale` (xesh o'zgarsa) — offline ishlaydi
- tavsiya: `GET /api/pos/devices/quick-sale/suggestions?days=7|30|90` — shu davrda kassa cheklarida (`is_pos`, hisobga olinadigan holatlar) eng ko'p sotilgan faol mahsulotlar; shu davrdagi qaytarishlar ayiriladi, teng bo'lsa ko'proq chekda uchragani oldin
- aksiya narxini server hisoblaydi: POS `completeSale` `prepareSalesItems` ga sotuv sanasini beradi (onlayn — bugun, offline — sotuv lahzasi, UTC kuni) va shu kunda amaldagi `promoPrice` (`promoPriceEnd` kuni ham kiradi, bo'sh — muddatsiz) prays-list narxi bo'ladi. Kassa yuborgan narx faqat solishtiriladi: onlayn `sales.edit`siz farq — 403, offline — chek yoziladi va `price_changed` nomuvofiqligi. Qoida `packages/shared` `activePromoPrice` va desktop `sale-calc` da bir xil. Web POS ham aksiya narxini ko'rsatadi va yuboradi (AKSIYA belgisi, eski narx chizilgan). Savdo buyurtmalari (web, agent) narxlashi o'zgarmadi
- mahsulot rasmi bazada (production'da S3 sozlanmagan): `product_images` (mahsulotga bitta; `products.image_key` = `db/product-image/<uuid>.<ext>`). `PUT /api/files/product-image/:productId/content` — JPG/PNG/WEBP, 5 MB, fayl boshidagi imzo e'lon qilingan turga mos bo'lishi shart (SVG/HTML rad), `products.edit`, audit `FILE_ATTACHED` (`storage: database`); `GET …/content` — `products.view`; `GET /api/files/url` bazadagi rasm uchun shu yo'lni qaytaradi; ajratish yoki S3 rasmiga almashtirish bazadagi yozuvni o'chiradi. S3 sozlangan bo'lsa avvalgi imzolangan URL oqimi. Web mahsulot formasi `/uploads` 503 bersa rasmni avtomatik bazaga yuklaydi; nginx shu yo'lga 6 MB
- qurilma: pull `products.imageKey`; `GET /api/pos-device/products/:id/image` (token): bazadagi — mazmun, S3 dagisi — imzolangan havolaga 302, rasmsiz yoki boshqa kompaniya mahsuloti — 404
- desktop: SQLite v6 — `products.category_id` (indeks bilan) va mahsulotlar bir marta qayta olinadi (`imageKey` uchun). Rasm `bum-image://product/<id>?v=<versiya>` protokoli orqali: main jarayon diskdagi keshdan (`userData/product-images`, versiya — kalit xeshi, eski versiya o'chiriladi, yozish vaqtinchalik fayl orqali) yoki serverdan; topilmagani 10 daqiqa, xato 1 daqiqa qayta so'ralmaydi; offline — keshdagisi, bo'lmasa bosh harflar belgisi. Disk yo'li va token renderer'ga chiqmaydi; CSP `img-src … bum-image:`
- kassa ekrani: "Tezkor sotuv" / "Barcha mahsulotlar" tablari (assortiment tanlanmagan bo'lsa — barcha mahsulotlar va web'dagi joy ko'rsatiladi), kategoriya tablari (ichki kategoriyalar ota tabga qo'shiladi), "Kartalar" / "Jadval" (kassada saqlanadi). Karta: rasm (`loading="lazy"`), nom, narx, birlik, qoldiq, AKSIYA (eski narx chizilgan), mijoz CHEGIRMA foizi, savatdagi soni; rasm yoki nomni bosish — savatga +1; ⓘ — batafsil (katta rasm, aksiya muddati, soliq, miqdor bilan qo'shish). Qidiruv va skaner doim barcha mahsulotlar bo'yicha (tanlangan kategoriya bilan). Ro'yxat 120 tadan ("Yana ko'rsatish", 960 gacha) — 100 minglab mahsulotda ekranga cheklangan qism, filtr SQLite indeksi bilan; jadvalda ham kichik rasm
- web Sozlamalar → Kassa qurilmalari → "Tezkor sotuv": assortiment (tartib ↑↓, olib tashlash, Saqlash / Bekor qilish, soni), 7/30/90 kunlik tavsiya ("Qo'shish", "Hammasini qo'shish"), mahsulot qidiruvi
- ruxsatlar: assortiment — `pos.devices.manage` (kassa sozlamalari kabi), kassada ko'rish va sotish — mavjud `pos.use`; alohida `pos.quick_sale` ruxsati qo'shilmadi (mavjud RBAC bilan yopildi, rol migratsiyasi shart emas)
- to'liq API: 298/298 (78 fayl); desktop 31/31; tsc (API, desktop main/renderer, web) va lint — toza

**K6 — tarozilar** (migratsiya 0041 — `products.is_weighted`, `products.plu_code` (kompaniyada unikal, 1–999999) va mavjud rollarga `scale.*`; desktop SQLite v7 — navbat jadvallari, PLU ifoda indeksi):
- ruxsatlar: `scale.view` (Kassir, Savdo menejeri, Ombor menejeri, Direktor, Auditor, Ko'ruvchi), `scale.sync` (Savdo menejeri, Ombor menejeri, Direktor), `scale.manage` (Ombor menejeri, Direktor); egalar — hammasi. Kassada og'irlik o'qish — `pos.use`. Kassir ruxsati main jarayonda tekshiriladi
- mahsulot: web formada "Tarozida tortiladi" va "Tarozi PLU kodi" (band PLU — 400 va qaysi mahsulotda); pull `isWeighted`, `pluCode`
- arxitektura: UI (Sozlamalar → Tarozilar, kassa ekrani) → IPC `scale:*` (12 kanal) → `ScaleService` (sozlama, navbat, to'liq sinxron, solishtirish) → `ScaleProvider` adapteri → transport: LAN — `node:net` TCP; COM — Windows PowerShell'dagi .NET `System.IO.Ports.SerialPort` (alohida jarayon, sozlamalar muhit o'zgaruvchilarida, vaqt chegarasi; native modul qo'shilmadi); USB — virtual COM port
- adapterlar: **Simulyator** (uskunasiz: og'irlik, PLU yuborish/o'chirish/ro'yxat — kassa bazasida); **Umumiy ASCII** — og'irlik satri ("ST,GS,+ 1.234kg", gramm, vergul, manfiy): tarozi uzluksiz yuboradi yoki sozlamadagi so'rov buyrug'i, barqaror (ST) kutiladi; mahsulot yuborish yo'q; **Shtrix-M, YES POS, Rongta** — almashinuv protokoli hujjati yo'q: taroziga hech qanday bayt yuborilmaydi, "Tekshirish" faqat TCP port ochiqligini aytadi ("port ochiq, protokol tasdiqlanmagan"), og'irlik va PLU — `PROTOCOL_DOCS_REQUIRED` va aynan qaysi hujjat kerakligi. Soxta "ulandi" yoki "yuborildi" yo'q
- sinxron navbati (`scale_sync_queue`): PENDING → PROCESSING → SUCCESS; xato — PENDING va eksponensial kutish (5 s, 10 s, 20 s … 10 daqiqagacha), urinishlar (1–20, standart 5) tugasa FAILED; protokol hujjati yo'q yoki qo'llab-quvvatlanmaydi — darhol FAILED; qo'lda qayta yuborish (hammasi yoki bittasi); bir tarozi va PLU bo'yicha bitta kutayotgan yozuv; ilova yopilgan bo'lsa PROCESSING qayta navbatga; SUCCESS 7 kun saqlanadi. Avtomatik: pull'da yoki kassada (narx) o'zgargan mahsulot har sinxron siklidan keyin — internetsiz ham (tarozi LAN/COM'da): tortiladigan va nomi/narxi o'zgargan — yuboriladi, endi tortilmaydigan yoki PLU'si o'zgargan — tarozidan o'chiriladi. Taroziga yuborilgani `scale_plu_state` da (nomi, narxi) — o'zgarmagani qayta yuborilmaydi. Narx — 1 kg uchun asosiy valyutada, bugungi aksiya bilan
- to'liq sinxron: barcha tortiladigan mahsulotlar yuboriladi, keraksiz PLU'lar o'chiriladi (tarozi ro'yxat bersa — undagi begonalar ham); progress (jami / yuborilgan / xato) sozlamalarda yangilanib turadi
- solishtirish: tarozidan o'qilgan ro'yxat (bermasa — kassa yozuvlari) bilan: taroziga yetmagan, tarozida ortiqcha, nomi yoki narxi farqli, mos
- og'irlik savatga: tortiladigan mahsulot kartasi yoki qatori bosilganda yoqilgan birinchi og'irlik o'qiydigan tarozidan; barqaror emas yoki 0 — qo'shilmaydi (xabar); tarozi sozlanmagan — 1 qo'shiladi va miqdorni kiritish xabari
- tarozi etiketkasi shtrix-kodi (EAN-13, GS1 do'kon prefiksi 20–29): prefikslar, PLU uzunligi (4–6), og'irlik kasrlari sozlanadi, nazorat raqami tekshiriladi; skanerda oddiy shtrix-kod ustun, keyin etiketka — PLU bo'yicha mahsulot va etiketkadagi og'irlik
- Sozlamalar → Tarozilar (qurilmada, offline): qo'shish/tahrirlash (turi, LAN IP va port yoki COM port, tezlik, bitlar, juftlik, stop; yoqilgan, avtomatik sinxron, urinishlar, so'rov buyrug'i, simulyator og'irligi), holat belgisi (Simulyator / Ulangan — og'irlik o'qildi / Port ochiq — protokol tasdiqlanmagan / Ulanib bo'lmadi / Protokol hujjati kerak / Xato), navbat hisoblari, Tekshirish, Sinxron, To'liq sinxron, Solishtirish, Navbat jadvali (holat filtri, xato matni, keyingi urinish, qayta yuborish), etiketka formati
- real uskunada TEKSHIRILMAGAN: COM port (PowerShell SerialPort) va Shtrix-M / YES POS / Rongta. Tekshirilgani — simulyator, soxta TCP tarozi, hujjatsiz adapterlar bayt yubormasligi, navbat mantiqi
- testlar: desktop `scale` (6) — ASCII og'irlik satri, EAN-13 etiketka (nazorat raqami, prefiks, PLU uzunligi, 0 og'irlik), umumiy ASCII soxta TCP tarozida (barqaror kutish, so'rov buyrug'i, faqat beqaror, javobsiz, yopiq port), Shtrix-M / YES POS / Rongta taroziga bayt yubormasligi va `PROTOCOL_DOCS_REQUIRED`, COM nomi va platforma, sozlama tekshiruvi, simulyator (sinov, og'irlik, yuborish, solishtirish, o'chirish), navbat (faqat tortiladigan, 5 s va 10 s kutish, muddatidan oldin yuborilmaydi, FAILED va qo'lda qayta, o'zgarmagani qayta yuborilmaydi, narx va PLU o'zgarishi, tortilmaydigan bo'lsa o'chirish, to'liq sinxron progress, begona PLU va nom farqi, PROCESSING tiklanishi); `kassa-service` (ruxsatlar, etiketka skaneri, simulyator og'irligi, sinxrondan keyin avtomatik yuborish, solishtirish); API `product-scale-fields` (2) — PLU unikalligi va oralig'i, tahrirlash, pull, kassir ruxsatlari, standart rollar
- to'liq API: 300/300 (79 fayl); desktop 38/38; tsc (API, desktop main/renderer, web) va lint — toza

**Tuzatish (2026-09-12) — kassada "Ruxsat yo'q: scale.view / currency_rates.view":** kassir yozuvi kassaga faqat a'zolik yoki foydalanuvchi o'zgarganda qayta kelardi; yangi ruxsatlar esa rollarga migratsiya (0039, 0041) va katalog orqali qo'shildi (egasi — `ALL_PERMISSIONS`) — kassa eski ro'yxatni saqlab qolgan. Endi pull'da hamma a'zolar ruxsatlari (rollar bitta so'rovda, `permissionsFromRoles` — `membershipPermissions` bilan bir xil qoida) xeshi config xeshiga qo'shiladi; qurilmadagi xesh boshqa bo'lsa kassirlar kursorsiz qayta yuboriladi — rol tahriri, migratsiya yoki yangi ruxsatdan keyin keyingi sinxronda kuchga kiradi (o'rnatilgan 0.3.0 kassada ham, qayta o'rnatishsiz). Desktop 0.3.1: holat (`app:status`) kassir ruxsatlarini bazadan yangilaydi, Tarozilar paneli sozlamalar ma'lumotidagi ruxsatlardan foydalanadi. Test: `pos-cashier-permissions` (1) — o'zgarishsiz takror yo'q, rol bazada o'zgarsa config va kassirlar qayta keladi, egasi ham, `pos.use` olinsa `active: false`. To'liq API: 301/301 (80 fayl); desktop 38/38; tsc va lint — toza
- testlar: `pos-quick-sale` (4) — assortiment (tartib, takror, boshqa kompaniya, noma'lum, sotilmaydigan, 201 ta, kassir 403, pull config va xesh, o'chirilgan mahsulot), tavsiyalar (7/30/90 davr, chek soni bo'yicha tartib, noto'g'ri davr, kassa bo'lmagan buyurtma), aksiya (amaldagi, muddatsiz, o'tgan; aksiya narxini yuborish qabul, eski narx 403; offline `price_changed`), bazadagi rasm (S3 yo'q — 503, imzosi mos emas / tur boshqa — 400, kassir 403, havola va mazmun, pull `imageKey`, qurilma rasmi, rasmsiz va boshqa kompaniya 404, almashtirish, ajratish). Desktop: `sale-calc` (aksiya qoidasi, oxirgi kun, valyuta va birlik, UTC sana), `kassa-service` (assortiment tartibi va filtrlari, kategoriya tablari, aksiya narxi kartada va chekda, sales.edit rad, ko'rinish sozlamasi, rasm keshi, offline, rasm almashtirilishi)

**K7 — premium mavzu tizimi va kassa ekrani UI/UX** (migratsiyasiz — kompaniya sozlamasi `pos.appearance` kengaytirildi; desktop 0.4.0):
- 12 mavzu: 🌑 Midnight POS (yumshoq qorong'i, qora emas), ❄️ Snow POS (oq emas, ko'zni qamashtirmaydi), 🌊 Ocean Blue, 💚 Emerald (asosiy — ko'k-yashil, muvaffaqiyat — alohida sariq-yashil), 💜 Royal Purple (aksiya — qizil-pushti), 🟠 Sunset Orange (ogohlantirish zaytun-sariq, xato qizil — to'q sariqdan ajraladi), 🌫️ Graphite (neytral kulrang), ✨ Glass POS (blur faqat panel/modal, 12–16 px; savat va kartalar deyarli to'liq), ⚡ Neon Night (glow faqat hover/fokus), 🛒 Classic Supermarket (katta elementlar va to'lov tugmasi, animatsiyasiz), 👁️ High Contrast (qora fon, sariq asosiy, qalin fokus, shrift kamida "Katta", animatsiyasiz), 💻 Windows System (tizim rejimini jonli kuzatadi). 🩶 va 🪟 Windows 10 shriftida yo'q (kvadrat chiqardi) — o'rniga 🌫️ va 💻. Eski qiymatlar o'qilganda moslanadi: light→snow, dark→midnight, blue→ocean, green→emerald, purple→royal, orange→sunset
- tokenlar (`apps/desktop/src/renderer/index.css`): asosiy (shadcn: background, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, sidebar…) + kassa `--pos-*`: surface, topbar, cart, total, category/active, action (to'lov tugmasi) va hover, selected, price, focus, shadow/hover, backdrop, glass-blur; semantik success, warning, danger, info, promotion (+ foreground), stock ok/low/out. Tailwind `@theme inline` — `bg-pos-*`, `text-pos-*`; zichlik `data-density` (compact / comfortable / touch): `--pos-tap-size`, karta o'lchami, oraliq. Renderer'dagi qattiq palitra ranglari (emerald/amber/sky/violet va `dark:`) tokenlarga o'tkazildi — kassa ekrani qayta yozildi, 23 faylda 134 almashtirish; qoldiq 0 (grep)
- kontrast: 11 tayyor mavzuda 25 juft (matn/fon, kartadagi semantik ranglar, to'lov tugmasi, jami bloki, sidebar, fokus halqasi) oklch → sRGB bo'yicha hisoblandi — hammasi WCAG ≥ 4.5 (fokus va asosiy rang ≥ 3); Emerald success 4.49 edi — tuzatildi. Qo'lda ekran o'quvchi va rang ko'rligi simulyatsiyasi qilinmagan
- ustuvorlik: kompaniya qulfi → kassir tanlovi → kompaniya standarti → Windows. Kassir tanlovi (mavzu, zichlik, shrift) qurilmada `cashierPrefs:<userId>` — qayta ishga tushirishda va qayta kirishda tiklanadi; "Kompaniya standartiga qaytarish" (`cashierTheme: null`); qulf bo'lsa o'zgartirish `FORBIDDEN`. Kassa sinxrondan keyin sozlamani qayta o'qiydi — web'da qulf yoki standart o'zgarsa keyingi sinxronda qo'llanadi
- maxsus mavzu (web Sozlamalar → Kassa qurilmalari → "Kassa ko'rinishi", `pos.devices.manage`): nomi, asos (yorug'/qorong'i), primary, secondary, background, surface, card, button, sidebar, accent, radius 0–24, soya, zichlik, shrift; har rang yonida kontrast nisbati, jonli mini-kassa ko'rinishi. API `PUT /api/pos/devices/appearance` `custom` ni tekshiradi: har rang matni ≥ 4.5, primary/background ≥ 3, button/surface ≥ 3 — aks holda 400 va `issues`; `custom` berilmasa — saqlanadi, `null` — o'chiriladi, "custom" mavzu maxsus mavzusiz — 400. Kassa buzilgan maxsus mavzuni qabul qilmaydi (Windows rejimiga qaytadi)
- desktop Sozlamalar → Tashqi ko'rinish: galereya (har mavzu — haqiqiy mini-kassa: sidebar, kartalar, savat, jami, to'lov tugmasi), bosilganda katta jonli ko'rinish (faqat namunada — ilovaga tegmaydi), "Qo'llash" / "Bekor qilish", manba belgisi (kompaniya qulfi / sizning tanlovingiz / kompaniya standarti / Windows), qulf ogohlantirishi, Zichlik va Shrift o'lchami (Oddiy / Katta / Juda katta)
- kassa ekrani: chapda bo'limlar paneli (Bosh sahifa, Tezkor sotuv, Sotuv, Sotuv tarixi, Kassa hisobi, Mijozlar, Xarid — `purchase.create`/`warehouse.receive`, Ombor — `warehouse.view`, Hisobotlar — `analytics.view`, Sozlamalar); yuqori panel — kompaniya va kassa, smena (chek soni, tushum), sinxron (Online / Offline / navbatdagi soni, bosilsa — yuborilmagan cheklar), printer (tanlangan printer Windows ro'yxatida bormi — qog'oz/ulanish holatini bildirmaydi), tarozi (`scale.view` va yoqilgan tarozi bo'lsa — oxirgi tekshiruv natijasi), kassir, soat; holatlar rang + ikonka + matn. Menyu → Ko'rinish → Mavzu (darhol, savat saqlanadi; qulf bo'lsa o'chiq)
- mahsulot kartasi: 3:2 rasm, qalin narx va "/ birlik", qoldiq holati matn bilan (Bor / Kam — `minStock` gacha / Tugagan / Minus), AKSIYA va CHEGIRMA belgilari, savatdagi soni; hover — ko'tarilish, chegara, soya (sensorli ekranda hover'ga bog'liq emas); bosish — darhol +1 (tasdiqsiz, qisqa "bosildi" animatsiyasi), uzoq bosish (550 ms), o'ng tugma yoki ⓘ — batafsil (katta rasm, −/+ miqdor). Kategoriya tablari: gorizontal, g'ildirak, ← →, sensorli
- savat: qatorda rasm, nom, summa; −/miqdor/+ (zichlikka qarab kattalashadi), birlik, narx (`sales.edit` bilan tahrir), chegirma, qoldiq ogohlantirishi, 🗑; qo'shilgan qator yoritiladi. Jami bloki doim ko'rinadi: Mahsulotlar / Chegirma / QQS / JAMI. To'lov: NAQD / KARTA / BANK yonma-yon, summa kiritilganda taqsimot chizig'i va "Naqd 30 000 + Karta 20 000 = 50 000", TO'LANADI / TO'LANGAN / QOLDIQ; "SAVDONI YAKUNLASH" (F12) — xato yoki mijozsiz qoldiq bo'lsa o'chiq; yakunlangach "Sotuv yakunlandi: chek …" xabari. 768 px balandlikda to'lov bloki o'z joyida aylanadi, tugma doim ko'rinadi
- holat saqlanishi: kassa ekrani boshqa bo'limga o'tganda o'chirilmaydi (yashiriladi) — savat, joriy sotuv, aralash to'lov summalari, tezkor sotuv tabi/kategoriyasi saqlanadi; yashirin paytda qaynoq tugmalar va skaner savatga yozmaydi. Mavzu faqat CSS atributlari (`data-theme`, `data-density`, `.dark`, maxsus mavzu CSS o'zgaruvchilari) — qayta yuklash va ma'lumotni qayta so'rash yo'q. Sotuv hisobi (`computeSale`), yakunlash, kechiktirish, qaytarish, sinxron, printer, skaner kodi o'zgarmadi
- harakat: 150–180 ms (bosildi, qator yoritilishi, xabar); Classic, High Contrast va tizimdagi "harakatni kamaytirish" da o'chadi. Ingichka mavzu rangidagi aylantirish chiziqlari. Rus tili lug'atiga yangi matnlar
- testlar: API `pos-appearance` (2) — 12 mavzu, eski qiymatlar 400, qulf, xesh, maxsus mavzu kontrasti (`issues`), saqlash/saqlab qolish/o'chirish; desktop `themes` (3) — shared bilan moslik, ustuvorlik matritsasi, maxsus mavzu tokenlari; `kassa-service` — ustuvorlik, qayta ishga tushirish, qulf va qaytarish rad etilishi, eski "green" → emerald, maxsus mavzu; `pos-theme-ui` (9, jsdom) — `applyAppearance` (Windows rejimi o'zgarishi, maxsus tokenlar tozalanishi, yuqori kontrast shrifti), jonli ko'rinish ilovaga tegmasligi, sidebar RBAC, to'lov taqsimoti, karta (bosish, uzoq bosish, qoldiq matni), kategoriya ← →, **regressiya**: savat (2 dona) + aralash to'lov (naqd 10 000, karta 4 000) → Sozlamalar → mavzu → Qo'llash → qaytish — savat, summalar, jami saqlangan, kontekst qayta so'ralmagan; yashirin kassada skaner kodi e'tiborsiz; Menyu → Mavzu (Neon) darhol va qulf bo'lsa o'chiq
- vizual tekshiruv: haqiqiy renderer bundle + soxta preload (namunaviy ma'lumot) bilan Electron skrinshotlari — 1366×768, 1600×900, 1920×1080, 2560×1440; 11 mavzu, sensorli zichlik, "Juda katta" shrift, bo'sh savat, Sozlamalar. Topilgan va tuzatilgan: 768 px da savatga joy yetmasligi, katta shrift/sensorli rejimda savat qatori sig'masligi, Windows 10 da emoji kvadratlari, Glass'da ko'rinmas tugma foni. Bu E2E emas — main jarayon, SQLite, printer va server soxta
- to'liq API: 302/302 (80 fayl; xotira yetmagani uchun 4 qismda, `--maxWorkers=1`); desktop 50/50 (8 fayl); tsc (API, desktop main/renderer, web) va lint — toza
- TEKSHIRILMAGAN: haqiqiy sensorli monitorda uzoq bosish va barmoq bilan aylantirish; to'liq Electron E2E (haqiqiy main jarayon + server); web'da yaratilgan maxsus mavzuning production kassaga yetib borishi (API va desktop alohida testlangan); ekran o'quvchi

## Dostavka / Delivery moduli (2026-09-13)

Talab: "BUM ERP — DOSTAVKA / DELIVERY MASTER PROMPT" (1–62 bo'lim). Asosiy prinsip — ORDER ≠ DELIVERY: yetkazma buyurtmadan alohida obyekt, buyurtmaning miqdori va narxi yetkazmada o'zgarmaydi.

| # | Bosqich | Holat |
|---|---------|-------|
| D1 | 15 ta `delivery.*` ruxsat, "Dostavka agenti" (DELIVERY_AGENT) roli, yetkazuvchi profili — login + a'zolik + HR xodimi + profil bitta tranzaksiyada | ✅ |
| D2 | DeliveryTask sxemasi, 11 holatli o'tishlar (serverda tekshiriladi), tasdiqlangan buyurtmadan avtomatik yoki qo'lda yaratish | ✅ |
| D3 | Supervayzer: biriktirish, boshqa agentga o'tkazish, olib tashlash, qayta rejalash, bekor qilish, tahrir, kunlik tartib | ✅ |
| D4 | Agent jarayoni: qabul → yo'lga chiqish → mijozga yetdim (GPS sifati, geofence) → topshirish (rasm / imzo / OTP, to'lov) → to'liq yoki qisman tasdiqlash, yoki "yetkazilmadi" | ✅ |
| D5 | Qaytgan mahsulotni omborga qabul qilish, to'lov farqi siyosati va ko'rib chiqish | ✅ |
| D6 | Ish sessiyasi va lokatsiya (faqat sessiyada), jonli holat va kunlik iz (audit bilan) | ✅ |
| D7 | Oflayn: o'qish keshi (service worker) va amallar navbati, server har amalni qayta tekshiradi | ✅ (haqiqiy telefonda tekshirilmagan) |
| D8 | Web: yetkazuvchi mobil ish joyi `/delivery-agent` va supervayzer sahifasi `/delivery` | ✅ (brauzerda qo'lda tekshirilmagan) |

**Migratsiya 0042** — faqat qo'shimcha: yangi enumlar va jadvallar, `sales_orders.delivery_required` (null — siyosatdagi standart), "Dostavka agenti" roli va mavjud rollarga `delivery.*` ruxsatlari (Direktor — hammasi; Supervayzer 8; Savdo menejeri 6; Ombor menejeri 2; Auditor va Ko'ruvchi — `delivery.view`). Ma'lumot o'chirilmaydi va o'zgartirilmaydi. Jadvallar: `delivery_agents`, `delivery_tasks` (buyurtmada bitta ochiq yetkazma — partial unique), `delivery_task_items`, `delivery_events` (tarix), `delivery_proofs` (bytea, 3 MB), `delivery_payments`, `delivery_work_sessions`, `delivery_locations`, `delivery_location_latest`.

**Server qoidalari:**
- geofence: masofa serverda (haversine, metrga yaxlitlab); `masofa > radius` — rad (200 m: 199 va 200 — ruxsat, 201 — rad). So'rov tanasi strict — mijoz yuborgan masofa, "ichida" belgisi, agent/kompaniya/mijoz ID'si qabul qilinmaydi. Rad etish hodisa, audit (`DELIVERY_GEOFENCE_BLOCK`) va siyosat bo'yicha bildirishnoma bilan saqlanadi
- GPS: aniqlik ("GPS aniqligi yetarli emas. Iltimos, qayta urinib ko'ring."), eskirgan o'lchov (amal vaqtiga nisbatan), noto'g'ri koordinata; chegaralar kompaniya siyosatida (`delivery.policy`, umumiy sozlamalar PUT orqali yozilmaydi)
- zaxira, qarz va jurnal — mavjud `shipOrder` yo'lga chiqishda (buyurtma "tasdiqlangan" bo'lsa, qulf ostida, bir marta); to'lov — mavjud `recordCustomerPayment` (`delivery:<clientRequestId>` referensi, kassa/bank va jurnal); qaytarish — mavjud `returnSaleItems` (bir marta). Har agent amali `clientRequestId` bilan idempotent — takror to'lov, chiqim, jurnal yoki tasdiqlash yo'q
- qisman yetkazish: yetkazilgan miqdor yetkazma qatorida, kutilgan to'lov yetkazilgan qiymat ulushida, qolgani "Omborga qabul qilish" bilan; buyurtma o'zgarmaydi
- to'lov farqi (masalan 500 000 o'rniga 480 000): siyosat `approval` — supervayzer ko'rib chiqadi, `debt` — farq mijoz qarzida, `block` — tasdiqlash rad etiladi; avtomatik "to'langan" bo'lmaydi, agent nasiya bermaydi
- OTP: faqat HMAC-SHA256 hash, muddat va urinishlar chegarasi; SMS faqat SMS provayder sozlangan bo'lsa (production'da yo'q — supervayzer kodni beradi, javobda bir marta, auditga yozilmaydi)
- oflayn amal: `occurredAt` 120 s gacha — onlayn; eskirog'i — siyosat ruxsati va `offlineMaxAgeHours` ichida, qurilma soati 60 s dan oldinda — rad; amal vaqtida ish sessiyasi ochiq bo'lishi, GPS yangiligi amal vaqtiga nisbatan tekshiriladi
- maxfiylik: agent faqat o'ziga biriktirilgan yetkazmani ko'radi (boshqasi — 404), supervayzer izohi, koordinatalar va hodisa tafsilotlari agentga berilmaydi, qarz — `delivery.view_debt` bilan; lokatsiya faqat faol ish sessiyasida qabul qilinadi, nuqtalar auditga yozilmaydi, iz ko'rish auditga yoziladi (`LOCATION_HISTORY_VIEWED`), saqlash muddati tugagan nuqtalar tozalanadi
- bildirishnoma faqat: yetkazilmadi, to'lov farqi (approval), geofence buzilishi — siyosatdagi oluvchilar yoki dostavka boshqaruvchilari
- xarita: pullik xarita API'si yo'q — 2026-09-14 dan OpenStreetMap + Leaflet (`MapView`), navigatsiya — Google Maps / Yandex / Android navigator havolasi (pastda "Xarita, optimal marshrut va hudud bo'yicha dostavka")

**Web:**
- yetkazuvchi `/uz/delivery-agent` (faqat yetkazuvchi ruxsatlari bor xodim ERP'dan shu yerga yo'naltiriladi): Bosh sahifa (progress, qolgan, yo'lda, kechikkan, yig'ilgan pul naqd/karta/bank, yig'ilishi kutilayotgan, to'lov farqi, mijozlar qarzi, keyingi yetkazma), Yetkazmalar (bugun / keyingi / tarix — mijoz, buyurtma №, summa, sana va vaqt oynasi, to'lov turi, taxminiy masofa, ustuvorlik, holat, KECHIKDI), yetkazma sahifasi (qadamlar, XARITADA OCHISH, MIJOZGA YETDIM, topshirish: rasm — kamera, imzo — canvas PNG, to'lov, OTP; tasdiqlash oynasi — qabul qilingan miqdor, talablar, farq ogohlantirishi; "yetkazib bo'lmadi" — sabablar, "Boshqa" uchun izoh; natija ekrani va KEYINGI YETKAZMA), Mijozlar, Qarz/To'lov (ruxsat bilan), Hisobotlar (davr)
- oflayn navbat (`localStorage`): tarmoq xatosida amal so'rov kaliti va vaqti bilan saqlanadi, internet qaytganda tartib bilan yuboriladi; server rad etsa — shu yetkazmaning keyingi amallari kutadi, "Qayta yuborish" / "O'chirish"; yetkazma holati navbat bo'yicha oldindan ko'rsatiladi ("Navbatda" belgisi); lokatsiya buferi 200 nuqtagacha
- supervayzer `/uz/delivery` (menyu "Dostavka"): Bugun (bosiladigan ko'rsatkichlar, agentlar progressi va yig'ilgan pul), Yetkazmalar (sana, holat, agent, biriktirilmagan, kechikkan, to'lov farqi, qidiruv — serverda, kursor sahifalash; tafsilot oynasi: bosqichlar, isbot rasmlari, to'lovlar, tarix va amallar), Buyurtmalar (yetkazma yaratish), Yetkazuvchilar (qo'shish, tahrir, faollik, kunlik tartib), Xarita (jonli joy, geofence doirasi, kunlik iz), Nazorat (farq, qaytarish, kechikkan), Hisobotlar, Sozlamalar (siyosat va bildirishnoma oluvchilari)
- HR → Xodimlar: "Dostavka agenti qo'shish"; savdo buyurtmasi formasida "Yetkazib berish kerak (dostavka)"
- tillar: uz, ru, kk (`delivery.json`, 592 kalit; kodda ishlatilgan kalitlar va tillar mosligi skript bilan tekshirildi)

**Testlar:**
- API: `delivery-team` (4), `delivery-flow` (8 — TEST1–TEST6, OTP + imzo, boshqaruv o'tishlari), `delivery-security` (2), `delivery-tracking` (3) — 17/17
- regressiya tuzatildi: `maintenance.test.ts` (yangi tozalash maydonlari), `sales-agent.test.ts` (rol mosligi — 0042 ham qo'llanadi)
- to'liq API: 84 fayl, 319 test — 4 qismda `--maxWorkers=1` (111 + 91 + 63 + 54), hammasi o'tdi
- web: `offline-queue` (5), `actions` (6), `errors` (6), `filters` (3), `use-delivery-tracking` (3); to'liq web — 10 fayl, 39 test
- tsc (API testlar bilan, web), lint (o'zgargan va yangi fayllar), `vite build` — toza

**D9 — real-time (WebSocket)** (migratsiyasiz; bog'liqlik `@fastify/websocket` 11.3.0, dev `@types/ws`):
- `GET /api/delivery/ws`: ulanishdan oldin (HTTP javob bilan rad) — sessiya cookie'si (401), Origin (ilova manzili yoki shu host; boshqa saytdan cookie bilan ulanish — 403), aktiv kompaniya va ruxsat: `delivery.view` yoki bog'langan faol yetkazuvchi (403)
- hodisa shinasi — PostgreSQL `NOTIFY bum_delivery` tranzaksiya ichida: faqat COMMIT bo'lganda yetkaziladi (bekor qilingan amal hodisa bermaydi), API bir nechta nusxada ham ishlaydi. LISTEN — bitta ajratilgan ulanish, faqat mijoz bor paytda
- hodisalar: har yetkazma hodisasi (yaratish, biriktirish, holatlar, isbot, to'lov, geofence rad etilishi, OTP xatosi, qaytarish, ko'rib chiqish), kunlik tartib, ish sessiyasi (boshlash, yakunlash, avtomatik yopish, faolsizlantirish), oxirgi joy yangilanishi, agent yaratish/tahrir, siyosat
- kim nimani oladi: boshqaruvchi — kompaniya yetkazmalari, sessiyalar va agentlar; lokatsiya — faqat `delivery.view_location`; agent — faqat o'z yetkazmalari (joriy, yangi va olib tashlangan agent) va o'z sessiyasi; boshqa kompaniya — hech narsa. Xabarda faqat ID, holat va amal nomi — ma'lumot REST orqali ruxsat bilan qayta olinadi
- har 60 s sessiya va ruxsat qayta tekshiriladi, faollik vaqti cho'zilmaydi (`peekSession`): sessiya tugagan — 4401, ruxsat yoki kompaniya o'zgargan — 4403; ping 30 s; foydalanuvchiga 5 ulanish; LISTEN uzilsa mijozlar 1012 bilan yopiladi va qayta ulanib ma'lumotni yangilaydi
- web (`useDeliveryRealtime`): agent ish joyi va supervayzer sahifasi; xabarlar 1 s da (lokatsiya 5 s da) birlashtirilib tegishli so'rovlar yangilanadi; qayta ulanish 1–30 s, internet yo'q paytda urinmaydi, 4401/4403 da to'xtaydi; jonli ulanishda davriy so'rovlar 5 daqiqaga siyraklashadi, uzilganda odatiy 30–60 s; holat belgisi "Jonli" / "Davriy yangilanish"
- nginx: `location = /api/delivery/ws` — Upgrade sarlavhalari, 3600 s; Vite proksi `ws: true`

**D10 — avtomatik biriktirish** (migratsiyasiz — siyosatga `autoAssign`, standart: o'chiq; eski saqlangan siyosat standart bilan birlashtiriladi):
- qoidalar: faol login, a'zolik va profil; ish jadvali (hafta kuni); bugungi yetkazma uchun ish sessiyasi (ixtiyoriy); kunlik ochiq yetkazma limiti (1–200, standart 30); agent filiali — buyurtma ombori filiali; transport maks. yuki (mahsulot og'irligi × asosiy birlikdagi miqdor; og'irlik birligi kg/g/t bo'lmasa — yuk tekshirilmaydi); masofa chegarasi (0 — cheklanmagan)
- strategiya: `balanced` — eng kam ochiq yetkazma (teng bo'lsa yaqini), `nearest` — eng yaqin (teng bo'lsa kam yuklangani); boshlang'ich nuqta — shu kundagi oxirgi yetkazma mijozi, bo'lmasa bugun uchun ish vaqtidagi joriy joy (30 daqiqagacha); tartib — ustuvorlik, vaqt oynasi, yaratilgan vaqt. Ochko'z taqsimlash — marshrut optimallashtirish (TSP) emas
- API: `POST /auto-assign/preview` — reja, hech narsa yozilmaydi (biriktirilmay qolganlar sababi va agentlar kesimida sanoq bilan); `POST /auto-assign` — rejadagi juftliklar kompaniya advisory qulfi va FOR UPDATE ostida qayta tekshirilib mavjud `assignDeliveryTask` orqali biriktiriladi (hodisa `details.auto` — strategiya, trigger, masofa; audit `DELIVERY_AUTO_ASSIGNED`; real-time); o'zgarib qolgan juftlik o'tkazib yuboriladi. Ruxsat `delivery.assign`; siyosat o'chiq — 409 `auto_assign_disabled`; o'tgan sana — 400
- siyosatda "yaratilganda darhol" — buyurtma tasdiqlanib yetkazma yaratilganda biriktiriladi; mos agent bo'lmasa yetkazma "tayyor" qoladi (tasdiqlash xato bermaydi)
- web: supervayzer sahifasida "Avtomatik biriktirish" (sana, strategiya → reja jadvali: yetkazma, mijoz, agent, masofa, yuklama; sabablar → "Qo'llash" va natija), Sozlamalarda qoidalar bo'limi, tafsilot tarixida "avtomatik" belgisi

**D9–D10 testlari:**
- API: `delivery-auto-assign` (6 — sof qoidalar va strategiya taqqoslash, reja yozmasligi, teng taqsimlash, hodisa va audit, qayta qo'llash, nearest/balanced boshlang'ich nuqta bilan, masofa chegarasi, limit va jadval sanog'i, ishdagi agent, yaratilganda biriktirish, o'chiq siyosat, ruxsatlar, o'tgan sana, qat'iy tana, boshqa kompaniya yetkazmasi va agenti); `delivery-realtime` (5 — filtrlash va Origin, 401/403 rad etish, boshqaruvchi/agent/boshqa kompaniya hodisalari, lokatsiya va sessiya, boshqa agentga o'tkazish, rollback'da hodisa yo'qligi, sessiya bekor qilinsa 4401, faolsizlantirilsa yopilish)
- web: `realtime` (4 — so'rov prefikslari, qayta ulanish kutishi, manzil, buzilgan xabar)
- to'liq API: 86 fayl, 330 test — 4 qismda (120 + 93 + 73 + 44), hammasi o'tdi; to'liq web: 11 fayl, 43 test
- tsc (API testlar bilan, web), lint (yangi va o'zgargan fayllar), `vite build` — toza

**TEKSHIRILMAGAN / QILINMAGAN:**
- brauzerda va haqiqiy Android telefonda qo'lda E2E (kamera, GPS, imzo, oflayn navbat, real-time) — faqat avtomatik testlar (WebSocket — Fastify `injectWS` bilan, Railway edge va nginx orqali brauzer ulanishi qo'lda sinalmagan)
- ~~marshrut optimallashtirish (TSP) yo'q~~ — 2026-09-14 da qo'shildi (kunlik marshrut, taqsimotda eng qisqa tartib); avtomatik biriktirishning o'zi hamon ochko'z taqsimlash
- yuk sig'imi: og'irlik birligi (kg / g / t) mahsulot formasiga 2026-09-13 da qo'shildi; eski, birligi kiritilmagan mahsulotda yuk tekshirilmaydi
- ruxsat olib tashlanganda ochiq WebSocket 60 soniyagacha ishlab turishi mumkin (keyingi qayta tekshiruvgacha); ma'lumotning o'zi REST'da darhol himoyalangan
- ekran qulflanganda fondagi lokatsiya — brauzer cheklovi, native Android ilova kerak
- "faqat kamera" — `capture` atributi; ba'zi brauzerlar galereyani ham taklif qiladi
- SMS orqali OTP — production'da SMS provayder yo'q
- filial va hudud jadvallari yo'q — hudud matn, filial `branchId`
- ~~qisman yetkazilgan qoldiqni qayta yetkazish yo'q (faqat omborga qaytarish)~~ — **2026-09-21 da qo'shildi** (pastda "Dostavka: qisman yetkazilgan qoldiqni qayta yetkazish")

## Obuna va litsenziya tizimi (2026-09-13)

Talab: "BUM ERP — SUBSCRIPTION & LICENSE SYSTEM MASTER IMPLEMENTATION PROMPT" (1–63 bo'lim). Asosiy prinsip — Employee ≠ User ≠ License: HR xodimi dasturdan foydalanmasligi mumkin (bepul, cheklanmagan); dasturdan foydalanadigan xodim — foydalanuvchi (telefon login, parol xeshi, PIN xeshi), a'zolik, rol va litsenziya. Shu ish bilan birga mahsulot formasiga og'irlik birligi (kg / g / t) qo'shildi.

| # | Bosqich | Holat |
|---|---------|-------|
| S1 | Migratsiya 0043: tariflar, obuna, to'lov so'rovlari, litsenziyalar, ikki tarix jadvali, `sessions.locked_at`; mavjud kompaniya va a'zolar uzilmasdan ko'chirildi | ✅ |
| S2 | Har yangi kompaniya (ro'yxatdan o'tgan va admin yaratgan) — server vaqti bo'yicha 25 kunlik trial, 3 included litsenziya, egasi — birinchisi | ✅ |
| S3 | Server guard: sessiya → faol a'zolik → obuna/trial → litsenziya → ruxsat — `requireTenant` ichida (bitta SELECT), kassa qurilmasida ham | ✅ |
| S4 | Litsenziya limiti (obuna qatori FOR UPDATE) va qo'shimcha litsenziya — xodim yaratish, a'zolikni qayta yoqish, HR ulash, agent faollashtirish yo'llarining hammasida | ✅ |
| S5 | To'lov so'rovi (idempotent) → platforma admini tasdig'i: obuna/litsenziya faollashadi yoki uzayadi (bitta tranzaksiya, takroriy tasdiq zararsiz); muddat tugashi va trial ogohlantirishlari — davriy ish | ✅ |
| S6 | HR: "BEPUL" tugmasi, bepul → dasturga ulash va aksincha; egasi va egalik roli himoyasi; HR rahbari o'zidan kuchli rol bera olmaydi | ✅ |
| S7 | PIN ekran qulfi: LOCK sessiyani saqlaydi, LOGOUT tugatadi | ✅ |
| S8 | Web: Obuna sahifasi, tugaganda menyu (Bosh sahifa + Obuna), trial/tugash banneri, qulf ekrani, HR va Sozlamalarda litsenziya, admin "To'lovlar" va kompaniya obunasi | ✅ (brauzerda qo'lda tekshirilmagan) |

**Migratsiya 0043** — jadvallar: `subscription_plans` (8 boshlang'ich tarif, keyin faqat bazadan), `subscriptions` (kompaniyaga bitta), `subscription_payments`, `subscription_history`, `licenses` (foydalanuvchiga kompaniyada bitta joriy — partial unique), `license_history`. Kompaniya FK lari `restrict`. Mavjud ma'lumot o'chirilmaydi va o'zgartirilmaydi, faqat qo'shiladi:
- `status = trial` va `trial_ends_at` bor kompaniya — trial, o'sha sana bilan; qolganlari — muddatsiz `active` (tizimdan oldingi mijozlar uzilib qolmasin)
- included litsenziyalar soni — kamida 3, faol a'zolar ko'p bo'lsa shuncha; har faol a'zo va egaga included litsenziya, HR xodimi bo'lsa bog'lanadi; tarixga `legacy_migrated`
- Direktor rollariga `subscription.view`, `license.view`; takror ishlasa o'zgarmaydi (testda ikki marta ishlatib tekshirildi)

**Tariflar:**

| Asosiy | Narx | Muddat | Litsenziya | | Qo'shimcha xodim | Narx | Muddat |
|---|---|---|---|---|---|---|---|
| 1 oy | 360 000 | 1 oy | 3 | | 1 oy | 100 000 | 1 oy |
| 3 oy | 900 000 | 3 oy | 3 | | 3 oy | 300 000 | 3 oy |
| 6 oy | 1 800 000 | 6 + 1 = 7 oy | 3 | | 6 oy | 600 000 | 6 + 1 = 7 oy |
| 12 oy | 3 600 000 | 12 + 3 = 15 oy | 3 | | 12 oy | 1 200 000 | 12 + 2 = 14 oy |

**Server qoidalari:**
- kirish darajalari: `business` (standart) — obuna va litsenziya shart; `dashboard` — `/api/analytics/dashboard`, obuna tugaganda ham ochiq; `account` — `/api/company` (ilova qobig'i) va `/api/subscription/*`. Rad etish — 403, `details.reason`: `subscription_expired` (trialda "Sinov muddati tugagan..."), `subscription_cancelled`, `license_required`, `license_pending_payment`, `license_expired`, `license_revoked`
- egasi litsenziya tekshiruvidan o'tmaydi (kompaniya yaratilganda included beriladi, bo'shatib bo'lmaydi); bepul xodimda foydalanuvchi yo'q — kira olmaydi
- 4-foydalanuvchi: `license_limit_reached` (hisob bilan) va hech narsa yaratilmaydi; qo'shimcha tarif tanlansa litsenziya `pending_payment` + to'lov so'rovi, tasdiqlanguncha kirish yopiq. Tugagan obunada qo'shimcha litsenziya sotib olinmaydi
- a'zolik o'chirilsa included bo'shaydi, to'langan qo'shimcha litsenziya xodimda qoladi (muddati tugaguncha); bepul xodimga aylantirishda har qanday litsenziya bekor, kutilayotgan to'lovi ham
- muddat: oy qo'shish UTC (oyda bunday kun bo'lmasa — oy oxiri; 01.01.2026 + 7 oy = 01.08.2026). Uzaytirish: amaldagi to'langan obuna yoki litsenziya — tugash sanasidan, trial, tugagan va tizimdan oldingi muddatsiz — hozirdan. Trial'dan to'langanga o'tganda qolgan trial kunlari qo'shilmaydi
- to'lov so'rovi: bir xil `idempotencyKey` — o'sha so'rov (boshqa tarif bilan — 409); yangi obuna so'rovi eski kutilayotganini bekor qiladi; tasdiq to'lov qatorini qulflaydi, `paid` bo'lsa hech narsa qilmaydi, `cancelled` — 409
- davriy ish (har soat, advisory lock): muddati o'tgan obuna va qo'shimcha litsenziya `expired` + tarix + audit; trial tugashiga 10/5/3/1 kun qolganda egasiga bildirishnoma, har chegara bir marta. Guard bunga bog'liq emas — sanani har so'rovda o'zi tekshiradi
- kassa qurilmasi: obuna tugasa `/session` va yangilanish ochiq, `pull`, `push`, kassir kirishi va boshqa amallar — 403; sinxron amali obuna yoki kassir litsenziyasi sababli rad etilsa "rejected" deb saqlanmaydi — butun so'rov 403, navbat kassada qoladi va uzaytirilgach yuboriladi
- PIN: faqat xesh (argon2id), 5 noto'g'ri urinish → 5 daqiqa blok; `POST /api/auth/lock` sessiyani qulflaydi (PIN o'rnatilmagan bo'lsa — 400), qulflangan sessiyada faqat `/me`, `/unlock`, `/logout` — boshqa hamma so'rov 423 `LOCKED`. PIN yangi sessiya ochmaydi: chiqishdan keyin va yangi qurilmada parol kerak
- audit: `TRIAL_CREATED`, `SUBSCRIPTION_PAYMENT_REQUESTED/CANCELLED`, `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_LICENSES_CHANGED`, `LICENSE_ASSIGNED`, `LICENSE_REVOKED`, `LICENSE_EXPIRED`, `LICENSE_RENEWED`, `ADDITIONAL_LICENSE_REQUESTED/PURCHASED`, `LICENSE_PAYMENT_REQUESTED`, `SOFTWARE_ACCESS_ENABLED/DISABLED`, `EMPLOYEE_CONVERTED`, `session_locked/unlocked`, mavjud `pin_changed`, `USER_PASSWORD_RESET`. Parol va PIN auditga yozilmaydi
- RBAC: `subscription.view`, `subscription.manage`, `license.view`, `license.manage`, `employee.software_access.manage`. To'liq ruxsatli rol (egasi) — hammasi; Direktor — faqat ko'rish; boshqa standart rollar — yo'q

**O'zgargan qarorlar (oldingi xatti-harakatdan farq):**
- platforma sozlamasidagi "sinov muddati (kun)" olib tashlandi — trial har doim 25 kun (spec: "every new Company"); saqlangan eski qiymat bazada qoladi, ishlatilmaydi
- admin yaratgan kompaniya ham trial (ilgari darhol muddatsiz edi); `companies.status` — platforma admini qarori (to'xtatish/tugatish) sifatida qoldi, to'lov tasdiqlanganda `trial` → `active`
- trial tugagan kompaniyada ilgari o'qish ochiq edi — endi faqat Bosh sahifa va Obuna (spec 30–33)
- avvalroq foydalanuvchi so'rovi bilan olib tashlangan web avto-qulf qaytarilmadi — faqat qo'lda "Ekranni bloklash" (foydalanuvchi menyusi)

**Web:**
- `/uz/subscription` (menyu "Obuna", `subscription.view`): joriy tarif, holat, boshlanish/tugash, qolgan kun, "BUM ERP obunangiz muddati tugagan." + OBUNANI UZAYTIRISH; litsenziyalar (Included / Ishlatilgan / Qo'shimcha / Jami faol / Bo'sh); kutilayotgan to'lovlar va bekor qilish; tarif kartalari ("6 oy + 1 oy bonus = 7 oy"); qo'shimcha litsenziya tariflari; litsenziyalar jadvali va uzaytirish; obuna va litsenziya tarixi
- obuna tugagan: menyuda faqat Bosh sahifa va Obuna, boshqa sahifalar Bosh sahifaga yo'naltiriladi, Bosh sahifada xabar; trial ogohlantirishi va tugash banneri (yuqorida); litsenziyasi yaroqsiz xodimga alohida ekran
- HR → Xodimlar: "BEPUL (dasturdan foydalanmaydi)" tugmasi ("Bu xodim BUM ERP dasturidan foydalanmaydi. License talab qilinmaydi." / "...foydalanadi. Software license kerak."), login, parol, PIN, rol; limit tugasa qo'shimcha tarif tugmalari ("3 ta included foydalanuvchi litsenziyasi ishlatilgan."); kartada "💻 Dasturdan foydalanadi · License: Included · Faol" yoki "🆓 Bepul · Dastur: Yo'q"; "Dastur" / "Bepul" amallari
- Sozlamalar → Xodimlar: litsenziya ustuni, PIN (ixtiyoriy), limitda tarif tanlash (yangi xodim va qayta yoqish)
- qulf: foydalanuvchi menyusida "Ekranni bloklash" (PIN yo'q bo'lsa avval o'rnatish oynasi), "🔒 EKRAN BLOKLANGAN" + PIN; boshqa oynadagi 423 ham qulf ekranini ochadi
- admin: "To'lovlar" bo'limi (kutilmoqda / tasdiqlangan / bekor; tasdiqlashda hujjat raqami), Kompaniyalar jadvalida obuna ustuni, tafsilotda obuna, litsenziyalar va included sonini o'zgartirish

**Testlar:**
- API: `subscription-rules` (10 — muddat hisobi, tariflar, uzaytirish oralig'i, amaldagi holat, trial chegaralari, guard darajalari va rad etish sabablari); `subscription` (26 — trial; tariflar; limit va parallel so'rovlar; qo'shimcha litsenziya to'lovgacha yopiq, tasdiq va idempotentlik; qo'shimcha litsenziyani uzaytirish +14 oy; a'zolikni o'chirish/qayta yoqish; trial → active +7 oy, idempotent so'rov, +15 oy uzaytirish; eskisini bekor qilish va tugagandan uzaytirish; to'lovni bekor qilish; tugagan trial va to'langan obuna — biznes API 403, dashboard/obuna/kompaniya 200, ma'lumot saqlanadi, uzaytirilgach ochiladi; davriy ish; faqat bitta xodim litsenziyasi tugashi; trial ogohlantirishi; bepul xodimlar cheklanmasligi va login yo'qligi; dasturga ulash va bepul qilish (sessiyalar bekor, hisob nofaol, qayta yoqish); limitda rollback va qo'shimcha tarif; egasi himoyasi va Direktor; PIN qulfi, boshqa qurilma, chiqishdan keyin PIN ishlamasligi; 5 urinish bloki; soxta maydonlar va sarlavhalar; boshqa kompaniya litsenziyasi/to'lovi 404, Kassir/Direktor/admin ruxsatlari; admin included sonini o'zgartirishi; kassa qurilmasi 403 va amal saqlanmasligi; migratsiya SQL ning mavjud ma'lumotda ikki marta ishlashi)
- moslashtirilgan testlar: `registration` (25 kun, obuna qatori, eski sozlama kaliti rad etiladi), `platform-ops` (sozlamalarda sinov muddati yo'q), `helpers.createCompany` (litsenziyaga aloqasi yo'q testlar uchun admin beradigan kengroq limit; litsenziya testlari — 3), `delivery-realtime` (ws tip e'loni)
- to'liq API: 88 fayl, 366 test — 4 qismda `--maxWorkers=1` (120 + 93 + 73 + 80), hammasi o'tdi
- web: `subscription` (5 — muddat matni, sana va summa, bloklash, limit xatosi, PIN sabablari); to'liq web — 12 fayl, 48 test
- tsc (API testlar bilan, web), lint (yangi va o'zgargan fayllar), `vite build` — toza

**TEKSHIRILMAGAN / QILINMAGAN:**
- brauzerda qo'lda E2E (Obuna sahifasi, HR BEPUL oynasi, qulf ekrani, admin tasdig'i) — faqat avtomatik testlar
- to'lov shlyuzi (Payme/Click) yo'q — faollashtirish faqat platforma admini to'lovni qo'lda tasdiqlaganda; spec'dagi keyingi `SUSPENDED` / `PENDING_PAYMENT` obuna holatlari qo'shilmagan
- kassada kassir litsenziyasi sinxron o'rtasida tugaganda butun so'rovni 403 qilish yo'li alohida test bilan qoplanmagan (obuna tugashi qoplangan); desktop kassa ilovasi obuna sababini alohida ekran bilan emas, sinxron xatosi matni bilan ko'rsatadi
- sotuv agenti va yetkazuvchi mobil ish joylarida qulf ekrani yo'q (ERP'da qulflangan sessiya u yerda 423 oladi)
- migratsiyaning production ma'lumotidagi natijasi deploydan keyin tekshiriladi (test bazasida mavjud ma'lumot bilan tekshirilgan)
- ~~qo'shimcha litsenziya muddati tugashiga yaqin ogohlantirish yo'q (faqat trial uchun)~~ — **2026-09-21 da qo'shildi** (pastda "Obuna: qo'shimcha litsenziya tugashi ogohlantirishi")

### Obuna (`/api/subscription`)

Aktiv kompaniya (companyId so'rovdan olinmaydi); obuna tugaganda ham ochiq.

| Metod | Yo'l | Ruxsat |
|---|---|---|
| GET | `/` (holat, litsenziyalar soni, kutilayotgan to'lovlar), `/history` (`?limit=`), `/payments` (`?status=&limit=`) | `subscription.view` |
| GET | `/plans` | `subscription.view`, `license.view` yoki `employee.software_access.manage` |
| GET | `/licenses` | `license.view` |
| POST | `/purchase` `{planId, idempotencyKey}`, `/payments/:paymentId/cancel` | `subscription.manage` |
| POST | `/licenses/:licenseId/purchase` `{planId, idempotencyKey}` | `license.manage` |

Platforma admini (`/api/platform`): `GET /billing/payments` (`?status=&companyId=&limit=`), `POST /billing/payments/:paymentId/confirm` `{reference?}`, `POST /billing/payments/:paymentId/cancel`, `GET /companies/:companyId/subscription`, `PUT /companies/:companyId/subscription` `{includedLicenses}`; `GET /companies` javobida `subscription`.

Auth: `POST /api/auth/lock`, `POST /api/auth/unlock` `{pin}` (doim 200 `{success, reason}`); `/api/auth/me` — `subscription`, `licenseDenial`, `isCompanyOwner`, `sessionLocked`. HR: `POST /api/hr/employees` `{..., softwareAccess?: {phone, password, pin, role, additionalLicensePlanId?}}`, `POST|DELETE /api/hr/employees/:employeeId/software-access`. Kompaniya: `POST /api/company/employees` `{..., pin?, additionalLicensePlanId?}` → `license`, `payment`; `PATCH /api/company/employees/:userId` `{additionalLicensePlanId?}`.

### Dostavka (`/api/delivery`)

Agent yo'llari — `delivery.accept` va bog'langan faol yetkazuvchi (agent, kompaniya va mijoz ID'si so'rovdan olinmaydi).

| Metod | Yo'l | Ruxsat |
|---|---|---|
| GET (WebSocket) | `/ws` | `delivery.view` yoki bog'langan faol yetkazuvchi; Origin tekshiriladi |
| POST | `/auto-assign/preview`, `/auto-assign` | `delivery.assign` (siyosatda yoqilgan bo'lsa) |
| POST | `/route-plan` `{deliveryAgentId, date, origin?, apply?}` — kunlik eng qisqa marshrut | `delivery.view` (saqlash — `delivery.manage_routes`) |
| GET / POST | `/dispatch` — yetkazmasiz buyurtmalar + biriktirilmagan yetkazmalar (hudud, marshrut); `/dispatch/assign` `{orderIds, taskIds, deliveryAgentId, scheduledDate?, optimize}` | `delivery.manage` / `delivery.assign` (+ `delivery.manage` — buyurtmadan) |
| GET | `/agent/route` (`?lat=&lng=`) — bugungi optimal tartib (tavsiya, yozilmaydi) | agent |
| GET / PUT | `/policy`, `/policy/recipients` | o'qish — `delivery.view` yoki agent; yozish — `delivery.manage` |
| GET / POST / PATCH | `/agents` (`?activeOnly=&branchId=&territory=`), `/agents/supervisors`, `/agents/:agentId` | `delivery.view` / `delivery.manage` |
| GET | `/agents/live`, `/agents/:agentId/track` (`?date=`, audit) | `delivery.view_location` |
| GET | `/dashboard` (`?date=`), `/reports` (`?from=&to=&agentId=`) | `delivery.view` / `delivery.view_reports` |
| GET / POST / PATCH | `/ready-orders`, `/tasks` (`?dateFrom=&dateTo=&status=&agentId=&unassigned=&branchId=&territory=&customerId=&search=&overdue=&reviewPending=&limit=&cursor=`), `/tasks/:taskId`, `/tasks/:taskId/proofs/:proofId` | `delivery.view` / `delivery.manage` |
| POST / PUT | `/tasks/:taskId/assign` (boshqa agentga — `delivery.reassign`), `/unassign`, `/reschedule`, `/cancel`, `/route-order`, `/tasks/:taskId/return`, `/payment-review`, `/otp` | `delivery.assign` / `.reassign` / `.manage` / `.manage_routes` / `.return` |
| GET | `/agent/me`, `/agent/dashboard`, `/agent/tasks` (`?scope=today\|upcoming\|history`), `/agent/tasks/:taskId`, `/agent/customers`, `/agent/customers/:customerId`, `/agent/reports`, `/agent/debts` (`delivery.view_debt`) | agent |
| GET / POST | `/agent/work-session`, `/agent/work-session/start`, `/agent/work-session/end`, `/agent/locations` (1–20 nuqta, faqat sessiyada) | agent |
| POST | `/agent/tasks/:taskId/accept`, `/start`, `/arrive`, `/delivering`, `/proofs`, `/otp/resend`, `/payments`, `/confirm`, `/fail` | `delivery.accept` / `.start` / `.arrive` / `.confirm` / `.collect_payment` / `.fail` |

### Distributsiya (`/api/distribution`)

O'qish — `distribution.view`, yozish — `distribution.manage`.

| Metod | Yo'l |
|---|---|
| GET / POST / PATCH / DELETE | `/sales-reps` (`?includeInactive=`), `/sales-reps/stats`, `/sales-reps/:salesRepId` |
| GET / POST / PATCH / DELETE | `/routes` (`?includeInactive=`), `/routes/:routeId` (mijozlar bilan) |
| GET / POST | `/routes/export` (`?includeInactive=`) — CSV, `/routes/import` (CSV qatorlari; kunlar "1,3,5", do'konlar fayl bilan biriktirilmaydi) |
| POST / PUT / DELETE | `/routes/:routeId/customers`, `/routes/:routeId/customers/order`, `/routes/:routeId/customers/:memberId` |
| POST | `/routes/:routeId/optimize` `{apply}` — eng qisqa yo'l tartibi (ko'rish — `distribution.view`) |
| GET | `/map` — faol marshrutlar do'konlari tartibda va marshrutsiz koordinatali do'konlar |
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

## Kassa: dasturdan to'liq chiqish va qurilmani uzish (2026-09-13)

Muammo (skrinshotlar): BUM POS KASSA "Bonnu Market" holatida osilib qolar, oyna yopilgach jarayonlar qolar edi; boshqa kompaniya xodimi (+998999999999) kirganda "Bu kompaniyaga kirishingiz cheklangan" dan boshqa yo'l yo'q edi.

- Chiqish: asosiy oyna yopilsa ilova to'liq tugaydi (`before-quit` — sinxron to'xtaydi, tarozi COM jarayonlari o'ldiriladi, SQLite yopiladi; 5 s dan keyin majburiy `app.exit`); chop etish 60 s timeout bilan (printer osilib qolmasin); ikkinchi nusxa ochilsa oyna qayta yaratiladi
- Tugmalar: kassir ekranida (xato ostida), Sozlamalar → Chiqish va bosh sahifada "Dasturni yopish"; "Qurilmani uzish" — navbatda yuborilmagan amal, rad etilgan amal yoki ochiq smena bo'lsa 409 (ma'lumot yo'qolmaydi); serverda qurilma faolsizlanadi (`POST /api/pos-device/unregister`, audit `POS_DEVICE_UNREGISTERED`), qurilmada kompaniya ma'lumotlari tozalanadi, qurilma sozlamalari (printer, tarozi, yangilanish fayli) qoladi
- Kassir boshqa kompaniya xodimi bo'lsa aniq xabar: "Bu foydalanuvchi «…» kompaniyasining faol xodimi emas. Boshqa kompaniya bilan ishlash uchun kassada «Qurilmani uzish» ni bosing."
- Testlar: desktop `kassa-exit` (4 — uzishda navbat/smena himoyasi, server rad etsa ham lokal tozalash, sinxron paytida yopish), API `pos-device-unregister` (2); desktop to'liq — 9 fayl, 54 test; Electron smoke (alohida `KASSA_USER_DATA`): 2 marta ochib-yopildi, 4 jarayon ham tugadi
- o'rnatuvchi 0.4.1 qurildi (2026-09-14): `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.1.exe`, 106.6 MB, SHA-256 `785264989CF5C992348037FE2F9FBB58A5336C817E2AE5362E088EC58686B346`, imzosiz
- **Qilinmagan:** 0.4.1 e'lon qilinmagan — platforma admini Admin → "Desktop kassa" orqali yuklaydi (admin kirishi kerak); paketlangan ilova bu kompyuterda ishga tushirilmadi (ishlab turgan kassaning ma'lumot papkasi va bitta-nusxa qulfiga tegmaslik uchun) — chiqish manba bo'yicha Electron smoke bilan tekshirilgan; haqiqiy kassada (printer, tarozi) qo'lda sinov

## Multi-business: biznes manzili va parallel tablar (2026-09-13)

- Manzil: `app.bum-erp.uz/{biznes}/{bo'lim}` (masalan `/bonnumarket/purchase`, `/hadichamarket/distribution`); slug band yoki yaroqsiz bo'lsa — kompaniya ID'si; til bilan qolgan sahifalar — `/uz/login`, `/uz/admin`, `/uz/select-company`, `/uz/onboarding`; eski `/uz/dashboard` havolalari joriy biznes manziliga yo'naltiriladi
- Tab konteksti: har API so'rovida `x-bum-company` (rasm, yuklab olish, WebSocket — `bumCompany` parametri). Server kontekstni foydalanuvchining FAOL a'zoligi bo'yicha tekshiradi: boshqa biznes, mavjud bo'lmagan yoki noto'g'ri manzil, nofaol a'zolik — 403 `company_access_denied`; saqlangan aktiv kompaniya o'zgarmaydi — bir necha biznes bitta Chrome'da parallel tablarda, ma'lumot aralashmaydi
- React Query kalitlari va `/me` biznes bo'yicha; service worker agent oflayn keshi biznes bo'yicha (`agent-api-v2`); dostavka real-time — tab biznesida; kompaniya almashtirgichda "yangi tabda ochish"; kirish yo'q biznes uchun ekran va o'z bizneslari ro'yxati
- Testlar: API `company-context` (3 — ikki biznes parallel, yozish izolyatsiyasi, parametr, 403/401), web `company-context` (3); production: sessiyasiz `x-bum-company` — 401, `/bonnu-market/purchase` — 200, bundle'da sarlavha bor
- **Tekshirilmagan:** brauzerda ikki tabda qo'lda (Bonnu Market va Hadicha Market bir vaqtda)

## Xarita, optimal marshrut va hudud bo'yicha dostavka (2026-09-14)

Talab: agent nazorati xaritasi (bosilganda ochilmas yoki boshqa saytga o'tar edi), "Dostavka / Marshrut bo'yicha" — eng qisqa yo'l va navigatorga o'tish, "Hudud bo'yicha" — "Magazin 1 — Zakaz bor…" → "[ Barchasini dostavshikka biriktirish ]". Pullik xarita API'si ishlatilmaydi.

- **Xarita:** sxematik SVG o'rniga OpenStreetMap + Leaflet 1.9.4 (bepul, kalitsiz; o'z tile serveri — `VITE_MAP_TILE_URL`). Do'konlar tartib raqami bilan, marshrut chiziqlari, geofence, hududlar; belgi bosilganda — ma'lumot va Google Maps / Yandex / Android navigator havolalari (matn DOM orqali — XSS yo'q). Internet bo'lmasa xarita qatlami yuklanmaydi, lekin belgilar va chiziqlar chiziladi (ogohlantirish bilan). Kompyuterda "Xaritada ochish" endi ilova ichidagi oynada (telefonda — navigator ilovasi)
- **Marshrut algoritmi** (`apps/api/src/shared/route-optimizer.ts`, ochiq yo'l, assimetrik matritsa): 12 nuqtagacha aniq (Held–Karp), ko'prog'i — eng yaqin qo'shni (12 boshlanish) + 2-opt + Or-opt. Masofa — yo'l bo'yicha bepul OSRM (`ROUTING_OSRM_URL`, standart — OSRM loyihasining ommaviy serveri; "off" — o'chiq; faqat koordinatalar yuboriladi), javob bo'lmasa to'g'ri chiziq × 1,3 (reja baribir hisoblanadi, "taxminiy" belgisi)
- **Dostavka API:** `POST /route-plan` (dostavshikning kunlik ochiq yetkazmalari; yo'ldagilar oldinda, koordinatasizlar oxirida; boshlanish — berilgan joy yoki bugun uchun dostavshikning 2 soatdan yangi GPS nuqtasi; `apply` — tartib saqlanadi), `GET /dispatch` (yetkazmasi yaratilmagan buyurtmalar + biriktirilmagan "tayyor" yetkazmalar, mijoz hududi va distribyutsiya marshrutidagi o'rni bilan), `POST /dispatch/assign` (buyurtmalardan yetkazma yaratish va yetkazmalarni bitta dostavshikka — bitta tranzaksiyada, biri xato bo'lsa hech biri; keyin shu kunlar uchun eng qisqa tartib), `GET /agent/route` (dostavshikka tavsiya, yozilmaydi). Audit `DELIVERY_BULK_ASSIGNED`
- **Distribyutsiya API:** `GET /map`, `POST /routes/:routeId/optimize`
- **Migratsiya 0044** — faqat qo'shimcha: `customers.city`, `customers.district` (bo'sh bo'lishi mumkin) va indeks; mavjud ma'lumot o'zgarmaydi
- **Web:** Dostavka → Buyurtmalar: "Hudud bo'yicha" (shahar → mahalla) / "Marshrut bo'yicha" / "Hammasi", do'kon qatorida "Zakaz bor", guruhda "Barchasini dostavshikka biriktirish" (dostavshik, ixtiyoriy sana, eng qisqa tartib → xaritada marshrut va navigator havolalari), belgilab biriktirish; Xarita → "Kunlik marshrut" (hisoblash, saqlash); dostavshik ilovasi → Yetkazmalar → "Optimal marshrut" (hozirgi joydan, Google Maps 9 nuqtadan ko'p bo'lsa bo'laklab, Yandex bitta marshrutda); Distribyutsiya → "Xarita" tabi (marshrutlar rangida, marshrutsiz do'konlar, "Optimal tartib") va Marshrutlar → "Optimal tartib"; mijoz formasida "Shahar / tuman", "Mahalla / hudud"; tillar uz/ru/kk
- **Testlar:** API `route-optimizer` (5 — to'liq sanab chiqish bilan tenglik, assimetriya, 120 nuqta sifati va vaqti), `routing-service` (4 — OSRM javobi, xato/timeout'da taxminiy reja, tarmoqsiz), `delivery-dispatch` (6 — Urganch → Luchevoy stsenariysi, atomarlik, supervayzer rejasi va saqlash, dostavshik GPS'idan, ruxsat va boshqa kompaniya izolyatsiyasi, distribyutsiya xaritasi va optimallashtirish); tegishli to'plam (delivery, distribution, sales, route) — 28 fayl, 87 test; web `navigation` (4); to'liq web — 14 fayl, 56 test; tsc, lint, `vite build` — toza
- **Production:** API va web deploy qilindi (web birinchi urinishda yiqildi — commit qilinmagan `apps/mobile/package.json` Docker ichida `pnpm install` ni ishga tushirgan; lockfile moslashtirilib qayta deploy — SUCCESS); yangi endpointlar sessiyasiz 401
- **Tekshirilmagan / cheklovlar:** brauzerda qo'lda; production'dan OSRM ommaviy serveriga haqiqiy so'rov (Railway tarmog'idan) — tekshirish uchun tizimga kirgan sessiya kerak; OSRM ommaviy serveri adolatli foydalanish cheklovli — ko'p dostavshikda o'z OSRM serveri (Docker `osrm-backend` + Geofabrik O'zbekiston xaritasi, bepul) tavsiya etiladi; hudud (shahar/mahalla) mavjud mijozlarda bo'sh — kiritilgunicha "Hudud ko'rsatilmagan" guruhida; hudud poligonlari (territoriya chegarasi) ma'lumotnomasi yo'q — `MapView` poligonni qo'llaydi, lekin ma'lumot manbai yo'q
- **To'liq API regressiyasi** (xarita, marshrut va Android o'zgarishlaridan keyin): 93 fayl, 386 test — 4 qismda `--maxWorkers=1` (129 + 95 + 84 + 78), hammasi o'tdi; 1-qismda xotira bosimi ostida sekinlashgan 3 ta parallel so'rovli test (`bootstrap`, `cash`, `company-context`) alohida qayta ishga tushirilganda o'tdi (21/21). Testda Postgres ulanishini kutish 30 s ga oshirildi (`db/client.ts`, faqat test), `TEST_LOG_LEVEL=error` — sababni ko'rish uchun

## Android ilova (2026-09-14)

**Texnologiya — Capacitor 8.4.3** (`apps/mobile`). Sabab: mavjud React/Vite ilova va API to'liq qayta ishlatiladi — sotuv agenti, dostavshik, distribyutsiya, do'kon, buyurtma, marshrut, xarita va statuslar bitta kodda, web deploy darhol hamma telefonga yetadi; native qism faqat brauzer qila olmaydigan joyda. React Native yoki Kotlin — barcha ekranlarni qayta yozish va ikki kodni parallel yuritish demakdir.

- ilova production web manzilini ochadi (`BUM_APP_URL`, standart — Railway domeni; `bum-erp.uz` DNS ulangach almashtiriladi): cookie sessiya, biznes manzili, service worker oflayn keshi va real-time web bilan bir xil; server ochilmasa — ilova ichidagi oflayn sahifa. appId `uz.bumerp.app`, minSdk 24, target/compile 36, launcher ikonka — BUM logotipi
- native: fondagi GPS — `@capacitor-community/background-geolocation` 1.2.26 (doimiy bildirishnomali xizmat, ekran qulflanganda ham, faqat ish sessiyasida; `ACCESS_BACKGROUND_LOCATION` so'ralmaydi; soxta GPS — `mocked` belgisi serverga), bildirishnoma — `@capacitor/local-notifications` 8.3.1 (yangi / bekor qilingan / o'zgargan yetkazma — real-time xabardan, ilova fonda bo'lganda; FCM/tashqi push xizmatisiz), kamera (web sahifadagi rasm olish), `geo:` / Google Maps / Yandex havolalari tizim ilovasida
- web tomoni: `src/lib/native/` — `platform`, `geolocation` (Android — fondagi xizmat, brauzer — `watchPosition`), `notifications`; dostavshik va sotuv agenti GPS hook'lari shu adapterda; brauzerda xatti-harakat o'zgarmadi (web testlari 14 fayl, 56 test)
- versiyalar `minimumReleaseAge` (3 kun) qoidasiga mos tanlandi (8.5.2 hali yetilmagan — Railway web build'i shu sabab bir marta yiqilgan)
- build: Gradle 8.14.3, AGP 8.13.0, **JDK 21** (Capacitor 8 talabi; mashinada Android Studio JBR 21 — `%USERPROFILE%\.jdks\jbr-21.0.11`), `gradle.properties` — 900 MB heap, bitta worker

**APK qurildi (2026-09-14):** 2026-09-14 kechasi Gradle ikki marta xotira yetishmagani uchun to'xtatilgan edi (1,4 GB bo'sh). Xotira bo'shagan paytda (Docker to'xtatilib) qayta qurildi:
- debug: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` — 5.1 MB, SHA-256 `1323380DF32FB4549C9840485D2295FD99E54BF3C794EF052FA99E47E65E2294`, Android Debug sertifikati bilan imzolangan (`apksigner verify`)
- release: `apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk` — 3.9 MB, SHA-256 `58FCB3F5D8108524857BBEA1896426B6E7CDF8AFEED147F16BB8697F921E8F96`, **imzosiz** (imzo kaliti yo'q — o'rnatib bo'lmaydi va Play'ga yuklanmaydi)
- APK fayllari repoga kiritilmaydi (`.gitignore`); qayta qurish: `JAVA_HOME` = JDK 21, `ANDROID_HOME` = Android SDK, `apps/mobile/android` → `gradlew.bat assembleDebug` / `assembleRelease` (yoki Android Studio → Gradle JDK 21)

**Statik audit (qurilgan APK, `aapt dump`):** paket `uz.bumerp.app`, versionCode 1 / versionName 1.0, minSdk 24, target 36, nomi "BUM ERP"; ruxsatlar — INTERNET, ACCESS_FINE/COARSE_LOCATION, POST_NOTIFICATIONS, CAMERA, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION (GPS xizmati `foregroundServiceType=location`), RECEIVE_BOOT_COMPLETED, WAKE_LOCK; `ACCESS_BACKGROUND_LOCATION` yo'q; faqat HTTPS (`cleartext: false`)
- tuzatildi: plagin qo'shgan `SCHEDULE_EXACT_ALARM` olib tashlandi (aniq vaqtli signal ishlatilmaydi; Google Play asoslash talab qiladi)
- ikonka: adaptive — BUM logotipi niqobning xavfsiz zonasi ichida, fon oq, kesilmaydi (ko'z bilan tekshirildi); splash: 11 o'lcham, oq fonda markazda BUM logotipi (standart Capacitor rasmi almashtirildi)
- bildirishnoma bosilganda — dostavshikning "Yetkazmalar" sahifasi (joriy biznes manzili bilan); faqat shu saytdagi nisbiy yo'l qabul qilinadi (web testi)
- release imzosi: `app/build.gradle` `android/keystore.properties` bo'lsa imzolaydi (fayl va `*.jks`/`*.keystore` — `.gitignore`); kalit yaratilmagan — egasi yaratadi va xavfsiz saqlaydi (yo'qolsa ilovani yangilab bo'lmaydi)

**Tekshirilmagan (real qurilma yo'q — `adb devices` bo'sh, emulyator uchun xotira yetmaydi):** telefonda o'rnatish, kirish/chiqish, GPS (ochiq, fonda, ekran qulflanganda), bildirishnoma va uni bosish, kamera va rasm yuborish, Google Maps / Yandex / navigator intentlari, oflayn sahifa. Web qismi (kirish, xarita, marshrut, navigator havolalari, mobil ko'rinish) lokal brauzer E2E da o'tgan. iOS yo'q

## Release tayyorgarligi tekshiruvi (2026-09-14)

Faqat haqiqatda bajarilgan tekshiruvlar. Production'da tizimga kirgan holda sinov qilinmadi: test hisobi yo'q, production admin paroli ishlatilmaydi va production bazada sinov kompaniyasi yaratilmadi — autentifikatsiyali oqimlar lokal dev bazada haqiqiy brauzerda sinaldi (pastda).

**Production (real):**
- API `/health` (konteyner ichidan, `railway ssh`): `ok`, `production`; SMS, AI, fayl saqlash — o'chiq
- `app.bum-erp.uz` → `bum-web`, sertifikat amal qiladi: `/` 200, `/bonnu-market/purchase` 200, `/api/company` 401; `www.bum-erp.uz` ham shunday
- sessiyasiz: `/api/auth/me`, `/api/company`, `/api/company/mine`, `/api/delivery/dispatch`, `/api/delivery/tasks`, `/api/distribution/map`, `/api/sales/customers`, `/api/platform/stats`, `/api/subscription` — hammasi 401; begona biznes sarlavhasi bilan ham 401; noto'g'ri login (mavjud bo'lmagan raqam) — 401, umumiy xabar (raqam mavjudligi oshkor bo'lmaydi)
- CORS: begona Origin preflight'ida `access-control-allow-origin` faqat `WEB_ORIGIN` — begona sayt ruxsat olmaydi
- OSRM: production API konteyneridan ommaviy OSRM javob beradi (sinov yo'li 2541 m) — marshrutlar "yo'l bo'yicha" hisoblanadi; `ROUTING_OSRM_URL` o'rnatilmagan (standart ommaviy server)

**Domen (`bum-erp.uz`):**
- NS — `dns1–4.webspace.uz`. `app` → CNAME `vdhio0zu.up.railway.app` (Railway'da tasdiqlangan, sertifikat VALID), `www` → CNAME `br5m6hjv.up.railway.app` (tasdiqlangan, VALID). Eski `auth`, `logto-admin` yozuvlari o'chirilgan (osilib qolgan CNAME yo'q)
- apex `bum-erp.uz` → A `95.46.96.77` (eski hosting): HTTPS javob bermaydi, Railway'da ulanmagan. Railway tarifida bir xizmatga 2 ta shaxsiy domen — `app` va `www` band
- `WEB_ORIGIN` production'da `https://bum-erp.uz`. Ilova bitta domenda ishlaydi (nginx `/api` proksi): CORS talab qilinmaydi, sessiya cookie'si host-only (`domain` yo'q) — hozir ta'siri yo'q, o'zgartirilmadi; tartib uchun `https://app.bum-erp.uz` qilish tavsiya etiladi (API qayta ishga tushadi)

**Xavfsizlik auditi:**
- git: kuzatiladigan maxfiy fayl yo'q (faqat `.env.example`); tarixda `.env`, kalit yoki sertifikat fayli qo'shilmagan; sir naqshlari (private key, AWS, Anthropic, GitHub token, parolli Postgres URL) bo'yicha yagona moslik — `apps/api/test/files.test.ts` dagi AWS hujjatlarining ommaviy S3 imzo test vektori (`…EXAMPLE`), haqiqiy kalit emas
- ildiz `.gitignore`: `*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `*.pem`, `keystore.properties` qo'shildi
- sessiya cookie: `httpOnly`, production'da `Secure`, `SameSite=Lax`; API javoblarida helmet sarlavhalari (HSTS, nosniff, X-Frame-Options)
- SQL: `sql.raw` faqat koddagi konstantalar bilan; web: `dangerouslySetInnerHTML` faqat shadcn chart stilida (koddagi qiymat), xarita popup matni — DOM `textContent`
- **topildi va tuzatildi:** web sahifalarida (nginx) xavfsizlik sarlavhalari yo'q edi — clickjacking xavfi. Endi SPA sahifalarida X-Frame-Options `SAMEORIGIN`, nosniff, Referrer-Policy, HSTS, Permissions-Policy (GPS va kamera — faqat shu sayt); lokal `nginx:1.29-alpine` konteynerida `nginx -t` va `curl` bilan tekshirildi; web deploy (2026-09-14 03:12 UTC) dan keyin production `app.bum-erp.uz` `/` va `/bonnu-market/delivery` da hammasi bor, `/api` javobida X-Frame-Options bitta (takrorlanmaydi)
- IDOR: yangi `tenant-isolation` testi (2) — B kompaniyasi A ning mijoz, buyurtma, mahsulot, ombor, ta'minotchi, xodim, xarajat, lead, yetkazma va marshrutini ID bilan o'qiy, o'zgartira yoki o'chira olmaydi (403/404), A ma'lumoti o'zgarmaydi; o'z buyurtmasiga A mijozi, ombori yoki mahsulotini bog'lay olmaydi; `x-bum-company` orqali A ga o'tish — 403. Birinchi urinishda o'tdi — zaiflik topilmadi

**Brauzer E2E (lokal, haqiqiy Chromium va UI, lokal dev baza va lokal API; Playwright 1.63): 14/14 o'tdi**
- kirish: noto'g'ri parol — xato xabari; to'g'ri parol — `/sinov-dokon/dashboard`
- Dostavka → Buyurtmalar: "Hudud bo'yicha" — "Urganch → Luchevoy" (3 do'kon), "Hudud ko'rsatilmagan", "Zakaz bor"; "Marshrut bo'yicha"
- "Barchasini dostavshikka biriktirish" → "Marshrut tayyor": OpenStreetMap xaritasida 3 ta raqamli belgi, yo'l chizig'i, "2.1 km · 5 daq · yo'l bo'yicha", Google Maps / Yandex tugmalari
- belgi popup'i: Google Maps va Yandex havolalari; Xarita → "Kunlik marshrut"; yetkazma tafsilotida "Xaritada" — ilova ichidagi oyna, yangi sahifa ochilmaydi
- Distribyutsiya → Xarita (raqamli belgilar) → "Optimal tartib"
- boshqa biznes sarlavhasi — 403, begona ID — 404; dostavshik (mobil 400 px): "Optimal marshrut" va navigator havolalari; chiqish — `/api/auth/me` 401 va kirish sahifasi; brauzer konsolida kutilmagan xato yo'q
- **topildi va tuzatildi:** marshrut oynasida xarita belgisi bosilsa oyna yopilib yetkazma tafsiloti ochilardi — popup'dagi navigator havolalariga yetib bo'lmasdi. Endi belgi — navigator havolalari, yetkazmani ochish — ro'yxat qatoridan (dostavka jonli xaritasida ham)
- Kassa bu bosqichda qayta sinalmadi: 2026-09-13 dagi Electron smoke va desktop testlari o'z kuchida; paketlangan 0.4.1 foydalanuvchining ishlab turgan kassasiga (ma'lumot papkasi, bitta-nusxa qulfi) tegmaslik uchun ishga tushirilmadi

**Mijoz hududlari:** migratsiya 0044 — faqat `ADD COLUMN` va `CREATE INDEX`, `UPDATE` yo'q; mavjud mijozlarning hududi bo'sh qoladi va avtomatik taxmin qilib to'ldirilmaydi; E2E da ular "Hudud ko'rsatilmagan" guruhida to'g'ri ko'rindi.

## To'lov terminallari va universal aralash to'lov (2026-09-14)

Holatlar: **DONE** — kod + test o'tdi; **PARTIAL** — qisman; **BLOCKED** — foydalanuvchi harakati/kalit kerak.

**Arxitektura (migratsiya 0045 — faqat qo'shimcha: 2 jadval, nullable ustunlar, UPDATE yo'q):**
- `payment_terminals` — id, company_id, name, network (uzcard/humo/visa/mastercard/unionpay/other), provider, cash_account_id (bank hisobi, asosiy valyuta), branch_id, terminal_identifier (TID, kompaniyada unikal), is_active, vaqt. O'chirilmaydi — faolsizlantiriladi
- `cash_accounts.ledger_account_id` — bank hisobi buxgalteriyada alohida (masalan 1021); yo'q bo'lsa 1010/1020. Kirim, chiqim, qaytarish va kassa↔bank o'tkazmasi shu qoidada
- `payments` — to'lov hujjati (source: pos / pos_device / delivery / sales_payment / pos_customer_payment, `idempotency_key` kompaniyada unikal, jami); `customer_payments.payment_id` / `terminal_id` — qismlar (usul, summa, hisob, terminal, havola, vaqt). Alohida `PaymentAllocation` modeli qo'shilmadi — mavjud `customer_payments` qatorlari taqsimot vazifasini bajaradi (takror model yo'q)
- `sales/payment-allocation.service.ts` — POS (web va desktop sinxroni), dostavka, qarz/buyurtma to'lovi va kassada qarz to'lash uchun bitta qoidalar: terminal va hisob shu kompaniyaniki va faol, terminal faqat karta, hisob turi usulga mos, takror qism rad; karta/bank jami summadan oshmaydi; **ortiqcha to'lov rad** (qaytim faqat bitta naqd to'lovda — oddiy kassa qaytimi); **kam to'lov rad**, faqat mijoz tanlanib `onCredit` (nasiya) belgilansa qarzga. Har qism o'z hisobiga kassa harakati va jurnal (DR hisob / CR 1100)

| Band | Holat | Dalil |
|---|---|---|
| Terminallar API va UI (Moliya → Karta terminallari), kassaga buxgalteriya hisobini bog'lash | DONE | `payment-terminals.test.ts`; web tsc/lint |
| POS web: aralash to'lov paneli (Jami, qism qatorlari, To'langan, Qoldiq, "To'lov qo'shish"), [UZCARD]/[HUMO] tugmalari, nasiya belgisi, `clientRequestId` (ikki marta bosish / qayta urinish — 409, ikkinchi chek yo'q) | DONE (API test) | `payment-terminals`, `pos-mixed-payment` testlari; brauzerda qo'lda sinalmadi |
| Chekda qismlar ro'yxati (terminal nomi bilan) | DONE | web tsc |
| Qaytarish asl hisobdan (UZCARD — A bank, HUMO — B bank; qisman va to'liq) | DONE | `payment-terminals` testi (`sales_return_card`, `sales_return_card_2`) |
| Dostavka: `parts[]`, siyosatda ruxsat etilgan usullar (`collectionMethods`), `/agent/payment-options`, dostavshik oynasida bir nechta qism, takroriy so'rov | DONE (API test) | `payment-terminals` testi; mobil UI brauzerda sinalmadi |
| Qarz/buyurtma to'lovi aralash (`POST /api/sales/payments parts[]`), kassada qarzni aralash to'lash (oyna), qarzdan ortig'i rad | DONE | `payment-terminals` testi |
| Smena yig'indisi: bank/o'tkazma to'lovi `totalBank` ga (avval yozilmasdi) | DONE | test |
| Desktop kassa: aralash to'lov (naqd/karta/bank) oflayn navbatdan idempotent sinxron (chek ID) | DONE (avvaldan) | `pos-mixed-payment` offline testi |
| Desktop kassada terminal tanlash: faol terminallar qurilma config'i bilan sinxronlanadi (terminal qo'shilsa/o'chirilsa xesh o'zgaradi), kassa ekranida karta — har terminal alohida qism (UZCARD + HUMO bir chekda), oflayn chek navbatda `terminalId` bilan, serverda terminal bog'langan bank hisobiga; chek va to'lov taqsimotida terminal nomi | DONE (kod + test) | API `payment-terminals` (5: config sinxroni, xesh, oflayn chek hisoblari, begona terminal rad); desktop `sale-calc`, `kassa-service` testlari; yangi o'rnatuvchi e'lon qilinmaguncha foydalanuvchi kassalarida yo'q |
| Haqiqiy ekvayring (terminal to'lovni o'zi tasdiqlashi) | BLOCKED | bank/processing protokoli va kalitlari yo'q; soxta "to'lov o'tdi" qilinmadi — kassir terminal chekiga qarab kiritadi; adapter nuqtasi — terminal yozuvi |

## Modullar boshqaruvi (2026-09-14)

**Arxitektura (migratsiya 0046 — faqat qo'shimcha):**
- `@bum/shared` `MODULE_REGISTRY` — 12 real modul: products, warehouse, sales, pos, purchase, manufacturing, crm, distribution, delivery, finance, hr, reports. Bog'liqliklar: warehouse → products; sales, pos, purchase, manufacturing → products + warehouse; distribution, delivery → sales. Tizim qismlari (auth, kompaniya, obuna, bosh sahifa, profil, xavfsizlik, sozlamalar) modul emas — o'chirilmaydi
- `company_modules` (company_id, module_key, enabled, enabled_at, disabled_at, changed_by, vaqt) va `company_module_history` (source: owner / platform / registration, sabab). Yozuv yo'q — yoqilgan: mavjud kompaniyalarda hech narsa o'zgarmaydi. Eski `settings` dagi `module.*` qatorlari (faqat UI edi) ko'chirilmadi
- Server guard (`company/module-guard.ts`, `onRoute`): Auth → Company → Subscription/License → **Module** → Permission. O'chiq modul API'si — 403 `MODULE_DISABLED` (`details.module`); obuna tugagan/a'zolik yo'q bo'lsa avval o'sha xato. Umumiy API: `/api/sales/customers` (savdo, POS, CRM, dostavka, distribyutsiya — bittasi yoqilgan bo'lsa), `/api/sales/*` (savdo yoki POS). Yopilmaydi: auth, registration, public, platform, company, subscription, notifications, files, valyuta kurslari, `/api/analytics/dashboard`, omborlar ro'yxati, kassa qurilmasining session/app-update/unregister/releases
- Kassa qurilmasi: POS o'chsa sinxron (pull/push) 403 — desktop navbatdagi amallarni o'chirmaydi (sync-engine xatoni holatga yozadi), yangi qurilma ro'yxatdan o'tmaydi

| Band | Holat | Dalil |
|---|---|---|
| Server guard, bog'liqliklar, tarix + audit (MODULE_ENABLED/DISABLED), ma'lumot o'chirilmaydi | DONE | `modules.test.ts` (4) |
| Kompaniyalar izolyatsiyasi (A o'chirsa B ochiq), qayta yoqish, RBAC (modul + ruxsat ikkalasi shart), obuna ustunligi, platforma admini | DONE | `modules.test.ts` |
| Web: menyu va sahifa server holatidan, "Modul o'chirilgan" ekrani, Sozlamalar → Modullar (karta, holat, ON/OFF, bog'liqlik ogohlantirishi, tarix), admin paneli → kompaniya modullari | DONE (tsc/lint) | brauzerda qo'lda sinalmadi |
| Ro'yxatdan o'tish: "Qaysi modullardan foydalanasiz?" qadami (standart: ishlab chiqarishsiz), bog'liqliklar avtomatik | DONE | `modules.test.ts` (API); UI tsc |
| Sotuv agenti / dostavshik ilovalari va desktop kassada maxsus "modul o'chirilgan" ekrani | PARTIAL | API xabari umumiy xato sifatida ko'rinadi |

## Bank komissiyasi, kassada to'lov usullari va GPS zaryadi (2026-09-14)

**Arxitektura (migratsiya 0047 — faqat qo'shimcha: ustunlar + unikal indeks, mavjud ma'lumot o'zgarmaydi):**
- `payment_terminals.commission_percent` (ekvayring, %) va `show_in_pos`; `cash_accounts.show_in_pos` va `outgoing_commission_percent` (pul chiqarish, %); `expenses.reference_type/reference_id` (kompaniyada unikal — takroriy so'rovda komissiya ikki marta yozilmaydi)
- `finance/bank-commission.service.ts`: komissiya — bank hisobidan alohida chiqim + jurnal DR 5800 "Bank komissiyasi xarajatlari" / CR bank hisobi + "bank komissiyasi" toifali to'langan xarajat (Xarajatlarda ko'rinadi). 5800 hisobi yangi kompaniyalarda standart, eskilarida birinchi komissiyada ochiladi
- Ekvayring: karta terminali to'lovida (POS web/desktop, qarz to'lovi, dostavka) — 100 000 da 0.25% → bankka 99 750, xarajat 250. Qaytarishda komissiya qaytmaydi (bank ham qaytarmaydi)
- Pul chiqarish: faqat bank turi va asosiy valyuta — ta'minotchi to'lovi, xarajat, maosh, kassalar orasida o'tkazma, qo'lda chiqim: 1 000 000 da 1% → hisobdan 1 010 000, ta'minotchi balansiga 1 000 000, xarajat 10 000. Mablag' yetmasa (summa + komissiya) — 400, hech narsa yozilmaydi. Mijozga qaytarishda komissiya olinmaydi
- Kassada ko'rsatish: `/api/sales/pos/payment-options` va qurilma config'i faqat `show_in_pos` terminallar va bank hisoblarini beradi. Kassa tugmalari: Naqd, UZCARD, HUMO (bir tizimda bir nechta terminal — "UZCARD · nomi"), bank hisobi nomi; terminal bo'lmasa — umumiy "Karta", hisob belgilanmasa — umumiy "Bank"

| Band | Holat | Dalil |
|---|---|---|
| Ekvayring komissiyasi (0.25%, 0% da yozuv yo'q, takroriy `clientRequestId` — ikkinchi komissiya yo'q, 5800/1020/1100/4000 jurnallari) | DONE | `bank-commission.test.ts` (1) |
| Pul chiqarish komissiyasi (ta'minotchi, xarajat, o'tkazma, qo'lda chiqim, mablag' yetmasa rad, naqd kassada yo'q, 101% rad) | DONE | `bank-commission.test.ts` (2) |
| Moliya UI: terminalda komissiya va "Kassada ko'rsatish", bank hisobida "Kassada ko'rsatish" (darhol saqlanadi) va chiqim komissiyasi, misol matni | DONE | brauzer E2E (lokal) |
| Web kassa: to'lov usuli tugmalari terminal va bank hisobi bo'yicha, aralash to'lov panelida ham; yashirilgan terminal ko'rinmaydi | DONE | brauzer E2E (lokal) |
| Desktop kassa: bank hisoblari config bilan, bank qismi har hisob bo'yicha, oflayn chek `cashAccountId` bilan shu hisobga, begona hisob rad | DONE (kod + test) | API `payment-terminals` (5), desktop `kassa-service` testi; yangi o'rnatuvchi e'lon qilinmaguncha kassalarda yo'q |
| Haqiqiy terminal ekvayringi (to'lovni bank tasdiqlashi) | BLOCKED | bank/processing protokoli yo'q — kassir terminal chekiga qarab kiritadi |

**Brauzer E2E (lokal, Chromium, 2026-09-14) — 12/12:** egasi kirishi; Moliya → Karta terminallari: UZCARD 0.25% qo'shildi ("100,000 so'm to'lovda 250 so'm komissiya ... 99,750 so'm"), jadvalda 0.25%; Kassa & Bank: "Kassada ko'rsatish" va chiqim 1% ("1,010,000 so'm chiqadi, 10,000 so'm"); Kassa: tugmalar Naqd | HUMO · ... | UZCARD · ... | bank hisobi nomi (umumiy "Karta"/"Bank" yo'q); UZCARD bilan 12 000 so'mlik sotuv — bankka 11 970, komissiya 30 (xarajat, "To'langan"); bank hisobi tanlab 12 000 — hisobga to'liq 12 000, komissiya yo'q; aralash to'lov panelida UZCARD, HUMO, bank hisobi; terminal kassada yashirilganda tugmasi yo'qoladi; Xarajatlar ro'yxatida "Ekvayring komissiyasi 0.25% — ..." (toifa "Bank komissiyasi"); 400 px enida gorizontal siljish yo'q; konsolda xato yo'q. Topilgan va tuzatilgan: misol matnida raqam formati aralash edi ("1 000 000" va "1,010,000") — `formatMoney` bilan bir xil qilindi

**GPS zaryad sarfi (Android ogohlantirishi):**
- Sabab: fondagi GPS plagini (`@capacitor-community/background-geolocation` 1.2.26) ish vaqti davomida **har soniya** yuqori aniqlikda o'lchardi (`setInterval(1000)`, `setMaxWaitTime(1000)`); dostavshik serverga har buferlangan nuqtada so'rov yuborardi (mashinada ~har 4 soniya); WebSocket pingi 25 s va ish vaqti tashqarisida ham fonda ochiq edi
- Tuzatish: `patches/@capacitor-community__background-geolocation@1.2.26.patch` (pnpm `patchedDependencies`) — oraliq, eng tez oraliq va paketli yetkazish JS'dan; paketdagi har o'lchov yetkaziladi; ruxsatsiz kuzatuvchi qo'shilmaydi. Eski APK yangi parametrlarni e'tiborsiz qoldiradi (avvalgidek ishlaydi)
- JS: GPS oralig'i siyosat oralig'ining uchdan biri, 10–30 s (standart 60 s siyosatda — 20 s, paket 40 s); dostavka nuqtalari serverga 30–120 s da bir paket (bufer 20 ga yetsa darhol); siyosatdagi aniqlikdan yomon nuqta yuborilmaydi; savdo agenti — siljishda ham 15 s dan tez emas; ish sessiyasi yopilgan (409) — kuzatuv to'xtaydi; ekrandagi nuqta 5 m dan kam siljisa qayta chizilmaydi; tashrif/buyurtma amalida 15 s ichidagi aniq (≤ 50 m) kuzatuv o'lchovi qayta ishlatiladi (GPS alohida yoqilmaydi); WebSocket pingi 55 s (server o'zi 30 s da ping yuboradi), ish vaqti tashqarisida fonda 1 daqiqadan keyin ulanish yopiladi va ilova ochilganda qayta ulanadi; taymerlar fonda qayta chizmaydi
- Dockerfile'lar: `COPY patches patches` (lockfile patch xeshini tekshiradi)

| Band | Holat | Dalil |
|---|---|---|
| Plagin patch'i, JS kuzatuv siyosati, realtime | DONE (kod + test) | `tracking-throttle.test.ts` (3), `use-delivery-tracking`, `realtime` testlari; web tsc/lint |
| Patch'langan plagin bilan APK qurilishi | DONE | `cap sync android` (plagin yo'li patch'langan paketga), `gradlew assembleDebug` — BUILD SUCCESSFUL; kompilyatsiya qilingan `BackgroundGeolocation*.class` da yangi kod bor. Debug APK: 5 359 204 bayt, SHA-256 `619988448EB912A40405DCFD273B1722398B2EFEF1CEA62F98A0B90C1BDDC5DA` (debug imzo); release imzosi — kalit yo'q |
| Real telefonda zaryad sarfini o'lchash | Qilinmagan | telefon ulanmagan; yangi APK o'rnatilgach Android "Batareya" bo'limida solishtirish kerak |

**Testlar (2026-09-14, shu bosqichdan keyin):** API regressiya 97 fayl — `--maxWorkers=1` bilan 8 qismda hammasi o'tdi (2 test standart hisoblar sonini 21 kutardi — 5800 qo'shilgani uchun 22 ga yangilandi); web 15 fayl / 60 test, tsc, lint (o'zgargan fayllar), `vite build` — toza; desktop typecheck (main + renderer), 9 fayl / 57 test

**Production deploy (2026-09-14, commit `3407c66`):** `bum-api` va `bum-web` — SUCCESS (13:15, Toshkent vaqti). API ichidan `/health` — ok; migratsiyalar qo'llandi — bazada 0047 tekshirildi (6 ta yangi ustun va `expenses_company_reference_key` indeksi bor, jami 48 migratsiya yozuvi; faqat o'qish so'rovi, qiymatlar chiqarilmadi). Dockerfile'lar `patches` bilan qurildi. Sessiyasiz: `/api/sales/pos/payment-options`, `/api/finance/terminals`, `/api/finance/cash-accounts`, `POST /api/delivery/agent/locations` — 401; `/`, `/uz/login` — 200; noma'lum yo'l — 404. Tizimga kirgan holda production'da sinalmadi (production hisobi ishlatilmaydi)

**Foydalanuvchi uchun (bonnu-market):** *(yangilangan — keyingi bo'limga qarang: "Karta terminallari" menyusi olib tashlandi)* Moliya → Kassa & Bank → bank hisobini tanlash → "Karta turi qo'shish": UZCARD → "Uzcard" hisobi, komissiya (masalan 0.25); HUMO → "Humo". Bank hisobini kassada alohida tugma qilish — Kassa & Bank → hisobni tanlash → "Kassada ko'rsatish"; pul chiqarish komissiyasi — shu yerda. Mavjud ma'lumot avtomatik o'zgartirilmadi

## Karta turlari bank hisobi ichida, komissiya hisoboti (2026-09-14)

**Talab (foydalanuvchi):** "Karta terminallari" menyusi kerak emas; kassada Naqd, Karta, Bank kabi UZCARD, HUMO ham chiqsin; UZCARD/HUMO bog'langan bank hisobiga komissiyasi ushlanib tushsin va bank hisobida ko'rinsin; komissiyaga ketgan summa hisobotda ko'rinsin; bank hisobidan firmaga/ijaraga to'lovda komissiya (1%, 2%) avtomatik — 1 000 000 da hisobdan 1 010 000, firmaga 1 000 000.

**O'zgarishlar (migratsiya yo'q — ma'lumot modeli o'sha: `payment_terminals` → bank hisobi):**
- Moliya: "Karta terminallari" tabi olib tashlandi. Karta turlari (UZCARD, HUMO, VISA ...) — **Kassa & Bank → bank hisobi → "Karta to'lovlari shu hisobga" → "Karta turi qo'shish"** (to'lov tizimi, kassadagi nomi, komissiya %, kassada ko'rsatish, faol). Hisob tanlanmaydi — ochilgan bank hisobiga bog'lanadi. Avval qo'shilgan terminallar o'z hisobi ostida ko'rinadi
- Kassa (web va desktop): **Naqd, Karta, Bank doim**, yonida karta turlari (UZCARD, HUMO) va "kassada" belgilangan bank hisoblari. Umumiy "Karta" — asosiy bank hisobiga, komissiyasiz (karta turi tanlanmasa). Aralash to'lov panelida ham xuddi shunday
- Bank hisobi: harakatlar tarixida karta kirimi karta turi nomi bilan ("Mijoz to'lovi: SO-… · UZCARD") va komissiya chiqimi "komissiya" belgisi bilan; hisob ustida bu oygi xulosa — kartadan tushum, karta komissiyasi, hisobga sof tushgan, pul chiqarish komissiyasi. Bank hisobining "Kassada ko'rsatish" belgisi endi aniq nomlangan: "Kassada «hisob nomi» tugmasi (bank o'tkazmasi)"
- **Hisobotlar → Bank komissiyasi** (`finance.view`, davr tanlovi): kartadan tushum, karta komissiyasi, bank hisobiga sof, pul chiqarish komissiyasi, jami; karta turlari bo'yicha (tushum / komissiya / sof), bank hisoblari bo'yicha, komissiyalar ro'yxati (sana, turi, hisob, to'lov summasi, komissiya). API: `GET /api/finance/reports/bank-commissions?dateFrom=&dateTo=&cashAccountId=`
- Pul chiqarishda komissiya oldindan ko'rinadi ("Bank komissiyasi 1%: 10 000 so'm — hisobdan jami 1 010 000 so'm chiqadi"): Kassa & Bank → Chiqim, xarajatni to'lash, maoshni to'lash, ta'minotchiga to'lov. Ta'minotchiga to'lov formasiga **"Qaysi hisobdan"** tanlovi qo'shildi (avval hisob tanlab bo'lmasdi — server usul bo'yicha tanlardi); "Avtomatik" da ham server qaysi hisobni olishi ko'rsatiladi

| Band | Holat | Dalil |
|---|---|---|
| Hisobot API: jami, karta turi va hisob bo'yicha, qatorlar; hisob va sana filtri; noto'g'ri sana 400; kassir 403 | DONE | `bank-commission.test.ts` (2 test, hisobot tekshiruvlari qo'shildi) |
| Bank harakatida karta turi nomi va komissiya qatori | DONE | `bank-commission.test.ts` |
| Komissiya ko'rsatkichi hisobi (1% — 10 000 / 1 010 000, 0.25%, yaxlitlash, noto'g'ri summa) | DONE | `src/components/payments/bank-commission.test.ts` (2) |
| Web UI (Moliya, kassa, hisobot, to'lov oynalari) | DONE | brauzer E2E 14/14 (quyida); web tsc, lint |
| Desktop kassa: Karta va Bank ustunida umumiy qism + karta turlari / bank hisoblari | DONE (typecheck) | desktop renderer tsc; kassa ekrani brauzerda sinalmaydi (Electron), yangi o'rnatuvchi e'lon qilinmaguncha kassalarda yo'q |

**Brauzer E2E (lokal, Chromium) — 14/14:** "Karta terminallari" tabi yo'q; bank hisobi ichida "Karta turi qo'shish" — UZCARD 0.25% ("100,000 so'm to'lovda 250 so'm komissiya ushlanadi — «hisob» hisobiga 99,750"), ro'yxatda "komissiya 0.25% · kassada", API'da shu hisobga bog'langan; bank o'tkazmasi tugmasi va chiqim 1%; Chiqim oynasida 1 000 000 → "10,000 so'm — hisobdan jami 1,010,000 so'm"; kassa tugmalari tartibi Naqd | Karta | Bank | HUMO … | UZCARD … | bank hisoblari; UZCARD bilan 12 000 — bankka 11 970, komissiya 30; umumiy "Karta" — tanlangan bank hisobiga tushmaydi, komissiya yo'q; aralash to'lov panelida Karta, Bank, UZCARD, HUMO; bank tarixida "· E2E UZCARD …" va "komissiya" belgisi, oy xulosasi (tushum 12 000, komissiya 30, sof 11 970); Hisobotlar → Bank komissiyasi — karta turi qatori 0.25% / 12 000 / 30 / 11 970 (API bilan mos); 400 px enida gorizontal siljish yo'q; konsolda xato yo'q

**Testlar (shu bosqichdan keyin):** API regressiya — 97 fayl / 399 test, `--maxWorkers=1` bilan 8 qismda, hammasi o'tdi; web — 16 fayl / 62 test, tsc, lint (o'zgargan fayllar), `vite build` toza; desktop — typecheck (main + renderer), 9 fayl / 57 test

**Kassa 0.4.4 (Karta va Bank ustunida umumiy qism + karta turlari / bank hisoblari):** o'rnatuvchi qurilgan — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.4.exe`, 111 732 262 bayt, SHA-256 `FF163E21258C682681CFD04ADFC7ED5C6C1300FF4A15FAA00465CEE9D66BEBB1`, imzosiz (`Get-AuthenticodeSignature`: NotSigned), **e'lon qilinmagan**; paketlangan ilova ishga tushirilmadi (ishlab turgan kassaga tegmaslik uchun)

**Production deploy (commit `a0e8cad`):** `bum-api` va `bum-web` — SUCCESS (16:29, Toshkent vaqti); migratsiya yo'q. API ichidan `/health` — ok. Sessiyasiz: `/api/finance/reports/bank-commissions`, `/api/finance/terminals`, `/api/sales/pos/payment-options` — 401 (marshrutlar mavjud); `/`, `/uz/login` — 200; noma'lum yo'l — 404. Tizimga kirgan holda production'da sinalmadi (production hisobi ishlatilmaydi)

**Foydalanuvchi uchun (bonnu-market):** Moliya → Kassa & Bank → "Uzcard" bank hisobini tanlash → "Karta turi qo'shish": To'lov tizimi UZCARD, komissiya (masalan 0.25) → Saqlash; "Humo" hisobida — HUMO. Kassada UZCARD va HUMO tugmalari chiqadi, to'lov shu hisobga komissiyasi ushlanib tushadi. Pul chiqarish komissiyasi — shu hisobning "Pul chiqarish komissiyasi, %" maydoni. Hisobot — Hisobotlar (Analitika) → "Bank komissiyasi". Mavjud ma'lumot avtomatik o'zgartirilmadi

## Xavfsizlik auditi va mustahkamlash (2026-09-14)

**Talab:** zero-cost security hardening — AUDIT → FIX → TEST → RETEST; majburiy pullik xizmat yo'q; production ma'lumotiga destructive amal yo'q; tekshirilmagan narsa PASS deb yozilmaydi.

**Audit:** 5 yo'nalish (AUTH — kirish/sessiya, PAY — pul/to'lov, TEN-B — tenant/RBAC backend, TEN-S — savdo/kassa/agent, CLI — web/desktop/Android/infra) — **69 topilma: CRITICAL 0, HIGH 7, MEDIUM 19, LOW 43** (yo'nalishlar orasida takrorlar bor: TEN-B-8 = AUTH-2, TEN-B-4 = PAY-6, TEN-S-1 ≈ PAY-1 ≈ AUTH-4, TEN-S-3 = PAY-2, TEN-S-4 = PAY-16, TEN-S-5 = PAY-4, AUTH-11 = CLI-2). Commit qilingan o'zgarishlarda haqiqiy sir topilmadi (git diff va yangi fayllar skaneri: faqat test bazasi uchun sinov parollari; `.env`, `.jks`, `.keystore`, `.pem` fayllari yo'q). Production muhit o'zgaruvchilari ochilmadi

| Topilma | Og'irlik | Holat | Dalil |
|---|---|---|---|
| AUTH-1 SMS kodni parallel so'rov bilan tanlash | HIGH | DONE | urinish solishtirishdan oldin atomar; test: 15 parallel xato kod — urinish ≤ 5, kod yonadi |
| AUTH-2 / TEN-B-8 `trustProxy: true` — IP soxtalashtirish | HIGH | DONE | `TRUST_PROXY_HOPS=1`, nginx rekursiv realip; test: XFF chap qiymati yozilmaydi; production'da soxta XFF bilan tekshirilgan — API haqiqiy mijoz IP'sini ko'radi (`15dc4c2`) |
| CLI-1 imzosiz yangilanish o'rnatuvchisi | HIGH | BLOCKED — USER ACTION REQUIRED | kod imzolash sertifikati (`CSC_LINK`, `CSC_KEY_PASSWORD`) kerak; 0.4.5 — NotSigned |
| PAY-1 / TEN-S-1 / AUTH-4 qurilma istalgan kassir nomidan ishlaydi | HIGH | PARTIAL | `pos_device_cashiers` (0048): yuqori huquqli offline amallar (qaytarish, narx, xarid, ta'minotchi to'lovi, hisobdan chiqarish, ko'chirish, sanash, kurs, mijoz/ta'minotchi tahriri) va analitika — faqat shu qurilmada parol bilan kirgan kassir; test bor. Oddiy savdo/smena hali `cashierId` ga ishonadi (offline ish to'xtamasin); pull'da a'zolar ro'yxati (TEN-S-8) — NOT STARTED |
| TEN-B-1 `hr.manage` egani / to'liq huquqlini bloklaydi | HIGH | DONE | ega, to'liq rol, platforma admini himoyalangan; HR orqali kirishni o'zgartirish `employee.software_access.manage`; test |
| TEN-S-2 agentlar menejeri istalgan a'zoni bloklaydi | HIGH | DONE | test: egaga bog'langan agentni faolsizlantirish 403 |
| AUTH-3 login lockout poygasi | MEDIUM | DONE | test: 12 parallel xato — ≤ 5 tasi parol tekshiradi |
| AUTH-5 raqamni bilgan kishi hisobni bloklab turadi | MEDIUM | PARTIAL | raqam+IP 5, raqam 20, IP 30 (15 daq.); ko'p IP bilan raqamni bloklash hali mumkin |
| CLI-2 / AUTH-11 CSP yo'q | MEDIUM | DONE (lokal) | nginx CSP `script-src 'self'`, inline skript `theme-init.js` ga; brauzer E2E: kiritilgan inline skript bloklanadi, 10 sahifada CSP buzilishi yo'q. Production: sarlavha bor, `theme-init.js` JS, sahifada inline skript yo'q; tizimga kirgan holda brauzerda — NOT VERIFIED; Android WebView native bridge — PARTIAL |
| CLI-3 Android backup yoqilgan | MEDIUM | DONE | `allowBackup=false`, `data_extraction_rules.xml`; APK qurildi, merged manifest tekshirildi |
| CLI-4 logout qurilmada ma'lumot qoldiradi | MEDIUM | DONE (kod) | agent API keshi, qoralamalar, yuborilmagan GPS o'chiriladi; brauzerda alohida — NOT VERIFIED |
| PAY-2 / TEN-S-3 offline narx, chegirma, kurs | MEDIUM | PARTIAL | faqat nomuvofiqlik yoziladi (offline chek rad etilmaydi — kelishilgan qaror) |
| PAY-4 / TEN-S-5 kassir kutilgan naqdni kamaytiradi, pulni boshqa hisobga o'tkazadi | MEDIUM | DONE | chiqim ≤ kutilgan naqd (offline — `cash_exceeds_expected`), boshqa hisobga `finance.manage`; test |
| PAY-5 qaytarish usuli asl to'lovga mos emas | MEDIUM | DONE | `return-items` — test; `orders/:id/return` — kod, alohida test yo'q |
| PAY-6 / TEN-B-4 xarid qaytarishida pul chegarasiz | MEDIUM | DONE | test: 5000 > 3000 — 400 |
| PAY-7 / TEN-B-3 omborchi istalgan hisobga jurnal | MEDIUM | PARTIAL | qarshi hisob `finance.manage` (test); tannarx chegarasi — NOT STARTED |
| PAY-8 dostavka naqdi to'g'ridan-to'g'ri asosiy kassaga | MEDIUM | NOT STARTED | topshirish bosqichi kerak (dizayn qarori) |
| PAY-9 kassir balans yaratadi | MEDIUM | PARTIAL | balansga qaytim ≤ chek summasi (test); offline va tasdiqlash — NOT STARTED |
| PAY-10 son chegarasi 500 va sinxron navbatini to'xtatadi | MEDIUM | DONE | 22003 → 400 (test), offline amal rad qilinadi (kod) |
| TEN-B-2 qayta ishga olish platforma blokini ochadi | MEDIUM | DONE | test |
| TEN-B-5 aqlli ogohlantirishlar hammaga ko'rinadi | MEDIUM | DONE | bo'lim ruxsati bo'yicha; testlar (security, notifications) |
| AUTH-9 tiklash kodi xeshida server siri yo'q | LOW | DONE | HMAC(SESSION_SECRET); tiklash testlari o'tdi |
| AUTH-10 parol siyosati faqat uzunlik | LOW | DONE | keng tarqalgan va bir xil belgili parollar rad; test |
| AUTH-12 DB xato parametrlari logda | LOW | DONE (kod) | pino `err` serializer; test yo'q |
| AUTH-13 mayda nomuvofiqliklar | LOW | PARTIAL | platforma telefon almashtirishda sessiyalar bekor, parol almashtirish limiti atomar |
| CLI-7 yangilanishda token `startsWith` bilan | LOW | DONE | faqat API origin'iga; desktop typecheck, 57 test |
| CLI-8 chek oynasida JS va navigatsiya | LOW | DONE (typecheck) | CSP + navigatsiya taqiqi; Electron'da ishga tushirilmadi |
| CLI-11 rendererdan istalgan https havola | LOW | DONE (typecheck) | domenlar ro'yxati |
| CLI-12 FileProvider keng yo'llar | LOW | DONE (build) | faqat `cache/shared/`; qurilmada ulashish — NOT VERIFIED |
| PAY-11 dostavka qaytarishi `sales.refund` siz | LOW | DONE | test |
| PAY-13 xarid sotuv narxi `products.edit` siz | LOW | DONE | test |
| PAY-16 / TEN-S-4 aralash to'lovda mijoz tekshirilmaydi | LOW | DONE | test |
| TEN-B-6 kuchliroq rolni zaiflashtirish | LOW | DONE | test |
| TEN-B-9 moliya ruxsati bo'shliqlari | LOW | PARTIAL | `PUT /currencies` kurs ruxsati (test); qolgani NOT STARTED |
| TEN-B-12 umumiy sozlama yo'li `pos.*` | LOW | DONE | test |
| TEN-S-10 qulf tenant tekshiruvidan oldin | LOW | DONE (kod) | regressiya o'tdi, alohida test yo'q |
| AUTH-8 / CLI-10 qurilma tokeni muddatsiz, plaintext fallback | LOW | PARTIAL | uzishda token xeshi almashtiriladi; muddat/rotatsiya, shifrlash — NOT STARTED |
| AUTH-6 ro'yxatdan o'tgan raqamni aniqlash | LOW/MEDIUM | NOT VERIFIED | parol tiklash javobi bir xil; ro'yxatdan o'tish oqimi tekshirilmadi |
| AUTH-7, CLI-5, CLI-6, CLI-9, CLI-13, PAY-3, PAY-12, PAY-14, PAY-15, PAY-17, PAY-18, PAY-19, TEN-B-7, TEN-B-10, TEN-B-11, TEN-B-13, TEN-S-6, TEN-S-7, TEN-S-8, TEN-S-9, TEN-S-11 | LOW | NOT STARTED | ro'yxat quyidagi "Qolgan xavfsizlik ishlari"da |

**Infratuzilma:**
- Paketlar: drizzle-orm 0.45.2 (HIGH advisory yopildi), drizzle-kit 0.31.10, vitest 4.1.11 — `pnpm audit`: critical 0, high 0, moderate 1 (faqat dev: drizzle-kit ichidagi esbuild) — DONE
- Zaxira: `deploy/backup` — pg_dump (custom), SHA-256, arxivni o'qib tekshirish, saqlash muddati; tiklash sinovi faqat nomida `restore`/`test` bo'lgan bazaga — lokal PASS (14 jadval soni manba bilan mos). Production cron xizmati — BLOCKED — USER ACTION REQUIRED (Railway'da alohida xizmat va volume, bepul tarif limiti ichida)
- nginx: `nginx -t` PASS (lokal); realip oxirgi X-Forwarded-For; API'ga `X-Forwarded-For $remote_addr`

**Testlar (xavfsizlik fixlaridan keyin):**
- API: 98 fayl / 408 test — `--maxWorkers=1`, 9 qismda (79 + 49 + 39 + 64 + 29 + 48 + 33 + 55 + 12), hammasi o'tdi; keyin `security-hardening.test.ts` ga 10 ta maqsadli test qo'shildi — 20/20 o'tdi (jami 418 test); API `tsc` (src + test) — 0 xato
- Web: 16 fayl / 62 test, tsc, lint (o'zgargan fayllar), `vite build` — toza; `dist` da inline skript yo'q
- Brauzer E2E (lokal, production nginx shabloni + dist): CSP 30/31, to'lovlar 14/14, xarita/dostavka 13/14. Yiqilgan 2 tekshiruv — ikkalasi WebSocket 403: lokal 8080 portda `Origin` host (`127.0.0.1:8080`) ≠ `Host` (nginx `$host` portni olib tashlaydi) — lokal muhit artefakti, CSP emas (brauzer ulanishga urindi); production'da — NOT VERIFIED
- Desktop: typecheck (main + renderer), 9 fayl / 57 test. **Kassa 0.4.5** o'rnatuvchisi qurildi — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.5.exe`, 111 732 866 bayt, SHA-256 `A6050E36C4CF27A8FF1CBA7415C8F4DA0FAB3A9D09C2465B6948171D50B30E05`, imzosiz (`Get-AuthenticodeSignature`: NotSigned), **e'lon qilinmagan**, ishga tushirilmadi (ishlab turgan kassaga tegmaslik uchun)
- Android: `assembleDebug` BUILD SUCCESSFUL — `app-debug.apk` 5 787 561 bayt, SHA-256 `FDE69AB6E44DE4E19554B22AEA2A91A1AE0318A7D02E78C75B1AA5219EC9ECE0`; merged manifest: `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules`. Release imzo — BLOCKED (kalit yo'q); real qurilma — NOT VERIFIED

**Production (egasining ruxsati bilan deploy, 2026-09-14):**
- `bum-api` va `bum-web` — SUCCESS (yakuniy: API `8a3b678b`, web `d172d534`)
- **Uzilish ~15 daqiqa (17:12–17:26 UTC), sababi — shu deploy:** yangi "oddiy parol" qoidasi `.env` dagi bootstrap admin paroliga ham qo'llandi, API har ishga tushishda yiqildi (Railway deployni SUCCESS ko'rsatdi, eski deploy olib tashlangan edi). Tuzatish `dba183b`: bootstrap faqat uzunlikni tekshiradi va logga ogohlantirish yozadi (parol chiqarilmaydi); regressiya testi `bootstrap.test.ts` (14/14). **Bootstrap admin paroli production'da oddiy parollar ro'yxatiga yoki bir xil belgili qolipga tushadi — egasi Railway o'zgaruvchisida murakkab parolga almashtirishi kerak**
- **IP regressiyasi va tuzatish `15dc4c2`:** Railway zanjiri `"<mijoz yuborgani>, <mijoz>, <Railway proksi 152.233.x>"` — oxirgi qiymatni olish barcha foydalanuvchilarni proksi IP'lariga birlashtirdi (IP limitlari umumiy). Endi nginx realip rekursiv (ichki tarmoqlar va `152.233.0.0/16` ishonchli). Lokal nginx: 4 zanjir holati — PASS; production: soxtasiz va `X-Forwarded-For: 203.0.113.7` bilan so'rovda API ko'rgan IP = tashqi IP (ipify) — PASS, soxta qiymat yozilmadi
- Konteyner ichidan `/health` — ok; migratsiyalar 49 ta (0048 qo'llangan); `pos_device_cashiers`: 1 bog'lanish, 1 qurilma (faol qurilma 0, bog'lanishsiz faol qurilma 0) — faqat o'qish so'rovi
- `app.bum-erp.uz/uz/login` — 200, `Content-Security-Policy` va boshqa sarlavhalar bor, sahifada inline skript yo'q; `/theme-init.js` — `application/javascript`; `/api/auth/me` — 401 (nosniff, SAMEORIGIN); `/api/delivery/ws` upgrade cookiesiz — 401
- NOT VERIFIED: tizimga kirgan holda brauzerda realtime (WebSocket) CSP ostida, kassada kassir qayta kirishi va yuqori huquqli amallar (production hisobi ishlatilmaydi); Railway proksi oralig'i (`152.233.0.0/16`) — kuzatilgan manzillar asosida, Railway hujjati bilan tasdiqlanmagan
- Ishdagi kassalar uchun eslatma: 0048 bog'lanishlarni qurilma tarixidan (ro'yxatdan o'tkazgan, sinxron amallar, smenalar, kassir kirishlari) to'ldiradi. Tarixi yo'q xodim nomidan yuqori huquqli offline amal "cashier_not_bound" bilan rad etiladi — xodim kassada parol bilan bir marta kirishi kerak

**Qolgan xavfsizlik ishlari:** AUTH-7 (PIN bruteforce, qulflangan sessiyada WebSocket), AUTH-8/CLI-10 (token muddati, shifrlash), CLI-5/6 (S3 fayl tekshiruvi — S3 sozlanganda), CLI-9 (Electron fuses), CLI-13 (yuklash sessiyasi egasi), PAY-3 (offline xarid kursi), PAY-8 (dostavka naqdini topshirish), PAY-12 (qaytarishda smena kassiri), PAY-14 (tizim hisoblarini qayta yo'naltirish), PAY-15 (keshbek poygasi), PAY-17 (majburiy idempotentlik kaliti), PAY-18 (chegirma chegarasi/tasdiq), TEN-B-7 (AI/dashboard maosh jami), TEN-B-10 (bo'lim ichidagi ruxsat bo'shliqlari), TEN-B-11 (modul guard bo'shliqlari), TEN-B-13 (obuna yozish yo'llari), TEN-S-6/7/8/9 (modul ruxsatlari, ombor cheklovi o'qishda, pull'da a'zolar, GPS soxtalashtirish), TEN-S-11 (public OSRM). Pullik xizmat majburiy emas: kod imzolash sertifikati (Windows, yiliga taxminan 200–500 USD, kassalar keng tarqatilishidan oldin) — yagona tavsiya etilgan xarajat

## Qolgan xavfsizlik ishlari — ikkinchi bosqich (2026-09-15)

**Talab:** "qolgan xavfsizlik ishlarini qil". Pul oqimini o'zgartiradigan dizayn qarorlari egasining roziligisiz o'zgartirilmadi (pastda).

| Topilma | Holat | Dalil |
|---|---|---|
| AUTH-7 PIN sekin tanlash, qulflangan sessiya | DONE | 24 soatda blok 5 → 10 → 20 daqiqa, 3-blokda barcha sessiyalar bekor; qulflangan sessiya muddati uzaymaydi; real-time berilmaydi — test |
| AUTH-6 raqamni aniqlash | PARTIAL | parol tiklashda SMS kutilmaydi (javob vaqti bir xil) — test; ro'yxatdan o'tishda "raqam band" javobi qoldi (SMS tasdiqlash kerak — Eskiz kalitlari yo'q) |
| AUTH-8 / CLI-10 qurilma tokeni | PARTIAL | web'dan o'chirilganda token almashtiriladi va kassir bog'lanishlari bekor — test; desktop tokeni shifrlashsiz diskka yozilmaydi (kassa 0.4.6); lokal baza shifrlanmagan — kassa kompyuterlarida BitLocker tavsiya |
| AUTH-13 mayda nomuvofiqliklar | PARTIAL | noma'lum raqamga kirish urinishi auditga (raqam qisman yashirin), ochiq kompaniya qidiruvi IP limiti — test; "boshqa sessiyalarni ko'rish/yopish" — NOT STARTED |
| PAY-12 qaytarishda smena kassiri | DONE | test |
| PAY-15 keshbek poygasi | DONE (kod) | buyurtma qatori qulflanadi; alohida parallel test yo'q |
| PAY-3 offline xarid kursi | DONE (kod) | `rate_changed` nomuvofiqligi (savdo bilan umumiy funksiya); alohida test yo'q, sinxron testlari o'tdi |
| PAY-7 / TEN-B-3 qo'lda kirim | DONE | aktiv va tizim nazorat hisoblari qarshi hisob bo'lmaydi; o'rtacha tannarxdan 10 martadan ko'p farq — `finance.manage` — test |
| PAY-14 tizim yozuvlarini qayta yo'naltirish | PARTIAL | kichikroq kodli hisob bilan subtype'ni tortib olish taqiqi — test; nazorat hisoblariga qo'lda jurnal, yopilgan davr — NOT STARTED |
| TEN-B-9 moliya bo'shliqlari | PARTIAL | o'z xarajatini tasdiqlash (egadan tashqari) va tasdiqlanganini o'chirish rad — test; qarshi hisobsiz kassa amali jurnalga yozilmasligi — **egasining qarori** (kirim "boshqa daromad"mi yoki "kapital"mi) |
| TEN-B-7 AI va bosh sahifa | DONE | kassa, qarz, foyda, maosh faqat `finance.view` / `hr.view` / `hr.salary` va modul yoqilgan bo'lsa — test |
| TEN-S-7 / TEN-B-10 ombor va HR chegaralari | PARTIAL | smena, savdo va xarid buyurtmalari, to'lovlar ro'yxati, ishlab chiqarish buyurtmalari — ruxsat berilgan omborlar; o'z ta'tilini tasdiqlash rad; maosh faqat `hr.salary` bilan — test; ta'minotchi to'lovi hisobi, katalog partiyalari, BOM kategoriyasi — NOT STARTED |
| TEN-B-11 modul guard | PARTIAL | fayllar tur bo'yicha modulga bog'landi, smart ogohlantirishlar modul o'chiq bo'lsa yashirin — test; moliya moduli o'chiq bo'lsa maosh to'lanmaydi (kod); omborlar yozuvi va ishlab chiqarishni yakunlash — NOT STARTED |
| TEN-B-13 obuna yozuvlari | PARTIAL | litsenziya so'rovini faqat `license.manage` bekor qiladi (kod); to'xtatilgan kompaniya to'lov so'rovi yarata oladi — ataylab (qayta faollashtirish uchun kerak) |
| TEN-S-8 qurilmaga a'zolar | DONE | qurilmada ishlay olmaydigan xodimning telefoni va ruxsatlari yuborilmaydi — test (`pos-cashier-permissions` testi userId bo'yicha yangilandi) |
| TEN-S-9 soxta GPS | PARTIAL | agent qurilmasi 15 daqiqa ichida mock GPS bildirgan bo'lsa buyurtma yuborilmaydi, hodisa va audit (kod; agent testlari o'tdi); do'kon koordinatasini birinchi kiritishni tasdiqlash, dostavka `arrive`/`confirm` — NOT STARTED |
| CLI-5 S3 yuklash | PARTIAL | biriktirishda tur majburiy va fayl imzosi (Range GET) — test (soxta klient); production'da S3 sozlanmagan — haqiqiy S3 bilan NOT VERIFIED; PDF uchun `content-disposition` — NOT STARTED |
| CLI-6 rasm metama'lumoti | PARTIAL | bazaga saqlanadigan mahsulot rasmidan EXIF/XMP/izohlar qayta kodlashsiz olib tashlanadi (JPEG, PNG, WebP) — test; S3'ga to'g'ridan-to'g'ri yuklash yo'li — NOT STARTED |
| CLI-9 Electron fuses | PARTIAL | RunAsNode, NODE_OPTIONS, `--inspect` o'chiq — 0.4.6 o'rnatuvchisidan o'qib tasdiqlangan; asar yaxlitligi va faqat asar'dan yuklash — paketlangan ilovani ishga tushirib sinamaguncha yoqilmadi (ishlab turgan kassaning lokal bazasiga tegmaslik uchun) |
| CLI-13 reliz yuklash sessiyasi | DONE | sessiyaga faqat boshlagan admin yozadi, yakunlaydi, bekor qiladi; bitta so'rovli yuklashda `x-sha256` majburiy va mos — test |

**Egasining qarori kerak (o'zgartirilmadi):** PAY-8 (dostavka naqdi — agent qo'lidagi pul hisobi va kassaga topshirish), PAY-9 (katta balans to'ldirish va farqli smena yopilishini rahbar tasdiqlashi), PAY-18 (chegirma chegarasi), PAY-19 (soliq yaxlitlashi — summalar o'zgaradi), qarshi hisobsiz kassa amalining jurnali, TEN-S-6 (dostavka/agent ruxsatlari savdo ruxsatlarini chetlab o'tishi), TEN-S-11 (public OSRM — o'chirilsa yo'l masofasi to'g'ri chiziq bo'ladi). PAY-17 — PARTIAL: web POS va to'lov oynasi kalitni doim yuboradi, server majburiy qilmaydi. AUTH-5 (ko'p IP bilan raqamni bloklash) — PARTIAL. CLI-1 — BLOCKED (sertifikat)

**Testlar (shu bosqichdan keyin):**
- API regressiya: 99 fayl / 438 test, `--maxWorkers=1`, 9 qismda (80 + 49 + 41 + 65 + 28 + 40 + 41 + 56 + 38). Birinchi o'tishda 1 test yiqildi (`pos-cashier-permissions` — kassir qatorini telefon bo'yicha qidirardi; TEN-S-8 dan keyin telefon yuborilmaydi) — test userId bo'yicha yangilandi, qayta o'tdi. Oraliq: B/C bosqichida 2 test noto'g'ri faraz bilan yozilgan edi (Savdo menejerida `finance.view` bor; xarajatlar testi o'zini tasdiqlashni kutardi) — tuzatildi, 35/35. API `tsc` (src + test) — toza
- Web: 16 fayl / 62 test, tsc, lint (`dashboard/page.tsx`), `vite build` — toza, `dist` da inline skript yo'q
- Desktop: tsc (main + renderer), 9 fayl / 57 test. **Kassa 0.4.6** — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.6.exe`, 111 733 115 bayt, SHA-256 `5E36F73E450DEA49BB327205F9059071A58A49AE18B3EEBC165EECBDFD000059`, NotSigned, e'lon qilinmagan, ishga tushirilmagan
- Android: bu bosqichda o'zgarish yo'q — qayta qurilmadi

**Production (2026-09-15):** `bum-api` `b9a683b4` va `bum-web` `b9b49200` — SUCCESS; migratsiya yo'q. API logida bitta ishga tushish (qayta-qayta yiqilish yo'q), `/health` ok, `/api/auth/me` 401; soxta `X-Forwarded-For` bilan so'rovda API tashqi IP'ni yozdi. Web: login 200, CSP bor, `theme-init.js` — JS, WebSocket cookiesiz 401. Tizimga kirgan holda sinov — NOT VERIFIED

## Mustaqil xavfsizlik tekshiruvi va egasining qarorlari (2026-09-15)

**Talab:** oldingi audit xulosalariga ishonmasdan qayta tekshirish (faqat o'qish production'da), CRITICAL/HIGH darhol tuzatish; "kerakmi deganlaring barchasi kerak" — egasining qarorlarini joriy etish.

| Topilma / qaror | Holat | Dalil |
|---|---|---|
| HIGH: kassa qurilmasi kassir nomidan (bog'lanmagan `cashierId`) chek, pul harakati, smena | DONE | barcha qurilma amallari amal vaqtida bog'langan kassirni talab qiladi, ro'yxatdan o'tkazgan avtomatik bog'lanmaydi — qurilma testlari (17 fayl) |
| HIGH: karta/bank bilan to'langan chekni naqd qaytarish | DONE | bitta usulda asl usuldan ortig'i `finance.manage` siz rad — security-hardening, security-verification |
| HIGH: kassa yangilanishi imzosiz (server buzilsa kassalarda begona o'rnatuvchi) | DONE | Ed25519 imzo (`apps/desktop/scripts/release-sign.mjs`), kassa ichidagi ochiq kalit bilan yuklashdan va o'rnatishdan oldin tekshiriladi; admin imzosiz e'lon qila olmaydi (0049) — API va kassa testlari |
| PAY-19 soliq yaxlitlashi, keshbek foizi | DONE | bitta yaxlitlash (server, kassa, web) |
| TEN-S-11 OSRM | DONE | standart `off` |
| TEN-S-6 | DONE | yetkazuvchi o'ziga OTP bera olmaydi; agent buyurtmasini o'zi tasdiqlay olmaydi (egadan tashqari) |
| Qarshi hisobsiz kassa amali | DONE | "boshqa daromad/xarajat" hisobiga jurnal — cash testi |
| PAY-18 chegirma chegarasi | DONE | `PUT /api/sales/policy`; chegaradan ortig'i `sales.approve` (403 `discount_limit`), offline — `discount_over_limit` — owner-decisions |
| PAY-9 katta depozit va smena farqi | DONE | kassada balansga (qaytim ham) chegaradan ortig'i `sales.approve`; farq chegaradan oshsa smena `pending`, tasdiqlovchilarga bildirishnoma, `/pos/shift-reviews`, o'z smenasini faqat ega (0050) — owner-decisions |
| PAY-8 dostavka naqdi | DONE | naqd yetkazuvchining "yo'ldagi naqd" hisobiga, `POST /api/delivery/agents/:id/cash-handover` (boshqa kassa — `finance.manage`, summadan oshmaydi, boshqa kompaniya 404) — owner-decisions, payment-terminals |
| AUTH F-01 agent/HR orqali boshqa xodim loginini bloklash | DONE | agent profili boshqa roldagi a'zoga bog'lansa yoki HR yozuvi o'chirilsa `employee.software_access.manage` — security-verification (birinchi o'tishda yiqildi: tekshiruv tipda bor, kodda yo'q edi — tuzatildi) |
| CSRF (SameSite=Lax ustiga) | DONE | cookie bilan o'zgartiruvchi so'rov: begona Origin yoki `Sec-Fetch-Site: cross-site` — 403 `csrf_origin` — test va production (soxta cookie bilan, hech narsa yozilmadi) |
| PAY F5 qo'lda jurnal nazorat hisoblariga | PARTIAL | kassa, bank, debitor, zaxira, kreditor, avans, keshbek, sotuv, tannarx va kassaga bog'langan hisob rad — finance testi; yopilgan davr (lock date) — NOT STARTED |
| XSS xarita tooltip | DONE | nomlar matn tuguni |
| W-1 dostavka oflayn navbati | DONE | navbat foydalanuvchiga bog'langan — web testi |
| A-1 Android manzili | DONE (kod) | `https://app.bum-erp.uz` (200, CSP bor); APK pastda |
| I-2/I-3 zaxira | DONE (kod) | `BACKUP_PASSPHRASE` bilan AES-256; tiklash sinovi baza nomini va manbadan farqini tekshiradi; Railway'da ishga tushirilmagan — NOT VERIFIED |
| Mayda: bildirishnoma havolasi, `.dockerignore`, lokal PG 127.0.0.1, log yashirish, desktop tashqi havolalar | DONE | web testi (tab/yangi qator) |
| PAY F3/F4 offline kassa (qarz, qaytarish chegaralari), D-3 asar fuse'lari, F-08 kassir boshqa smenani ko'rishi, RLS | NOT STARTED | |

**Testlar:**
- API: 101 fayl / 449 test, `--maxWorkers=1`, 9 qismda (80 + 49 + 41 + 66 + 27 + 38 + 45 + 57 + 46) — hammasi o'tdi; `tsc` toza. Yangi: `owner-decisions` (4), `security-verification` (7: CSRF, sessiya fiksatsiyasi va chiqishdan keyin cookie, SQLi/XSS yuklamalari, obuna muddati, agent/HR bloklash, boshqa kompaniya va takroriy qaytarish)
- Web: 16 fayl / 63 test, tsc, lint, `vite build` (inline skript yo'q)
- Desktop: tsc (main + renderer), 9 fayl / 57 test. **Kassa 0.4.7** — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.7.exe`, 111 733 951 bayt, SHA-256 `BEC4CB466C613BB8EEE3CA6C040320222F75EFC40FF3109198CA9A420C420E6B`, Ed25519 imzo `k6MIG3q/pIEcHyVWUBdKu2FWConYvWVxsnUqB2WvQK97HREct0oAxwZhbmcLlrKsdOTDKHpu49qkDX9xpzTFDQ==` (ochiq kalit bilan tekshirildi; boshqa versiya/xesh bilan — rad), Authenticode NotSigned, fuses: RunAsNode / NODE_OPTIONS / inspect o'chiq; e'lon qilinmagan
- Android: debug APK qayta qurildi (JDK 21, `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 5 787 561 bayt, SHA-256 `7342606B63E76645B252012153B07E5034C3B7B3A989795C72FDCE8FA2F2384E`); APK ichidagi `capacitor.config.json` — `https://app.bum-erp.uz` (Railway domeni yo'q). Release imzosi — kalit yo'q; real telefonda sinalmagan
- Bog'liqliklar: `pnpm audit --prod` — 0 zaiflik. Git: kuzatiladigan fayllarda maxfiy kalit yo'q (yagona moslik — AWS hujjatidagi `...EXAMPLE` namuna kaliti, test)
- **Reliz imzolash:** `node apps/desktop/scripts/release-sign.mjs sign <o'rnatuvchi.exe> <versiya>` — chiqqan "Imzo" platforma admini e'lon qilishda kiritiladi. Maxfiy kalit `%USERPROFILE%\.bum-erp\release-signing-ed25519.pem` — git'da yo'q, **egasi zaxira nusxasini xavfsiz joyda saqlashi shart** (yo'qolsa keyingi yangilanishlarni avtomatik o'rnatib bo'lmaydi). Eski kassalar (0.4.6 va oldingi) imzoni tekshirmaydi — 0.4.7 ni bir marta qo'lda o'rnatish kerak

**Production (2026-09-15):** `bum-api` `1ba3ec03` va `bum-web` `6d63cfe1` — SUCCESS. API logida bitta ishga tushish, migratsiyalar 0049 va 0050 (faqat qo'shimcha ustun va indeks) — bazada 51 ta migratsiya va yangi ustunlar faqat o'qish tranzaksiyasi bilan tasdiqlandi; `/health` ok, `/api/auth/me` 401; soxta `X-Forwarded-For` — API haqiqiy IP'ni yozdi; web sarlavhalari (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) bor; CORS begona originga ruxsat bermaydi (faqat `WEB_ORIGIN`); noto'g'ri JSON — 400 umumiy xabar; Postgres xizmatida ochiq TCP proksi o'zgaruvchisi yo'q. Tizimga kirgan holda sinov — NOT VERIFIED (production paroli ishlatilmaydi)

### Ikkinchi aylanma (2026-09-15, "davom et toxtama")

| Topilma | Holat | Dalil |
|---|---|---|
| PAY F4 offline qaytarish | DONE | boshqa kassa/web cheki, boshqa kassir smenasi, chekdagidan boshqa usulda pul — rad etilmaydi (pul berilgan), `pos_sync_conflicts` ga yoziladi — pos-sale-sync |
| PAY F3 offline qaytim | DONE | chek summasidan katta qaytim balansga — `change_over_total` (offline qarz — onlayn bilan bir xil qoida, kredit limiti nomuvofiqligi avvaldan bor) |
| PAY F5 yopilgan davr | DONE | `GET/PUT /api/finance/lock-date` (`finance.approve`); shu sanagacha qo'lda jurnal, uni bekor qilish, kassa amali, xarajat — 400 `period_locked`; hujjatlar (savdo, xarid, offline kassa) cheklanmaydi — finance testi |
| F-08 kassir boshqa smenalarni ko'rishi | DONE | faqat o'z smenasi; boshqalari — `sales.approve` yoki `finance.view` — security-verification |
| F-04 yangi xodimga maosh | DONE | `hr.salary` talab — security-verification |
| F11 keshbek summasi | DONE | tiyindan mayda summa 400 — security-verification |
| F6 kassada to'lov takrori | DONE | depozit, qarz to'lovi, balansdan to'lov so'rov kaliti bilan bir marta; boshqa mijozga shu kalit — 409 — owner-decisions |
| AUTH-13 sessiyalar | DONE | `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others`; Sozlamalar > Xavfsizlik — security-verification |
| A-2 Android GPS xizmati | DONE | `exported="false"` (birlashtirilgan manifestda tasdiqlandi), APK qayta qurildi |
| D-4 chek CSP | DONE | `<header>` teg `<head>` deb olinmaydi |
| Qabul qilingan (o'zgartirilmadi) | — | bootstrap admin paroli har ishga tushishda muhitdan (ataylab: muhit — manba); qurilma pull'ida xarid narxi va qarzlar (offline ish uchun); pul endpointlarida alohida limit yo'q (kassirni bloklash xavfi); RLS yo'q; asar fuse'lari (paketlangan ilovani ishga tushirish kerak) |

**Testlar (ikkinchi aylanma):** API 101 fayl / 453 test (8 qismda: 87 + 47 + 46 + 64 + 34 + 54 + 27 + 94) — hammasi o'tdi, `tsc` toza; web 16 fayl / 63 test, tsc, lint, build; desktop 9 fayl / 57 test. Android debug APK — 5 787 561 bayt, SHA-256 `CB50601389A1A53171403201098C9E3F272A7553E8359423AB8C61C4FA1C9AB6`

**Production (ikkinchi aylanma):** `bum-api` `a82602ae` va `bum-web` `4559bfb4` — SUCCESS; yangi migratsiya yo'q; API logida bitta ishga tushish, `/health` ok; sessiyasiz `/api/auth/sessions`, `/api/finance/lock-date`, `/api/sales/policy`, `/api/sales/pos/shift-reviews` — 401; begona Origin bilan soxta cookie'li `DELETE /api/auth/sessions/:id` — 403 `csrf_origin` (hech narsa o'zgarmadi); login sahifasi 200. Tizimga kirgan holda sinov — NOT VERIFIED

## Moliya: kutilayotgan to'lovlar va qirqim (2026-09-16)

Egasining so'rovi: "hisob qo'shishda turi kiritilganda hozir naqd va bank turibdi, boshqasini qo'shish imkoniyati bo'lsin … uzcard va humo terminal bo'lsa ulardan qirqilsa u bank hisobiga o'tkazilsa kiritilgan komissiya yechilib qolgani bank hisobiga tushsin … uzcarddan kutilayotgan deb bugungi uzcard summasi ham tursin".

- **Sxema (migratsiya 0051):** `cash_account_type` ga `card` va `ewallet` qo'shildi; `cash_accounts` ga `settles_to_cash_account_id` (o'ziga havola, `set null`) va `settlement_commission_percent`. Lokal bazada qo'llandi
- **Hisoblar rejasi:** 1030 "Kutilayotgan to'lovlar" (`subtype: clearing`) — standart hisoblarga qo'shildi (kompaniyada endi 23 ta). Qo'lda jurnal yozuvi tushmaydigan nazorat hisobi (o'z hujjatlari bilan yuritiladi). Bu hisob ochilmagan eski kompaniyada kutilayotgan hisob yaratilganda avtomatik ochiladi, topilmasa yozuv bank hisobiga tushadi
- **Terminal:** endi bank hisobiga yoki kutilayotgan hisobga bog'lanadi (naqd kassaga — yo'q). Kutilayotgan hisobda qirqim manzili belgilanmagan bo'lsa terminal ulanmaydi (400)
- **To'lov:** terminal puli kutilayotgan hisobga tushsa ekvayring komissiyasi **to'lov paytida ushlanmaydi** — pul to'liq o'sha hisobda turadi va komissiya qirqimda ushlanadi. To'g'ridan-to'g'ri bank hisobiga bog'langan terminal eski tartibda ishlaydi (komissiya darhol)
- **Qirqim:** kutilayotgan hisobdan bank hisobiga o'tkazma — komissiya "Bank komissiyasi" xarajati va DR 5800 / CR 1030 yozuvi bilan ushlanadi, qolgani bank hisobiga tushadi va o'sha hisob tarixida "Qirqim: …" bo'lib ko'rinadi. Summa berilmasa — butun qoldiq; qoldiqdan ortiq, boshqa valyuta, faol bo'lmagan yoki bank bo'lmagan manzil — rad
- **Web (Moliya > Kassa & Bank):** "Kutilayotgan to'lovlar" paneli — har hisob bo'yicha "Kutilmoqda", "Bugun tushdi", terminal nomlari va "Qirqish" oynasi (komissiya va bankka tushadigan sof summa oldindan ko'rinadi); hisob qo'shishda turlar ro'yxati (naqd, bank, karta terminali, elektron hamyon) va kutilayotgan hisob uchun qirqim manzili va komissiyasi
- **Aralash to'lov tuzatishi:** `payment-allocation` da karta/o'tkazma qismi endi "faqat bank" emas, "naqd kassa emas" deb tekshiriladi — terminal kutilayotgan hisobga bog'langanda ham to'lov o'tadi

**Testlar (2026-09-16):** yangi `apps/api/test/settlement.test.ts` (2 test: to'lovda komissiya yo'q → qirqimda 0.25% ushlanib bankka 99 750, jurnal 1030/1020/5800; qoidalar — qoldiqdan ortiq, bank hisobini qirqish, manzilsiz terminal, naqd manzil, qisman qirqim). Ta'sirlangan qismlar bo'yicha regressiya: **42 fayl / 229 test** (4 qismda: 10 + 42 + 76 + 101) — hammasi o'tdi. To'liq API to'plami (102 fayl) bu bosqichda qayta ishga tushirilmadi. API `tsc` toza; web `tsc`, lint (o'zgargan fayllar) va `vite build` toza. Desktop kodi bu bosqichda o'zgarmadi

Tuzatilgan eski kutilmalar: `finance.test` va `import-convex.test` (23 ta standart hisob), `payment-terminals.test` — ortiqcha to'lov holati oldingi bosqichdagi qoidaga moslandi (naqd qism bo'lsa ortig'i naqddan qaytim; naqdsiz ortiqcha va kartadan ortiq to'lov — rad)

**Production (2026-09-16):** commit `12c9033`, `bum-api` va `bum-web` deploy qilindi — ikkalasi ham Online. Yangi kod ishlayotgani tasdiqlandi: sessiyasiz `https://www.bum-erp.uz/api/finance/settlements` → **401** (eski buildda bu marshrut yo'q, 404 bo'lardi), `/api/auth/me` → 401, web sahifasi → 200. Migratsiya 0051 production bazasida **tasdiqlandi** (2026-09-16, `railway ssh` orqali faqat o'qish tranzaksiyasi): `cash_accounts` da `settles_to_cash_account_id` va `settlement_commission_percent` ustunlari bor, `cash_account_type` = cash, bank, card, ewallet; bazada 53 ta migratsiya. Tizimga kirgan holda sinov — NOT VERIFIED (production paroli ishlatilmaydi)

## Balanslarni to'g'rilash (2026-09-16)

Egasining so'rovi: "hamma balanslarni o'rnatish funksiyasi bo'lsin masalan mijozning balansi nimagadir xato bo'lsa to'g'irlab qo'yish uchun. Yetkazib beruvchini balansi ham. Boshqa balanslar ham."

- **Qamrov:** mijoz balansi (hamyon), mijoz qarzi, mijoz keshbegi, ta'minotchi qarzi va kassa/bank qoldig'i
- **Qoida:** to'g'ri qiymat kiritiladi, server farqni (delta) hisoblab jurnalga yozadi — farq "Boshqa xarajatlar" (qiymat oshsa) yoki "Boshqa daromadlar" (kamaysa) bilan yopiladi; balans hisoblari (2300 avanslar, 1100 debitorlar, 2000 kreditorlar, 2400 keshbek, 1010/1020 kassa) jurnalsiz o'zgarmaydi
- **Sabab majburiy** (kamida 3 belgi) — jurnal yozuvi izohiga va audit qatoriga tushadi
- **Ruxsat:** `finance.approve` (egasi, buxgalter); kassirda yo'q — 403
- **Cheklovlar:** manfiy qiymat rad etiladi; yopilgan davrga (`lock-date`) yozilmaydi; qiymat o'zgarmasa yozuv yaratilmaydi
- **Sxema:** `customer_balance_tx_type` ga `adjustment` (migratsiya 0052) — hamyon tuzatishi balans tarixida ishorali qator bo'lib ko'rinadi; keshbek tuzatishi keshbek tarixida (`adjustment` enum'da avvaldan bor edi, endi ishlatiladi)
- **Ta'minotchi:** `applySupplierBalance` orqali — valyuta bo'yicha qoldiq va `suppliers.total_debt` bir joyda yangilanadi; hozircha faqat asosiy valyutadagi ta'minotchi
- **Kassa:** farq oddiy kirim yoki chiqim tranzaksiyasi bo'lib (`tuzatish` kategoriyasi) hisob tarixida ko'rinadi
- **Endpointlar:** `POST /api/sales/customers/:customerId/balance-adjust` (balans, qarz, keshbek), `POST /api/purchase/suppliers/:supplierId/set-debt`, `POST /api/finance/cash-accounts/:cashAccountId/set-balance`
- **Web:** umumiy "Balansni to'g'rilash" oynasi (`src/components/balances/set-balance-dialog.tsx`) — joriy qiymatlar oldindan to'ldiriladi va faqat o'zgargani yuboriladi; mijoz kartasida, ta'minotchi kartasida va Moliya > Kassa & Bank bo'limida

**Testlar (2026-09-16):** yangi `apps/api/test/balance-adjust.test.ts` (3 test: mijoz balansi/qarzi/keshbegi jurnal bilan va sabab/manfiy qiymat/kassir 403 tekshiruvi; ta'minotchi qarzi va valyuta qoldig'i; kassa qoldig'i — kirim/chiqim, tarix va o'zgarishsiz holat). Ta'sirlangan qismlar regressiyasi: **13 fayl / 42 test** — hammasi o'tdi. API `tsc` toza; web `tsc`, lint (4 o'zgargan fayl) va `vite build` toza. Desktop kodi bu bosqichda o'zgarmadi

**Production (2026-09-16):** commit `aad78b6`, `bum-api` va `bum-web` deploy qilindi — ikkalasi ham Online, web sahifasi 200. Yangi marshrutlar ishlayotgani tasdiqlandi: sessiyasiz `POST /api/finance/cash-accounts/:id/set-balance`, `POST /api/sales/customers/:id/balance-adjust`, `POST /api/purchase/suppliers/:id/set-debt` — uchalasi ham **401** (eski buildda bu marshrutlar yo'q edi, 404 bo'lardi). Migratsiya 0052 production bazasida **tasdiqlandi** (2026-09-16, `railway ssh` orqali faqat o'qish tranzaksiyasi): `customer_balance_tx_type` = deposit, change, sale_payment, refund, **adjustment**. Tizimga kirgan holda sinov — NOT VERIFIED (production paroli ishlatilmaydi)

## Import va eksport: mijozlar, ta'minotchilar, hodimlar, marshrutlar (2026-09-16)

Egasining so'rovi: "Xaridlarda, hodimlarda, marshrutlarda, import, export bo'lsin va boshqa qaysi birida import export bo'lishi kerak bo'lsa qo'shilsin".

- **Umumiy qoida** (mahsulotlar eksportidan ajratilgan `apps/api/src/shared/csv.ts`): eksport — UTF-8 BOM va CRLF bilan (Excel to'g'ri ochadi), har katak formula injection'dan himoyalanadi (`=`, `+`, `-`, `@` bilan boshlansa apostrof qo'shiladi), bir eksportda ko'pi bilan 10 000 qator. Import — fayl brauzerda o'qiladi, qatorlar serverda tekshiriladi va `{created, errors}` qaytadi: xato qator sababi bilan ko'rsatiladi, to'g'rilari yozilaveradi (bir so'rovda 500 qatorgacha)
- **Mijozlar:** `GET /api/sales/customers/export` (`sales.view`), `POST /api/sales/customers/import` (`crm.manage`)
- **Ta'minotchilar (xaridlar):** `GET /api/purchase/suppliers/export` (`purchase.view`), `POST /api/purchase/suppliers/import` (`purchase.create`) — fayldagi yoki bazadagi kod takrorlansa o'sha qator rad etiladi
- **Hodimlar:** `GET /api/hr/employees/export` (`hr.view`; `?includeSalary=true` — **`hr.salary`** talab qilinadi va pasport/INN/hisob raqami/maosh ustunlari shunda qo'shiladi), `POST /api/hr/employees/import` (`hr.manage`)
- **Marshrutlar:** `GET /api/distribution/routes/export` (`distribution.view`), `POST /api/distribution/routes/import` (`distribution.manage`) — kunlar "1,3,5" ko'rinishida (0 = yakshanba … 6 = shanba); do'konlar fayl bilan biriktirilmaydi
- **Xarajatlar:** `GET /api/finance/expenses/export` (`finance.view`; ekrandagi holat filtri bilan), `POST /api/finance/expenses/import` (`finance.manage`) — import xarajatni **"kutilmoqda"** holatida ochadi (pul faqat "to'landi" deb tasdiqlanganda harakatlanadi), yopilgan davr (`lock-date`) bir marta o'qiladi va o'sha sanadagi qator xato bo'lib qaytadi — tranzaksiya yiqilmaydi
- **Xavfsizlik qoidalari:** import **pul qiymatlarini o'zgartirmaydi** (qarz, balans, keshbek faqat hujjat yoki "to'g'rilash" amali orqali o'zgaradi); hodim importi **login, parol yoki PIN yaratmaydi** — dasturdan foydalanish alohida amal bilan beriladi
- **Web:** umumiy `CsvToolbar` komponenti (`src/components/csv/csv-toolbar.tsx`) — "Eksport" va "Import" tugmalari mijozlar, yetkazuvchilar, hodimlar va marshrutlar ro'yxatida; fayl sarlavhalari o'zbekcha va inglizcha nom bilan ham moslanadi

**Testlar (2026-09-16):** yangi `apps/api/test/csv-import-export.test.ts` (4 test: mijoz importi va BOM'li eksport; ta'minotchida takroriy kod; hodim importi login yaratmasligi, maosh ustunlari `hr.salary` bilan va kassirga 403; marshrut kunlari va noma'lum agent). Ta'sirlangan qismlar regressiyasi: **13 fayl / 48 test** — hammasi o'tdi. API `tsc` toza; web `tsc`, lint (5 fayl) va `vite build` toza

**Production (2026-09-16):** commit `e9dc7ae`, `bum-api` va `bum-web` deploy qilindi — ikkalasi ham Online, web sahifasi 200. Yangi marshrutlar ishlayotgani tasdiqlandi: sessiyasiz `GET /api/sales/customers/export`, `/api/purchase/suppliers/export`, `/api/hr/employees/export`, `/api/distribution/routes/export` — to'rttasi ham **401** (eski buildda bu marshrutlar yo'q edi, 404 bo'lardi). Bu bosqichda yangi migratsiya yo'q. Tizimga kirgan holda sinov — NOT VERIFIED (production paroli ishlatilmaydi)

**Xarajatlar qo'shimchasi (2026-09-16):** `csv-import-export.test.ts` 5 ta testga kengaytirildi (xarajat importi "kutilmoqda" holatida qoladi va pul harakatlanmaydi; yopilgan davrdagi qator xato bo'lib qaytadi, ochiq davrdagisi yoziladi). Ta'sirlangan qismlar regressiyasi: **10 fayl / 38 test** — hammasi o'tdi; API `tsc` toza, web `tsc`, lint va `vite build` toza. **Production (2026-09-16):** commit `92738dc`, `bum-api` va `bum-web` deploy qilindi — ikkalasi ham Online, web sahifasi 200. Sessiyasiz `GET /api/finance/expenses/export` → **401**, shu build'dan oldin esa **404** edi — yangi kod ishlayotganining dalili. `railway up` dastlab to'rt marta tarmoq xatosi bilan uzildi (backboard: "operation timed out", keyin "os error 10054"), beshinchi urinish o'zgarishsiz o'tdi — sabab kodda emas, tarmoqda. Bu bosqichda yangi migratsiya yo'q; tizimga kirgan holda sinov — NOT VERIFIED (production paroli ishlatilmaydi)

## Qabul testi kamchiliklarini yopish (2026-09-16)

Qabul testida topilgan kamchiliklar bo'yicha oltita bosqich — har biri alohida, mavjud funksiyalarni buzmasdan.

- **Web POS'da rasm bilan sotish:** yangi `src/pages/pos/_components/product-card.tsx` — desktop kassadagi (`apps/desktop/src/renderer/pos/product-grid.tsx`) konsepsiya: rasm yoki nom bosh harflari, aksiya belgisi, qoldiq holati (Bor / Kam / Tugagan), birlik va narx; rasmni bosish — savatga +1, qayta bosish — miqdor +1 (qoldiqdan oshmaydi), uzoq bosish / o'ng tugma / ⓘ — batafsil oyna: katta rasm va miqdor steppery. Ixcham ko'rinishda kichik rasm. Rasm mavjud `ProductImage` (`/api/files/url`) orqali — yangi endpoint qo'shilmadi (`/api/catalog/products` allaqachon `imageKey`, `minStock`, `baseUnitName` qaytaradi)
- **Xaridlar (purchase orders) CSV:** yetkazuvchilardan **alohida** — `GET /api/purchase/orders/export` (`purchase.view`) va `POST /api/purchase/orders/import` (`purchase.create`). Fayl qatori = hujjat qatori; bir xil "Hujjat raqami" bitta hujjatga birlashadi. Import **mavjud `createOrder` servisi** orqali **qoralama** hujjat ochadi — raw SQL bulk insert yo'q, ta'minotchi qarzi, ombor qoldig'i va jurnal tegilmaydi (ular qabul va to'lovda o'zgaradi)
- **Universal import preview:** barcha importlarda `dryRun` — server hech narsa yozmasdan tekshiradi va `{valid, errors, duplicates, warnings}` qaytaradi; web'da jami / to'g'ri / xato / dublikat oynasi (qator raqami, kalit va sabab bilan), yozish faqat "Importni boshlash" bosilgandan keyin. Vaqtinchalik fayl ombori qo'shilmadi: fayl brauzerda o'qiladi, tekshiruv serverda — yangi saqlash va tozalash yuzasi paydo bo'lmasin
- **Dublikat nazorati (CREATE ONLY):** mijoz — telefon, ta'minotchi — kod va STIR, hodim — telefon, marshrut — nom, xarajat — kategoriya+tavsif+summa+sana, mahsulot — SKU, xarid — hujjat raqami. Kalit yozishdan oldin belgilanadi, shuning uchun fayl ichidagi takror ham preview'da ko'rinadi. Dublikat `errors` emas, alohida `duplicates` ro'yxatida — keyinchalik UPDATE rejimi qo'shishga arxitektura tayyor
- **"Aralash to'lov" terminologiyasi:** kassa chekida alohida tugma allaqachon yo'q edi; mijoz to'lovi oynasidagi "Aralash to'lov" / "Bitta usulda" toggle'i ham olib tashlandi — qarzda usullar paneli doim ochiq (bitta qator — bitta usul, bir nechta qator — aralash). **"Balansdan to'lash"** alohida amal sifatida saqlandi: u pul usuli emas va panel uni qo'llamaydi, shuning uchun uni panelga ko'chirish mavjud funksiyani yo'qotgan bo'lardi
- **RBAC qabul testi:** 8 rol (Direktor, Buxgalter, Moliya menejeri, Savdo menejeri, Xarid menejeri, Kassir, Sotuv agenti, Dostavka agenti) uchun kutilma qo'lda yozilmaydi — `GET /api/company` dagi haqiqiy ruxsatlardan olinadi: ruxsat yo'q bo'lsa **403 shart**, bo'lsa 403 bo'lmasligi shart. Platforma marshrutlari kompaniya foydalanuvchilariga yopiq; IDOR/BOLA (begona mijoz, ta'minotchi, marshrut, mahsulot, ombor + begona mijozga to'lov va qarz to'g'rilash) — 403/404

**Testlar (2026-09-16):** yangi `purchase-csv` (8), `import-preview` (9), `acceptance-rbac` (11) va web `product-card` (10). API `tsc` toza, regressiya **26 fayl / 133 test**; web `tsc`, lint va `vite build` toza, **18 fayl / 77 test**. Bu bosqichda yangi migratsiya yo'q (sxema o'zgarmadi)

**Kuzatuv:** `GET /api/analytics/dashboard` `analytics.view` talab qiladi — Kassir, Sotuv agenti va Dostavka agenti web bosh sahifasini ocholmaydi (403). Bu modul guardidan ozod, lekin ruxsatdan ozod emas; ruxsat sozlamasi o'zgartirilmadi, egasining qarori kerak

**Production (2026-09-16):** commit `21be475`, `bum-api` va `bum-web` deploy qilindi — ikkalasi ham Online, web sahifasi 200. Sessiyasiz `POST /api/purchase/orders/import` → **401**, ya'ni yangi marshrut jonli (eski buildda bunday marshrut yo'q va 404 qaytardi). Eslatma: `GET /orders/export` bu yerda diskriminator bo'la olmaydi — eski buildda ham `GET /orders/:orderId` uni parametr sifatida qabul qilib 401 beradi. Bu bosqichda yangi migratsiya yo'q (sxema o'zgarmadi). Tizimga kirgan holda sinov — NOT VERIFIED (production paroli ishlatilmaydi)

## Yakuniy holat va keyingi qadam (2026-09-14)

### Bajarilgan (tekshirilgan)
- **Kassa:** dasturdan to'liq chiqish va qurilmani uzish (desktop testlari, Electron smoke); o'rnatuvchi 0.4.1 qurilgan — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.1.exe`, 106.6 MB, SHA-256 `785264989CF5C992348037FE2F9FBB58A5336C817E2AE5362E088EC58686B346`, imzosiz; holati — **e'lon qilinmagan**
- **Kassa 0.4.2 (terminallar):** o'rnatuvchi qurilgan — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.2.exe`, 106.6 MB, SHA-256 `09D9B340B410A685DFECB607AED0767F9A97AE31FFF39C4693CC599BE5FBA2CE`, imzosiz, **e'lon qilinmagan**; desktop typecheck (main + renderer) toza, desktop testlari 9 fayl / 56 test; server config'da terminallar — API deploy (2026-09-14) SUCCESS. Paketlangan ilova ishga tushirilmadi (foydalanuvchining ishlab turgan kassasiga tegmaslik uchun), real terminal bilan sinalmadi
- **Xarita:** OpenStreetMap + Leaflet; belgi — navigator havolalari (Google Maps, Yandex, Android `geo:`); kompyuterda ilova ichidagi oyna
- **Marshrut:** 12 nuqtagacha aniq, ko'prog'ida taxminiy yaxshilangan tartib; yo'l masofasi — OSRM (production konteyneridan javob tasdiqlangan), javob bo'lmasa to'g'ri chiziq bo'yicha
- **Dostavka:** "Hudud bo'yicha" / "Marshrut bo'yicha", "Zakaz bor", "Barchasini dostavshikka biriktirish", kunlik marshrut, dostavshikda "Optimal marshrut"
- **Distribyutsiya:** xarita, marshrut, "Optimal tartib", ruxsat va kompaniya izolyatsiyasi
- **Multi-business:** `/{biznes}/{bo'lim}`, tab konteksti, begona biznes — 403
- **Xavfsizlik:** web xavfsizlik sarlavhalari (production'da tasdiqlangan), IDOR testi, git sirlar auditi, imzo kalitlari `.gitignore` da
- **To'lovlar:** karta terminallari (bank hisobiga bog'lanish), universal aralash to'lov taqsimoti — POS, dostavka, qarz; ortiqcha/kam to'lov qoidalari, idempotentlik, asl hisobdan qaytarish (bo'lim yuqorida)
- **Modullar:** server guard (MODULE_DISABLED), bog'liqliklar, tarix/audit, Sozlamalar va admin paneli, ro'yxatdan o'tishda tanlov (bo'lim yuqorida)
- **API regressiya (to'lovlar va modullardan keyin):** 96 fayl, 396 test — `--maxWorkers=1` bilan 7 qismda (129 + 39 + 62 + 31 + 49 + 30 + 56), hammasi o'tdi (2026-09-14). Fon rejimidagi birinchi urinish xotira yetmagani uchun tizim tomonidan to'xtatildi (kod xatosi emas) — oldingi rejimda qayta ishga tushirildi
- **Web:** 14 fayl / 57 test, tsc, lint (o'zgargan fayllar), `vite build` — toza (to'lovlar va modullardan keyin qayta tekshirildi); brauzer E2E (lokal, avvalgi bosqich) — 14/14, yangi to'lov va modul ekranlari brauzerda sinalmadi
- **Production deploy (to'lovlar va modullar):** `bum-api` (2026-09-14 05:49 UTC) va `bum-web` (05:50 UTC) — SUCCESS. API ishga tushishida migratsiyalar qo'llandi (0045, 0046 — faqat qo'shimcha), `/health` ok (konteyner ichidan). Sessiyasiz: `/api/finance/terminals`, `/api/company/modules`, `/api/sales/pos/payment-options`, `/api/delivery/agent/payment-options`, platforma modullari — 401 (marshrutlar mavjud), noma'lum yo'l — 404; `/`, `/uz/login` — 200, X-Frame-Options bor. Tizimga kirgan holda production'da sinalmadi (production hisobi ishlatilmaydi)
- **Desktop kassa testlari:** 9 fayl / 54 test — o'tdi (kassa kodi bu bosqichda o'zgarmagan)
- **Bank komissiyasi va kassada to'lov usullari (keyingi bosqich):** ekvayring va pul chiqarish komissiyasi avtomatik ("Bank komissiyasi" xarajati), terminal va bank hisobi uchun "Kassada ko'rsatish", web va desktop kassada UZCARD / HUMO / bank hisobi nomi bilan tugmalar — API regressiya 97 fayl (hammasi o'tdi), web 15 fayl / 60 test + build, desktop 9 fayl / 57 test, brauzer E2E 12/12 (bo'lim yuqorida)
- **Kassa 0.4.3 (bank hisoblari to'lov usuli sifatida):** o'rnatuvchi qurilgan — `apps/desktop/release/BUM-POS-KASSA-Setup-0.4.3.exe`, 111 731 940 bayt, SHA-256 `5897036982319CFDED25DFE1E4594C51B37845EA9D0579F7316939DA7477C6E8`, imzosiz (`Get-AuthenticodeSignature`: NotSigned), **e'lon qilinmagan**; paketlangan ilova ishga tushirilmadi (ishlab turgan kassaga tegmaslik uchun)
- **GPS zaryadi:** plagin patch'i (har soniya o'lchash o'rniga 10–30 s va paketli yetkazish), serverga paketli yuborish, fonda realtime yopilishi; debug APK qayta qurildi (bo'lim yuqorida); real telefonda o'lchanmagan
- **Production deploy (komissiya va GPS):** `bum-api`, `bum-web` — SUCCESS, migratsiya 0047 bazada tasdiqlangan

## Sotuv ≠ to'lov ≠ yetkazish: holatlarni ajratish (2026-09-16 audit)

**Egasi xabar qilgan muammo:** kassadan qilingan oddiy 100 000 so'mlik chek (naqd/Uzcard, "Saqlash") Sotuvlar ro'yxatida **"YETKAZILDI"** bo'lib ko'rinardi.

**ROOT CAUSE — UI'da emas, ma'lumot modelida.** `sales_order_status` enumi bitta o'qda uchta tushunchani aralashtirgan edi. Uning ikkita terminal qiymati aslida **to'lov holatini** bildirgan, yetkazishni emas:

- `shipped` = yakunlangan sotuv, qarz bor
- `delivered` = yakunlangan sotuv, to'liq to'langan

Dalillar (12 joy): `pos.service.ts` chek yopilganda `total === 0 ? "delivered" : "shipped"` yozardi; `payments.service.ts`, `cashback.service.ts`, `customer-balance.service.ts` **to'liq to'lov** sodir bo'lganda holatni `shipped → delivered` ga ko'chirardi; `orders.service.ts` `shipOrder` da holat faqat `paidAmount >= totalAmount` ga qarab tanlanardi; `salesStats.totalDebt` qarzni `status = 'shipped'` bo'yicha sanardi; desktop kassa `history-screen.tsx` da bu ikki qiymat ochiq matnda `shipped: "qarz bor", delivered: "to'langan"` deb tarjima qilingan. Web esa ularni **yetkazish** lug'atida ("Jo'natilgan" / "Yetkazilgan") ko'rsatardi — shundan "YETKAZILDI".

**Teskari nuqson ham bor edi:** `lifecycle.service.ts` da `update(salesOrders)` umuman yo'q — ya'ni **yetkazmani tasdiqlash sotuv holatini hech qachon o'zgartirmagan**. `delivery-flow.test.ts` da buyurtma "delivered" bo'lgani `confirm` dan emas, undan oldingi **to'lovdan** kelib chiqqan. Natijada nasiyaga haqiqatan yetkazilgan buyurtma hech qachon "yetkazilgan" ko'rinmasdi, kassadagi darhol to'langan chek esa ko'rinardi.

**Yechim (qo'shimcha, buzmaydigan):**
- `sales_order_status` ga terminal `completed` qiymati qo'shildi (migratsiya `0053`). Sotuv yakunlanganini bildiradi — "yetkazildi" degani emas
- To'lov holati **ustun sifatida saqlanmaydi**, `paid_amount`/`total_amount` dan hisoblanadi (`paymentStatus`: `unpaid` / `partial` / `paid`) — ikki manba bir-biriga zid bo'lib qolmaydi
- Yetkazish holati avvalgidek `delivery_tasks.status` da qoladi (u allaqachon to'g'ri ajratilgan edi)
- Yangi ustunlar: `source` (`pos` / `sales_agent` / `manual` / `import`) va `fulfillment_method` (`counter` / `pickup` / `delivery`) — egasi so'ragan yetishmayotgan domen tushunchalari. Kanal serverda beriladi (so'rov tanasidan olinmaydi): kassa — `pos`, savdo agenti — `sales_agent`, ERP — `manual`. Yetkazish usuli buyurtmada `deliveryRequired` aniq bo'lsa yaratilishda (`delivery` / `pickup`), siyosat bo'yicha hal bo'lsa — yetkazma ochilganda yoziladi
- To'lov endi sotuv holatini **o'zgartirmaydi**; kassa cheki `completed` + `counter` + `pos` bo'lib yoziladi
- Yagona haqiqat manbai: `apps/api/src/modules/sales/sale-status.ts`

**Eski ma'lumot tegilmadi:** mavjud `shipped`/`delivered` yozuvlar **o'zgartirilmadi** (egasining tasdig'isiz ma'lumot transformatsiyasi qilinmaydi). Ular o'qishda `completed` bilan teng hisoblanadi; "Yakunlangan" filtri uchchalasini qamrab oladi; barcha til fayllarida ular ham "Yakunlangan" deb ko'rsatiladi.

**Regressiya (hammasi o'tdi):**
- API: **111 fayl / 528 test** (6 bo'lakda; avvalgi hisobotdagi "26 fayl / 133 test" eskirgan baseline edi)
- Yangi `acceptance-business-scenarios.test.ts` — **17 biznes ssenariysi**: chakana naqd/aralash/uch usulli, nasiya va keyingi to'lov, distribyutsiya, yetkazish, **nasiyaga yetkazish**, olib ketish, ulgurji qisman to'lov, to'liq va qisman qaytarish, ishlab chiqarish, ishlab chiqarish + chakana, ishlab chiqarish + distribyutsiya, xarid ≠ to'lov, xarajat, **bitta kompaniya bir vaqtda 4 biznes**
- Web: 18 fayl / 77 test; Desktop: 9 fayl / 57 test
- API tsc, web tsc, web lint, web build, desktop typecheck — toza

**Deploy qilinmadi** — egasi audit davomida deploy qilmaslikni so'ragan.


## Universal to'lov arxitekturasi: pul chiqimi ham bitta qoidalar to'plamiga o'tdi (2026-09-16)

**Oldingi auditdagi M-1:** `PaymentAllocation` faqat pul KIRIMIDA (kassa, sotuv to'lovi, yetkazishdagi inkassatsiya)
ishlatilardi; ta'minotchiga to'lov va xarajat to'lovi alohida kod yo'lidan borardi va aralash (naqd + UZCARD + bank)
to'lovni umuman qo'llab-quvvatlamasdi.

**Root cause:** `resolvePaymentParts` va `settlePaymentParts` aslida yo'nalishdan mutlaqo mustaqil — ularda mijozga xos
hech narsa yo'q edi. Lekin ular `modules/sales/payment-allocation.service.ts` ichida turgani uchun chiquvchi oqimlar
ularni hech qachon qabul qilmagan. Ya'ni bu joylashuv muammosi, dizayn xatosi emas.

**Yechim — kengaytirish, parallel tizim emas:**
- Yo'nalishdan mustaqil qatlam `modules/finance/payment-parts.service.ts` ga ko'chirildi (usul, terminal → bank hisobi,
  hisob turi va valyutasi, takrorlanmaslik, ortiqcha/kam to'lov arifmetikasi). `sales/payment-allocation.service.ts`
  uni qayta eksport qiladi — mavjud chaqiruvchilar tegilmadi
- **Ta'minotchiga aralash to'lov** (`recordMixedSupplierPayment`): qismlar universal qatlamda tekshiriladi, so'ng har
  qism mavjud `recordSupplierPayment` orqali yoziladi — kassa chiqimi, jurnal, bank komissiyasi, buyurtma qoldig'i va
  ta'minotchi balansi avvalgidek. Har qism o'z to'lov yozuvi ID'si bilan ketadi
- **Xarajatga aralash to'lov**: har qism o'z hisobidan chiqadi, jurnal esa BITTA balanslangan yozuv (DR xarajat jami /
  CR har bir hisob o'z ulushi bilan). Sabab quyida
- **Balansga aralash kirim** va **karta orqali kirimda terminal mapping'i**: ilgari kartadan balansga kirim terminalning
  banki o'rniga standart bankka tushardi — endi `cashAccountId` uzatiladi

**Audit paytida topilgan tuzoq:** `postJournalEntry` `(referenceType, referenceId)` bo'yicha takrorlanmaydi. Agar
xarajatning har qismiga alohida jurnal yozuvi urinilganda edi, ikkinchi va uchinchi qism jimgina birinchisiga qaytardi
va pul jurnalsiz chiqib ketardi. Shuning uchun xarajatda bitta ko'p qatorli yozuv ishlatiladi. Kassa harakati esa hisob
bo'yicha ham ajratilgani uchun har qism alohida yoziladi; bitta hisob ikki marta kiritilsa — aniq xato.

**Chegaralar (ataylab):** aralash to'lov faqat asosiy valyutada (valyutadagi to'lov bitta usul bilan alohida);
ta'minotchida kam to'lash mumkin (qarz qoladi), xarajatda esa qismlar yig'indisi summaga aynan teng bo'lishi shart —
chunki xarajatning "to'landi" holati bo'linmaydi.

**Testlar:** yangi `acceptance-payment-architecture.test.ts` — 26 ta ssenariy: kassa (naqd, UZCARD, 2 va 3 usulli),
mijoz to'lovlari (naqd, aralash kirim, aralash qarz to'lash), yetkazishda inkassatsiya, ta'minotchiga to'lov (naqd,
UZCARD, 3 usulli, xarid hujjatiga), xarajat (naqd, 3 usulli, noto'g'ri yig'indi), qaytarish (to'liq va qisman),
idempotentlik (takroriy havola va takroriy chek), xavfsizlik (begona kompaniya, begona hisob va terminal, ruxsatsiz
xodim), modul chegaralari. Har ssenariyda buxgalteriya invarianti (jami debet = jami kredit) tekshiriladi.

**Regressiya:** API 112 fayl / 554 test, web 18 / 77, desktop 9 / 57 — hammasi o'tdi. API va web tsc, lint, web build,
desktop typecheck toza. Migratsiya qo'shilmadi — sxema o'zgarmadi.


## Modullararo ifloslanish auditi (2026-09-16)

**Usul:** taxmin qilish o'rniga o'lchash. Har amaldan oldin va keyin butun kompaniya holati suratga olinadi —
sotuv, yetkazma, xarid, ishlab chiqarish, zaxira, mijoz qarzi, ta'minotchi qarzi, kassa qoldiqlari va buxgalteriya —
so'ng faqat KUTILGAN o'lchov o'zgarganini tasdiqlanadi.

**Strukturaviy natija (kod bo'ylab):** hech bir modul boshqa modulning holat jadvaliga yozmaydi.
`sales_orders` ga faqat `sales` (12 joy) va `delivery` (1 joy — u ham faqat `fulfillment_method`, holat emas);
`purchase_orders` — faqat `purchase`; `production_orders` — faqat `manufacturing`; `delivery_tasks` — faqat
`delivery`; `stock_levels` — faqat `inventory` (hammasi `moveStock` orqali); `suppliers` — faqat `purchase`.
`customers` ga `sales-agent` ham yozadi (profil va joylashuv) — ikkalasi ham auditlanadi va oldindan
`accessibleStore` bilan kirish huquqi tekshiriladi.

**Yangi testlar** — `acceptance-cross-module.test.ts` (13 ta):
- §25 negative: kassa chekiga qo'lda yetkazma yaratib bo'lmaydi; ta'minotchiga to'lov sotuv/mijoz qarzi/yetkazmaga
  tegmaydi; xarajat to'lovi mijoz qarzi va zaxiraga tegmaydi; ombor o'tkazmasi sotuv va qarz yaratmaydi; ishlab
  chiqarish sotuv/yetkazma/qarz yaratmaydi; yetkazmani tasdiqlash xarid va ishlab chiqarishga tegmaydi va sotuv
  holatini o'zgartirmaydi; qaytarish ishlab chiqarish va xaridga tegmaydi; xarid qabul qilish sotuv va mijoz
  qarzi yaratmaydi
- §29 concurrency: bir xil kalitli ikkita parallel kassa cheki — bitta chek; bir xil havolali ikkita parallel
  ta'minotchi to'lovi — pul bir marta chiqadi; qoldiqdan ortiq ikkita parallel sotuv — bittasi rad, zaxira manfiy
  bo'lmaydi; yetkazmani ikki marta parallel tasdiqlash — bir marta bajariladi
- §24 ketma-ket 10 qadamli ko'p biznesli oqim: ishlab chiqarish → chakana → distribyutsiya → yetkazish (nasiya) →
  ulgurji (qisman to'lov) → qarz to'lovi → xarid → xarajat → ombor o'tkazmasi → qaytarish; har qadamdan keyin
  tegishli bo'lmagan o'lchovlar o'zgarmagani tasdiqlanadi

**§27 DB butunligi (faqat o'qish, toza bazada):** 112 jadvaldan 102 tasida `company_id`; qolgan 10 tasi global
(`companies`, `users`, `sessions`, `units`, `subscription_plans`, `desktop_releases`…) yoki ota-jadval orqali
bog'langan (`delivery_task_items`). 361 FK, 444 indeks, 87 CHECK. `delivery_tasks.order_id` RESTRICT — yetim
yetkazma yaratib bo'lmaydi; `journal_lines.entry_id` CASCADE.

**§30 Audit log:** 18 modulda 182 ta alohida amal — to'lov, qaytarish, yetkazma, sotuv, xarid, ishlab chiqarish,
litsenziya, modul, bank hisobi va terminal qamrab olingan.

**Regressiya:** API 113 fayl / 567 test, web 18 / 77, desktop 9 / 57 — hammasi o'tdi. tsc, lint va build toza.
Sxema o'zgarmadi — migratsiya qo'shilmadi.


## Kassa sessiyasi + Android POS: yakuniy qabul (2026-09-17)

3-bosqich — audit → minimal tuzatish → haqiqiy Chrome → regressiya. Yangi parallel tizim yaratilmadi,
sxema o'zgarmadi (migratsiya qo'shilmagan), hech qanday ma'lumot o'chirilmadi.

**Haqiqiy brauzerda tasdiqlangan (Playwright + o'rnatilgan Chrome, `e2e/pos-acceptance.spec.ts`)**
- Faol smena paneli: yuqorida ixcham `Naqd X · Karta Y · Jami Z`, bosilganda terminal kesimi
  (qaysi terminal → qaysi bank hisobi → nechta tranzaksiya).
- Uch usulli to'lov: 100 000 = naqd 40 000 + UZCARD 30 000 + HUMO 30 000. Brauzerdan tashqari
  **bazada ham** tekshiriladi (`pnpm --filter @bum/api verify:last-pos-sale`, faqat SELECT):
  naqd → "Asosiy kassa", UZCARD → "Asosiy bank hisobi", HUMO → "Hamkorbank hisobi",
  uchala qism ham bitta `pos_shift_id` ga bog'langan, `source=pos`, `fulfillment_method=counter`,
  `delivery_tasks = 0`.
- To'lov validatsiyasi: kam to'lovda "Yakunlash" o'chirilgan; to'liq to'lovda yoqilgan;
  naqdsiz ortiqcha to'lov summa oynasining o'zida bloklanadi ("Ko'pi bilan: …", Saqlash/Yakunlash
  o'chirilgan). Naqdda ortig'i ataylab ruxsat — bu qaytim. Server ham rad etadi
  (`overpayment`, `pos-mixed-payment.test.ts` va `acceptance-payments.test.ts`).
- Smenani yopish: naqd qatorma-qator (boshlang'ich, naqd savdo, kirim, chiqim, kutilayotgan) —
  karta naqd hisobiga QO'SHILMAYDI; terminal kesimi alohida. Yopilgandan keyin kassa ish maydoni yo'q.
- Kategoriya: gorizontal ro'yxat, "Barchasi", kategoriya ichida qidiruv, almashtirilganda savat saqlanadi.
- Mahsulot kartochkasi: matn kartochka chegarasidan chiqmaydi; ikki bosish dublikat qator yaratmaydi
  (bitta qator, miqdor 2). Telefondagi savat: +/−, o'chirish, jami yangilanishi.

**Tuzatilgan kamchiliklar (audit natijasi)**
- 360px da ilova sarlavhasining o'ng tugmalari ekrandan chiqib ketardi (avatar kesilgan) —
  `min-w-0` va kompaniya nomining qisqarishi.
- **Telefon yon holati**: eni 800–915px, balandligi 360–412px bo'lgan ekran `md:` bo'yicha "desktop"
  deb hisoblanib, siqilgan desktop layout ko'rsatilardi. Yangi `wide:` varianti eni VA balandlikni
  birga tekshiradi; `short:` varianti past ekranda sarlavha qatorlarini yupqalashtiradi va
  kartochka rasmini pasaytiradi.
- Savat ro'yxatidagi +/−/× tugmalarining o'qiladigan nomi yo'q edi — `aria-label` qo'shildi.
- Uch qismli to'lovda "Yakunlash" tugmasi past ekranli noutbukda ko'rinmay qolardi — `sticky`.
- Demo zaxira takroriy qabul testlarida tugab qolardi: seeder endi qoldiqni maqsad darajagacha
  **to'ldiradi** (faqat kirim; hech narsa o'chirilmaydi), va Playwright `globalSetup` uni har yugurishdan
  oldin ishga tushiradi.
- Kassa sahifasi `h-screen` (100vh) ishlatardi, lekin u ilova sarlavhasi ostidagi `main` ichida —
  uch qismli to'lovda "Yakunlash" tugmasi pastdan kesilardi (o'lchangan: 940 > 900). Endi sahifa
  `main` ichiga aynan sig'adi; tugma o'rni testda tekshiriladi.
- `pnpm lint` uchta xato bilan yiqilardi (bu sessiya o'zgarishlaridan emas): Android/Gradle build
  chiqishi lint'dan chiqarildi, `cash.service.ts` dagi o'lik initializer olib tashlandi.

**Skrinshotlar:** `e2e/.screenshots/final/` (gitignore'da) — 8 ta, har biri ko'zdan kechirilgan.
Playwright `outputDir` ni har yugurishda tozalagani uchun skrinshotlar undan tashqariga chiqarildi.
Kam xotirali mashinada `E2E_LIGHT=1` video va trace yozuvini o'chiradi (9.7 daq → 3.4 daq).

**TEKSHIRILMAGAN (NOT VERIFIED)**
- Haqiqiy Android qurilmada sinov — telefon ulanmagan. Playwright mobil emulyatsiyasi (360/390/412
  tik va 800x360/844x390/915x412 yon) — PASS, lekin bu haqiqiy qurilma emas.
- Haqiqiy UZCARD/HUMO terminali — ekvayring integratsiyasi yo'q. Kassir chekka qarab qo'lda kiritadi;
  aynan shu qo'lda kiritish oqimi — PASS.
- Telefon yon holati ishlaydi, lekin 390px balandlikda mahsulot maydoni tor — tik holat tavsiya etiladi.

**Regressiya:** API 114 fayl / 574 test, web 18 / 77, brauzer 29 test (5 fayl) — hammasi o'tdi.
tsc (web va API), lint va build toza.

## Litsenziya talabi va CSV import shabloni (2026-09-17)

**Obuna sahifasida "Foydalanuvchi qo'shish"**
Litsenziya talabi serverda avvaldan bor edi (`assignLicense` → included tugasa `license_limit_reached`,
hech narsa yaratilmaydi). Yangi parallel tizim qo'shilmadi — mavjud oqim obuna sahifasiga chiqarildi:
- litsenziya kartochkasida "Foydalanuvchi qo'shish" (faqat kompaniya egasiga — serverda ham shunday);
  bo'sh litsenziya qolmagan bo'lsa ustida ogohlantirish chiqadi;
- "Yangi foydalanuvchi" oynasi umumiy komponentga chiqarildi
  (`src/components/company/new-employee-dialog.tsx`) — Sozlamalar → Foydalanuvchilar ham shuni ishlatadi,
  takrorlangan 64 qator olib tashlandi;
- brauzerda tasdiqlandi: bo'sh litsenziyalar to'ldirilgach oyna yopilmaydi, tarif tanlash so'raladi va
  server xodimni yaratmaydi (`e2e/subscription-license.spec.ts`). Test o'zi yaratgan foydalanuvchilarni
  faolsizlantiradi — litsenziyalar bo'shaydi, hech narsa o'chirilmaydi.

**CSV import: shablon va ustunlarni qo'lda moslash** (`src/components/csv/csv-toolbar.tsx`)
- "Shablon" — kutilayotgan sarlavhalar bilan bo'sh CSV (UTF-8 BOM, Excel to'g'ri ochadi);
- fayl tanlangach endi darrov serverga ketmaydi: avval "Ustunlarni moslash" oynasi — har maydon uchun
  fayl ustuni tanlanadi, yonida qaysi sarlavhalar avtomat tanilishi yozilgan, keraksizi o'tkazib yuboriladi;
- tekshiruv oynasida "Ustunlarni o'zgartirish" bilan moslashga qaytish mumkin;
- brauzerda tasdiqlandi (`e2e/csv-import.spec.ts`): notanish sarlavhali fayl avtomat tanilmaydi,
  qo'lda moslangach import o'tadi.

**Savdo agenti joyi — o'lchov** (bir martalik, spec saqlanmadi)
Demo kompaniyada savdo agenti `sales_reps` yozuvi yo'q edi — seeder endi uni bog'laydi (busiz agent mobil
ish joyiga kira olmaydi). Haqiqiy Chrome'da ikki brauzer konteksti bilan o'lchandi: agent "ISHNI BOSHLASH"
bosgandan keyin sessiya 0.4–0.5 s da ochiladi, birinchi lokatsiya serverda 1.1–1.2 s da qabul qilinadi,
supervayzer brauzeriga 3.9–5.4 s da yetadi va xaritada 4.2–5.7 s da chiziladi. Supervayzer qadami
`/supervisor/live` ning 15 soniyalik so'rov oralig'iga bog'liq — eng yomon holatda ~16 s.
Bu Playwright GPS emulyatsiyasi; **haqiqiy telefonda GPS fiksatsiyasi uzoqroq** — NOT VERIFIED.

**Regressiya (shu sessiya oxiri):** API 115 fayl / 589 test, web 19 / 81, desktop 9 / 57,
brauzer 38 test (10 fayl) — hammasi o'tdi. tsc (web, API, desktop) va lint toza.
Sxema: `0055_kpi_rules` va `0056_product_kind` — ikkalasi ham faqat qo'shish, destruktiv amal yo'q.

## KPI, Android orqaga tugmasi va Mahsulotlar importi (2026-09-17)

**KPI — oylik mukofot ishlangan ishdan hisoblanadi** (migratsiya `0055_kpi_rules`, faqat qo'shish)
- `kpi_rules` (lavozim yoki xodim + ko'rsatkich), `kpi_rule_tiers` (bosqichlar), `salary_kpi_lines`
  (oylikda KPI qanday chiqqani — auditga ochiq).
- Qoida LAVOZIMGA yoziladi va shu lavozimdagi hamma xodimga tegadi; alohida xodimga yozilgani
  o'sha xodim uchun lavozim qoidasining O'RNIGA ishlaydi (har ko'rsatkich bo'yicha alohida).
- Hisob PROGRESSIV: har bosqich faqat o'z oralig'iga tushgan qismga qo'llanadi
  (214 dona, 0–100→4 000, 100–200→6 000, 200+→9 000 → 1 126 000). Hammasi bigint'da, float yo'q.
- 11 ta ko'rsatkich: dostavka (soni, summasi, og'irligi kg — mahsulot `weight` idan), savdo agenti
  (sotuv summasi, buyurtma soni, tashrif soni, yig'ilgan to'lov), kassir (chek soni, kassa savdosi),
  ombor (qabul va chiqim hujjatlari soni). Pul ko'rsatkichida stavka foizda, dona/kg da — birlik uchun summa.
- `POST /api/hr/salaries/generate` endi mukofotni shu qoidalardan hisoblaydi va `salary_kpi_lines` ga yozadi;
  qoida yo'q xodimda mukofot 0 (eski xatti-harakat o'zgarmadi).
- Bosqichlar qat'iy tekshiriladi: 0 dan boshlanadi, bo'shliq va kesishuv bo'lmaydi, cheksiz bosqich oxirgi.
- UI: Xodimlar → KPI. Qoidalar jadvali, bosqich muharriri va "Hisob-kitob" (oylik tayyorlanmasdan
  kim qancha olishini ko'rsatadi, faqat SELECT). Ko'rish `hr.view`, o'zgartirish `hr.salary`.
- Testlar: `apps/api/test/kpi.test.ts` 14 ta (bosqich matematikasi, validatsiya, kompaniya izolyatsiyasi,
  oylikka qo'shilishi) va `e2e/hr-kpi.spec.ts` 2 ta brauzer testi.

**Android: apparat "orqaga" tugmasi**
`@capacitor/app` plagini umuman o'rnatilmagan edi — shuning uchun tugmaga ishlov berilmay, ilova
standart yo'l bilan yopilardi. Endi tartib aniq: ochiq oyna bo'lsa avval U yopiladi → tarixda orqaga
qaytiladi → bosh sahifada faqat IKKI marta bosilganda chiqiladi ("Chiqish uchun yana bir marta bosing").
Mantiq `src/lib/native/back-button.test.ts` da 4 ta test bilan tekshirilgan.
**Haqiqiy telefonda sinalmagan — yangi APK qurish kerak (NOT VERIFIED).**

**Mahsulotlar importi umumiy komponentga o'tkazildi**
Mahsulotlar sahifasi o'z import kodini ishlatardi — shuning uchun u yerda shablon ham, ustunlarni
moslash ham yo'q edi (foydalanuvchi aynan shuni ko'rmagan). Endi u ham `CsvToolbar` ni ishlatadi:
shablon yuklab olish, ustunlarni qo'lda moslash va tekshiruv oynasi. Sahifadagi 84 qator takror kod ketdi.

## Katalog turlari, kassa yangilanishi va admin chiqishi (2026-09-17)

**Xom ashyo va yarim tayyor mahsulotlar** (migratsiya `0056_product_kind`, faqat ustun qo'shish)
- `products.kind` enum: `product` (sukut — mavjud yozuvlar shunday qoladi), `raw_material`, `semi_finished`.
- API: `GET /api/catalog/products?kind=...` filtri, yaratish va tahrirda `kind`.
- Ombor → **Katalog** yangi ichki bo'limi: uch tur bitta ro'yxatda, tur bo'yicha chiplar, qidiruv
  va shu yerdan qo'shish (tur oldindan tanlangan; xom ashyo sotuvga chiqmaydi, yarim tayyor
  ishlab chiqariladi deb belgilanadi). Mahsulotlar sahifasidagi shaklga ham "Katalog turi" qo'shildi —
  mavjud yozuvlarni (masalan "Un (xomashyo)") shu yerdan qayta belgilaydi.
- Testlar: `products.test.ts` da tur filtri, `e2e/warehouse-catalog.spec.ts` da brauzer oqimi.

**Kassa: yangi versiyani avtomatik tekshirish**
Ilgari yangilanish faqat Sozlamalar ekranidan qo'lda tekshirilardi. Endi kassir kirgach 20 soniyada
va har 6 soatda avtomatik tekshiriladi; yangi versiya bo'lsa pastda banner chiqadi
(`Yuklab olish` → `Yangilash va qayta ishga tushirish`). Yuklash va o'rnatish **qo'lda** —
savdo o'rtasida ilova o'zi qayta ishga tushmaydi. Majburiy versiyada "Keyinroq" bo'lmaydi.
Tekshiruv xatosi jim yutiladi (internet yo'qligi kassa ishiga xalaqit bermaydi).

**Android avtomatik yangilanish — QILINMADI (blocker)**
Ilova production web manzilini ochadi, shuning uchun web o'zgarishlari darhol yetadi, lekin APK
o'zi yangilanmaydi. Buning uchun kerak: (1) **release imzo kaliti** — hozir yo'q, imzosiz APK
mavjud o'rnatilgan ilova ustiga yangilanish bo'lib tushmaydi; (2) serverda Android relizlarini
saqlash (hozir faqat desktop uchun bor); (3) `REQUEST_INSTALL_PACKAGES` ruxsati. Kalit yaratilgach
qilinadi — hozir yarim ishlaydigan narsa qo'shilmadi.

**Admin panelida chiqish**
Tugma bor edi, lekin faqat admin subdomenida, yozuvsiz va xira (`text-white/50`) — topilmasdi.
Endi ikkala yuzada ham yozuvi bilan ko'rinadi. Ikkinchi kamchilik: `signout()` sessiyani tozalardi,
lekin sahifa o'sha yerda qolib ketardi — endi kirish sahifasiga o'tkaziladi.
Brauzerda tekshirildi (`e2e/warehouse-catalog.spec.ts`); test uchun lokal, vaqtinchalik platforma
admini `apps/api/src/cli/test-platform-admin.ts` orqali beriladi va test oxirida qaytarib olinadi
(faqat localhost, bootstrap adminga tegmaydi, parol o'zgartirmaydi).

## Qurilma tasdig'i, modul nazorati, soliq va kassa qoidalari (2026-09-17)

**Ishonchli qurilmalar** (migratsiya `0057_user_devices`, faqat qo'shish)
Login va parolni bilgan begona odam kira olmasligi uchun ikkinchi to'siq: har foydalanuvchining
kirish qurilmalari ro'yxatga olinadi. BIRINCHI qurilma avtomatik ishonchli, keyingilari
"tasdiq kutilmoqda" bo'lib qoladi va **biznes egasi tasdiqlamaguncha kirish berilmaydi** —
parol to'g'ri bo'lsa ham. Bekor qilingan qurilma qayta tasdiq so'raydi.
- mijoz `x-device-id` sarlavhasini yuboradi (brauzerda saqlanadi, sir emas — huquqni tasdiq beradi);
  sarlavha yuborilmasa tekshiruv qo'llanmaydi, shuning uchun yangilanmagan eski mijozlar kira oladi;
- tasdiq kutayotgan qurilma yozuvi ALOHIDA tranzaksiyada saqlanadi — rad etilsa ham egasi ro'yxatda ko'radi;
- UI: Sozlamalar → Foydalanuvchilar → xodim qatoridagi "Qurilmalar" (nom berish, tasdiqlash, bekor qilish);
- testlar: `apps/api/test/user-devices.test.ts` (5 ta).

**Modullar faqat platforma administratori orqali**
Kompaniyaning o'z endpointi (`PUT /api/company/modules/:key`) endi har doim rad etadi va tushuntirish
qaytaradi; Sozlamalar → Modullar faqat ko'rish rejimida. Kompaniya to'plami ro'yxatdan o'tishda
tanlanadi (onboarding avvaldan so'raydi) va admin panelidagi "Yangi kompaniya" formasiga ham
modul tanlovi qo'shildi. Keyingi o'zgarish — admin panelidan.

**Soliqni avtomatik hisoblashni o'chirish**
Sozlamalar → Kompaniya'da bitta tugma (`tax.auto`). O'chirilsa yangi sotuv va xarid hujjatlarida
stavka 0 bo'ladi (mahsulotdagi qiymat e'tiborga olinmaydi). Eski hujjatlar o'zgarmaydi.

**Kassa kirim/chiqim maqsadi majburiy**
`counterAccountId` endi majburiy: kirim — daromad moddasi, chiqim — xarajat moddasi. Ilgari ixtiyoriy
edi va jim "Boshqa xarajatlar" ga tushardi, hisobotda pul nima uchun chiqqani ko'rinmasdi.

**Manfiy kassa qoldig'i hech qayerda bo'lmaydi**
`allowOverdraft` imtiyozi olib tashlandi — oflayn kassa sinxroni ham istisno emas. Ilgari oflayn
xarid to'lovi kitobdagi qoldiq yetmasa ham yozilardi; aynan shu production'da `-77 520 so'm` ga
olib kelgan. Endi bunday amal rad etiladi va kassada nomuvofiqlik bo'lib ko'rinadi.
Diqqat: smenaning boshlang'ich naqdi kassa hisobiga yozilmaydi — kassadan chiqim qilish uchun
kitobda qoldiq bo'lishi kerak (kerak bo'lsa "Qoldiqni to'g'rilash" bilan kiritiladi).

**Kassada avto chek tugmasi** — web POS va desktop kassaning yuqori panelida, mahsulotlar tabi yonida.
Web'da tanlov shu brauzer uchun saqlanadi (kompaniya sozlamasi sukut qiymat bo'lib qoladi),
desktopda qurilma sozlamasiga yoziladi.

**Android release imzo kaliti — YARATILDI**
`apps/mobile/android/bum-erp-release.jks` (RSA 4096, 10 000 kun), parollar `keystore.properties` da —
ikkalasi ham gitignore'da va **egasining zaxirasida saqlanishi shart** (yo'qolsa ilovani yangilab bo'lmaydi).
`gradle.properties` dagi `bumVersionCode`/`bumVersionName` dan versiya olinadi — har relizda oshiriladi.
Imzolangan APK qurildi va `apksigner` bilan tekshirildi (V2 imzo).
Qolgan ish: serverda Android relizlarini saqlash va ilovadan yangilanishni taklif qilish.

**Regressiya:** API 116 fayl / 594 test, web 19 / 81, desktop 9 / 57, brauzer 37 test (9 fayl) —
hammasi o'tdi. tsc (web, API, desktop) va lint toza. Migratsiyalar `0055`–`0057` — faqat qo'shish.

## Telegram botlari va agent naqdi (2026-09-18)

Uch ish birga bajarildi: biznes egasi uchun platforma boti, har biznesning o'z mijozlar boti va
savdo agenti mijozdan pul yig'ishi. Migratsiyalar `0058_telegram_bots`, `0059_sales_rep_cash`,
`0060_sales_order_source_bot` — uchalasi ham FAQAT QO'SHISH (jadval, ustun, enum qiymati), bazada
hech narsa o'chirilmadi yoki o'zgartirilmadi.

**1. Biznes egasi uchun bot (platformada bitta)**
Admin panel → Platforma sozlamalari → "Biznes egalari uchun Telegram bot": admin BotFather tokenini
qo'yadi. Egasi botga telefon raqamini ulashadi — ERP'dagi raqami bo'yicha uning biznesi topiladi
(faqat `companies.owner_id`, xodimlarga bu bot ochilmaydi) va u faqat O'Z biznesini ko'radi.
- tugmalar: Bugungi xulosa, Qoldiq, Qarzdorlar, Xodimlar; erkin matn — mijoz va mahsulot qidiruvi
- kunlik xulosa har kuni 20:00 dan keyin avtomatik (soatlik `startMaintenance` ichida), kuniga bir marta:
  takrorlanmaslik har suhbat uchun `telegram_chats.state` dagi sana bilan (bitta UPDATE — ikki nusxa ham yubormaydi)
- darhol ogohlantirishlar: smena kassa farqi chegaradan oshdi, chekdagi chegirma siyosat chegarasidan
  oshdi, xodim joylashuvi shubhali (soxta GPS yoki imkonsiz sakrash), botdan yangi buyurtma
- hisobotlar FAQAT O'QIYDI (`owner-reports.service.ts`) — bot orqali hech narsa o'zgartirilmaydi

**2. Mijozlar uchun bot (har bizneda o'ziniki)**
Sozlamalar → Telegram: egasi BotFather tokenini qo'yadi, ptichkalar bilan qaysi xabarlar borishini
o'zi belgilaydi (xarid cheki, to'lov qabul qilindi, qarz eslatmasi, bot ichida xaridlar tarixi va qarz,
botdan buyurtma berish). Standart holatda buyurtma berish o'chiq.
- mijoz botga telefon raqamini ulashadi; raqam shu biznesning mijozlar ro'yxatida bo'lsagina bog'lanadi
- xabar biznes amalini HECH QACHON to'xtatmaydi: Telegram ishlamasa sotuv/to'lov baribir yoziladi
- qarz eslatmasi har kuni 10:00 dan keyin, muddati kelgan yoki 3 kun ichida keladigan qarz bo'yicha
- botdan buyurtma: mahsulot qidirish → tanlash → miqdor → savat → yuborish. Buyurtma **qoralama**
  (`source: "bot"`) bo'lib tushadi, egasining hisobi nomidan yoziladi va do'kon xodimi dasturda
  tasdiqlaydi — bot zaxira yoki pulni o'zgartirmaydi. Yangi "buyurtma tizimi" yaratilmadi, mavjud
  `createOrder` va uning barcha tekshiruvlari ishlaydi

**Webhook manzili:** standart — `WEB_ORIGIN` (nginx `/api/` ni API'ga uzatadi, shuning uchun
Railway'da qo'shimcha o'zgaruvchi shart emas). API alohida domenda bo'lsa `PUBLIC_API_URL`
**bum-api** xizmatiga qo'yiladi. Manzil HTTPS bo'lishi shart — Telegram HTTP qabul qilmaydi.
Hozirgi production uchun ishlaydigan qiymat: `https://www.bum-erp.uz` (apex `bum-erp.uz` hali
yo'naltirilmagan — WEB_ORIGIN shunday bo'lsa PUBLIC_API_URL ni qo'lda qo'yish kerak).

**Xavfsizlik:** token bazada AES-256-GCM bilan shifrlangan (`shared/secret-box.ts`, kalit
`SESSION_SECRET` dan HKDF orqali), UI'ga faqat niqoblangan ko'rinishda chiqadi. Webhook ikki qavat
himoyalangan: manzildagi 24 baytlik tasodifiy sir va Telegram yuboradigan
`X-Telegram-Bot-Api-Secret-Token` sarlavhasi; noto'g'ri so'rov ishlanmaydi, lekin Telegram qayta
urinavermasligi uchun 200 qaytadi. Webhook manzili `PUBLIC_API_URL` dan olinadi — u sozlanmagan
bo'lsa bot saqlanadi, lekin webhook o'rnatilmaydi va sabab egasiga ko'rsatiladi.

**3. Savdo agenti mijozdan pul yig'adi**
Yetkazuvchidagi qoida bilan BIR XIL (yangi parallel tizim emas): mijozdan olingan naqd asosiy
kassaga emas, agentning "yo'ldagi naqd" hisobiga tushadi (`cash_accounts.sales_rep_id`), shuning uchun
moliyada "kimda qancha pul bor" ko'rinib turadi. Kassaga topshirilganda `transferCash` bilan agentdan
yechilib kassa qoldig'iga qo'shiladi — sotuv jurnaliga tegmaydi.
- agent ilovasi: mijoz kartochkasida "To'lov qabul qilish" (naqd/karta/bank), boshqaruv panelida
  "Sizdagi naqd"; takroriy yuborish `clientRequestId` bilan bir marta yoziladi
- supervayzer: Distribyutsiya → Savdo vakillari → hamyon tugmasi: agentdagi naqd, topshirish tarixi
  va "Kassaga topshirish" (`distribution.manage`; boshqa kassani tanlash — `finance.manage`)
- agentdagi summadan ortiq topshirib bo'lmaydi va boshqa agent hisobiga o'tkazib bo'lmaydi
- to'lov yozilgach mijozning botiga avtomatik xabar ketadi: qancha to'landi, kim qabul qildi va qancha qarz qoldi

**To'lov xabarlari qayerlarga ulandi:** kassadagi sotuv (`POST /api/sales/pos/sales`), oddiy sotuv
hujjati, `POST /api/sales/payments` (bitta usul va aralash), kassada qarz to'lash, dostavshik yig'gan
to'lov va savdo agenti to'lovi. Hammasi TRANZAKSIYADAN KEYIN `void` bilan yuboriladi — tarmoq kutishi
bazani band qilmaydi.

**Testlar:** `apps/api/test/telegram.test.ts` (18 ta — token shifri, ruxsatlar, webhook siri,
ptichkalar, xabar qoidalari; `fetch` almashtirilgan, tarmoqqa chiqmaydi) va
`apps/api/test/sales-agent-cash.test.ts` (11 ta — pul agentda qoladi, takror yozilmaydi, qarzdan
ortiq to'lov rad, topshirish, chegaralar).

**Regressiya:** API 118 fayl / 623 test, web 19 / 81 — hammasi o'tdi; tsc (API, web, desktop) va
lint toza.

**Production'ga deploy qilindi (2026-09-18, 07:35–07:43, egasi "deploy qil" dedi)**
`bum-api` (a560e469) va `bum-web` (98963577) yuklandi; `railway up` yuklashi uch marta tarmoq
xatosi bilan uzildi, to'rtinchi urinishda o'tdi (Railway tomonidagi nosozlik, kod bilan bog'liq emas).
Tashqaridan tekshirildi: `/api/telegram/customer-bot`, `/api/telegram/owner-bot` va
`/api/sales-agent/cash` — 401 (ilgari 404 edi), `/api/auth/me` — 8 ta ketma-ket so'rovda 401
(crash-loop yo'q). Webhook yo'liga POST — 200, ya'ni `telegram_bots` jadvali bor va so'rov ishlayapti:
migratsiyalar `0058`–`0060` production bazasida QO'LLANDI. Yangi web bundle `index-C4E9OizH.js`
ichida "Biznes egalari uchun Telegram bot", "Mijozlar uchun Telegram bot", `admin-logout` va
"yo'ldagi naqd" satrlari bor. `PUBLIC_API_URL=https://app.bum-erp.uz` — egasi qo'ydi.

## Mobil ko'rinish, import shabloni va yagona xodim qo'shish (2026-09-18)

**1. Telefonda bo'limlar kompyuterdagidek siqilmaydi**
Yangi umumiy komponent `src/components/page-tabs.tsx`: tor ekranda (md dan kichik) sahifa bo'limlari
bitta tugma + ro'yxat bo'lib ochiladi, keng ekranda esa avvalgidek yorliqlar qatori. Shu komponent
Sozlamalar, Distribyutsiya, Dostavka, Moliya, HR, CRM, Sotuv, Ishlab chiqarish va Tahlil sahifalarida
ishlatiladi. Sahifa yon bo'shliqlari telefonda `p-4`, kompyuterda `p-6`. Marshrut qatoridagi agent nomi,
mijozlar soni va kun belgilari endi sig'masa pastga o'tadi (ilgari qator ekrandan chiqib ketardi).
Ombor yorliqlari o'z idishida suriladi.

Ikkinchi aylanma (egasining telefondagi suratlari bo'yicha): Mahsulotlar, Xarid, Ombor va Sotuv
sahifalarining sarlavha qatori telefonda pastga tushadi — "Eksport / Shablon / Import / Qo'shish"
tugmalari ekrandan chiqib ketmaydi; Ombor bo'limlari ham ro'yxatga o'tdi, qidiruv maydoni to'liq
kenglikda. CSV tugmalari telefonda bitta qatorni teng bo'lib oladi.

Yangi tekshiruv: `e2e/mobile-layout.spec.ts` — 11 ta ERP sahifasi 360x740 ekranda ochiladi va
sahifaning o'zi YON TOMONGA SURILMASLIGI tekshiriladi (keng jadval o'z idishida surilishi mumkin).
Sahifa bo'limlari endi `role="tab"` bilan (brauzer testlari shu rol bo'yicha bosadi).

**2. Import shabloni endi kataklarga bo'linadi**
Shablon `;` (nuqtali vergul) bilan yoziladi — Excel'ning ruscha/o'zbekcha sozlamasida har bir ustun
ALOHIDA katakka tushadi (ilgari vergul bilan bo'lgani uchun hammasi bitta katakda ko'rinardi).
Majburiy ustun sarlavhasida `*` turadi, ikkinchi qator esa `#` bilan boshlanadigan NAMUNA:
`# Coca Cola 1L;COLA-1L;4780000000001;Dona;8000;10000;...`. Namuna qatori import paytida o'tkazib
yuboriladi — foydalanuvchi uni o'chirmasa ham bo'ladi. Import oynasida format haqida qisqa izoh bor.
Hamma ro'yxatlar uchun (mahsulot, mijoz, ta'minotchi, xarajat, marshrut, xodim, xarid) namunalar
to'ldirildi. Tekshiruv: `e2e/csv-import.spec.ts` ajratgich, `*` va `#` ni ham tekshiradi.

**3. Xodim qo'shish — BITTA forma**
Sozlamalar → Foydalanuvchilar → "Xodim qo'shish". Rol tanlanadi, server esa shu rolga mos profilni
o'zi yaratadi:
- "Sotuv agenti" → login + a'zolik + HR kartochkasi + savdo agenti profili (hudud, ishga kirgan sana)
- "Dostavka agenti" → login + a'zolik + HR kartochkasi + yetkazuvchi profili (transport, davlat raqami)
- boshqa rollar → login + a'zolik
- "Dasturga kiradi" o'chirilsa — login ham, litsenziya ham berilmaydi, faqat HR kartochkasi ochiladi
  (yuk tashuvchi, qorovul kabi xodimlar uchun)

Shu forma HR, Distribyutsiya va Dostavka bo'limlaridagi "Xodim qo'shish" tugmasi bilan ham O'SHA YERDA
ochiladi — sahifa almashmaydi (avval Sozlamalarga o'tkazardi, egasiga noqulay bo'ldi). Ilgarigi uchta
alohida forma o'chirildi (`create-agent-dialog.tsx` va HR'dagi o'z oynasi), tahrirlash va faolsizlantirish
o'z bo'limlarida qoladi.

**Qurilma tasdig'i endi xodim bo'yicha** (migratsiya `0061_member_device_check`, faqat qo'shish):
`company_members.device_check` — standart `true` (avvalgi xatti-harakat saqlanadi). Formadagi tugma
bilan yoqiladi/o'chiriladi, keyin ham "Tahrirlash" oynasida o'zgartiriladi. O'chirilgan bo'lsa xodim
istalgan qurilmadan kiradi, lekin qurilma baribir ro'yxatga olinadi — egasi kim qayerdan kirganini
ko'rib turadi.

Testlar: `apps/api/test/employee-onboarding.test.ts` (9 ta). Agent testlaridagi eski ikki bosqichli
qo'shish (`POST /api/company/employees` + `POST /api/distribution/sales-reps`) yagona qo'shishga
moslandi — `salesRepOf` yordamchisi avtomatik yaratilgan profilni topadi.

**Regressiya:** API 119 fayl / 632 test, brauzer 38 test (11 fayl), web 19 / 81 — hammasi o'tdi;
tsc (API, web, desktop) va lint toza.

**Production'ga deploy qilindi (2026-09-18, 12:17–12:19, egasi "deploy qil" dedi)**
`bum-api` (4efc16f5) va `bum-web` (93edd785). Bazada TEKSHIRILDI (faqat o'qish, `railway ssh`):
`company_members.device_check` bor, `telegram_bots`/`telegram_chats` ikkalasi bor,
`cash_accounts.sales_rep_id` bor, `sales_order_source` da `bot` qiymati bor — ya'ni `0058`–`0061`
production bazasida qo'llangan (jami 62 ta migratsiya). API barqaror (`/api/auth/me` — ketma-ket
6 ta 401, crash-loop yo'q). Yangi web bundle `index-C22GeFzl.js` ichida "Qurilma tasdig'i",
"Dasturga kiradi", "Bo'limlar" va `page-tabs-mobile` bor.

## Logotip, mahsulot kartochkasi va soliq rejimi (2026-09-18)

**Logotip qo'yildi** — egasining yuborgan BUM belgisi barcha yuzalarda:
`public/brand/bum-logo.png` (yozuvi bilan) va `public/brand/bum-mark.png` (faqat belgi), ikkalasi ham
shaffof fonli. `src/components/brand-logo.tsx` orqali ishlatiladi: kirish sahifasi (chap panel va
mobil sarlavha), ERP yon menyusi, admin panel sarlavhasi, kompaniya tanlash. Favicon endi
`/favicon.png` (ilgari ⚡ emoji edi). PWA ikonkalari (`public/icon/*`), Android ilova ikonkalari
(`mipmap-*`, adaptiv oldingi qatlam bilan), splash rasmlari va desktop kassa ikonkasi (`icon.ico`,
`icon.png`) ham shu logotipdan qayta yaratildi — ilgari eski "E" belgisi turardi.

**Mahsulot qo'shish oynasi** (`product-form-dialog.tsx`):
- Shtrix-kod yonida **skaner tugmasi** — telefonda kamera, kompyuterda USB/HID skaner yoki qo'lda
  kiritish. Ilgari Androidda skanerlashning iloji yo'q edi.
- **Kategoriya va brend shu yerdan qo'shiladi**: "+ Kategoriya qo'shish" / "+ Brend qo'shish".
  Ro'yxat bo'sh bo'lsa "yo'q — pastdan qo'shing" deb turadi (ilgari shunchaki bo'sh ro'yxat chiqardi).
- **O'lchov konversiyalari shu yerda kiritiladi**: "1 [birlik] = [son] [asosiy birlik]" qatorlari,
  "+ Konversiya qo'shish" bilan istagancha qator, tahrirlashda saqlanganlari ko'rinadi va o'chiriladi.
  Ilgari "mahsulot saqlangandan keyin qo'shiladi" degan izoh turardi, boshqa hech narsa yo'q edi.
- Majburiy maydon boshqa tabda bo'lsa endi xato xabari chiqadi (ilgari "Saqlash" jim qolardi).
- Yangi kategoriya/brend nomi va konversiya soni ALOHIDA kichik komponentlarda turadi: telefonda
  yozilgan matnni o'chirib bo'lmasdi — har harfda butun oyna qayta chizilib, kiritilgan matn eskisiga
  qaytib qolardi (Android klaviaturasi bilan). Konversiya qatorlari barqaror `id` bilan chiziladi,
  shuning uchun bitta qator o'chirilganda qolganlarining qiymati aralashib ketmaydi.
  Deploy: `bum-web` (932e40cd), 2026-09-18 15:57, bundle `index-9I_f8DQh.js`.

**Soliq rejimi hamma joyda** — "Soliqni avtomatik hisoblash" o'chirilsa:
- server allaqachon sotuv va xarid hujjatlarida 0 yozardi; endi **kassa qurilmasiga ham 0 stavka**
  yuboriladi (`sync-pull`), ya'ni oflayn chek ham serverdagi hisob bilan bir xil;
- interfeysda soliq maydonlari ko'rinmaydi: xarid oynasidagi "Soliq %" ustuni, sotuv va xarid
  jamilaridagi QQS qatori, kassadagi "Soliqsiz / QQS" qatori, mahsulot kartochkasidagi stavka va
  "narxga soliq kiritilgan" (o'rniga tushuntirish matni);
- oldindan ko'rish ham 0 bilan hisoblaydi — ekrandagi jami serverdagi jami bilan mos.
Eski hujjatlar o'zgarmaydi.

Testlar: `apps/api/test/tax-toggle.test.ts` (5 ta — sotuv, xarid, qurilma sinxroni, qayta yoqish) va
`e2e/product-form.spec.ts` (skaner, kategoriya/brend qo'shish, ikkita konversiya, saqlash).

**Regressiya:** API 120 fayl / 637 test, brauzer 39 test (12 fayl), web 19 / 81 — hammasi o'tdi;
tsc va lint toza.

**Production'ga deploy qilindi (2026-09-18, 15:08–15:09).** Egasi shu kundan boshlab har safar
so'ramasdan avtomatik deploy qilishni so'radi — ish tugagach tekshiruvlar o'tsa, deploy qilinadi.
`bum-api` (a7f29a4a) va `bum-web` (545e9b11). Tekshirildi: `/api/auth/me` — 5 ta ketma-ket 401
(crash-loop yo'q), `/favicon.png`, `/brand/bum-logo.png`, `/brand/bum-mark.png` — 200, yangi bundle
`index-Deezin2W.js` ichida `product-barcode-scan`, "Kategoriya qo'shish", "Konversiya qo'shish" va
logotip manzili bor.

## Androidda o'chirish (backspace) tugmasi ishlamasligi (2026-09-18)

Egasi: "Dasturda Androidda hamma yerda matn yozishda o'chirish knopkasi 5-6 marta bosgandan keyin
ishlab boshlaydi, telefonning boshqa joylarida ajoyib ishlaydi."

**Sabab topildi:** `apps/mobile/capacitor.config.ts` dagi `android.captureInput: true`. Bu sozlama
APPARAT klaviaturasi (masalan USB skaner) uchun mo'ljallangan: yoqilganda WebView o'zini "matn
muharriri" deb e'lon qiladi va Android klaviaturasi (GBoard) boshqa kirish rejimiga o'tadi —
bashoratli yozuvda o'chirish tugmasi bir necha bosishdan keyingina ta'sir qiladi. Shuning uchun
muammo FAQAT ilovada ko'rinardi (brauzerda va boshqa ilovalarda yo'q edi).

**Yechim:** `captureInput: false`. Shtrix-kod skaneri baribir oddiy tugma hodisalari orqali ishlaydi,
shuning uchun hech narsa yo'qolmaydi. Bu NATIV sozlama — faqat yangi APK bilan tushadi:
`bumVersionCode=2`, `bumVersionName=1.0.1`, imzolangan APK qurildi (`app-release.apk`, 4,2 MB,
V2 imzo, CN=BUM ERP) va APK ichidagi `capacitor.config.json` da `"captureInput": false` ekani
tekshirildi. Web tomonida o'zgarish yo'q — deploy talab qilinmaydi.

## Telefon ilovasida yangilanish (2026-09-18)

Ilova production saytini ochgani uchun WEB qismi deploy bilan darhol yangilanadi, lekin NATIV qism
(ruxsatlar, GPS xizmati, klaviatura sozlamasi, ikonka) faqat yangi APK bilan keladi. Endi APK ham
dastur orqali tarqatiladi — mavjud desktop reliz tizimi ikkala platformaga umumiy qilindi
(migratsiya `0062_release_platform`: `desktop_releases.platform` ustuni, versiya endi har platforma
ichida yagona; ma'lumot o'chirilmadi, faqat indeks qayta yaratildi).

- **Admin panel → Desktop kassa**: yuklash formasida "Kassa (.exe)" / "Telefon (.apk)" tanlovi,
  ro'yxatda har reliz qaysi ilova uchun ekani ko'rinadi. Fayl turi boshidagi belgilar bilan
  tekshiriladi (`MZ` — .exe, `PK` — .apk), SHA-256 avvalgidek solishtiriladi, yuklash uzilsa
  o'sha joydan davom etadi.
- **E'lon qilish**: desktop relizida Ed25519 imzo avvalgidek MAJBURIY (kassa uni tekshiradi);
  Android APK uchun imzo so'ralmaydi — uni Android o'zi tekshiradi (boshqa kalit bilan imzolangan
  APK eski ilova ustiga o'rnatilmaydi).
- **Ilova tomoni**: `src/components/app-update-banner.tsx` — ilova ochilganda va har 6 soatda
  `GET /api/public/app-release` so'raydi, o'zining versiyasi (`App.getInfo()`) bilan solishtiradi va
  yangisi bo'lsa pastda xabar chiqaradi: versiya, hajm, izoh va "Yuklab olish". "Keyinroq" bosilsa
  o'sha versiya uchun boshqa bezovta qilmaydi; `minVersion` dan eski bo'lsa xabarni yopib bo'lmaydi.
  Brauzerda umuman ko'rinmaydi.
- **Yuklab olish sessiyasiz** (`GET /api/public/app-release/download`): Android yuklab oluvchisi
  cookie yubormaydi. Range qo'llab-quvvatlanadi — uzilgan yuklash davom etadi.

Testlar: `apps/api/test/android-release.test.ts` (5 ta — yuklash, imzosiz e'lon, sessiyasiz yuklab
olish, platformalar aralashmasligi, eski versiyaning arxivga o'tishi) va `src/lib/version.test.ts` (4 ta).
**Regressiya:** API 121 fayl / 642 test, brauzer 39 test, web 20 / 85 — hammasi o'tdi; lint va tsc toza.

**Deploy (2026-09-18 17:28–17:31):** `bum-api` (588b68e2), `bum-web` (eb28da7f), bundle
`index-Ci7kL87g.js`. Tekshirildi: `/api/public/app-release` — 200 `{"release":null}` (hali APK
e'lon qilinmagan), yuklab olish yo'li — 404 (reliz yo'q), `/api/auth/me` — barqaror 401.
Migratsiya `0062` production bazasida qo'llandi (API ishga tushdi).

## Yakuniy sotuvga tayyorlik auditi (2026-09-18)

Egasining topshirigi bo'yicha faqat tekshiruv o'tkazildi: kod, sxema va production o'zgartirilmadi,
deploy qilinmadi, production tranzaksiyasi yaratilmadi. Natija: **`FINAL-SALE-READINESS-AUDIT.md`**
(25 bo'lim, har biri PASS / PARTIAL / FAIL / NOT VERIFIED).

**O'lchangan va o'tgan:** API 121 fayl / 642 test, brauzer E2E 39, web 20 fayl / 85, desktop 9 fayl / 57;
tsc (API, web, desktop) va `eslint --max-warnings=0` toza; `vite build` yig'iladi.
Productionda faqat o'qish bilan: migratsiyalar 63 = 63 (lokal bilan bir xil), 118 jadval,
noma'lum formatdagi parol xeshi 0, qisqa PIN xeshi 0, **balanslanmagan jurnal yozuvi 0**,
tirik sarlavhalar HSTS/CSP/nosniff/X-Frame-Options.

**Hukm: NOT SALE READY** — sabab kodda emas, tekshirilmagan haqiqiy dunyo qismlarida:
(1) zaxira nusxadan tiklash sinalmagan, (2) haqiqiy Android telefonda hech narsa tekshirilmagan,
(3) savdo agenti ish joyi brauzer testlarida ochilmagan, (4) yetkazuvchi ish joyi ham,
(5) productionda fayl saqlash sozlanmagan (rasm 503), (6) SMS sozlanmagan (parol tiklash 503),
(7) desktop kassa haqiqiy kassa kompyuterida o'rnatilmagan.

**Ochiq ma'lumot masalasi:** `Bonnu Market -> Asosiy kassa` qoldig'i **-77 520 so'm** (eski yozuv).
Yangi kod manfiy qoldiqqa yo'l qo'ymaydi; mavjud qoldiqni egasi "Qoldiqni to'g'rilash" orqali tuzatadi.
Audit davomida ma'lumotga tegilmadi.

## 7 sale blocker bo'yicha ish (2026-09-18)

`FINAL-SALE-READINESS-AUDIT-v2.md` — har blocker uchun AUDIT -> REQUIREMENTS -> IMPLEMENT/CONFIGURE ->
REAL TEST -> EVIDENCE. Production o'zgartirilmadi, deploy qilinmadi.

**Yopildi (3):**
- **Backup/restore — PASS.** Production `pg_dump -Fc` (1 729 945 bayt, sha256 mos) -> toza `bumerp_restore`
  bazasiga `pg_restore` (6 s, 0 xato). 250 o'lchov taqqoslandi: 118 jadval, 1678 ustun, 466 indeks,
  379 FK, 1174 CHECK, 69 enum, 7 trigger, 63 migratsiya, 118 jadvalning qator soni va **117 jadvalning
  MD5 checksum'i — hammasi bir xil**. Yagona farq: ataylab chiqarilgan `desktop_release_chunks` (107 MB
  kassa o'rnatuvchilari); binar sodiqligi alohida isbotlandi (md5 `680fc831...`). Restore ustida API
  ko'tarildi: login, kompaniyalar, buyurtmalar, kassa qoldig'i (-77 520.00) o'qildi va yangi kategoriya
  yozildi. Nusxa va dump audit tugagach o'chirildi.
- **Sotuv agenti UI — PASS.** Yangi `e2e/sales-agent.spec.ts` (2 test): menyu aynan 5 bo'lim, ERP yopiq,
  ish sessiyasi, marshrutdagi do'kon, tashrif, **vitrina rasmisiz buyurtma ochilmaydi**, rasm -> taymer,
  buyurtma (3 dona = 12 000 so'm, naqd, yetkazish kuni); geofence UI'da ham, serverda ham rad etadi.
- **Yetkazuvchi UI — PASS.** Yangi `e2e/delivery-agent.spec.ts` (2 test): menyu 5 bo'lim, to'liq zanjir
  ASSIGNED -> ACCEPTED -> OUT_FOR_DELIVERY -> ARRIVED -> DELIVERING -> naqd -> DELIVERED; alohida testda
  "Yetkazib bo'lmadi" (sabab majburiy). Ikkalasida ham asl buyurtma summasi o'zgarmadi. Yig'ilgan pul
  "Yetkazuvchi DA-001 - yo'ldagi naqd" hisobida (16 000.00), kassada emas.

**Tuzatilgan noto'g'ri da'vo:** v1 auditda "mahsulot rasmi va tashrif rasmlari productionda 503" deb
yozilgan edi - **noto'g'ri**. Mahsulot rasmi, tashrif rasmi va yetkazma dalili S3 sozlanmaganda
**bazaga** saqlanadi va ishlaydi (productionda `agent_visit_photos` 848 kB, `delivery_proofs` 376 kB).
Faqat xarajat cheki va xodim surati S3 talab qiladi. S3 oqimining o'zi MinIO bilan 14/14 tekshirildi
(yuklash, mavjudlik, imzolangan URL, ko'rish, o'chirish, tenant izolyatsiyasi, sessiyasiz kirish).

**Ochiq qolgani (3):** SMS (Eskiz hisobi yo'q - mantiq 11/11 PASS), real Android (`adb devices` bo'sh),
desktop kassa (0.4.7 qayta qurildi, `/S` bilan o'rnatildi va ishga tushdi - PASS; imzo yo'q va kassir
oldida qo'lda sinov qilinmadi).

**Muhit eslatmasi:** bu mashinada `localhost` avval IPv6 (`::1`) ga ketadi, MinIO esa faqat IPv4 da -
lokal `.env` da `STORAGE_ENDPOINT` `127.0.0.1` ga o'zgartirildi (kod o'zgarmadi).

## Distributsiya 0->100 simulyatsiyasi va kassa o'zgarishlari (2026-09-19)

**Desktop kassa:** qurilmani ulashda server manzili maydoni olib tashlandi — kassir faqat login va
parol kiritadi (manzil ilovada: DEFAULT_API_URL, sinovlarda KASSA_API_URL). IPC shartnomasidan
apiUrl chiqarildi. Desktop testlari 57/57.

**Kassalar mas'ul xodim bilan (migratsiya 0063):** `cash_accounts.employee_id` (nullable) qo'shildi —
rahbar (asosiy) kassa mas'ulsiz, qolgan kassalar xodimga biriktiriladi ("Kassir Diana" kabi).
API xodim shu kompaniyaniki va faol ekanini tekshiradi; ro'yxatda `employeeName` qaytadi;
Moliya -> Kassalar oynasida tanlov bor.

**Yangi brauzer/Electron testlari:** `e2e/desktop-kassa.spec.ts` (5 test — ulash, kassir PIN,
smena, naqd sotuv, chek tarixi, qayta ishga tushirish, smenani yopish), `e2e/agent-mobile.spec.ts`
(4 test — agent va yetkazuvchi 390x844 va 412x915 da), `e2e/delivery-agent.spec.ts` ga qisman
yetkazish va qaytarish testi qo'shildi.

**0->100 simulyatsiya:** `scripts/distribution/` — noldan kompaniya, 12 xodim, 2 ombor, 2 bank,
2 terminal, 10 mahsulot, xarid, aksiya, marshrut, 3 mijoz (naqd/nasiya/aralash), POS, yetkazib
bo'lmadi, qisman yetkazish, qaytarish, ko'chirish, hisobotlar, salbiy testlar, parallellik va
buxgalteriya solishtiruvi. **114 tekshiruv — 114 PASS.** Bazadan: 37 jurnal yozuvi, balanslanmagan 0,
DEBIT = KREDIT = 23 062 000, manfiy kassa va zaxira yo'q.

Topilmalar `DISTRIBUTION-E2E-BUG-REPORT.md` da: 2 MEDIUM (yetkazib bo'lmaganda sotuv "completed"
qolishi; kassir ERP to'lovlari uchun finance.manage talab qilinishi), 4 LOW, BLOCKER/HIGH yo'q.
Yakuniy holat `DISTRIBUTION-E2E-FINAL-REPORT.md` da.

## F-01/F-03 tuzatildi, import va qurilmalar (2026-09-19, deploy qilindi)

**F-01 — yetkazib bo'lmagan yetkazma ko'rinmay qolishi:** endi `GET /api/delivery/tasks` har
yetkazmada `returnPending` belgisini qaytaradi va `?returnPending=true` filtri bor; Yetkazmalar
sahifasida "Tovar qaytarilmagan" filtri va sariq nishon; xato bildirishnomasi keyingi qadamni
aytadi. Zaxira va pul mantig'i ataylab o'zgartirilmadi (tovar jismonan yetkazuvchida).

**F-03 — kassir mijozdan to'lov qabul qila olmasligi:** yangi ruxsat `sales.collect_payment`
(Kassir va Savdo menejerida), `POST /api/sales/payments` endi `sales.collect_payment` YOKI
`finance.manage` bilan ochiladi. Kassirda moliya sozlamalari yopiq qoldi.

**Xarid importi:** SKU majburiy emas — mahsulot avval NOMI bo'yicha qidiriladi, topilmasa
avtomatik ochiladi (SKU o'zi beriladi). `dryRun` da faqat ogohlantirish chiqadi.

**Qurilmalar:** yangi ruxsat `devices.manage` (HR menejeri, Direktor, ega) — rahbar yo'qda ham
yangi telefon ochiladi. Foydalanuvchi O'ZINING qurilmasini ishonchli qurilmadan turib tasdiqlaydi:
`GET/POST /api/auth/devices`, Sozlamalar -> Xavfsizlik -> "Mening qurilmalarim". Rahbarning 2-3
telefoni/noutbuki muammosiz.

**Migratsiyalar:** 0063 (kassa mas'ul xodimi), 0064 (kassir to'lovi), 0065 (qurilma ruxsati) —
hammasi faqat qo'shadi. Production'da tasdiqlandi: 66 migratsiya, Kassir/Savdo menejeri
`sales.collect_payment` bilan, HR menejeri `devices.manage` bilan.

**Testlar:** API 124 fayl / 653 test. Yangi fayllar: delivery-return-pending (3),
cashier-collect-payment (2), device-self-service (4); purchase-csv (9).

**Deploy (2026-09-19):** `bum-api` va `bum-web` — tekshirildi: `/api/auth/devices` 401 (mavjud),
`?returnPending=true` 401, bundle `index-BemJjLKO.js` da yangi matnlar bor.

## Xodim kartochkasi, hududlar va zaxirani band qilish (2026-09-19)

**Xodim qo'shish (0068 gacha o'zgarishsiz, faqat xizmat qatlami):** endi har bir yangi xodim Kadrlar
ro'yxatida ham ko'rinadi — login ochilgan xodimga ham HR kartochkasi yaratiladi (avval faqat agent,
yetkazuvchi va "dasturga kirmaydi" holatida ochilardi). "Xodim qo'shish" oynasiga bo'lim, lavozim va
ishga kirgan sana maydonlari qo'shildi; tanlanmasa "Asosiy" bo'limi va rol nomidagi lavozim ochiladi.
Kadrlardagi tahrir/o'chirish amallari ro'yxatni darhol yangilaydi. Maosh varaqasiga to'lanadigan
hech narsasi yo'q xodim (maoshi kiritilmagan, KPI va qo'shimcha to'lovi ham yo'q) tushmaydi.

**Hududlar (migratsiya 0069):** yangi `territories` jadvali va `distribution_routes.territory_id`.
Marshrutlar hudud tarkibida: "Urganch" hududida "Luchevoy", "Nadmes bozor". Distribyutsiya →
Marshrutlar bo'limida "Hududlar" oynasi (qo'shish/o'chirish), marshrut oynasida hudud tanlovi majburiy,
ro'yxat hudud bo'yicha guruhlangan. CSV import/eksportda "Hudud" ustuni — importda majburiy, yo'q
hudud avtomatik ochiladi. API'da maydon ixtiyoriy: hududlar joriy qilinishidan oldingi marshrutlar
"Hududsiz" bo'lib qoladi (ma'lumot o'zgartirilmaydi).

**Zaxirani band qilish (migratsiya 0070):** tasdiqlangan buyurtma omborda tovarni band qiladi
(`stock_levels.reserved_qty`, `sales_orders.stock_reserved`). Omborda 50 dona bo'lsa va bir agent
40 donaga buyurtma olsa, boshqalarga 10 dona ko'rinadi — ortig'ini na qoralamaga yozib, na
tasdiqlab bo'ladi. Band jo'natishda (tovar chiqadi) va bekor qilishda bo'shaydi. Ombor qoldig'i
jadvalidagi "band" va "mavjud" ustunlari endi haqiqiy son ko'rsatadi.

Yo'l-yo'lakay tuzatildi: hududlar ro'yxatidagi marshrut soni har doim 0 chiqardi — qo'shilmasiz
so'rovda drizzle tashqi ustunga jadval nomini qo'shmaydi va ichki jadvalning "id" ustuni bilan
chalkashib ketardi (marshrutlar ro'yxatidagi mijoz soni qo'shilma tufayli to'g'ri ishlagan).

## Audit tuzatishlari: maosh jurnali, kartochka, bron poygasi, tenant kirish (2026-09-19)

Mustaqil auditdan keyingi tuzatishlar (migratsiyasiz — faqat xizmat qatlami va UI):

**Maosh + kompensatsiya (H-1).** Qo'shimcha to'lovi (yo'l/ovqat puli) bor xodimga maosh TO'LAB
BO'LMASDI: jurnal balanssiz chiqib, to'lov 400 xato bilan qaytardi. Endi kompensatsiya alohida
xarajat qatori bo'lib "Boshqa xarajatlar" (5500) hisobiga tushadi — ish haqi hisobi (5100) soliq
bazasi bilan bir xil qoladi. Tahrirlashda ham qo'shimcha yo'qolmaydi (avval `netSalary` dan tushib
qolardi). Debet = kredit invarianti test bilan qotirildi.

**Kartochka takrorlanishi (M-4).** Import qilingan xodimga login ochilganda ikkinchi HR kartochkasi
yaratilardi. Endi shu kompaniyadagi, hali hech kimga bog'lanmagan va ishdan bo'shamagan kartochka
telefon bo'yicha topilib LOGINGA ULANADI (maoshi va ma'lumotlari saqlanadi). Bir xil telefonli bir
nechta kartochka bo'lsa — avtomatik ulanmaydi, aniq xato qaytadi.

**Bron poygasi (M-1).** Ikki agent bir vaqtda yuborganda ikkalasi ham bron qilib, qoldiqdan ortiq
sotilardi. Endi agent buyurtmasida mavjud miqdor qoldiq qatori QULFI ostida qayta tekshiriladi —
faqat bittasi o'tadi. Qo'lda kiritilgan buyurtma avvalgidek tovar kelishidan oldin ham tasdiqlanadi.

**Tenant kirish (M-2).** Biznes a'zoligi endi SESSIYA OCHILISHIDAN OLDIN tekshiriladi: begona biznes
manzilidagi urinish sessiya ham, `login_success` izi ham qoldirmaydi; audit izida `login_denied`
(sabab: tenant_mismatch) yoziladi.

**Universal kirish sahifasi olib tashlandi.** `/uz/login` haqiqiy universal kirish edi: tenant
ko'rsatilmasdan sessiya ochib, foydalanuvchining oxirgi faol biznesiga kiritardi. Endi u biznes
manzilini so'raydigan sahifaga yo'naltiradi; kirish faqat `app.bum-erp.uz/<biznes>` dan. Parolni SMS
bilan tiklash biznes kirish sahifasiga ko'chdi. Platforma admini uchun alohida kirish — `/uz/admin`.
API (`POST /api/auth/login`) `companySlug` siz ham ishlaydi — desktop kassa va Android ilovasi shunga
tayanadi.

**Testlar:** API 129 fayl / 700 test, brauzer 70 test (yangi `e2e/tenant-isolation.spec.ts` — 6 ta
cross-tenant ssenariy), frontend 21 fayl / 87 test. Lint va build toza.

## Dostavchi qaytarib olgan tovar; modullar ro'yxati (2026-09-19)

**Qaytarib olish (migratsiya 0067, 0068):** dostavchi mijozdan ILGARI SOTILGAN tovarni ham qaytarib
oladi. Mijoz kartochkasida uning oldingi xaridlari chek bo'yicha ko'rinadi — qachon olgani, qanday
narxda olgani va qanchasini qaytarish mumkinligi; kerakli qatorlarni belgilab, miqdor va sabab
yoziladi. Yangi `delivery_return_pickups` (+ qatorlari) jadvali va `delivery.return_pickup` ruxsati
(Dostavka agenti va Direktor rollariga qo'shildi).

Ikki rejim — Dostavka → Siyosat bo'limidagi "Qaytarib olingan tovar omborda qabul qilinsin":
- yoqilgan (standart): so'rov "qabul kutilmoqda" bo'lib turadi, tovar mashinada ekan ombor qoldig'i
  oshmaydi; supervayzer Dostavka → Nazorat bo'limida qabul qilganda savdo qaytarish hujjati yoziladi
  (zaxira qaytadi, qarz kamayadi yoki pul tanlangan usulda qaytariladi), rad etilsa hech narsa yozilmaydi;
- o'chirilgan: dostavchi tasdiqlashi bilan darhol rasmiylashtiriladi.

Kutilayotgan so'rov chekdagi qoldiqni band qiladi — bir tovarni ikki marta qaytarib bo'lmaydi. Pul,
zaxira va jurnal faqat mavjud savdo qaytarish oqimida harakatlanadi (yangi hisob-kitob yozilmagan).
Buyurtmani to'liq yoki qisman qaytarish avvalgidek: dostavchi topshirishda har bir mahsulot uchun
miqdor kiritadi, yetkazilmagani supervayzer qabul qilguncha "qaytarish kutilmoqda" bo'lib turadi.

**Modullar:** Sozlamalar → Modullar ro'yxatida endi faqat YOQILGAN modullar turadi (o'chirilgani
biznes egasi uchun yo'q hisoblanadi; pastda nechtasini ulash mumkinligi eslatiladi).

**Testlar:** API 127 fayl / 686 test, brauzer 62 test, frontend 21 fayl / 89 test. Yangi:
`delivery-return-pickup` 9 ta API testi, `e2e/delivery-return-pickup` (dostavchi → qabul → zaxira
qaytdi), `modules-section` 2 ta komponent testi.

## Tezda qo'shish: hujjat sarlavhasi + qatorlar (2026-09-19)

"Tezda qo'shish" endi importdagi kabi barcha kataklarni takrorlamaydi: hujjatga xos, bir marta
yoziladigan maydonlar (ta'minotchi, ombor, sana, kategoriya, brend, bo'lim kabi — ustunda
`shared: true`) oynaning yuqorisida BIR MARTA kiritiladi va har bir qatorga qo'shiladi; jadvalda
faqat mahsulotga (yozuvga) tegishli kataklar qoladi. Har bir umumiy maydonni "har qatorda" bilan
jadvalga ko'chirish va "umumiy" bilan qaytarish mumkin.

Xaridda bir saqlash = BITTA hujjat: qatorlar `docKey` bilan bog'lanadi (import bodyda yangi ixtiyoriy
maydon; hujjat raqami sifatida saqlanmaydi, raqamni tizim beradi). Raqamli va raqamsiz fayl importi
avvalgidek ishlaydi.

Ikkala oyna ham butun ekranga yoyiladi ("Tezda qo'shish" va "Yangi xarid buyurtmasi"). Yo'l-yo'lakay
tuzatildi: bu oynalarda `max-w-5xl` `sm:max-w-lg` bilan bosilib qolayotgan edi — ya'ni kompyuterda
oyna kerakli kenglikka ochilmasdi.

**Admin panel:** platforma admini endi qurilma tasdig'isiz, telefon + parol bilan kiradi — uning
qurilmasini tasdiqlaydigan biznes egasi yo'q edi va ikkinchi qurilmadan kirish berkilib qolardi.
Qurilma baribir ro'yxatga yoziladi (kim, qachon, qaysi IP). Kompaniya xodimlarida qoida
o'zgarmadi: ikkinchi qurilma egasi tasdiqlaguncha kutadi.

Testlar: API 126 fayl / 668 test (yangi: docKey guruhlash 2 ta, admin panel qurilmasi 1 ta),
brauzer 61 test (`quick-add.spec.ts` 5 tasi — umumiy maydonlar, bitta hujjat, katta ekran).

## Maosh, tezda qo'shish va biznes manzili (2026-09-19, deploy qilindi)

**Maosh (migratsiya 0066):** xodim qo'shish oynasidan ish haqi turi va miqdori olib tashlandi —
endi Kadrlar -> Maosh bo'limidagi "Maosh va qo'shimcha to'lovlar" kartochkasida. Yangi
`employee_allowances` jadvali: yo'l puli, ovqat puli, aloqa, turar joy yoki boshqa to'lov xodimga
va davrga ("qaysi oydan qaysi oygacha") biriktiriladi; maosh tayyorlanganda shu oyga tushganlari
avtomatik qo'shiladi (soliq faqat hisoblangan maoshdan, kompensatsiya qo'lga qo'shiladi —
`salary_payments.allowances`). Xarajatda `employee_id` va `payout_kind`: xodim tanlansa
to'lov turi (maosh / yo'l / ovqat / aloqa / turar joy / boshqa) majburiy.

**Xodim kartochkasi:** tahrirlash oynasida "Dasturga kirish" bo'limi — import qilingan xodimni ham
shu yerdan dasturga ulash yoki uzish mumkin (avval faqat sichqoncha olib borilganda ko'rinardi).

**Tezda qo'shish:** import/eksport yonida yangi tugma — importdagi kabi kataklarga yozib saqlash
(fayl shart emas), tekshiruv importdagi bilan bir xil. CsvToolbar'da bo'lgani uchun mahsulot,
xodim, xarid, mijoz, ta'minotchi, xarajat va marshrut bo'limlarida ishlaydi.

**Xaridda mahsulot qidirish:** barkod bilan darhol qo'shish (skaner ham) va nomi/SKU bo'yicha
ro'yxatdan bir nechta mahsulotni belgilab qo'shish.

**Biznes manzili bilan kirish:** `app.bum-erp.uz/bonnu-market` — aynan shu biznesning kirish
sahifasi (nomi va logotipi bilan); login `companySlug` bilan yuboriladi va server foydalanuvchi shu
biznesning faol xodimi ekanini tekshiradi. Manzilsiz kirilganda biznes manzili so'raladi.
`/login`, `/onboarding`, `/select-company`, `/admin` biznes manzili deb qabul qilinmaydi.

**Testlar:** API 126 fayl / 665 test, brauzer 58 test — hammasi o'tdi. Yangi fayllar:
allowances (6), company-login (6), delivery-return-pending (3), cashier-collect-payment (2),
device-self-service (4), e2e/quick-add (2), e2e/company-login (3), e2e/agent-mobile (4).

## Tabli sessiya izolyatsiyasi, yagona xodim manbai, narx takliflari va tannarx (2026-09-19)

**Biznesga bog'langan sessiya (migratsiya 0071).** Ilgari brauzerda BITTA `bum_session` cookie'si
bor edi (`path=/`), shuning uchun ikkinchi tabda boshqa biznesga kirish birinchi tabning sessiyasini
ustidan yozardi va eski tabda "boshqa biznesning ma'lumoti" ko'rinib qolardi. Endi:

- cookie nomi biznesga xos: `bum_s_<biznes>` (eski `bum_session` desktop kassa, telefon ilovasi va
  admin paneli uchun qoldi — orqaga moslik buzilmadi);
- `sessions.company_id` — sessiya qaysi biznesda ochilganini BAZA darajasida saqlaydi;
- server har so'rovda sessiyaning biznesi bilan manzildagi biznesni solishtiradi, mos kelmasa
  403 `company_session_mismatch` ("Bu sessiya boshqa biznesga tegishli");
- chiqish faqat o'sha biznesning sessiyasini bekor qiladi — qolgan tablar ochiq qoladi;
- biznes almashtirilganda (`/api/company/switch`) YANGI bog'langan sessiya ochiladi.

Kirish qoidasi: har bir biznes manzilidan faqat o'sha biznesning xodimi kira oladi; begona
foydalanuvchiga sessiya umuman yaratilmaydi (avval yaratilib, keyin rad etilardi) va jurnalda
`login_denied` qoladi.

**Xodim yaratish — yagona manba (3-A).** Yangi xodim faqat **Kadrlar → "Xodim qo'shish"** da
ochiladi. Sozlamalar → Foydalanuvchilar endi "Foydalanuvchi qo'shish": MAVJUD xodimni tanlab unga
login, rol va litsenziya beradi (yangi kartochka ochmaydi). Dostavka va Distribyutsiya bo'limlari
Kadrlarga yo'naltiradi. Foydalanuvchilar ro'yxatida har bir loginning xodimi ko'rinadi
("Xodim: …" yoki "Xodim biriktirilmagan").

Ikkita CLI qo'shildi (ikkalasi ham hech narsa o'chirmaydi):
- `employee-audit.ts` — 10 ta tekshiruv bo'yicha faqat o'qiydigan hisobot (loginsiz kartochka,
  kartochkasiz login, ikkilangan telefon, begona biznes bog'lanishi…);
- `employee-reconcile.ts` — standart holatda **quruq yurish**, `--apply` bilan yetishmagan
  kartochkani ochadi yoki mavjudini ulaydi. Bir nechta nomzod bo'lsa "AMBIGUOUS" deb qoldiradi:
  telefon bo'yicha ko'r-ko'rona birlashtirish yo'q.

**Narx takliflari (xarid hujjatida).** Narx qatorida "Narxlarni taklif qilish" tugmasi:
oxirgi xarid narxi (sana va ta'minotchi bilan), oxirgi 20 xarid bo'yicha o'rtacha, kartochkadagi
kirim narxi, oldingi sotuv narxi va kartochkadagi sotuv narxi. **Narx o'z-o'zidan o'zgarmaydi** —
har bir qiymat yonida "Olish" tugmasi bor. Parallel narx tizimi yaratilmadi: hammasi mavjud
hujjatlardan (`purchase_order_items`, `sales_order_items`, mahsulot kartochkasi) o'qiladi, faqat
tovar KELGAN hujjatlar hisobga olinadi, valyuta kurs bilan va "quti/dona" koeffitsienti bilan
solishtirib bo'ladigan holga keltiriladi.

**Tannarx (Mahsulotlar → "Tannarx").** Mahsulot bo'yicha joriy tannarx, ombordagi o'rtacha tannarx
(AVCO), oxirgi xarid narxi va sanasi, sotuv narxi va marja; qatorni ochib tannarx tarixini
(tovar kelgan xarid hujjatlari) ko'rish mumkin.

**Yangi ruxsat `products.view_cost` (migratsiya 0072 — faqat qo'shadi).** Tannarx endi
`products.view` dan ajratilgan: ilgari kirim narxini mahsulotni ko'ra oladigan HAR KIM (kassir va
sotuv agenti ham) ro'yxatda, kartochkada va CSV eksportda ko'rardi — bu yopildi. Server ruxsat
bo'lmasa maydonni umuman yubormaydi (brauzerda yashirish emas), `/products/costs` va
`/price-suggestions` esa 403 qaytaradi. Ruxsat berilgan tizim rollari: Direktor, Buxgalter,
Moliya menejeri, Savdo menejeri, Xarid menejeri, Ombor menejeri, Omborchi, Ishlab chiqarish
menejeri, Auditor (egasi va Superadmin — barcha ruxsatlar bilan). **Diqqat:** kompaniya o'zi
yaratgan maxsus rollarga bu ruxsat avtomatik berilmaydi — kerak bo'lsa egasi rol sozlamalaridan
qo'shadi.

**Testlar:** API 132 fayl / 722 test va brauzer 79 test — **hammasi o'tdi**.
Yangi fayllar: `tenant-session` (6), `employee-single-source` (6), `product-cost` (10),
`e2e/tenant-isolation` (7), `e2e/employee-single-source` (4), `e2e/product-cost` (4).

**Soxta GPS oqimi (`e2e/_lib/geo.ts`).** Sotuv agenti brauzer testlari beqaror edi: buyurtma
yuborilmasdi va geofence ogohlantirishi chiqmasdi. Sabab ilovada emas — Playwright'ning
`setGeolocation` i BITTA statik nuqta beradi: `watchPosition` uni bir marta oladi, keyin yangi
o'lchov kelmaydi. Ilova esa (to'g'ri qilib) 15 soniyadan eski nuqta bilan ish qilmaydi va yangisini
so'raydi — statik mock'da bu so'rov javobsiz qoladi va 20 soniyadan keyin "Joylashuvni aniqlab
bo'lmadi" xatosi chiqadi. O'lchov: kuzatuv yoqilgan zahoti `getCurrentPosition` 1 ms da javob
beradi, 16 soniyadan keyin esa osilib qoladi; `setGeolocation` qayta chaqirilganda yana 0 ms da
javob beradi. Shuning uchun testda nuqta har 5 soniyada qayta e'lon qilinadi — haqiqiy qurilmadagi
GPS oqimi kabi. Koordinata o'zgarmaydi: geofence, masofa va aniqlik tekshiruvlari (UI va server)
o'z kuchida qoladi, ilova kodi o'zgarmadi.

## Yakuniy qabul auditi (2026-09-20)

Egasining topshirigi bo'yicha `2b5f696` ustida real-world qabul auditi: **`FINAL-ACCEPTANCE-AUDIT-v3.md`**
(26 soha, har biri PASS / NOT VERIFIED / PARTIAL / BLOCKED). Production'ga deploy qilinmadi,
production ma'lumotiga tegilmadi, ilova kodi o'zgartirilmadi.

**Yangi:** `apps/api/test/final-acceptance.test.ts` — bitta kompaniya 0 dan 100% gacha
(7 rol, 2 ombor, 3 pul hisobi, UZCARD va HUMO, 10 mahsulot, 4 mijoz, ta'minotchi): xarid →
aralash to'lov → 4 xil sotuv va yetkazish → kassa (naqd/UZCARD/HUMO/uch usulli/nasiya/qaytarish) →
qarzni bo'lib to'lash → ombor o'tkazmasi va parallel jo'natish → kun oxiri solishtiruvi.
**API endi 133 fayl / 747 test** (+1 ataylab "kutilgan xato" — AUDIT-1).

**Zaxira va tiklash HAQIQATAN sinaldi** (Docker + repodagi `deploy/backup` skriptlari): nusxa
123 jadval ma'lumoti bilan olindi, alohida `bumerp_restore_test` bazasiga tiklandi va manba bilan
solishtirildi — 14 jadval qatori va 12 moliyaviy ko'rsatkich (jumladan jurnal debet = kredit
466 307 033.62 va balanslanmagan yozuv 0) **aynan mos**. Bu dev bazasi; **production zaxirasi
hali yo'q**.

**Topilmalar:** AUDIT-1 (MEDIUM) — ERP buyurtmasi mavjud miqdordan ortiq band qiladi, natijada
ombordagi "mavjud" ustuni manfiy ko'rinadi (haqiqiy qoldiq buzilmaydi); AUDIT-2 (HIGH, operatsion) —
production bazasining avtomatik zaxirasi qo'yilmagan; AUDIT-3 (BLOCKED) — `railway up` va
production'ga tashqi so'rov avtomatik rejim klassifikatori tomonidan rad etildi, shuning uchun
`2b5f696` **deploy qilinmadi**.

**Hukm: NOT READY** — sabab kodda emas: production zaxirasi yo'q va haqiqiy Android/kassa
kompyuteri/UZCARD-HUMO terminali hamon sinalmagan.

## AUDIT-1 tuzatildi va zaxira arxitekturasi (2026-09-20)

Egasining topshirigi: auditdagi blocker'ni yopish, yangi biznes funksiyasi qo'shmasdan.
Production'ga deploy qilinmadi, production bazasiga tegilmadi.

**Zaxirani band qilish (AUDIT-1) — endi invariant DB darajasida.** Muammo: buyurtma tasdiqlanganda
mavjud miqdordan ortiq band qilinardi (`reserved_qty > quantity`) va ombordagi "mavjud" ustuni
manfiy chiqardi. Tuzatish UI'da niqoblash emas (`greatest(..., 0)` ISHLATILMADI):

- `inventory/reservations.service.ts` qayta yozildi. Mahsulotlar **tartiblangan** holda
  `select … for update` bilan qulflanadi (deadlock bo'lmasin), `available = quantity − reserved`
  hisoblanadi, yozuv esa shartli: `update … set reserved = reserved + N where reserved + N <= quantity`.
  Ya'ni invariant qator darajasida himoyalangan — parallel ikki tasdiqda ikkinchisi yoza olmaydi.
- **Siyosat ajratildi:** `strict` (`pos`, `sales_agent`) — yetmasa `400 out_of_stock`;
  `best_effort` (`manual`, `import`, `bot`) — mavjudi band qilinadi, yetishmagan qism **PRE-ORDER**
  bo'lib qoladi va band qilingan deb hisoblanmaydi (buyurtma tasdiqlanadi, lekin qoldiq "o'g'irlanmaydi").
- Migratsiya **0073** (faqat qo'shimcha, `add column if not exists`): `sales_order_items.reserved_qty`
  + `>= 0` check. Har satr uchun haqiqatda band qilingan miqdor saqlanadi, shuning uchun bekor
  qilish/jo'natishda aynan o'sha miqdor bo'shatiladi. 0073 gacha yaratilgan buyurtmalar uchun eski
  hisoblash fallback sifatida qoldirildi.
- `inventory/stock.service.ts`: chiqim sharti `quantity + delta >= 0` → **`quantity + delta >= reserved_qty`**
  (offline POS sinxroni uchun `allowNegative` bundan mustasno). Xato matni nechta dona boshqa
  buyurtma uchun band qilinganini aytadi.
- `sales/orders.service.ts`: `shipOrder` avval **mijozni** qulflaydi, keyin zaxirani bo'shatadi —
  bu topilgan deadlock'ni yopdi. Butun tizimda qulf tartibi: **buyurtma → mijoz → qoldiq**.

**Testlar:** `apps/api/test/stock-reservation-policy.test.ts` — 15 doimiy test (buyurtmaning barcha
manbalari, parallel 90+90 qoldiq 100 → `[200, 400]`, qisman band, bekor qilish, jo'natish, qaytarish,
idempotentlik, pre-order). Har bir testda `assertInvariant()` butun `stock_levels` jadvalini
tekshiradi: `quantity >= 0` va `reserved_qty <= quantity`. `final-acceptance.test.ts` dagi
`it.fails(… AUDIT-1)` oddiy o'tuvchi testga aylantirildi.

**Regressiya (tuzatishdan keyin, to'liq):** API **134 fayl / 763 test PASS** (42 daqiqa),
brauzer E2E **79/79 PASS** (17.5 daqiqa), `tsc --noEmit` va `eslint --max-warnings=0` toza.
Buxgalteriya va qoldiq solishtiruvi o'zgarmadi — jurnal yozuvlari balansli, tannarx mantig'iga
tegilmadi.

**Zaxira arxitekturasi (AUDIT-2) — faqat kod va hujjat, production'ga o'rnatilmadi.**
`deploy/backup/` izolyatsiya qilingan xizmat (`postgres:18-alpine` + `openssl` + `rclone`):

- `pg-backup.sh` — `pg_dump` (custom) → `pg_restore --list` bilan o'qib tekshirish → SHA-256 →
  AES-256-CBC/PBKDF2 shifrlash → saqlash muddati. `BACKUP_PASSPHRASE` **majburiy**: parolsiz nusxa
  yozilmaydi (`BACKUP_ALLOW_PLAINTEXT=1` faqat lokal sinov uchun). `RETENTION_DAYS` standart **30**.
- `files-backup.sh` (yangi) — S3 → mustaqil S3 ga inkremental `rclone sync` + `rclone check`
  (xesh solishtiruvi); o'chirilgan/almashgan fayllar `archive/<sana>/` ga suriladi.
- `files-restore-test.sh` (yangi) — nusxadan namuna obyektlarni yuklab, hajmi va SHA-256 ini
  manba bilan solishtiradi; production saqlagichga umuman tegmaydi.
- `README.md` — arxitektura, siyosat (kunlik baza + kunlik fayl, haftalik yaxlitlik tekshiruvi,
  oylik ALOHIDA muhitda tiklash sinovi), RTO/RPO va egasi bajaradigan Railway qadamlari.
- **Sirlar:** faqat muhit o'zgaruvchilari (`DATABASE_URL`, `BACKUP_PASSPHRASE`, `*_S3_*`); repoda
  hech qanday sir yo'q; loglarda parol, ulanish satri va token chop etilmaydi; fayllar `umask 077`.

**Fayl zaxirasi haqida muhim xulosa:** productionda S3 hali yoqilmagan, shuning uchun bugun tashrif
rasmlari, mijoz vitrinasi va yetkazma dalillari baza dump'i ichida (`bytea`). **S3 yoqilgan kundan
boshlab baza nusxasi YETARLI EMAS** — mahsulot rasmi, xodim surati va xarajat cheki faqat S3 da
bo'ladi. Shuning uchun `files-backup.sh` S3 dan OLDIN ishga tushirilishi shart.

## Production deploy va tashqi tekshiruv (2026-09-20)

Egasining topshirigi: kechagi va undan oldingi barcha o'zgarishlarni GitHub va Railway
production'ga chiqarish, keyin productionda haqiqatan ishlayotganini tekshirish. Yangi
funksiya qo'shilmadi; UZCARD/HUMO terminal integratsiyasi, SMS va AI'ga tegilmadi.

**Deploydan oldingi holat.** Ishchi daraxt toza, HEAD `0946490`. Production bazasida **71**
migratsiya (oxirgisi `0070`), ya'ni productionda `1fbb37e` gacha bo'lgan kod turgan edi —
`0b7b4ce`, `2b5f696`, `0e06624`, `0946490` hali chiqmagan. Buni marshrut diskriminatori
tasdiqladi: `/api/distribution/territories` va `/api/delivery/returns/pickups` allaqachon
**401** (mavjud), `/api/catalog/products/:id/price-suggestions` esa **404** (yo'q).
Chiqarilmagan 7 migratsiya (`0067`–`0073`) **faqat qo'shuvchi**: `create table`,
`add column ... default`, `add constraint`, va `roles.permissions` ga `array_append`.
Hech qanday `drop`, `delete`, `truncate` yoki ustun turini o'zgartirish yo'q.

**Testlar (deploydan oldin, hammasi lokal).** API `tsc --noEmit` toza, web `tsc -b` toza,
`eslint --max-warnings=0` toza. API to'plami 8 GB mashinada 7 qismga bo'lib ishga tushirildi
(`--maxWorkers=2`): **134 fayl / 763 test PASS** (22+20+20+20+20+16+16 fayl;
181+83+124+84+93+46+152 test). Frontend unit: **21 fayl / 87 test PASS**. Brauzer E2E
(Playwright, 3 shard): **79 test PASS** (44+12+23). Topshiriqda alohida so'ralgan to'plamlar
shu ichida: `stock-reservation`, `stock-reservation-policy`, `tenant-isolation`,
`tenant-session`, `acceptance-payment-architecture`, `employee-single-source`,
`product-cost`, `final-acceptance`.

**GitHub.** `git push origin feat/postgres-migration` — **o'tdi**: `fc047ac..0946490`,
162 commit. Avvalgi sessiyalardagi "avtomatik rejimda push rad etildi" blokeri **yopildi**.

**Railway production deploy.** `bum-api` (deployment `252dd3ea`, SUCCESS 10:52 UTC) va
`bum-web` (deployment `8cc72d9e`, SUCCESS 10:55 UTC) — ikkalasi ham RUNNING. `railway up`
dastlab ikki marta tarmoq xatosi bilan uzildi (backboard "operation timed out"), uchinchi
urinish o'zgarishsiz o'tdi — kodda emas, tarmoqda (avval ham shunday bo'lgan). Mavjud
muhit o'zgaruvchilariga, baza ulanishiga va production ma'lumotiga tegilmadi.

**Migratsiya natijasi.** API loglarida bitta `Migratsiyalar qo'llandi (35ms)` va bitta
`Server listening` — crash-loop yo'q, `ERROR`/`FATAL` yo'q. Bazada **71 → 74**:
`sessions.company_id` (0071), `roles` da `products.view_cost` — **36 rolda** (0072),
`sales_order_items.reserved_qty` (0073). Ma'lumot butun: kompaniya **3**, foydalanuvchi
**10** — deploydan oldin ham, keyin ham bir xil.

**Yangi kod jonli ekanining dalili.** Deploydan keyin 404 → 401 ga o'tgan marshrutlar:
`/api/catalog/products/:id/price-suggestions`, `/api/catalog/products/:id/cost-history`.
Web bundle almashdi: `index-OyhtHdrr.js` → `index-Ca7itN0K.js`.

### Productionda tekshirilgani (tizimga kirmasdan)

- **A) Root** — `app.bum-erp.uz/` login KO'RSATMAYDI: "Biznes manzili" sahifasi,
  parol maydoni **0 ta**. PASS
- **B) Tenant** — `app.bum-erp.uz/bonnu-market` aynan shu biznesning kirish sahifasi
  ("BONNU MARKET · Xodimlar uchun kirish · bonnu-market"), parol maydoni 1 ta. Noto'g'ri
  manzil (`/zzz-no-such-business`) — "Bunday biznes manzili yo'q", login formasi
  ko'rsatilmaydi. PASS
- **B2) Tenant almashtirish** — sessiyasiz `X-Company-Id`, `x-company-slug`, `X-Tenant`
  sarlavhalari va `POST /api/company/switch` `companyId` tanasi bilan — to'rttasi ham
  **401**, ya'ni sarlavha yoki tana bilan tenant tanlab bo'lmaydi. PASS
- **Xizmat sog'lig'i** — `/api/auth/me`, `/api/company/mine`, `/api/inventory/stock`,
  `/api/finance/accounts`, `/api/hr/employees`, `/api/purchase/orders`,
  `/api/catalog/products`, `/api/analytics/dashboard`, `/api/distribution/territories`,
  `/api/delivery/returns/pickups` — hammasi **401** (jonli va himoyalangan);
  `POST /api/sales/pos/sales`, `/api/sales/pos/payment-options`,
  `/api/sales/pos/shifts/open` — **401**. Sahifalar 200. Sessiyasiz cookie yozilmaydi.

### Productionda TEKSHIRILMAGANI (tizimga kirish kerak)

Topshiriqdagi **C (sessiya izolyatsiyasi), D (xodim), E (sotuv), F (zaxira),
G (to'lovlar), H (narx takliflari), I (tannarx)** bandlari haqiqiy hisob bilan kirishni
talab qiladi. Bular **BAJARILMADI** — production bootstrap admin paroli ishlatilmaydi
(uzoq vaqtdan beri amaldagi qoida), egasining sinov hisobi esa yo'q. Bu mantiqlarning
hammasi lokal to'plamda qoplangan va o'tgan (`tenant-session`, `employee-single-source`,
`final-acceptance`, `stock-reservation`, `acceptance-payment-architecture`,
`product-cost`), lekin bu **production dalili emas**.

### Zaxira (backup)

Railway production'da xizmatlar: `bum-api`, `bum-web`, `Postgres--bSX` (ilova bazasi),
`logto`, `Postgres` (logto'niki), `BUM-ERP` (bo'sh). **`bum-backup` xizmati YO'Q**, hech
bir xizmatda `Cron Schedule` qo'yilmagan (17 ta konfiguratsiyaning hammasida `null`).
Topshiriqqa muvofiq o'zboshimchalik bilan qo'shilmadi. Kod `deploy/backup/` da tayyor.

Egasi bajaradigan Railway qadamlari:
1. `bum-backup` nomli yangi xizmat (repodan, `RAILWAY_DOCKERFILE_PATH=deploy/backup/Dockerfile`)
2. Volume: `/backups` ga ulanadi (kamida 10 GB)
3. O'zgaruvchilar: `DATABASE_URL` (Postgres--bSX dan referens), `BACKUP_PASSPHRASE` (egasi
   o'ylab topadi, hech qayerda chop etilmaydi), `RETENTION_DAYS=30`; S3 yoqilgach
   `*_S3_*` (R2) kalitlari — **hech qaysi biri repoga yozilmaydi**
4. `Cron Schedule`: kunlik (masalan `0 1 * * *`)

## Distributsiya → Mijozlar: tezda qo'shish, import va Excel shablon (2026-09-20)

Egasining topshirigi: distributsiyada mijoz qo'shishni professional ERP darajasiga yetkazish.
Yangi biznes funksiyasi qo'shilmadi; UZCARD/HUMO, SMS va AI'ga tegilmadi.

**Muammo:** distributsiyada "Mijozlar" bo'limi umuman yo'q edi — mijoz faqat marshrut ichidan
MAVJUDLARI orasidan tanlanardi. Tezda qo'shish, import va shablon yo'q edi (ular Savdo → Mijozlar
da bor, lekin distributsiya foydalanuvchisi u yerga bormaydi).

**Yangi tab — Distributsiya → Mijozlar** (`_components/customers-section.tsx`). Ro'yxat + qidiruv va
bitta `[Yangi mijoz]` tugmasi; u uchta sodda tanlov oynasini ochadi: **Tezda qo'shish**,
**Import qilish**, **Excel shablon**. Telefonda ham qulay (tugmalar to'liq kenglikda).

**Yangi jadval OCHILMADI.** Mijoz o'sha `customers` jadvalida (Savdo → Mijozlar bilan bir xil manba).
"Hudud" va "Savdo agenti" uchun ham yangi ustun qo'shilmadi: `customers` da ular yo'q, bog'lanish
`route_customers` → `distribution_routes` orqali ketadi (marshrutda hudud ham, agent ham bor).
Shuning uchun hudud/agent berilganda mos **faol marshrut** topiladi va mijoz o'sha marshrutga
biriktiriladi — aynan `convertProspect` dagi naqsh. Mos marshrut topilmasa yoki bir nechta bo'lsa,
mijoz **baribir yaratiladi** va ogohlantirish qaytadi (xato emas).

**Uchala yo'l bitta serverdan o'tadi** — `POST /api/sales/customers/import`. "Tezda qo'shish" —
bu bitta qatorli import (`requirePhone: true`), shuning uchun tekshiruv va dublikat qoidasi
hamma joyda bir xil. Ruxsat — `crm.manage`, tenant kontekstdan (`writeInTenant`); tanadagi
`companyId` qabul qilinmaydi (`z.strictObject` uni 400 bilan rad etadi).

**Dublikat (create-only, mavjud yozuv O'ZGARTIRILMAYDI):** telefon bo'yicha, mavjud
`normalizePhone` bilan (faqat raqamlar solishtiriladi). Telefon berilmagan qatorlarda zaxira
kalit — nom (registr va bo'shliqqa befarq), aks holda har importda bir xil do'kon qayta ochilaverardi.
Xabar: "Bu mijoz allaqachon mavjud".

**`.xlsx` qo'llab-quvvatlash** (`src/components/csv/xlsx.ts`, yangi `exceljs` bog'liqligi):
- import endi `.xlsx` ham, `.csv` ham qabul qiladi (kengaytma bo'yicha ajratiladi; CSV yo'li tegilmagan);
- **Excel shablon** — qalin sarlavha, ustun kengligi, muzlatilgan qator, kulrang namuna. 1-qator
  sarlavha (majburiyda `*`), 2-qator `#` bilan boshlanadigan NAMUNA — parser uni tashlab ketadi;
- **"Xatolarni yuklab olish"** — preview'da ham, yakuniy hisobotda ham xato/dublikat qatorlar `.xlsx` bo'lib tushadi;
- `exceljs` **dinamik `import()`** bilan yuklanadi: build'da alohida bo'lak (`exceljs.min-*.js`,
  930 kB / 256 kB gz) — asosiy bundle kattalashmadi.

**Import oqimi o'zgarmadi** (3 bosqich): fayl → ustunlarni moslash → **preview** (`dryRun`, bazaga
yozilmaydi: jami / yangi / dublikat / xato) → "Importni boshlash". Yangi qo'shilgani — oxirida
**"Import yakunlandi"** hisoboti (Jami / Yaratildi / Dublikat / Xato + xatolarni yuklab olish).

**Mavjud bo'limlar buzilmadi:** `CsvToolbar` ga qo'shilgan `templateFormat` (standart `csv`),
`hideToolbar` va `ref` — hammasi ixtiyoriy, shuning uchun mahsulot, xodim, xarid, ta'minotchi,
xarajat va marshrut bo'limlari avvalgidek CSV shablon beradi (`csv-import.spec.ts` shuni pinlaydi).

**Testlar:** yangi `apps/api/test/distribution-customer-import.test.ts` — **12 test**
(tezda yaratish; nom va telefon majburiyligi — lekin fayl importida telefon ixtiyoriyligicha
qoladi; telefon dublikati; telefonsizda nom dublikati; `dryRun` hech narsa yozmasligi; 120 ta
mijoz; xato qatorlar raqami va sababi; hudud+agent bo'yicha marshrutga biriktirish; marshrut
topilmasa ogohlantirish; tenant izolyatsiyasi va soxta `companyId`; kassirga 403 va sessiyasizga 401;
qisman xato tranzaksiyani buzmasligi). Yangi `src/components/csv/xlsx.test.ts` — **7 test**
(shablon ↔ parser aylanishi, raqam katagi, bo'sh varaq, xatolar fayli). Yangi
`e2e/distribution-customers.spec.ts` — **4 test** (uchta tanlov; tezda qo'shish validatsiyasi va
ro'yxatda darhol chiqishi; `.xlsx` shablon haqiqiy ZIP bo'lishi; `.xlsx` import — moslash →
preview → hisobot, dublikat yozilmasligi).

**To'liq regressiya:** API **135 fayl / 775 test PASS** (avval 763 edi, +12), frontend unit
**22 fayl / 94 test PASS** (avval 87, +7), brauzer E2E **83 test PASS** (avval 79, +4),
`tsc` (API va web) va `eslint --max-warnings=0` toza, `vite build` o'tdi.

**Production (2026-09-20):** commit `6ef98a7`, GitHub'ga chiqarildi (`e9c3b29..6ef98a7`);
`bum-api` (deployment `d9952a6f`) va `bum-web` (deployment `217cac2f`) deploy qilindi.
API toza ko'tarildi — bitta `Migratsiyalar qo'llandi (27ms)` va bitta `Server listening`,
`ERROR`/`FATAL` yo'q (bu bosqichda YANGI migratsiya yo'q, sxema o'zgarmadi). Web bundle
`index-Ca7itN0K.js` → **`index-B9s0rsSh.js`** — lokal `vite build` chiqargan nom bilan AYNAN bir xil,
ya'ni productionda shu build turibdi. Sahifalar 200, marshrutlar sessiyasiz 401. Production
ma'lumotiga va o'zgaruvchilariga tegilmadi. Tizimga kirgan holda sinov — NOT VERIFIED
(production paroli ishlatilmaydi; egasining sinov hisobi kerak).

## Dostavka: qisman yetkazilgan qoldiqni qayta yetkazish (2026-09-21)

Dostavka modulidagi ochiq kamchilik yopildi: shu paytgacha qisman yetkazilgan yetkazmaning qoldig'i
uchun **yagona yo'l omborga qaytarish** edi (sotuv va qarz kamayadi, jurnal teskari yoziladi). Mijoz
"qolganini ertaga olib keling" desa, tizimda buni yozadigan joy yo'q edi.

**Yangi amal — «Qoldiqni qayta yetkazish»** (`POST /api/delivery/tasks/:taskId/redeliver`, ruxsat
`delivery.manage`, agent bilan yaratilsa — qo'shimcha `delivery.assign`). Qoldiq uchun **yangi yetkazma**
ochiladi: faqat qolgan qatorlar va miqdorlar, yangi kun va (ixtiyoriy) agent. **Buyurtma, zaxira, qarz
va jurnal o'zgarmaydi** — tovar allaqachon jo'natilgan (`shipOrder` yo'lga chiqishda bir marta) va
yetkazuvchida; yangi yetkazma faqat jarayon obyekti (ORDER ≠ DELIVERY).

**Asosiy invariant: qoldiq bir vaqtda faqat BITTA tirik yetkazmada.**
- qayta yetkazma ochiq (bekor qilinmagan) bo'lsa — asl yetkazmadan omborga qabul qilib bo'lmaydi
  (409 `redelivery_open`), ya'ni bir miqdor ikki marta qaytmaydi;
- qoldiq omborga qabul qilingan bo'lsa — qayta yetkazma ochilmaydi (409 `already_returned`);
- bitta yetkazmaga ikkinchi qayta yetkazma ochilmaydi (409 `redelivery_exists`);
- qayta yetkazma bekor qilinsa — qoldiq yana omborni kutadi (`returnPending` qaytadi);
- qayta yetkazmaning o'zi qisman bo'lsa — zanjir davom etadi (uning qoldig'i o'z navbatida
  qaytariladi yoki yana qayta yetkaziladi).

**Migratsiya 0074** — faqat qo'shadi: `delivery_tasks.origin_task_id` (o'ziga havola, `on delete set null`)
va shartli indeks. Ma'lumot o'zgarmaydi, mavjud yetkazmalarda `null`.

**Yo'l-yo'lakay tuzatilgan ikkita eski kamchilik** (ikkalasi ham API darajasida ochiq edi, UI ularni
taklif qilmasdi):
- qisman yetkazilgan va qoldig'i hal qilinmagan buyurtmaga `POST /tasks` orqali oddiy yetkazma ochish
  mumkin edi — u buyurtmaning TO'LIQ miqdorini olardi; endi 409 `redelivery_required`;
- yetkazma rejalashda ilgari **mijozga topshirilgan** miqdor hisobga olinmasdi (faqat qaytarilgani) —
  qoldiq omborga qabul qilingach, o'sha buyurtmaga yana yetkazma ochilib, allaqachon yetkazilgan
  miqdorni rejalashtirardi; endi `delivered_qty` ham chegiriladi.

**Ko'rsatkichlar mosligi:** `returnPending` belgisi, `?returnPending=true` filtri, Nazorat bo'limidagi
"Qaytarish kutilmoqda" paneli va Bugun sahifasidagi `pendingReturns` sanog'i endi bitta shartdan
(`returnPendingCondition`) hisoblanadi va qayta yetkazishga berilgan qoldiqni ko'rsatmaydi.

**Web:** yetkazma oynasida (supervayzer) yangi «Qoldiqni qayta yetkazish» tugmasi — qoldiq qatorlari,
yig'iladigan summa, sana va agent tanlovi; «Omborga qabul qilish» qayta yetkazma ochiq bo'lsa
ko'rinmaydi. Tafsilotda zanjir ko'rinadi: "Asl yetkazma" va "Qoldiq yetkazmasi". Tillar: uz, ru, kk
(14 tadan yangi kalit).

**Testlar:** yangi `apps/api/test/delivery-redelivery.test.ts` — **10 test** (qoldiq uchun yangi
yetkazma: faqat qolgan miqdor, qoldiq summasi, buyurtma/zaxira/qarz o'zgarmasligi, ikki tomonlama
havola va tarix; qayta yetkazma ochiq ekan omborga qabul qilinmasligi va bekor qilingach yana
mumkinligi; ikkinchi qayta yetkazma va qaytarilgandan keyingi urinish; faqat `partially_delivered`
dan; agent qayta yetkazmani yetkazishi — zaxira qayta kamaymaydi, to'lov qarzni yopadi; zanjir
(qayta yetkazma ham qisman) va qoldiqning bir marta omborga qaytishi; oddiy yetkazma ochilmasligi;
qat'iy tana, o'tgan sana va qoldiqdan katta summa; ruxsatlar 403/401 va boshqa kompaniya 404;
marshrut tartibi bilan boshqa agentga biriktirish). `src/lib/delivery/errors.test.ts` ga yangi
sabab kodlari qo'shildi (+1 test).

**To'liq regressiya:** API **136 fayl / 785 test PASS** (avval 135 / 775, +10), frontend unit
**22 fayl / 95 test PASS** (avval 94, +1), `tsc` (API va web) va `eslint --max-warnings=0` toza.
Brauzer E2E bu bosqichda ishga tushirilmadi (dostavka supervayzer sahifasi E2E qamrovida emas —
modulning boshlanishidan beri shunday).

**Production (2026-09-21):** commit `149fde2`, GitHub'ga chiqarildi (`7012f8b..149fde2`);
`bum-api` (deployment `4db1a563`) va `bum-web` (deployment `17ad9905`) deploy qilindi.
API toza ko'tarildi — bitta `Migratsiyalar qo'llandi (34ms)` (0074 qo'llandi) va bitta
`Server listening`, `ERROR`/`FATAL` yo'q. Yangi marshrut tekshirildi: sessiyasiz
`POST /api/delivery/tasks/<id>/redeliver` → **401** (marshrut bor), mavjud bo'lmagan marshrut →
**404** — ya'ni 401 umumiy javob emas. Web bundle `index-B9s0rsSh.js` → **`index-C7srWsIe.js`** —
lokal `vite build` chiqargan nom bilan aynan bir xil. Production ma'lumotiga va o'zgaruvchilariga
tegilmadi. Tizimga kirgan holda qo'lda sinov (qoldiqni qayta yetkazish oynasi) — NOT VERIFIED,
egasining hisobi kerak.

## Obuna: qo'shimcha litsenziya tugashi ogohlantirishi (2026-09-21)

Ochiq kamchilik yopildi: trial tugashiga 10/5/3/1 kun qolganda egasiga bildirishnoma borardi, **pullik
qo'shimcha litsenziya esa jim tugardi** — kompaniya egasi xodim tizimga kira olmay qolgandan keyin bilardi.

**Nima qo'shildi** (yangi parallel tizim emas — mavjud `processSubscriptionExpiry` davriy vazifasi kengaytirildi):
- **Oldindan ogohlantirish:** faol `additional` litsenziya tugashiga 10/5/3/1 kun qolganda kompaniya
  egasiga bildirishnoma. Matnda kimning litsenziyasi ekani aytiladi; 3 kun va undan kam qolganda
  `severity: warning`, aks holda `info`. Havola — `/subscription`.
- **Tugaganda xabar:** ilgari faqat holat, tarix va audit yozilardi — endi egasiga ham bildirishnoma
  («… tizimga kira olmaydi»). Takror ishga tushirilsa ikkinchisi yozilmaydi (litsenziya allaqachon `expired`).
- **Har chegara bir marta:** `licenses.warning_days` — `subscriptions.trial_warning_days` bilan bir xil naqsh.
  Litsenziya uzaytirilganda `null` ga qaytadi, ya'ni yangi muddat uchun ogohlantirish qaytadan boshlanadi.

**Migratsiya 0075** — faqat qo'shadi: `licenses.warning_days` (integer, null). Ma'lumot o'zgarmaydi.

**API:** `GET /api/subscription/licenses` javobida har litsenziya uchun `daysLeft` va `expiryWarning`
(included — ikkalasi ham `null`, chunki u obuna bilan ketadi), hisobda esa `additionalExpiringSoon`.
Ogohlantirish chegarasi serverda hisoblanadi (`licenseWarning` — `@bum/shared`), frontend faqat ko'rsatadi.

**Web:** Obuna → Litsenziyalar bo'limida tugash sanasi yonida «N kun qoldi» belgisi va bo'lim tepasida
umumiy ogohlantirish satri (nechta litsenziya tugayapti, nima qilish kerak).

**Testlar:** `subscription-rules.test.ts` — `licenseWarning` sof funksiyasi (chegaralar; `expired` va
`pending_payment` ogohlantirilmaydi; included — hech qachon; muddatsiz va o'tgan sana — null).
`subscription.test.ts` — 2 ta yangi integratsiya testi: 5 kun chegarasi bir marta va 3 kunda yana
(bildirishnoma matni, `severity`, `relatedId`, ro'yxatdagi `daysLeft`/`expiryWarning` va
`additionalExpiringSoon`), uzaytirilgandan keyin hisoblagich tozalanishi va included ogohlantirilmasligi;
mavjud "litsenziya tugadi" testiga egaga bildirishnoma va takrorlanmaslik tekshiruvi qo'shildi.

**To'liq regressiya:** API **136 fayl / 788 test PASS** (avval 785, +3), frontend unit
**22 fayl / 95 test PASS**, `tsc` (API va web) va `eslint --max-warnings=0` toza.

**Production (2026-09-21):** commit `a6f9505`, GitHub'ga chiqarildi (`b8779d2..a6f9505`);
`bum-api` (deployment `c9cd2a76`) va `bum-web` (deployment `e38646cc`) deploy qilindi. API toza
ko'tarildi — bitta `Migratsiyalar qo'llandi (31ms)` va bitta `Server listening`, `ERROR`/`FATAL` yo'q.
Sxema bazadan tekshirildi (faqat o'qish, `railway ssh`): `licenses.warning_days` va
`delivery_tasks.origin_task_id` bor, jami **76 ta migratsiya** qo'llangan (0000–0075). Web bundle
`index-C7srWsIe.js` → **`index-Rn4yLOY9.js`** — lokal `vite build` nomi bilan aynan bir xil.
Production ma'lumotiga va o'zgaruvchilariga tegilmadi. Bildirishnomaning haqiqiy productionda
ko'rinishi — NOT VERIFIED: davriy vazifa soatlik ishlaydi va hozir tugashiga 10 kundan kam qolgan
qo'shimcha litsenziya yo'q (testlarda to'liq qoplangan).

## Import: fayl kodlashi va mavjud mijozni yangilash (2026-09-21)

Egasi mijozlarni CSV bilan import qilgach, ro'yxatdagi barcha nomlar romb belgilarga aylanib qolgan edi
(`C-0015 ??? ??????` ko'rinishida). Sabab kodda: fayl Excel'ning **ANSI (Windows-1251)** eksporti
edi, `papaparse` ga esa `File` berilardi — u faylni doim **UTF-8** deb o'qiydi. Har bir kirill harfi
`U+FFFD` ga aylanib bazaga shunday yozilgan; bunday matn tiklanmaydi (asl baytlar yo'qolgan).

**1) Kodlashni aniqlash** — yangi `src/components/csv/encoding.ts`: fayl baytlari o'qiladi va kodlash
tartib bilan aniqlanadi — BOM (UTF-8, UTF-16LE/BE) → sof ASCII → qat'iy UTF-8 tekshiruvi → aks holda
Windows-1251. UTF-8 dan boshqa kodlash aniqlansa foydalanuvchiga xabar chiqadi. Bu **barcha** CSV
importlariga tegishli (mijoz, mahsulot, hodim, ta'minotchi, xarajat, marshrut). `.xlsx` yo'li avvalgidek
(`exceljs` o'zi to'g'ri o'qiydi).

**2) "Mavjudlarini yangilash"** — import CREATE ONLY edi, ya'ni allaqachon buzuq yozilgan mijozlarni
qayta import TUZATA olmas edi (telefon dublikat bo'lib o'tkazib yuborilardi), mijozni o'chirish
endpointi esa yo'q. `POST /api/sales/customers/import` ga `updateExisting` qo'shildi: qator mavjud
mijozga (telefon bo'yicha; telefonsiz qatorda — nom bo'yicha) mos kelsa, u faylda **to'ldirilgan**
ustunlar bo'yicha yangilanadi. Bo'sh katak eski qiymatni o'chirmaydi; qarz, balans va keshbekka
tegilmaydi (ular ilgarigidek faqat hujjat yoki "Balansni to'g'rilash" orqali). Fayl ichidagi takror
qator bu rejimda ham dublikat bo'lib qoladi. Marshrutga biriktirish takror a'zolik yaratmaydi
(`rc_route_customer_key` tekshiriladi). Web: import oynasida belgi (`Mijozlar` va `Distributsiya →
Mijozlar` bo'limlarida), preview va yakunda "Yangilanadi / Yangilandi" ko'rsatkichi.

**Testlar:** `src/components/csv/encoding.test.ts` — 5 ta yangi test (1251 kirill matni, UTF-8 BOM
bilan va BOMsiz, UTF-16LE, sof ASCII, `File` orqali o'qish) **PASS**; `tsc` (web va API) va
`eslint --max-warnings=0` toza. API testiga 2 ta yangi holat yozildi
(`csv-import-export.test.ts`: yangilash rejimi mavjud yozuvni tuzatadi va bo'sh katak eski qiymatga
tegmaydi; telefonsiz qator nom bo'yicha yangilanadi, fayl ichidagi takror dublikat bo'ladi) —
`csv-import-export.test.ts` **7/7 PASS**. Importga tegishli qolgan fayllar ham qaytadan ishlatildi:
`acceptance-import-export`, `distribution-customer-import`, `import-preview`, `purchase-csv`
(**39 test PASS**) va `crm`, `distribution`, `customer-balance`, `sales-agent-stores`
(**10 test PASS**). To'liq API to'plami **ishlatilmadi** — fonda ishga tushirilgani xotira
yetishmovchiligidan to'xtatildi (Docker + Postgres konteyneri bilan birga 8 GB yetmaydi).

**Production (2026-09-21):** commit `1be9fcc`; `bum-api` (deployment `df9e1c8f`) va `bum-web`
(deployment `4859c9fa`) deploy qilindi. API toza ko'tarildi — bitta `Migratsiyalar qo'llandi (70ms)`
va bitta `Server listening`. Web bundle `index-Rn4yLOY9.js` → **`index-6nq_pXkQ.js`** (yangi matn
bundle ichida topildi). Migratsiya yo'q, ma'lumotga tegilmadi.

**Egasi uchun keyingi qadam:** buzuq yozilgan mijozlarni tuzatish — Sotuv → Mijozlar → **Import**,
o'sha `mijozlar-shablon.csv` faylni tanlash, "Ustunlarni moslash" oynasida **"Mavjudlarini yangilash"**
ni belgilash → **"Tekshirish"** (bu bosqichda bazaga hech narsa yozilmaydi, "Yangilanadi" soni
ko'rinadi) → "Importni boshlash". Fayldagi telefonsiz 2 qator (`Муслима Маркет`, `Тинчлик Бобожонов
Комил`) nomi bazada buzuq bo'lgani uchun mos kelmaydi — ular YANGI mijoz bo'lib qo'shiladi,
eski buzuq yozuvini qo'lda tahrirlash yoki nofaol qilish kerak.

## Mijozlar: arxivga ko'chirish (2026-09-21)

Import tuzatilgandan keyin ochiq qolgan kamchilik: noto'g'ri kodlashda yozilgan ikkita telefonsiz mijoz
(`C-0006`, `C-0035`) ro'yxatda qoldi, mijozni **o'chirish yoki yashirish** esa web'da umuman yo'q edi.

Bazada `customers.is_active` va `PATCH /api/sales/customers/:customerId { isActive }` allaqachon bor edi
(qarzli mijoz arxivlanmaydi — `409`, `listCustomers` esa `includeInactive` ni qo'llaydi) — faqat UI yo'q edi.
Yangi endpoint yoki migratsiya **qo'shilmadi**.

**Web (Sotuv → Mijozlar):**
- har bir kartada "Arxivga ko'chirish" tugmasi va tasdiq oynasi — yozuv o'chirilmaydi, hujjat, to'lov va
  tarix joyida qoladi, mijoz esa sotuv, kassa va marshrut tanlovlaridan chiqadi;
- "Arxiv" tugmasi — arxivdagilar ro'yxati (`includeInactive=true` bilan so'raladi, nofaollari ajratiladi),
  kartada "Arxivda" belgisi va "Arxivdan qaytarish" tugmasi;
- arxiv ko'rinishida eksport ham arxivdagilarni oladi; arxivda "Mijoz qo'shish" ko'rinmaydi.

**Test:** `sales.test.ts` — yangi holat: arxivlangan mijoz standart ro'yxatdan chiqadi,
`includeInactive=true` bilan `isActive: false` bo'lib ko'rinadi, hujjat sahifasi ochiladi va qaytarilganda
ro'yxatga tushadi (`sales.test.ts` **4/4 PASS**). `tsc` va `eslint --max-warnings=0` toza. Qarzli mijozni
arxivlab bo'lmasligi ilgaridan shu faylda tekshirilgan (`409`).

**Production (2026-09-21):** commit `5754871`; faqat `bum-web` deploy qilindi (API kodi o'zgarmagan —
test qo'shildi). Bundle `index-6nq_pXkQ.js` → **`index-DA6qFg8j.js`**, "Arxivga ko'chirish" matni bundle
ichida topildi.

## Marshrut: mijozlarni ro'yxatdan belgilab qo'shish (2026-09-21)

"Marshrutga mijoz qo'shish" oynasida bitta ochiladigan ro'yxat (Select) bor edi: qidirib bo'lmasdi,
har bir do'konni alohida-alohida qo'shishga to'g'ri kelardi (10 marshrut × o'nlab do'kon).

**Web (Distributsiya → Marshrutlar → mijoz qo'shish):** qidiruv maydoni (nomi, kodi, telefoni, shahri,
mahallasi, manzili bo'yicha — mijozlar ro'yxati baribir bitta so'rovda kelgani uchun filtr brauzerda),
har bir qator oldida belgilash katakchasi, tepada **"Hammasi"** (joriy filtrdagilarni belgilaydi yoki
bo'shatadi — boshqa filtrda belgilangani saqlanadi) va "Qo'shish (N)" tugmasi. Marshrutda bor mijoz
ro'yxatda ko'rinadi, lekin "marshrutda" belgisi bilan va belgilab bo'lmaydi.

**API:** `POST /api/distribution/routes/:routeId/customers` endi `{ customerIds: [...] }` (1–500 ta) ni
ham qabul qiladi va `{ added, skipped, members }` qaytaradi — bitta tranzaksiyada, marshrut qulflangan
holda, tartib raqami mavjud oxirgisidan davom etadi; marshrutda bori **xato bermaydi**, `skipped` bo'lib
qaytadi (bitta mijoz uchun `{ customerId }` avvalgidek ishlaydi va takrorga `409` beradi). Ikkala maydon
birga yuborilsa — `400`. Audit: `ROUTE_CUSTOMERS_ADDED` (qo'shilgan va o'tkazib yuborilgan soni).
Yangi jadval yoki migratsiya **yo'q**.

**Testlar:** `distribution.test.ts` — yangi holat: ko'p tanlov qo'shiladi va tartiblanadi, takroriy tanlov
`skipped`, begona kompaniya mijozi `400`, `customerId` + `customerIds` birga `400`, bo'sh tana `400`
(**5/5 PASS**). Endpointdan foydalanadigan qolgan testlar ham qayta ishlatildi: `delivery-dispatch`,
`sales-agent-boundaries`, `csv-import-export` (**16 test PASS**). `tsc` (web va API) va
`eslint --max-warnings=0` toza.

**Production (2026-09-21):** commit `a0b162e`; `bum-api` (deployment `1fb6c812`) va `bum-web`
(deployment `09e98e1d`) deploy qilindi. API toza ko'tarildi — yangi konteyner `cfeaa5c5482c`, bitta
`Migratsiyalar qo'llandi (91ms)` va bitta `Server listening`, `ERROR`/`FATAL` yo'q. Web bundle
`index-DA6qFg8j.js` → **`index-BGeuOErI.js`**.

## Import: tekshirish oynasida qatorlar jadvali (2026-09-21)

"Tekshirish" bosqichi faqat sonlar (jami, to'g'ri, xato, dublikat) va muammo ro'yxatini ko'rsatardi —
qiymat qaysi maydonga tushganini yozishdan OLDIN ko'rib bo'lmasdi. Ustun noto'g'ri moslangani faqat
import qilingandan keyin, mijoz kartasida bilinardi.

**Web (barcha CSV importlari — mijoz, mahsulot, hodim, ta'minotchi, xarajat, marshrut):** preview
oynasida jadval qo'shildi — sarlavhada faqat MOSLANGAN maydonlar (o'tkazib yuborilgani chiqmaydi),
qatorlarda fayldagi qator raqami (muammo ro'yxatidagi raqam bilan bir xil) va har bir katak qiymati
(bo'shi — `—`). Xato qator qizil, dublikat sariq fonda ajralib turadi. Avval birinchi 10 qator,
"Hammasini ko'rsatish (N)" bilan hammasi; ustun ko'p bo'lsa jadval yon tomonga suriladi. Oyna kengaytirildi
(`sm:max-w-4xl`). Server yoki endpoint o'zgarmagan — jadval brauzerdagi moslangan qatorlardan chiziladi.

**Test:** yangi `src/components/csv/csv-toolbar.test.tsx` — Windows-1251 dagi TSV fayl berilganda
ustunlar avtomat moslanadi, jadval sarlavhasi va kataklari to'g'ri joyda chiqadi (kirill matn buzilmaydi),
va serverga aynan shu qatorlar `dryRun: true` bilan yuboriladi. Frontend to'plami: **24 fayl / 101 test
PASS** (avval 23/100), `tsc` va `eslint --max-warnings=0` toza.

**Production (2026-09-21):** commit `f2ac180`; faqat `bum-web` deploy qilindi (deployment `dcf496c3`),
bundle `index-BGeuOErI.js` → **`index-CbWwwKGg.js`**. API kodi o'zgarmagan.

## Mijozlar: hudud, qarz va tartib bo'yicha saralash (2026-09-21)

Mijozlar ro'yxatida faqat matnli qidiruv bor edi: hudud bo'yicha ajratish ham, "oxirgi qo'shilganlar"ni
ko'rish ham mumkin emasdi (ro'yxat doim nomi bo'yicha, 200 talik chegara bilan — import qilingan yangi
mijozlar ro'yxat o'rtasiga tushib ketardi).

**API:** `GET /api/sales/customers` ga `city`, `district` (registrga befarq TENGLIK — qiymat tanlov
ro'yxatidan keladi), `withDebt` va `sort` (`name` | `newest` | `oldest` | `debt` | `purchases`)
qo'shildi; har bir tartibda ikkinchi ustun ham beriladi (teng qiymatlarda tartib sakramaydi).
Yangi `GET /api/sales/customers/regions` (`sales.view`, `?includeInactive=`) — mavjud shahar/mahalla
juftliklari va har birida nechta mijoz borligi; hududi ko'rsatilmagan mijozlar `city: null` bo'lib chiqadi
(ularni to'ldirish kerakligi ko'rinib turadi). Saralash SERVERDA bajariladi — 200 talik ro'yxat
chegarasidan tashqaridagi mijoz ham topiladi. Migratsiya kerak emas: `customers_company_region_idx`
(company + city + district) allaqachon bor.

**Web (Sotuv → Mijozlar):** qidiruv ostida hudud va mahalla tanlovlari (mijozlar soni bilan), tartib
tanlovi, "Qarzi borlar" tugmasi, "Tozalash" va topilgan mijozlar soni (200 ta bo'lsa — qidiruvni
aniqlashtirish haqida eslatma). Mahalla ro'yxati tanlangan shaharga qarab qisqaradi; arxiv ko'rinishida
hududlar ham arxivdagilardan yig'iladi.

**Testlar:** `sales.test.ts` — yangi holat: `newest`/`oldest`/`debt` tartiblari, hudud bo'yicha saralash
(registrga befarq), `district`, `withDebt`, hududlar ro'yxati va arxivlangan mijoz hududlar ro'yxatidan
chiqib ketishi (`includeInactive=true` bilan qaytishi) — **5/5 PASS**. Qo'shimcha: `csv-import-export`,
`crm`, `pos` (**11 PASS**), frontend `src/components/csv` (**13 PASS**). `tsc` (web va API) va
`eslint --max-warnings=0` toza.

**Production (2026-09-21):** commit `036c1f4`; `bum-api` (deployment `5d97e313`) va `bum-web`
(deployment `5c266b4c`) deploy qilindi — har ikkalasida `railway up` bir martadan xato berdi
(`os error 10054` va "operation timed out"), qayta urinishda o'tdi. API toza ko'tarildi: yangi konteyner
`e1ed8280475f`, bitta `Migratsiyalar qo'llandi (56ms)` va bitta `Server listening`. Yangi endpoint
tashqaridan tasdiqlandi: `/api/sales/customers/regions` → **401** (mavjud), `/api/sales/zzz` → 404.
Web bundle `index-CbWwwKGg.js` → **`index-DVL7Tv3M.js`**.

## Saralash paneli marshrutga mijoz qo'shishda ham (2026-09-21)

Saralash (hudud, mahalla, tartib, "Qarzi borlar") alohida komponentga chiqarildi va endi mijoz ro'yxati
chiqadigan ikkinchi joyda — **marshrutga mijoz qo'shish** oynasida ham ishlaydi.

- `src/components/customers/customer-filter.ts` — holat, so'rov parametrlari (`customerFilterParams`,
  standart qiymatlar so'rovga qo'shilmaydi) va hudud tanlovlarini yig'ish (`cityTotals`, `districtTotals`).
- `src/components/customers/customer-filters.tsx` — panel UI (hudud, mahalla, tartib, "Qarzi borlar",
  "Tozalash" va o'ngdagi qo'shimcha matn uchun `trailing`).
- Sotuv → Mijozlar shu komponentga o'tkazildi — xatti-harakati o'zgarmagan.
- Distributsiya → Marshrutlar → "Mijoz qo'shish" oynasida panel qo'shildi (`showDebt={false}` — marshrut
  tanlashda qarz ahamiyatsiz). Oqim: hududni tanlash → ro'yxat qisqaradi → "Hammasi" bilan belgilash →
  bir marta "Qo'shish". Oyna yopilganda filtr tozalanadi.

**Test:** yangi `customer-filter.test.ts` (4 ta) — standart holatda parametr yuborilmasligi, tanlovlar
parametrga aylanishi, shahar/mahalla ro'yxatlari va hududsizlar tanlovga tushmasligi. Frontend to'plami:
**25 fayl / 105 test PASS**. `tsc` va `eslint --max-warnings=0` toza.

**Production (2026-09-21):** commit `f15ba94`; faqat `bum-web` (deployment `5e7a95e1`) — API kodi
o'zgarmagan. Bundle `index-DVL7Tv3M.js` → **`index-Bc_aSJM_.js`**.

**Keyingi qadam (egasi so'rovi bo'yicha):** kerak bo'lsa shu panelni mijoz tanlanadigan boshqa joylarga
ham qo'shish — sotuv buyurtmasi va kassadagi mijoz tanlovi, dostavka va CRM ro'yxatlari.

## Mijoz tanlash: qidiruvli ro'yxat va saralash qolgan joylarda (2026-09-21)

Mijoz ro'yxati chiqadigan hamma joy ko'rib chiqildi va kerakli joyiga saralash yoki qidiruv qo'shildi.

- **Distributsiya → Mijozlar:** hudud/mahalla/tartib paneli (Sotuv → Mijozlar dagi bilan aynan bir xil
  komponent) va topilgan mijozlar soni.
- **Sotuv → "Yangi sotuv buyurtmasi"** va **CRM → Faoliyat:** mijoz oddiy `Select` da edi — 200–500 ta
  mijoz qidiruvsiz ochilardi va butun ro'yxat sahifa bilan birga yuklanardi. Endi yangi
  `src/components/customers/customer-combobox.tsx`: qidiruv SERVERDA (`GET /api/sales/customers?search=`
  — nomi, kodi, telefoni; 30 tadan), ro'yxat faqat oyna ochilganda so'raladi, qatorda kodi, telefoni va
  shahri ko'rinadi. "Anonim" (buyurtma) va "—" (CRM) variantlari saqlandi. Buyurtma oynasi endi
  tanlangan mijozning o'zini holatda saqlaydi — chegirma avvalgidek qo'llanadi.
- **Kassa (POS)** mijoz tanlagichiga tegilmadi: u allaqachon qidiruvli va kassa ekrani uchun ixcham.
- **Mahsulotlar ro'yxati** — saralash QO'SHILMADI: u keyset kursor bilan sahifalanadi (`name`, `id`), ya'ni
  tartibni o'zgartirish kursorni ham qayta qurishni talab qiladi. Kerak bo'lsa alohida ish sifatida.

**Testlar:** frontend to'plami **25 fayl / 105 test PASS**, `tsc` va butun `src` bo'yicha
`eslint --max-warnings=0` toza. API kodi bu qadamda o'zgarmagan.

**Production (2026-09-21):** commit `b7a128f`; faqat `bum-web` (deployment `28714490`).
Bundle `index-Bc_aSJM_.js` → **`index-CH8cjoMx.js`**, qidiruvli tanlagich matni bundle ichida topildi.

## Oynalar: keng jadval chegaradan chiqib ketmasligi (2026-09-22)

Importni tekshirish oynasidagi jadval oyna chegarasidan tashqariga chiqib, o'ng tomondagi ustunlar ekran
chetida qirqilib qolardi (egasining ekran surati). Sabab UI primitivida: `DialogContent` — `grid`, uning
bolalarining eng kichik kengligi sukut bo'yicha MAZMUNGA teng (`min-width: auto`), shuning uchun keng
jadval `overflow-auto` ichida surilish o'rniga oynaning o'zini cho'zib yuborardi.

- `src/components/ui/dialog.tsx`: `DialogContent` ga **`[&>*]:min-w-0`**. Endi mazmun ichkarida suriladi,
  oyna kengligi buzilmaydi — bu **barcha** oynalarga tegishli (import, "Tezda qo'shish", dostavka
  avtomatik taqsimoti, marshrutga mijoz qo'shish...). `overflow-hidden` ATAYLAB qo'shilmadi: u baland
  oynalarni kesib qo'yardi.
- Importni tekshirish jadvali: katak mazmuni ichki blokda cheklanadi (`max-w-56 truncate` — jadval
  avtomatik joylashuvida `td` ga berilgan `max-width` ishlamaydi, ichki blokka esa ishlaydi; to'liq matn
  sichqoncha ostida), qator raqami ustuni esa yon tomonga surilganda yopishib turadi (`sticky left-0`).
- Muammolar jadvalida uzun xabar so'z bo'yicha ko'chiriladi, kalit ustuni qisqartiriladi.

**Tekshirilgani:** `vite build` chiqargan CSS da qoida bor — `.[&>*]:min-w-0>*{min-width:0}`; deploy'dan
keyin productiondagi `index-dQGEMSvA.css` ichida ham tasdiqlandi. Frontend `src/components/csv` testlari
**13 PASS**, `tsc` va `eslint --max-warnings=0` toza. Ko'rinishning o'zi (piksel darajasida) brauzerda
tekshirilmagan — egasi oynani ochib ko'radi.

**Production (2026-09-22):** commit `7b0161f`; faqat `bum-web` (deployment `930d132d`),
bundle `index-CH8cjoMx.js` → **`index-Dt53jYRJ.js`**.

## Mijoz oynasi: shahar va mahalla takliflari (2026-09-22)

"Yangi mijoz" oynasida Shahar/tuman va Mahalla har safar QO'LDA yozilardi: bazada "Urganch" bo'lsa ham
maydon bo'sh ochilardi, ustiga bosilganda hech narsa chiqmasdi. Bu nafaqat noqulay — bir hududning ikki
xil yozilishi hudud bo'yicha saralashda ikki alohida hudud bo'lib chiqardi.

**Yangi `src/components/ui/suggest-input.tsx`** — erkin yoziladigan, lekin avval kiritilgan qiymatlarni
taklif qiladigan maydon: bosilganda to'liq ro'yxat ochiladi, yozila boshlangach ro'yxat qisqaradi,
ro'yxatda yo'q qiymatni ham yozish mumkin (bu `Select` emas). Ro'yxat qatori `onMouseDown` da tanlanadi —
maydon fokusdan chiqmaydi, shuning uchun `blur` da yopilishi tanlashni buzmaydi. Qiymat aynan mos kelsa
ro'yxat ochilmaydi (keraksiz taklif chiqmaydi).

Sotuv → Mijozlar oynasida shahar va mahalla shu maydonga o'tkazildi; takliflar
`GET /api/sales/customers/regions` dan (`includeInactive=true` — hudud nomi arxivdagilarda ham o'sha),
mahalla ro'yxati tanlangan shaharga qarab qisqaradi. Distributsiya → "Tezda qo'shish" da hudud va agent
allaqachon `Select` bilan tanlanadi — tegilmadi.

**Test:** yangi `suggest-input.test.tsx` (4 ta) — bosilganda ro'yxat ochilishi, yozilganda qisqarishi,
tanlangani maydonga tushishi, aynan mos qiymatda ro'yxat ochilmasligi, ro'yxatda yo'q matn
yozilaverishi. Frontend to'plami: **26 fayl / 109 test PASS**, `tsc` va butun `src` bo'yicha
`eslint --max-warnings=0` toza.

**Production (2026-09-22):** commit `9a111d5`; faqat `bum-web` (deployment `5b14897a`),
bundle `index-Dt53jYRJ.js` → **`index-C4Nniv1Y.js`**.

## "Hudud" tushunchasi: hozirgi model va taklif takliflari (2026-09-22)

Egasining savoli: Distributsiya → Hududlarda ikkita yozuv bor ("Urganch" — 10 marshrut, "Urganch tumani"
— 0 marshrut), lekin mijoz oynasidagi "Shahar/tuman" taklifida faqat "Urganch" chiqadi — xatolikmi?

**Xatolik emas, ikki xil narsa** (kodda tekshirilgan):
- `territories` (Distributsiya → Hududlar) — MARSHRUTLAR guruhi. Jadvalga faqat
  `distribution_routes.territory_id` bog'langan; mijoz jadvalida hudud ustuni yo'q, mijoz hududga
  marshrut orqali tegishli bo'ladi. Geografik ma'lumotnoma emas (viloyat/tuman iyerarxiyasi yo'q).
- `customers.city` / `customers.district` — mijozning o'z matn maydonlari ("Shahar/tuman", "Mahalla");
  dostavkada shahar bo'yicha guruhlash va yangi saralash shulardan foydalanadi.
  `GET /customers/regions` aynan MIJOZLARDAGI qiymatlarni yig'adi — shuning uchun hali birorta mijozda
  yozilmagan "Urganch tumani" u yerda chiqmasdi.

**Qilingan ish:** mijoz oynasidagi shahar taklifiga endi ikkala manba qo'shiladi — mijozlarda kiritilgan
qiymatlar va hudud nomlari (`GET /api/distribution/territories`), ya'ni bir joy ikki xil yozilib
ketmaydi. Ruxsat bo'lmasa (403) taklif avvalgidek faqat mijozlardagi qiymatlardan yig'iladi.

**Ochiq qaror (egasi hal qiladi):** "Hudud" geografik ma'lumotnoma (Respublika → viloyat → shahar/tuman)
bo'lishi kerakmi? Hozir u savdo hududi (marshrutlar guruhi). Geografik ma'lumotnomaga o'tkazish —
alohida ish: `territories` ga ota-bola bog'lanishi va turi (viloyat/tuman) qo'shiladi, mijozdagi
`city`/`district` matn maydonlari ma'lumotnomaga bog'lanadi, import va dostavka guruhlashi ham
moslashtiriladi. Boshlanmagan.

**Production (2026-09-22):** commit `72cfb97`; faqat `bum-web` (deployment `74a58c09`),
bundle `index-C4Nniv1Y.js` → **`index-BObbwNQH.js`**.

## Hududlar — geografik ma'lumotnoma (2026-09-22)

Egasining qaroriga ko'ra "hudud" savdo hududidan **geografik ma'lumotnomaga** o'tkazildi:
**viloyat → shahar/tuman → mahalla**.

**Migratsiya 0076** (faqat qo'shadi va to'ldiradi, ma'lumot o'chirilmaydi):
- `territories.kind` (`region` | `district` | `neighborhood`) va `parent_id` (o'ziga havola,
  `on delete restrict`); mavjud hududlar `district` bo'lib qoladi — marshrutlar bog'lanishi o'zgarmaydi;
- eski `terr_company_name_key` o'rniga `terr_company_parent_name_key` (ota ichida takrorlanmaydi) va
  yuqori daraja uchun qisman unikal `terr_company_root_name_key`; `kind` va `parent_id` bo'yicha indekslar;
- mijozlarda yozilgan shahar/tumanlar va mahallalar ma'lumotnomaga ko'chiriladi (registri har xil
  yozilganlari bitta yozuvga yig'iladi; mahalla o'z shahri tagiga).

**API:** `GET /territories?kind=` — daraja, ota bog'lanishi, ichki hududlar soni va **mijozlar soni**;
`POST`/`PATCH` daraja qoidasini tekshiradi (mahalla faqat shahar/tuman ichida va otasi majburiy,
viloyatning otasi bo'lmaydi, bir ota ichida nom takrorlanmaydi); nom o'zgarsa **mijozlardagi matn ham
yangilanadi** (`renamedCustomers`); ishlatilayotgan hudud o'chirilmaydi (marshrut, ichki hudud yoki mijoz).
Mijoz saqlanganda shahar/mahalla ma'lumotnomaga avtomatik qo'shiladi (`registerRegion`) — CSV import ham
shu yo'ldan o'tadi, ya'ni ro'yxat o'zi to'lib boradi.

**Web:** "Hududlar" oynasi daraxt ko'rinishida alohida faylga chiqarildi
(`src/pages/distribution/_components/territories-dialog.tsx`): daraja va ota tanlovi, nomni joyida
tuzatish (mijozlarga tarqaladi), har bir hududda marshrut va mijozlar soni. Mijoz oynasidagi shahar va
mahalla takliflari endi ma'lumotnomadan keladi (mahalla — tanlangan shahar ichidagilari); ro'yxatda yo'q
qiymat yozilsa "yangi hudud sifatida qo'shiladi" izohi chiqadi.

**Testlar:** `distribution.test.ts` — iyerarxiya qoidalari, bir xil nomning turli otalarda bo'lishi,
`kind` filtri, mijoz hududining ma'lumotnomaga tushishi, nom o'zgarganda mijozda yangilanishi,
ishlatilayotgan hududni o'chirib bo'lmasligi (**7/7 PASS**). Qo'shimcha: `sales`, `csv-import-export`,
`crm` (**20 PASS**), `acceptance-import-export`, `distribution-customer-import`, `delivery-dispatch`
(**25 PASS**), frontend **26 fayl / 109 test PASS**; `tsc` va butun `src` bo'yicha `eslint` toza.

**Production (2026-09-22):** commit `654eef9`; `bum-api` (deployment `fe156f58`) va `bum-web`
(deployment `d0ff69a7`). API toza ko'tarildi: `Migratsiyalar qo'llandi (40ms)`, bitta `Server listening`.
Bazadan (faqat o'qish, `railway ssh`) tasdiqlandi: `territories` da `kind` va `parent_id` ustunlari,
yangi indekslar, jami **77 ta migratsiya** (0000–0076). Hozirgi holat: 2 ta `district`
("Urganch", "Urganch tumani"), mahalla yo'q — chunki import faylida "Mahalla" ustuni bo'sh edi.
Web bundle `index-BObbwNQH.js` → **`index-4sRZvYVh.js`**.

**Keyingi qadam (ixtiyoriy):** O'zbekiston viloyat/tuman ro'yxatini bir marta yuklab qo'yish
(hozir ma'lumotnoma faqat kompaniya ishlatgan joylardan to'ladi) va mijoz eksport/importiga "Viloyat"
ustunini qo'shish.

## Hududlar: O'zbekiston ro'yxatini yuklash (2026-09-22)

Ma'lumotnoma faqat kompaniya o'zi ishlatgan joylardan to'lardi. Endi "Hududlar" oynasida bitta tugma —
**"O'zbekiston ro'yxatini yuklash"**: 14 ta viloyat (Qoraqalpog'iston Respublikasi va Toshkent shahri
bilan) va ularning shahar/tumanlari (190 dan ortiq) ma'lumotnomaga tushadi.

- `POST /api/distribution/territories/seed-uzbekistan` (`distribution.manage`): faqat YETISHMAYOTGANINI
  qo'shadi, mavjud hududni o'chirmaydi va nomini o'zgartirmaydi; viloyatsiz turgan mavjud shahar/tumanni
  o'z viloyatiga bog'laydi ("Urganch" → "Xorazm viloyati"). Takror bosilsa hech narsa qo'shilmaydi
  (idempotent). Javob: `{ regionsAdded, districtsAdded, districtsLinked }`, audit `TERRITORIES_SEEDED`.
- Ro'yxat `apps/api/src/modules/distribution/uzbekistan-regions.ts` da — lotin alifbosida, BOSHLANG'ICH
  ma'lumot: nomni tuzatish, keraksizini o'chirish va yangisini qo'shish kompaniya ixtiyorida (nom
  tuzatilsa mijozlardagi matn ham yangilanadi).
- Web: oynada tasdiq so'raladi ("mavjudlari o'chirilmaydi") va natijada nechta viloyat/tuman qo'shilgani
  va nechtasi viloyatiga bog'langani ko'rsatiladi.

**Testlar:** `distribution.test.ts` — 14 viloyat va 150 dan ortiq tuman qo'shilishi, avvaldan bor
"Urganch" yozuvi O'CHIRILMASDAN Xorazmga bog'lanishi (o'sha `id`), Toshkent shahri tumanlarining to'g'ri
otaga tushishi, takroriy yuklashda o'zgarish yo'qligi (**8/8 PASS**); `sales.test.ts` **5/5**, frontend
**26 fayl / 109 test PASS**; `tsc` va `eslint` toza.

**Production (2026-09-22):** commit `ee5fa74`; `bum-api` (deployment `5da8734f`) va `bum-web`
(deployment `7e97c08e`). API toza ko'tarildi (`Migratsiyalar qo'llandi (32ms)`, bitta `Server listening`),
endpoint tashqaridan tasdiqlandi: `/territories/seed-uzbekistan` → **401**, mavjud bo'lmagan yo'l → 404.
Web bundle `index-4sRZvYVh.js` → **`index--P2dwF5a.js`**. Ro'yxat hali YUKLANMAGAN — tugmani egasi
bosadi (bu ma'lumot qo'shadigan amal, avtomatik bajarilmaydi).

## Import: moslash oynasida fayl namunasi va ajratgich (2026-09-22)

"Ustunlarni moslash" oynasida faqat ustun NOMLARI ko'rinardi — fayl ichida nima turganini ko'rmasdan
moslashga to'g'ri kelardi. Egasining ekran suratida oqibati: fayl ustunlarga ajralmagan
("74 ta qator, 1 ta ustun topildi"), hamma maydon "o'tkazib yuborish" bo'lib qolgan va sababi bilinmaydi.

Egasi bilan kelishilgan to'rtta o'zgarish:
1. **Fayl namunasi jadvali** — birinchi 4 qator, hamma ustuni bilan (ustun ko'p bo'lsa yon tomonga
   suriladi, uzun matn ichki blokda qisqartiriladi, to'lig'i sichqoncha ostida).
2. **Belgilash ikki tomondan** — jadval sarlavhasidagi tanlov ("bu ustun — Telefon") va pastdagi
   maydonlar ro'yxati bitta `choice` holatiga yozadi; bir ustun ikki maydonga tushmaydi (avvalgisi
   avtomat bo'shaydi). Mantiq alohida modulda: `src/components/csv/mapping.ts`
   (`assignColumn`, `assignByColumn`, `columnOwner`, `sampleValues`).
3. **Maydon tagida namuna qiymatlar** — tanlangan ustunning birinchi 3 ta bo'sh bo'lmagan qiymati.
4. **Ajratgichni qo'lda tanlash** — Avtomatik / `,` / `;` / Tab / `|`; fayl O'QILGAN MATNDAN qayta
   ajratiladi (faylni yana o'qish va kodlashni aniqlash shart emas). 1 ta ustun topilsa qizil
   ogohlantirish chiqadi.

Oyna kengaytirildi (`sm:max-w-4xl`). O'zgarish barcha CSV importlariga tegishli.

**Testlar:** yangi `mapping.test.ts` (5 ta — ustun bitta maydonda qolishi, sarlavhadan belgilash, namuna
qiymatlar) va `csv-toolbar.test.tsx` ga 2 ta yangi holat (namuna jadvali qiymatlari o'z ustunida
ko'rinishi; ajratgich `;` ga o'zgartirilganda ustun 1 taga tushib ogohlantirish chiqishi va Tabga
qaytarilganda yana 4 ta bo'lishi). Frontend to'plami: **27 fayl / 116 test PASS**, `tsc` va butun `src`
bo'yicha `eslint --max-warnings=0` toza.

**Production (2026-09-22):** commit `f3e599b`; faqat `bum-web` (deployment `f20a383d`) — API kodi
o'zgarmagan. Bundle `index--P2dwF5a.js` → **`index-DlsY21XF.js`**; yuklab olingan bundle ichida
`csv-file-preview`, "Fayl ustunlarga ajralmadi" va "olinmasin" matnlari topildi.

## Foydalanuvchini kompaniyadan chiqarish (2026-09-22)

Egasining bildirgani: Sozlamalar → Foydalanuvchilarda Kadrlar kartochkasi bo'lmagan foydalanuvchi
("Xodim biriktirilmagan") osilib qolgan — na o'chirib bo'ladi, na Xodimlar ro'yxatida ko'rinadi.
Sabab: ro'yxat `company_members` dan chiqadi, Xodimlar esa `employees` dan; a'zolikni O'CHIRISH yo'li
umuman yo'q edi (faqat "bloklash").

**`DELETE /api/company/employees/:userId`** (kompaniya egasi, `ownerRemoveMember`):
- a'zolik yozuvi o'chadi, sessiyalar bekor qilinadi, kassa qurilmasidagi kassir bog'lanishlari yopiladi;
- litsenziya `revoke` rejimida bekor qilinadi — included o'rni bo'shaydi (to'langan `additional` ham yopiladi);
- Kadrlar kartochkasi SAQLANADI, faqat `employees.user_id` uziladi (davomat va maosh tarixi yo'qolmaydi);
  sotuv agenti va yetkazuvchi profillari nofaol bo'lib foydalanuvchidan uziladi;
- hisobning o'zi (`users`) o'chirilmaydi — hujjatlar va auditdagi nomi joyida qoladi; boshqa faol
  a'zoligi bo'lmasa hisob nofaol bo'ladi (login rad etiladi);
- himoya `assertOwnerMayManage` da: o'zini, kompaniya egasini, to'liq huquqli rolni va platforma
  adminini chiqarib bo'lmaydi. Audit: `MEMBER_REMOVED` (severity `warning`).

**Web:** foydalanuvchi qatorida "O'chirish" tugmasi va tasdiq oynasi — nima bo'lishi aniq yozilgan
(litsenziya bo'shaydi, tarix qoladi, Kadrlar kartochkasi saqlanadi).

**Testlar:** `company.test.ts` — chiqarilgan foydalanuvchi ro'yxatdan yo'qolishi va kira olmasligi,
`company_members` yozuvi o'chishi, hisob qolib nofaol bo'lishi, litsenziyaning `revoked` bo'lishi,
takroriy so'rovda 404, himoya holatlari (o'zi 403, boshqa kompaniya 404, ega bo'lmagan Direktor 403) —
**22/22 PASS**. Qo'shimcha: `hr`, `subscription`, `user-devices`, `company-owner` (**43 PASS**),
frontend **27 fayl / 116 test PASS**; `tsc`, `eslint` (`src` va `apps/api/src`) toza.

**Production (2026-09-22):** commit `9044402`; `bum-api` (deployment `203537f4`) va `bum-web`
(deployment `500f2747`). API toza ko'tarildi (`Migratsiyalar qo'llandi (53ms)`, bitta `Server listening`,
konteyner `878f3e0e3b18`). Web bundle `index-DlsY21XF.js` → **`index-BaVPqLfZ.js`** (tasdiq oynasi matni
bundle ichida topildi). Migratsiya yo'q.

## Mijozlar ro'yxati CRM bo'limiga ko'chirildi (2026-09-22)

Egasining qaroriga ko'ra (tanlov: "CRM bo'limiga ko'chirilsin") mijozlar ro'yxati Sotuv modulidan
CRM ga ko'chdi: mijoz faqat sotuvga emas, kassa, distributsiya, dostavka va CRM faoliyatiga ham tegishli.

- `src/pages/sales/_components/customers-section.tsx` → `src/pages/crm/_components/customers-section.tsx`
  (kod o'zgarmadi — faqat mijoz turi `@/pages/sales/_lib/types.ts` dan olinadi; endpointlar ham o'sha:
  `/api/sales/customers`).
- CRM sahifasida **"Mijozlar" birinchi tab** (Pipeline va Faoliyatlar yonida); tab `sales.view` ruxsati
  bo'lganda ko'rinadi, sahifaning o'zi esa avvalgidek `crm` moduli va `crm.view` bilan ochiladi.
- Sotuv moduli endi faqat buyurtmalar va to'lovlar (tab satri olib tashlandi, sarlavha matni yangilandi).
- Tezkor qidiruvda (Ctrl+K) mijoz tanlanganda CRM bo'limi ochiladi (ilgari Sotuv).
- Distributsiya → Mijozlar O'Z JOYIDA qoladi — u do'kon/marshrut ko'rinishi (hudud, marshrutga qo'shish).

**Egasi uchun eslatma:** CRM moduli hozir kompaniyada O'CHIRILGAN — mijozlar ro'yxati ko'rinishi uchun
Sozlamalar → Modullar dan CRM yoqiladi. Mijozlar bilan ishlaydigan rollarga `crm.view` ruxsati kerak
bo'ladi (`sales.view` esa ma'lumot uchun avvalgidek).

**Tekshirilgani:** frontend **27 fayl / 116 test PASS**, `tsc`, butun `src` bo'yicha `eslint` va
`vite build` toza.

**Production (2026-09-22):** commit `a406d85`; faqat `bum-web` (deployment `4c8e416d`),
bundle `index-BaVPqLfZ.js` → **`index-CyXr6YGd.js`** (yangi sarlavha matnlari bundle ichida topildi).
API kodi o'zgarmagan.

## Chiqarilgan xodimning telefoni qayta ishlatiladi (2026-09-22)

Egasining bildirgani: foydalanuvchini o'chirdim, ro'yxatdan yo'qoldi, lekin xodimni qaytadan qo'shmoqchi
bo'lsam "bu nomer bor" deydi.

Sabab: chiqarishda hisobning O'ZI (`users`) ataylab saqlanadi — nomi hujjatlar va auditda kerak; telefon
esa global unikal, shuning uchun raqam band bo'lib qolardi.

**Yechim** (`insertUser`): telefon egasi HECH BIR kompaniyada a'zo bo'lmasa (chiqarilgan hisob), yangi
yozuv ochilmaydi — o'sha hisob TIKLANADI: yangi parol, yangi ism, yangi a'zolik va rol; eski PIN
o'chiriladi, hisob faollashadi. Hisob id'si o'zgarmagani uchun eski hujjatlardagi nomi joyida qoladi.
Platforma admini va boshqa kompaniyada a'zo bo'lgan raqam qayta ishlatilmaydi — avvalgidek `409`.
O'zgarish barcha yo'llarga tegishli: Sozlamalar → Foydalanuvchi qo'shish va Kadrlar → Xodim qo'shish.

**Testlar:** `company.test.ts` — chiqarilgandan keyin o'sha telefon bilan xodim qaytadan qo'shiladi
(o'sha hisob id'si, yangi parol bilan kirish ishlaydi, yangi rol ruxsatlari qo'llanadi), boshqa kompaniya
a'zosining raqami esa `409` (**23/23 PASS**). Qo'shimcha: `hr`, `company-owner`, `acceptance-access`
(**15 PASS**), `auth`, `pos`, `subscription`, `bootstrap` (**62 PASS**); `tsc` va `eslint` toza.

**Production (2026-09-22):** commit `16df7a3`; faqat `bum-api` (deployment `7554dd31`) — web o'zgarmagan.
API toza ko'tarildi (`Migratsiyalar qo'llandi (27ms)`, konteyner `16cccb825393`).

### Modullarni yoqish — kim qiladi (2026-09-22 aniqlangan)

Egasining "Admin paneliga kirib bo'lmayapti" savoli bo'yicha tekshirildi (production bazasidan, faqat
o'qish): **Ezo** kompaniyasida `crm`, `manufacturing` va `pos` modullari O'CHIRILGAN; platforma admini
esa bitta — `+998999635353` (Bootstrap Admin, faol).

Loyiha qoidasi: modulni kompaniyaning o'zi yoqa olmaydi (`modules-section.tsx` da `canManage = false`,
o'chirilgan modul ro'yxatda ham ko'rsatilmaydi) — bu platforma administratori qarori. Shuning uchun CRM ni
yoqish yo'li: `app.bum-erp.uz/uz/admin` → platforma admini sifatida kirish → Kompaniyalar → Ezo →
Modullar → CRM. Mijozlar ro'yxati CRM ga ko'chirilgani uchun bu qadam **hozir zarur**.

Ochiq taklif (bajarilmagan): kompaniya egasiga o'z tarifidagi modullarni yoqish huquqini berish — egasi
xohlasa alohida ish sifatida qilinadi.

## Admin panel: `/uz/admin` oq ekran tuzatildi (2026-09-22)

Egasi `app.bum-erp.uz/uz/admin` ni ochganda OQ EKRAN chiqdi (ekran surati). Sabab `AdminDashboardGuarded`
da: kirilmagan foydalanuvchi `/{lng}/admin` ga yo'naltirilardi — ya'ni O'ZIGA O'ZIGA; React Router cheksiz
aylanib hech narsa chizmasdi. Kompaniya egasi (platforma admini emas) esa "Kirish taqiqlangan" ekranida
qolib ketardi — admin hisobiga o'tish tugmasi yo'q edi.

**Yechim:** ikkala holatda ham shu yerning o'zida `AdminLoginPage` ko'rsatiladi (admin subdomenidagi
bilan bir xil): kirilmagan bo'lsa kirish formasi, kirgan bo'lsa "Kirish taqiqlangan" va
"Boshqa akkaunt bilan kiring" tugmasi. Ishlatilmay qolgan `AccessDenied` olib tashlandi.

**Test:** yangi `src/pages/admin/page.test.tsx` — kirilmagan holatda kirish formasi chiziladi (oq ekran
emas), admin bo'lmagan hisob esa boshqa akkauntga o'tish tugmasini ko'radi. Frontend to'plami:
**28 fayl / 118 test PASS**, `tsc` va `eslint` toza.

**Production (2026-09-22):** commit (admin tuzatish) `bum-web` (deployment `633426b4`),
bundle `index-CyXr6YGd.js` → **`index-DJa857Ky.js`**; `https://app.bum-erp.uz/uz/admin` → 200 va bundle
ichida kirish formasi matni bor, eski "Bu sahifa faqat platforma adminlari uchun" matni yo'q.

Endi CRM modulini yoqish yo'li ochiq: `/uz/admin` → platforma admini (`+998999635353`) bilan kirish →
Kompaniyalar → Ezo → Modullar → CRM.

## Distributsiya ko'rsatkichi: "Faol marshrutlar" → "Marshrutlar" (2026-09-22)

Egasining savoli: "Faol marshrutlar 26 / 1318 ta do'kon deb turibdi — hali savdo boshlanmagan-ku?"

Productiondan tekshirildi (faqat o'qish, Ezo kompaniyasi): **26 ta marshrut** bor va hammasi yoqilgan
(`is_active`), ularga **1318 ta do'kon** biriktirilgan — `route_customers` da 1318 qator va 1318 TAKRORSIZ
mijoz, ya'ni son ikki marta sanalmayapti (kompaniyada jami 1322 mijoz, 1319 tasi faol). Tashriflar
jadvalida esa **0 ta** yozuv. Ya'ni raqam to'g'ri: u marshrut YOQILGANINI bildiradi, savdo yoki tashrif
boshlanganini emas.

Chalkashlik faqat so'zda edi — yorliqlar tuzatildi:
- uz: "Faol marshrutlar" → **"Marshrutlar"**, "{{count}} ta do'kon" → "{{count}} ta do'kon biriktirilgan"
- ru: "Активные маршруты" → "Маршруты", "Привязано магазинов: {{count}}"
- kk: "Белсенді бағыттар" → "Бағыттар", "Бекітілген дүкендер: {{count}}"

Kodda ham izoh qo'yildi: ko'rsatkich `/routes` (faolsizlantirilganlari qaytmaydi) bo'yicha hisoblanadi,
tashrif va tashrif savdosi esa alohida kartochkalarda.

**Tekshirilgani:** frontend **28 fayl / 118 test PASS**, `tsc` va `eslint` toza.
**Production (2026-09-22):** commit `bda8941`; faqat `bum-web` (deployment `e173a832`), bundle
`index-DJa857Ky.js` → **`index-Dt2XeHtK.js`** — eski "Faol marshrutlar" matni bundle ichida yo'q.

## Biznes manzili sahifasida namuna "bum" (2026-09-22)

`app.bum-erp.uz` ochilganda "Biznes manzili" so'raladi va namuna sifatida `bonnu-market` — bitta
mijoz biznesining nomi — ko'rsatilardi. Egasining so'rovi bo'yicha namuna **`bum`** ga o'zgartirildi
(izoh matnida ham, maydon placeholder'ida ham). Faqat ko'rinish: manzilni tekshirish va yo'naltirish
mantig'i o'zgarmagan.

**Tekshirilgani:** frontend **28 fayl / 118 test PASS**, `tsc` va `eslint` toza.
**Production (2026-09-22):** commit `62507ef`; faqat `bum-web` (deployment `cba8ee97`), bundle
`index-Dt2XeHtK.js` → **`index-a8jxZSdv.js`**; bundle ichida `placeholder:`bum`` va izohdagi `bum`
tasdiqlandi (`railway up` ikki marta "operation timed out" berdi, uchinchi urinishda o'tdi).

## Hudud va kun: haftalik jadval (2026-09-22)

Egasining so'rovi: agentni belgilagandan keyin hafta kunlarini ham belgilash kerak — agent o'z dasturiga
kirganda o'sha kunning marshrutlari chiqsin.

Server tomoni ALLAQACHON shunga mo'ljallangan edi (`routesForAgent`): shu sanaga biriktirish bo'lsa u
ustun, bo'lmasa agentning o'z marshrutlari **hafta kuni** bo'yicha olinadi (`distribution_routes.days` +
`sales_rep_id`). Yetishmagani — UI: "Hudud va kun" da faqat aniq sanaga biriktirish bor edi, haftalik
jadvalni esa marshrutni tahrirlab qo'yish kerak edi.

**Web (Distributsiya → Hudud va kun)** ikki qismga bo'lindi:
- **"Haftalik jadval (doimiy)"** — marshrut + agent + hafta kunlari (Du…Ya tugmalari). Saqlanganda
  marshrutning o'ziga yoziladi (`PATCH /api/distribution/routes/:routeId` — `salesRepId`, `days`), ya'ni
  yangi jadval ham, migratsiya ham kerak emas. Pastda **joriy jadval ro'yxati**: har marshrutda agent va
  belgilangan kunlar; qator bosilsa forma o'sha marshrut bilan to'ladi (tahrirlash).
- **"Kunlik o'zgartirish (bir martalik)"** — avvalgi sanaga biriktirish; shu kun uchun jadvaldan ustun
  turadi (almashinuv, bemorlik), keyingi haftaga ta'sir qilmaydi. Bo'sh holat matni ham shunga moslandi.

**Test:** `sales-agent-stores.test.ts` — boshqa kun belgilangan marshrut agentning "Bugungi marshrut"
ro'yxatida chiqmaydi; bugungi kun va agent belgilangach marshrut va uning do'konlari chiqadi; agent
almashtirilsa marshrut yangisiga o'tadi (**3/3 PASS**). Qo'shimcha: `distribution`,
`sales-agent-boundaries` (**11 PASS**), frontend **28 fayl / 118 test PASS**; `tsc` va `eslint` toza.

**Production (2026-09-22):** commit `60111e8`; faqat `bum-web` (deployment `c3234a2f`) — API kodi
o'zgarmagan (faqat test qo'shildi). Bundle `index-a8jxZSdv.js` → **`index-BvUcLGGU.js`**; ikkala yangi
sarlavha bundle ichida tasdiqlandi.

## Real biznes qabul testi: mini market va supermarket (2026-09-22)

Egasining topshirig'i bo'yicha ikki biznes ketma-ket uchidan-uchigacha sinovdan o'tkazildi.
**Production bazasiga tegilmadi**: test lokal `bumerp_test` bazasida, ikkita alohida test tenantida
bajarildi (`TEST-01-MINIMARKET`, `TEST-02-SUPERMARKET`) — yangi
`apps/api/test/acceptance-real-world.test.ts` (**35 ta test, hammasi PASS**).

Har qadam API javobi BILAN BIRGA baza holatiga qarab tekshiriladi: ombor qoldig'i va harakatlari,
mijoz/ta'minotchi qarzi, kassa qoldig'i, buxgalteriya jurnali (umumiy debet = kredit va HAR BIR yozuv
ichida ham), audit yozuvlari.

**Qamrov (ikkala biznesda):** tenant va rollar (ega / menejer / kassir, ruxsatsiz endpointlar 403);
mahsulot, kategoriya, shtrix-kod, qidiruv, faolsizlantirish; xarid (hujjat → tasdiq → qabul),
ta'minotchi qarzi va to'lovi; kassa cheklari (naqd, aralash naqd+karta, nasiya, mijozli, anonim) va
kassa chekiga yetkazma YARATILMASLIGI; mijoz qarzi (to'liq / qisman / to'lanmagan va qarzni yopish);
qaytarish (qoldiq va qarz qayta hisoblanishi, takroriy qaytarish rad etilishi); narx tavsiyalari
(narxni o'zgartirmaydi) va tannarx (AVCO, oxirgi xarid, marja; kassirga 403); xarajatlar
(pending → approved → paid) va kassa qoldig'i; hisobotlar (sotuv, xarid, xarajat, to'lovlar — API
summalari baza bilan AYNAN teng); aylanma balans va foyda-zarar.

**Chegaralar va invariantlar (salbiy ssenariylar):** qoldiqsiz yoki ortiqcha sotuv rad etiladi va
qoldiq o'zgarmaydi; kredit limitidan oshiq nasiya rad etiladi va qarz yozilmaydi; kassir chekda narxni
o'zgartira olmaydi (ega — oladi); bir xil qabulni ikki marta yozib bo'lmaydi; tasdiqlangan buyurtma
zaxirani band qiladi, jo'natishda bo'shaydi (`reserved_qty <= quantity`, qoldiq manfiy emas).

**Idempotentlik:** bir xil `clientRequestId` bilan kassa cheki **409** (`duplicate: true` va o'sha
hujjat id'si) — ikkinchi chek va ikkinchi ombor harakati yo'q; bir xil `reference` bilan mijoz to'lovi
**200** — qarz ikki marta kamaymaydi.

**Cross-tenant:** begona ID bo'yicha o'qish/tahrir — 404; ro'yxatlarda begona yozuv yo'q; tanadagi
`companyId` — 400 (strict sxema); begona mahsulotni sotish va begona mijozga to'lov rad etiladi;
audit va jurnal satrlari tenantlar orasida aralashmaydi (`journal_lines` hech qachon begona hisobga
bog'lanmagan).

**Natija:** MINI MARKET — **ACCEPTED** (15/15), SUPERMARKET — **ACCEPTED** (12/12 + umumiy chegaralar),
cross-tenant — **PASS** (3/3), chegaralar — **PASS** (5/5). Mahsulot kodida XATO TOPILMADI: dastlabki
8 ta muvaffaqiyatsizlik testning o'zidagi noto'g'ri API shakllari edi (xarid qatori `unitId`+`orderedQty`,
xarajat `pending → approved → paid`, kassa idempotentligi 409, hisobot maydon nomlari, kassaga
boshlang'ich mablag' kerakligi) — ular tuzatilib qayta ishlatildi.

**Regressiya:** `acceptance-business-scenarios` + `acceptance-cross-module` + `acceptance-payments`
(**35 PASS**), `acceptance-rbac` + `acceptance-access` + `acceptance-import-export` + `company`
(**47 PASS**), `sales` + `pos` + `purchase` + `inventory` (**21 PASS**), `finance` +
`inventory-journal` + `distribution` + `csv-import-export` (**22 PASS**). `tsc` va `eslint` toza.

**Commit:** `3bcce20` (faqat test qo'shildi — mahsulot xatti-harakati o'zgarmagan, deploy kerak emas).

### Android
- loyiha: `apps/mobile` (Capacitor 8.4.3, `uz.bumerp.app`), production web manzilini ochadi
- ikonka va splash: BUM logotipi (adaptive ikonka kesilmaydi)
- ruxsatlar: joylashuv, fondagi GPS xizmati (`FOREGROUND_SERVICE_LOCATION`), bildirishnoma, kamera; `ACCESS_BACKGROUND_LOCATION` va `SCHEDULE_EXACT_ALARM` yo'q
- APK: debug 5.1 MB (debug imzo) va release 3.9 MB (imzosiz) — **qurildi**; release imzosi — **tayyor emas** (kalit yo'q)
- real qurilmada test — **qilinmagan**

## Real biznes qabul testi: ulgurji va distributor (2026-09-22)

Egasining ikkinchi topshirig'i bo'yicha yana ikki biznes uchidan-uchigacha sinovdan o'tkazildi.
**Production bazasiga tegilmadi**: lokal `bumerp_test` bazasida, ikki alohida test tenantida
(`TEST-03-WHOLESALE`, `TEST-04-DISTRIBUTOR`) — yangi `apps/api/test/acceptance-wholesale.test.ts`
(**19 faza, hammasi PASS**) va `apps/api/test/acceptance-distributor.test.ts` (**19 faza, hammasi PASS**).

### BUSINESS 03 — ULGURJI SAVDO (`TEST-03-WHOLESALE`)
Zanjir: ta'minotchi → ombor → ulgurji mijoz → kredit → to'lov → qarz → buxgalteriya → hisobot.
Qamrov: 5 rol va ruxsat chegaralari; 3 ta'minotchi, 5 kredit limitli mijoz, 50 mahsulot va birlik
konversiyasi; katta xaridlar; **AVCO** uch xil narxdan o'rtacha (tavsiya narxni o'zgartirmaydi);
besh B2B buyurtma (tasdiq → zaxira → jo'natish); 1000+ donalik buyurtma; kredit limitidan oshiq
buyurtma rad etiladi; qisman to'lov va bir xil `reference` bilan takroriy to'lov **200** (qarz ikki
marta kamaymaydi); aralash naqd+bank to'lov; mijoz qaytarishi (takror qaytarish yo'q); ta'minotchiga
qisman va aralash to'lov; besh xarajat moddasi; omborlararo o'tkazma (jami qoldiq o'zgarmaydi);
inventar nazorati — qo'lda ERP buyurtmasi `best_effort` (yo'q tovar **oldindan buyurtma**, zaxira
band qilinmaydi, jo'natish to'xtaydi, bekor qilish zaxirani bo'shatadi); jurnal, aylanma balans va
kassa qoldig'i solishtirildi; hisobot summalari baza bilan AYNAN teng; kun yakuni.

### BUSINESS 04 — DISTRIBUTOR (`TEST-04-DISTRIBUTOR`)
Zanjir: ta'minotchi → ombor → savdo agenti → hudud → marshrut → mijoz → **tashrif** → buyurtma →
ombor jo'natishi → yetkazuvchi → yetkazish → to'lov → qarz → buxgalteriya → hisobot.
Qamrov: 6 rol; 50 mahsulot (dona/blok konversiyasi); 3 ta'minotchi; hudud ma'lumotnomasi
(Xorazm viloyati → Urganch/Xiva/Xonqa/Shovot); 5 marshrut, 2 agent va hafta kuni; 20 mijoz +
CSV import + tezkor qo'shish (hududi ko'rsatilgan import mijozi o'sha hudud marshrutiga tushadi);
agent ish joyi izolyatsiyasi (o'z marshrutlari va do'konlari, purchase/finance/tannarx — 403).

**To'liq tashrif oqimi standart siyosat bilan tekshirildi** (hech narsa o'chirilmadi): ish sessiyasi
boshlanmasa tashrif yo'q (`work_session_required`); geofence tashqarisida tashrif yo'q (403);
begona agentning do'koni — 404; buyurtma yuborishda ketma-ket **vitrina rasmi → polka rasmi →
do'konda minimal 10 daqiqa** talab qilinadi; buyurtma yuborilgach tashrif `completed/ordered` bilan
avtomatik yopiladi. Buyurtmasiz tashrif sabab bilan yopiladi va hisobotga tushadi.

Yetkazish: READY → ASSIGNED → ACCEPTED → OUT → ARRIVED → DELIVERED to'liq o'tildi; yetkazuvchi
ish sessiyasini boshlamasa yo'lga chiqa olmaydi (`work_session_required`); yetkazilmagan buyurtma
**FAILED** — qoldiq va qarz o'zgarmaydi; **qisman yetkazish** (70/100) va qolgani uchun qayta
yetkazma. SOTUV ≠ YETKAZISH ≠ TO'LOV har bosqichda tasdiqlandi.

**Natija:** BUSINESS 03 — **ACCEPTED** (19/19), BUSINESS 04 — **ACCEPTED** (19/19).
`reserved_qty <= quantity`, `quantity >= 0` va jurnalda debet = kredit (umumiy va HAR BIR yozuv
ichida) har fazadan keyin tekshirildi. **Mahsulot kodida XATO TOPILMADI** — barcha dastlabki
muvaffaqiyatsizliklar testning o'zidagi noto'g'ri API shakllari yoki noto'g'ri kutilgan qiymatlar
edi (agent/kuryer ish sessiyasi, tashrif rasmlari va minimal vaqt, nasiya buyurtmasida to'lov
muddati, `delivering` amali joysiz, import mijozining marshruti).

Regressiya: `acceptance-real-world` (35), `acceptance-wholesale` (19), `acceptance-distributor` (19),
`sales-agent-*` (visit-flow, orders, visits, work-session, stores, reports, security),
`delivery-*` (flow, security, redelivery, tracking), `distribution`, `territories`,
`distribution-customer-import`, `sales-payments` — **hammasi PASS**; `tsc` va `eslint` toza.

## GO-LIVE kritik bo'shliqlar 1–6 yopildi (2026-09-22)

Real biznes GAP AUDIT natijasida "go-live oldidan muhim" deb topilgan 6 ta bo'shliq tuzatildi.
**Yangi parallel arxitektura yaratilmadi** — hammasi mavjud manba va oqimlar ustiga qo'shildi.
Migratsiya `0077_credit_hold_customer_prices` — faqat QO'SHADI (ustun, jadval, indeks), hech narsa
o'chirilmaydi va mavjud yozuvlar standart qiymat bilan avvalgidek ishlaydi.

### 1. Agent KPI — bitta manba
Muammo: rahbar paneli (`GET /api/distribution/sales-reps/stats`) tashriflarni `route_visits` dan
sanardi, agent ilovasi esa `agent_visits` ga yozadi → panelda tashriflar **doim 0** edi.

Yechim: maydon KPI si `agent_visits` + `agent_orders` dan olinadi (agent hisoboti bilan AYNAN bir
xil qoida). `route_visits` **saqlanadi** — u marshrut-kun jurnali, boshqa granularlik va qo'lda
kiritiladi; endi u KPI ni shishirmaydi. Yangi maydonlar: `orderedVisitsThisMonth`,
`noOrderVisitsThisMonth`, `ordersThisMonth`. Migratsiya kerak emas, tarix yo'qolmadi.

### 2. Qarz yoshi va to'lov taqsimoti
Muammo: mijoz darajasidagi to'lov (buyurtmasiz) faqat `customers.total_debt` ni kamaytirardi,
hujjatlarning `paid_amount` i o'zgarmasdi → qarz yoshi va "muddati o'tgan" ogohlantirishi yolg'on
chiqardi. ERP tomonida yosh guruhlari umuman yo'q edi.

Yechim — yangi `sales/receivables.service.ts`:
- `allocateCustomerPayment` — to'lov ochiq hujjatlarga **eng eski muddatdan** taqsimlanadi
  (deterministik: muddat → hujjat sanasi → id). Naqd to'lov va balansdan to'lash bir xil yo'ldan
  o'tadi; jurnal va to'lov hujjati O'ZGARMAYDI (taqsimot faqat `paid_amount` yozadi).
- `GET /api/sales/receivables/aging` (`sales.view`) — `current / 0–30 / 31–60 / 61–90 / 90+`,
  mijoz va hujjat kesimida, jami bilan.
- **Qaytarish tuzatildi:** qarz endi hujjatning SOF summasidan hisoblanadi
  (`total_amount − qaytarilgan − paid_amount`). Qisman qaytarishda `total_amount` o'zgarmaydi,
  shuning uchun eski hisob qarzni oshirib ko'rsatardi. Bir xil ta'rif `salesStats` va muddat
  bildirishnomasiga ham qo'llandi.
- Invariant: `customers.total_debt` = ochiq hujjatlar qoldig'i = qarz yoshi jami.
- UI: Sotuv → **"Qarz yoshi"** tabi (mijozlar va hujjatlar kesimi, guruhga bosib filtrlash).

### 3. Nasiya to'xtatish (credit hold)
Muammo: muddati o'tgan qarzi bor mijozga nasiyani to'xtatishning yagona yo'li mijozni butunlay
faolsizlantirish edi (u holda naqd sotuv ham, qarz to'lash ham bloklanardi).

Yechim — `sales/credit.service.ts`, bitta server qoidasi ERP, kassa va agent uchun:
- `customers.credit_status` (`ok | hold`) + sabab, vaqt va kim qo'ygani (migratsiya 0077);
- siyosat chegaralari `sales.policy` da: `creditHoldOverdueDays`, `creditHoldOverdueAmount`
  (standart `null` — o'chiq, mavjud xatti-harakat o'zgarmaydi). Kodda "sehrli raqam" yo'q.
- **Faqat qarz qoldiradigan sotuv to'xtaydi**: naqd sotuv va mijozning qarzni to'lashi hech qachon
  bloklanmaydi;
- siyosat to'xtatishi HOSILAVIY (bazaga yozilmaydi): mijoz to'lagach o'zi ochiladi, qo'lda
  to'xtatishni esa faqat rahbar ochadi;
- `POST /api/sales/customers/:id/credit` (`sales.approve`, sabab majburiy) — audit
  `CUSTOMER_CREDIT_HOLD` / `CUSTOMER_CREDIT_RELEASE`; `GET .../credit` — joriy qaror va sabab.
- UI: CRM → Mijozlar da qalqon tugmasi, "Nasiya to'xtatilgan" nishoni va sabab dialogi.

### 4–5. Mijoz × mahsulot kelishilgan narxi va kanallar birligi
Muammo: ulgurjida narx har mijoz bilan alohida kelishiladi, lekin faqat `discount_percent` bor edi —
qolgani har qatorga qo'lda narx (ya'ni `sales.edit` hammaga kerak). Miqdorga bog'liq aksiya esa
faqat agent kanalida ishlardi.

Yechim: yangi `customer_prices` jadvali (mijoz × mahsulot × **birlik**, amal muddati, tarix bilan)
va narx hal qilish MAVJUD markazga — `prepareSalesItems` ga qo'shildi. ERP, kassa va agent
allaqachon shu funksiyadan o'tgani uchun uchala kanal avtomatik bir xil narx beradi.
- Ustuvorlik: qo'lda narx → kelishilgan narx → aksiya narxi → prays-list. Miqdor aksiyasi
  kelishilgan narx USTIGA chegirma bo'lib tushadi (narxni emas, chegirmani o'zgartiradi).
- Narx asosiy valyutada, kurs bilan qayta hisoblanmaydi; prays-list va boshqa mijozlar tegilmaydi.
- Tarix: yangi narx eskisini `effective_to` bilan yopadi, o'chirmaydi.
- `GET/POST /api/sales/customer-prices`, `DELETE /api/sales/customer-prices/:id` (`sales.edit`).
- Agent katalogi `?customerId=` bilan kelishilgan narxni ko'rsatadi (do'kon agent marshrutida
  bo'lishi tekshiriladi); frontend narx hisoblamaydi.

### 6. Backorder reyestri
Muammo: `best_effort` band qilish oldindan buyurtma yaratardi, lekin "kimga qancha yetmayapti"
ro'yxati yo'q edi va tovar kelganda hech narsa avtomatik band qilinmasdi.

Yechim — `inventory/backorders.service.ts`, **yangi jadvalsiz** (`sales_order_items` dan hosila):
- `GET /api/inventory/backorders` (`warehouse.view`) — mijoz/mahsulot/ombor/holat/sana filtri,
  `ordered / reserved / remaining`, holat `open | partially_allocated`, va yo'ldagi tasdiqlangan
  xarid qoldig'i (soxta ETA yo'q — faqat haqiqiy hujjat);
- tovar kelganda (xarid qabuli va qo'lda kirim) ochiq backorderlar **eng eski buyurtmadan**
  boshlab avtomatik band qilinadi; `POST /api/inventory/backorders/allocate` — qo'lda qayta urinish
  (`warehouse.receive`);
- invariantlar saqlanadi: `reserved_qty <= quantity` baza sharti bilan, qoldiq qatori `for update`
  bilan qulflanadi, omborlar va tenantlar aralashmaydi.
- UI: Ombor → **"Kutilayotgan"** tabi.

### Testlar
Yangi: `agent-kpi-reconciliation` (6), `receivables-aging` (8), `credit-hold` (7),
`customer-pricing` (9), `backorders` (9) — **39 ta yangi test**.
Qayta ishlatildi: `acceptance-wholesale` (19/19) va `acceptance-distributor` (19/19) — yangi
narx, qarz, kredit va backorder mantiqi bilan ham to'liq PASS.

## Qisman qaytarish, A4 nakladnoylar va import auditi (2026-09-22)

Egasining uchta aniq topshirig'i. Yangi tizim yaratilmadi — uchalasi ham MAVJUD oqimlar ustiga.
Migratsiya kerak bo'lmadi.

### 1. Nakladnoydan qisman qaytarish
Muammo: dostavchi 5 tadan 2 tasini olib kelsa ham, UI'da faqat "Buyurtmani qaytarish" tugmasi bor
edi va u BUTUN hujjatni qaytarardi. Qatorlar bo'yicha qaytarish API'si
(`POST /api/sales/orders/:id/return-items`) allaqachon bor edi, lekin unga oyna yo'q edi.

Qilingani:
- Nakladnoy detalida jadval: **Mahsulot · Berilgan · Qaytarilgan · Qolgan · Qaytarish miqdori**;
  "Hammasini tanlash" tugmasi, qolganidan ko'p kiritilsa qator qizil va tugma yopiq; tanlanган
  qatorlar summasi tugmada ko'rinadi.
- Mahsulot ro'yxatida "qaytarilgan N · qolgan M" ko'rsatiladi.
- **Qaytarish tarixi** bo'limi: hujjat raqami, sana, KIM qabul qilgani, sabab va qaysi mahsulotdan
  qancha qaytgani. Buning uchun `GET /api/sales/orders/:id` javobi boyitildi (`returns[].createdByName`
  va `returns[].items`) — yangi endpoint qo'shilmadi.
- Server qoidalari avvaldan to'g'ri ekani tasdiqlandi: 0/manfiy rad, qolganidan ko'p rad, takroriy
  qator rad, begona hujjat qatori rad, faqat yakunlangan sotuvdan qaytariladi, zaxira va qarz aynan
  qaytgan qism uchun qayta hisoblanadi, birlik — qator birligi (blok qaytarilsa omborga dona tushadi).

### 2. Barcha nakladnoylar A4 standartiga
Muammo (50+ qatorli hujjatda): kompaniya sarlavhasi faqat 1-sahifada chizilardi, jadval qatorlari
footer tasmasi ustiga tushardi, jami qutisi va imzo joyi esa sahifa chetidan tashqariga chiqib
umuman ko'rinmasdi.

Qilingani — `src/lib/pdf/pdf-utils.ts` da umumiy A4 qatlami:
- `A4` o'lchovlari va `contentBottom()`;
- `tableOptions()` — har sahifada jadval sarlavhasi (`showHead: everyPage`), qator ikkiga
  bo'linmaydi (`rowPageBreak: avoid`), `margin.top` sarlavha uchun, `margin.bottom` footer uchun,
  `didDrawPage` har yangi sahifada kompaniya sarlavhasini qayta chizadi;
- `ensureSpace()`, `drawTotalsBox()`, `drawSignatures()`, `drawNotes()` — blok sig'masa yangi
  sahifaga o'tadi, shuning uchun jami va imzo HAR DOIM to'liq ko'rinadi;
- Sotuv nakladnoyi (`invoice-pdf.ts`) va xarid buyurtmasi (`purchase-order-pdf.ts`) shu qatlamga
  o'tkazildi; maosh varaqasida footer himoyasi qo'shildi. Kassa cheki (80 mm) va etiketka
  (A4 varaq / rulon) o'z formatida qoldi — ular nakladnoy emas.
- Hujjatda yo'q maydon ko'rsatilmaydi (chegirma 0 bo'lsa "Chegirma" qatori chiqmaydi).

### 3. Mahsulot va xarid importi auditi
**Eng xavfli xato topildi va tuzatildi** — `cleanNumber` (6 ta import shu funksiyadan foydalanadi):
`"10,500"` → `10.5` va `"10.000"` → `10` bo'lib ketardi, ya'ni narx 1000 barobar buzilardi.
Yangi qoida aniq va takrorlanadigan: ikkala ajratgich bo'lsa oxirgisi kasr; bitta ajratgich bir
necha marta — mingliklar; bitta ajratgich ortidan aynan 3 raqam — mingliklar, aks holda kasr.
Yaroqsiz qiymat (`abc`, `NaN`, `Infinity`, `--5`) endi jim 0 bo'lmaydi — sxema uni rad etadi.

**Dona / blok / pachka:** mahsulot importiga `purchaseUnit`, `saleUnit`, `unitsPerPackage`
ustunlari qo'shildi. Qadoq birligi ko'rsatilib, nechtaligi ko'rsatilmasa — XATO (ilgari 10 blok
10 dona bo'lib tushib ketishi mumkin edi). Import `unit_conversions` yozuvini o'zi yaratadi.

**Preview boyitildi:** har qator uchun faylda yozilgani va tizim tushungani yonma-yon, hamda
bitta asosiy birlikka tushadigan tannarx (`unitCost`). Noaniq format foydalanuvchidan yashirilmaydi.
Holat: `new / duplicate / error` — xato va dublikat qatorlari sababi bilan ko'rinadi.

**Zanjir tasdiqlandi** (`import-units-prices.test.ts`): 1 blok = 6 dona, 10 blok × 60 000 →
**60 dona qoldiq**, **10 000/dona tannarx**; 1 dona × 12 000 sotuvda marja 2 000; 1 blok sotuvda
6 dona chiqadi, tannarx 60 000, marja 12 000. Konversiya ikki marta qo'llanmaydi (600 ham, 10 ham emas).

### Testlar
Yangi: `delivery-partial-return` (12), `import-units-prices` (18) — API;
`order-detail-drawer` (6), `a4-documents` (10) — frontend. **Jami 46 ta yangi test.**

## Do'kon rasmlari: faqat kamera (2026-09-23)

Muammo (egasi bildirdi): agent ilovasida "Vitrina rasmi", "Polka rasmi", "Joylashuv rasmi" va
"Aksiya rasmi" bosilganda kamera emas, GALEREYA ochilardi.

Sababi: kodda `<input type="file" accept="image/*" capture="environment">` ishlatilardi. `capture`
atributi — faqat MASLAHAT: Android WebView (Capacitor) uni e'tiborsiz qoldirib fayl tanlagichni
ochishi mumkin. Natijada agent do'konda turib emas, istalgan joydan eski rasmni yuborishi mumkin edi
— bu tashrif isbotining ma'nosini yo'qotadi (server rasm koordinatasini geofence bilan tekshiradi).

Yechim — yangi `src/components/camera-capture.tsx`: rasm ILOVA ICHIDA `getUserMedia` orqali olinadi.
- Galereya varianti umuman yo'q (fayl tanlagich element yaratilmaydi);
- jonli ko'rinish → tugma → kadr → ko'rib chiqish ("Qayta olish" / "Yuborish");
- kadr kanvasda 1600 px gacha kichraytirilib JPEG (0.85) qilinadi — mobil internet uchun;
- kadr olingach va oyna yopilgach kamera oqimi to'xtatiladi (qurilmada yonib qolmaydi);
- old/orqa kamerani almashtirish;
- ruxsat berilmasa yoki kamera topilmasa — ANIQ xato va "Qayta urinish"; jim galereyaga tushmaydi.

Uch joyda qo'llandi: tashrif rasmlari (`sales-agent/_components/visit-panel.tsx`), do'kon rasmi
(`sales-agent/_components/customer-panel.tsx`), yetkazish isboti rasmi
(`delivery-agent/tasks/task-page.tsx`). Mahsulot rasmi va chek logotipi (ERP, kompyuterdan
yuklanadi) o'zgarmadi — ular maydon isboti emas.

Native tomon tayyor edi: manifestda `CAMERA` ruxsati bor, ilova HTTPS manzilni ochadi (xavfsiz
kontekst), Capacitor WebView `RESOURCE_VIDEO_CAPTURE` so'rovini o'zi hal qiladi — yangi plagin
qo'shilmadi, APK qayta qurish shart emas (web deploy yetarli).

Test: `src/components/camera-capture.test.tsx` (6) — kamera orqa kamera bilan so'raladi, fayl
tanlagich umuman yo'q, kadr olinadi va tasdiqlangach yuboriladi, qayta olish, ruxsat rad etilganda
xato, yopilganda oqim to'xtaydi.

## Android: orqaga tugmasi ilovadan chiqarib yuborardi (2026-09-23)

Muammo (egasi bildirdi): telefondagi ilovada apparat "orqaga" tugmasi BARCHA sahifalarda ilovadan
chiqarib yuborardi — oldingi sahifaga qaytish o'rniga.

**Ildiz sabab:** `@capacitor/app` plagini 2026-09-17 da (`7721228`) qo'shilgan va web tomondagi
`listenAndroidBack` o'shanda yozilgan, lekin **`npx cap sync android` ishlatilmagan** — shuning uchun
plagin native loyihaga tushmagan. Telefondagi APK (2026-09-15) ichidagi `capacitor.plugins.json`
da faqat `background-geolocation` va `local-notifications` bor edi.

Aynan shu plagin `OnBackPressedCallback` ni ro'yxatdan o'tkazadi va tugmani JS'ga uzatadi. U
bo'lmagach Android standart yo'ldan bordi: Activity yopiladi → ilovadan chiqish. Web tomondagi kod
to'g'ri edi, lekin `hasNativePlugin("App")` to'g'ri `false` qaytargani uchun hech narsa qilmasdi.

**Tuzatildi:**
- `npx cap sync android` — `capacitor.settings.gradle` va `capacitor.build.gradle` ga `capacitor-app`
  qo'shildi (shu ikki fayl commitda). Endi `cap sync` natijasi repoda.
- Debug APK qayta qurildi (JDK 21 + SDK 36, `gradlew assembleDebug`): **5.1 MB**, ichidagi
  `capacitor.plugins.json` da endi uchala plagin bor (`@capacitor/app` qo'shildi).
- `back-button.ts`: qaytish qarori endi FAQAT `canGoBack` (WebView ro'yxati) bo'yicha. Ilgari
  `|| window.history.length > 1` bor edi — u sessiya davomida faqat o'sadi, shuning uchun qaytadigan
  joy qolmaganda ham "bor" deb ko'rsatardi: `history.back()` hech narsa qilmasdi va foydalanuvchiga
  chiqish ham taklif qilinmasdi.
- Ochiq oyna aniqlash `[role="dialog"][aria-modal="true"]` ni ham qamraydi, kamera oynasi esa
  Escape'da yopiladi — orqaga tugmasi endi avval kamerani yopadi, sahifani almashtirmaydi.

**MUHIM:** bu tuzatish web deploy bilan telefonlarga YETMAYDI — plagin APK ichida bo'lishi shart.
Egasi yangi debug APK'ni telefonlarga o'rnatishi kerak:
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Qurish uchun (JDK 21 kerak, mashinadagi 17 va 25 yaramaydi — Capacitor `source release 21` talab
qiladi, Gradle 8.14 esa 25 ni o'qiy olmaydi): `apps/mobile` → `pnpm apk:debug` (JAVA_HOME = JDK 21,
ANDROID_HOME = Android SDK).

Test: `back-button.test.ts` ikkita yangi holat bilan (kamera oynasi avval yopiladi; qaytadigan joy
qolmaganda tarixga tegilmay chiqish taklif qilinadi).

## Foydani faqat ega ko'radi (2026-09-23)

Egasining qarori: sof foyda, yalpi foyda, marja va tovar tannarxi (COGS) xodimlarga ko'rinmasligi
kerak. Ilgari "Analitika → BI Ko'rsatkichlar" dagi **"Sof foyda"** kartochkasini `analytics.view`
bor har bir rol ko'rardi — buxgalter, savdo, xarid, ombor, HR, ishlab chiqarish menejeri,
supervayzer, auditor va ko'ruvchi.

**Yangi ruxsat `analytics.view_profit`** (guruh "Analitika"):
- hech bir tayyor rolda YO'Q — faqat `Business Owner` va `Superadmin` (to'liq huquqli) ko'radi;
- **`Direktor` dan ham ataylab olib tashlangan**: u roli `ALL_PERMISSIONS` dan quriladi, shuning
  uchun yangi ruxsat unga avtomatik tushib ketardi (`roles.manage` va `company.manage` kabi
  istisnolar qatoriga qo'shildi);
- `VIEW_ONLY` ga tushmaydi (`.view` bilan tugamaydi), shuning uchun Auditor va Ko'ruvchi ham olmaydi;
- ega xohlasa rollar sozlamasidan istalgan rolga beradi (bitta belgi).

**Nima yashiriladi (server tomonda `null`, UI'da kartochka umuman chiqmaydi):**
| Joy | Yashiriladi | Ochiq qoladi |
|---|---|---|
| `GET /api/analytics/reports/overview` | `cogs`, `grossProfit`, `netProfit`, `grossMargin` | daromad, xarajat, ombor qiymati, mijoz/xodim soni |
| `GET /api/analytics/dashboard` | `cogs`, `grossProfit` | kassa, bank, qarzlar (`finance.view` bilan) |
| `GET /api/finance/reports/profit-loss` | butun hisobot — **403** | aylanma balans (`trial-balance`) ochiq |
| `GET /api/pos-device/.../analytics` | `cogs`, `grossProfit`, `margin` | aylanma, qaytarish, sof aylanma |
| AI yordamchi | foyda qatorlari so'rovga UMUMAN qo'shilmaydi | qolgan moliya konteksti |

Daromad va xarajat ataylab ochiq qoldirildi: ular ish uchun kerak va **ulardan foydani hisoblab
bo'lmaydi** — chunki tannarx (COGS) yashirilgan (`foyda = daromad − tannarx − xarajat`).

AI yordamchida foyda qatorlari kontekstga qo'shilmaydi va modelga "raqam aytmang, ruxsat yo'qligini
ayting" deb ko'rsatma beriladi — aks holda kartochkani yashirib, yordamchidan so'rab olish mumkin edi.

Migratsiya kerak emas (ruxsatlar kodda). Test: `profit-visibility.test.ts` (7) — ega ko'radi;
buxgalter, savdo, ombor, HR, supervayzer va direktor ko'rmaydi; bosh sahifa va foyda-zarar
tekshiriladi; ega ruxsat bergach direktorga ochilishi tasdiqlanadi.

## Import: "Faylda qator topilmadi" sababini aytadi (2026-09-23)

Egasi: «xariddan importni bossam faylda qator topilmadi deydi». Shablon fayli qayta o'qib
chiqilganda holat takrorlandi: CSV shabloni ikki qatordan iborat — sarlavha va `#` bilan
boshlanadigan NAMUNA. Import namuna qatorini tashlab yuboradi, natijada 0 qator qoladi va
bitta umumiy xabar chiqardi — sabab ko'rinmasdi. Excel `;` ajratgichli CSV ni ko'pincha bitta
ustunga ochgani uchun foydalanuvchi namuna qatorini ma'lumotdan farqlay olmasdi.

- `acceptParsed` uch holatni ajratadi: sarlavha yo'q / faqat namuna qatori bor (nima qilish
  kerakligi bilan) / ma'lumot qatori yo'q;
- Excel qo'shib yuboradigan bo'sh (`;;;;`) satrlar ma'lumot deb hisoblanmaydi;
- `papaparse` ajratgichni topa olmay hammasini bitta ustunga qo'ysa — sarlavhadagi ajratgich
  bilan QAYTA ajratiladi; Excelda noto'g'ri ochilgan CSV `.xlsx` bo'lib saqlansa ham ustunlarga
  bo'linadi;
- eski `.xls` o'qilmasa — "`.xlsx` yoki CSV qilib saqlang" deb aytiladi;
- **xarid shabloni endi Excel (`.xlsx`)**: ustunlar alohida katakda, namuna qatori kulrang/qiya.

Test: `src/components/csv/csv-toolbar.test.tsx` (3 ta yangi). Commit `53ae2a5`, production'ga
deploy qilingan (`app.bum-erp.uz` bundle'ida uchala yangi xabar tasdiqlandi).

## Tannarxni ham faqat ega ko'radi (2026-09-23)

Egasining qarori (foyda qaroridan keyin): tannarxni ham hech kim ko'rmasin. Ilgari
`products.view_cost` sakkizta tayyor rolda bor edi (Buxgalter, Moliya/Savdo/Xarid/Ombor
menejeri, Omborchi, Ishlab chiqarish menejeri, Auditor) va `Direktor` ga `ALL_PERMISSIONS`
orqali tushardi.

**Ruxsat `products.view_cost`** endi `analytics.view_profit` bilan bir xil qoidada: hech bir
tayyor rolda yo'q, faqat `Business Owner` va `Superadmin` da; `Direktor` uchun ham istisno
qilingan; ega uni rollar sozlamasidan istalgan rolga beradi.

**Audit natijasida topilgan va yopilgan teshiklar** (katalog allaqachon yopiq edi, qolganlari YO'Q edi):
| Joy | Yashiriladi | Ochiq qoladi |
|---|---|---|
| `GET /api/inventory/stock` | `avgCostPrice` | qoldiq, band, mavjud, holat |
| `GET /api/inventory/stock/stats` | `totalValue` (ombor qiymati) | mahsulot soni, kam/tugagan |
| `GET /api/inventory/stock/products/:id` | `avgCostPrice` | omborlar bo'yicha qoldiq |
| `GET /api/analytics/reports/stock` | `totalValue`, ABC pul qiymati | SKU soni, **ABC harfi** |
| `GET /api/analytics/reports/stock-velocity` | `value` | qoldiq, sotilgan, harakatlilik |
| `GET /api/sales/orders/:id` | qator `costPrice` | sotuv narxi, miqdor, chegirma |
| `GET /api/manufacturing/orders`, `/orders/stats`, `/orders/:id` | material/mehnat/jami/birlik narxi, soatlik narx | miqdor, muddat, holat, ish markazi |

Sotuv buyurtmasi qatoridagi `costPrice` eng jiddiy edi: uni `sales.view` bor har bir xodim
ko'rardi (jadval ustuni `...itemFields` bilan to'liq qaytarilardi).

Frontend: ombor jadvalidagi "O'rtacha narx"/"Qiymat" ustunlari, "Ombor qiymati" kartochkalari
(Ombor va Analitika), ishlab chiqarish narx ko'rsatkichlari va CSV eksportdagi "Qoldiq qiymati"
ustuni ruxsatsiz umuman ko'rsatilmaydi (0 emas — 0 noto'g'ri ma'lumot berardi).

Desktop kassa: offline analitikada foyda va tannarx UMUMAN cheklanmagan edi (server yo'li
2026-09-23 da yopilgan, offline yo'li esa yo'q). `hideCostAndProfit` qo'shildi va ombor
ko'rinishlaridagi eski `warehouse.manage` gate `products.view_cost` ga almashtirildi —
**yangi desktop relizida kuchga kiradi**.

**Migratsiya KERAK bo'ldi** (`0078_hide_cost_from_roles.sql`): `DEFAULT_ROLES` — faqat yangi
kompaniya uchun shablon, rollar kompaniya yaratilganda bazaga NUSXALANADI. Shuning uchun kodda
ruxsatni olib tashlash mavjud kompaniyalarga ta'sir qilmasdi. Migratsiya `roles.permissions`
massividan faqat bitta qatorni — `'products.view_cost'` — olib tashlaydi (to'liq huquqli rollardan
tashqari); boshqa hech narsa tegilmaydi va ega uni rollar sozlamasidan qaytarib bera oladi.
(`analytics.view_profit` da bu muammo yo'q edi — u YANGI ruxsat, eski rollarda umuman yo'q.)

Testlar: yangi `cost-visibility.test.ts` (7) —
ombor, analitika, sotuv va rol standartlari; `product-cost.test.ts` dagi "omborchi tannarxni
ko'radi" testi yangi qoidaga moslandi (endi ko'rmaydi, ega ruxsat bersagina ochiladi). To'liq API
to'plamida ikkita acceptance testi (`acceptance-real-world` BUSINESS 02, `acceptance-wholesale`
PHASE 3) menejer cookie'si bilan tannarx so'rardi — ular ham yangi qoidaga moslandi (AVCO hisobi
tekshiruvi saqlanib, so'rov egadan qilinadi va menejerga 403 qaytishi tasdiqlanadi).
To'liq API to'plami: 956/956; frontend: 145/145.

### Qolgan ishlar
1. Android: release imzo kaliti → imzolangan APK; real telefonda sinov (Android bo'limidagi ro'yxat)
1a. **Bootstrap admin parolini almashtirish** (egasi, Railway o'zgaruvchisi): hozirgi parol oddiy parollar qoidasiga tushadi. Tizimga kirgan holda production smoke: realtime (dostavka xaritasi) CSP ostida, kassada kassir kirishi va qaytarish
2. Kassa **0.4.6** ni (Naqd/Karta/Bank + UZCARD, HUMO va bank hisoblari bo'yicha to'lov, xavfsizlik: yangilanish tokeni faqat API'ga, chek oynasi CSP, token shifrlashsiz saqlanmaydi, Electron fuses; 0.4.1–0.4.5 o'rniga) platforma admini orqali e'lon qilish; haqiqiy kassada (printer, tarozi, terminal cheki) qo'lda sinov; sinovdan keyin asar yaxlitligi fuse'larini yoqish
3a. Yangi APK'ni telefonga o'rnatib, ish kunida Android "Batareya" bo'limida BUM ERP sarfini oldingi versiya bilan solishtirish; bonnu-market'da UZCARD/HUMO terminallarini "Uzcard"/"Humo" bank hisoblariga komissiya bilan qo'shish (egasi)
3. Production'da tizimga kirgan holda qo'lda smoke (egasi hisobi bilan): kirish, Dostavka → "Hudud bo'yicha" → biriktirish, "Kunlik marshrut", distribyutsiya xaritasi
4. Mavjud mijozlarga shahar/mahalla kiritish (avtomatik to'ldirilmaydi — `GET /customers/regions` da `city: null` bo'lib ko'rinadi); noto'g'ri kodlashda import qilingan mijozlar nomini "Mavjudlarini yangilash" bilan qayta import qilib tuzatish (egasi)
5. Apex `bum-erp.uz` ni ishlaydigan manzilga yo'naltirish; ixtiyoriy — `WEB_ORIGIN=https://app.bum-erp.uz` (o'zgaruvchi endi productionda majburiy, hozir `https://bum-erp.uz`)
6. Production'da fayl saqlash (S3), SMS (Eskiz — OTP) va AI kalitlari sozlanmagan — tegishli funksiyalar o'chiq
7. ~~Buxgalteriya: ombordagi qo'lda kirim jurnal yozuvi yaratmaydi~~ — **eskirgan, hal qilingan**: qo'lda kirim DR 1200 / CR 3000 (yoki tanlangan qarshi hisob) yozadi, `inventory-journal.test.ts` bilan tasdiqlangan (2026-09-14 audit)
8. Desktop: kod imzolash sertifikati (`CSC_LINK`, `CSC_KEY_PASSWORD`); Shtrix-M, YES POS, Rongta tarozilari uchun ishlab chiqaruvchining almashinuv protokoli hujjati
9. Obuna: to'lov shlyuzi (Payme / Click) — hozir admin qo'lda tasdiqlaydi (~~qo'shimcha litsenziya tugashi ogohlantirishi~~ — 2026-09-21 da bajarildi)
10. Dostavka: SMS OTP (provayder kerak), hudud poligonlari ma'lumotnomasi (~~qisman qoldiqni qayta yetkazish~~ — 2026-09-21 da bajarildi)
11. PR `feat/postgres-migration` → `main` — o'tish kuni kelishilgach
12. Railway'dagi eski xizmatlar (`BUM-ERP`, `logto`, logto'ning Postgres'i) hali bo'lsa — egasi o'chiradi (tasdiqsiz o'chirilmaydi)

## Inventarizatsiya, to'g'ridan-to'g'ri qabul, supervayzer zakazi va mahsulot rasmi (2026-09-23)

### Mahsulot rasmi ko'rinmasdi — sabab `apiUrl` da edi
Rasm havolasi serverdan SO'ROV QATORI bilan keladi (`/api/files/product-image/<id>/content?v=<kalit>`).
`apiUrl` esa biznes kontekstini qo'shayotganda yana `?` qo'yardi:
`...content?v=abc?bumCompany=bonnu-market`. Natijada `bumCompany` parametr bo'lmay qolardi, sessiya
cookie'si esa biznesga bog'langan (`bum_s_<biznes>`) — so'rov 401 qaytar va rasm ko'rinmasdi.

- `buildUrl` endi yo'lda `?` bo'lsa `&` bilan qo'shadi (barcha brauzer yuklaydigan manzillar uchun);
- test: `src/lib/company-context.test.ts` — ikkala parametr ham `URL` bilan o'qib tekshiriladi;
- productionda ishlatiladigan yo'l (S3'siz, rasm BAZADA) umuman test bilan qoplanmagan edi —
  `apps/api/test/files.test.ts` ga uchidan-uchiga test qo'shildi (yuklash → ro'yxatda `imageKey` →
  ko'rish havolasi → rasm mazmuni; begona kompaniya 404).

### Xaridni bir bosqichda yakunlash
Kichik biznesda xaridni kirituvchi odam uni o'zi qabul qiladi. `POST /orders/:orderId/complete`
(`purchase.approve` + `warehouse.receive`): qoralama bo'lsa tasdiqlanadi, QOLGAN tovar to'liq qabul
qilinadi, ixtiyoriy to'lov yoziladi — hammasi BITTA tranzaksiyada. Yangi hisob-kitob yo'q: qabul aynan
`receiveGoods`, to'lov aynan `recordSupplierPayment` orqali (zaxira, AVCO, jurnal, ta'minotchi qarzi va
backorder taqsimoti o'zgarmagan). UI: xarid hujjatida "To'g'ridan-to'g'ri qabul qilish" — to'lov usuli
yoki "qarzga" tanlanadi. Import qilingan qoralama hujjat ham shu tugma bilan yakunlanadi.
Testlar: `purchase.test.ts` (4 ta yangi) — to'liq oqim, qarzga olish, qisman qabuldan keyin yakunlash va
takror bosishda xato, bekor qilingan hujjat, `warehouse.receive` yo'q xodimga 403.

### Supervayzer ham zakaz oladi
"Supervayzer" roliga `sales_agent.use` va agent mijoz ruxsatlari qo'shildi; mavjud kompaniyalar uchun
`0079_supervisor_takes_orders.sql` (faqat yetishmayotganini qo'shadi, idempotent). ERP yon menyusida
"Zakaz olish" havolasi — `sales_agent.use` bor, lekin ERP bo'limlari ham bor xodimga (faqat agent
ruxsati bo'lganlar allaqachon agent ish joyiga yo'naltiriladi). Ruxsatning o'zi yetmaydi: hisob FAOL
savdo agentiga bog'lanishi kerak — "Distribyutsiya → Sotuv agentlari" da `userId` bilan bir marta.
Test: `supervisor-orders.test.ts` (4) — rol tarkibi, bog'lanmagan holatda 403, bog'langach ish joyi
ochilishi va boshqa rollarda ochilmasligi.

### Inventarizatsiya auditi
Server mantig'i to'g'ri ishlayotgani tasdiqlandi: tuzatma JORIY qoldiqqa nisbatan hisoblanadi, faqat
SANALGAN qatorlar tegiladi, band (rezerv) qilingan tovardan kam sanash `moveStock` invarianti bilan
rad etiladi, bekor qilingan hisob qo'llanmaydi, takror mahsulot noyob indeks bilan 409 beradi.
Bo'shliqlar UI da edi va yopildi:
- hisobga mahsulot qo'shish ("topilma" — omborda bor, ro'yxatda yo'q) — API bor edi, tugma yo'q edi;
- qatorlar bo'yicha qidiruv (ko'p mahsulotli omborda sanash imkonsiz edi);
- qo'llashdan oldin tasdiq oynasi: sanalgan, ortiqcha, kam va sanalmagan qatorlar soni bilan;
- seansni bekor qilish tugmasi (API bor edi, UI da faqat "Boshlash" ulangan edi);
- sanalgan miqdor Enter va fokusdan chiqqanda ham saqlanadi.
Testlar: `counts.test.ts` (4 ta yangi) — topilma qo'shish va takrorlanmaslik, sanalmagan qator
tegilmasligi, band tovardan kam sanashning rad etilishi, bekor qilingan hisobga qator qo'shilmasligi.

## Agent katalogida rasm va xarid importida qadoq birligi (2026-09-23)

### Agentda mahsulot rasmi ko'rinmasdi
Agent katalogi rasm havolasini FAQAT imzolangan S3 URL bilan berardi (`client && imageKey ? ... : null`),
productionda esa S3 sozlanmagan — shuning uchun `imageUrl` har doim `null` bo'lib, agent ilovasida
rasm umuman chiqmasdi (kompyuterdagi ERP bazadagi rasmni ko'rsatardi, chunki u `fileUrl` dan o'tadi).

- `files.service.ts` da umumiy `productImageUrl(productId, key, client, contentPath)` — bazadagi kalit
  uchun API manzili, saqlashdagi uchun imzolangan URL;
- agent uchun ALOHIDA marshrut `GET /api/sales-agent/catalog/:productId/image/content`: umumiy
  `/api/files/...` yo'li `products.view` talab qiladi, sotuv agentida esa u yo'q edi (403);
- frontendda manzil `apiUrl` bilan to'ldiriladi (biznes konteksti bo'lmasa sessiya topilmay 401 bo'lardi).
Testlar: `sales-agent-catalog-notify.test.ts` — S3'siz muhitda havola keladi, rasm ochiladi, begona
kompaniyaga 404; eski "rasm havolasi saqlashsiz null" kutilmasi yangi holatga moslandi.

### Xarid importida "blok"/"pachka" konversiyasi
Zaxira asosiy birlikda yuritiladi, shuning uchun qatordagi birlik asosiy birlikdan farq qilsa
koeffitsient shart. Ilgari buni faqat `unitFactorToBase` TOVAR QABUL QILINAYOTGANDA tekshirardi:
fayl muvaffaqiyatli import bo'lib, xato eng oxirida — "to'g'ridan-to'g'ri qabul" bosilganda chiqardi.

- import endi qatorning o'zida tekshiradi va xatoni o'sha qatorda ko'rsatadi;
- faylga ixtiyoriy "Birlikdagi dona" (`unitsPerPackage`) ustuni qo'shildi — konversiya yo'q bo'lsa
  shu bilan ochiladi (mahsulot importidagi bilan bir xil naqsh), hujjatdan OLDIN yoziladi;
- mavjud konversiya bo'lsa fayl uni takrorlamaydi va ikkilantirmaydi.
Testlar: `import-units-prices.test.ts` (+3) — konversiyasiz blok xato beradi va hujjat yaratilmaydi;
"Birlikdagi dona" bilan 10 blok × 12 = 120 dona qoldiq; mavjud konversiya ikkilanmaydi.

## Oylik plani, mijoz balansi tarixi, inventarizatsiya to'liqligi va dostavka nakladnoyi (2026-09-23)

### Oylik (8, 9)
KPI tizimi bor edi, lekin hisob PROGRESSIV — "plan bajarilmasa foiz yo'q" qoidasini ifodalab
bo'lmasdi. `kpi_rules.min_value` qo'shildi (`0080_kpi_min_value.sql`, faqat ustun):
ko'rsatkich plandan kam bo'lsa qoida bo'yicha pul 0, `null` — chegara yo'q (mavjud qoidalar
o'zgarmaydi). HR → KPI oynasida "Plan" maydoni. Dostavshik uchun yangi ko'rsatkich kerak emas:
`agent_collected_amount` to'lovni KIM qayd etganiga qarab hisoblanadi, shuning uchun dostavka
agenti yig'gan pul ham unga tushadi — yorlig'i aniqlashtirildi.

### Mijoz balansi (10)
API bor edi, UI yo'q edi. `SetBalanceDialog` ga ixtiyoriy `historyUrl` — oxirgi 20 harakat
(turi, summasi, keyingi qoldiq, izoh) shu oynada. Balansni o'rnatish avvalgidek `balance-adjust`.

### Inventarizatsiya (11)
Hisob `stock_levels` dan qurilardi — harakat bo'lmagan mahsulot ro'yxatga tushmasdi ("chala").
Endi MAHSULOTLAR jadvalidan quriladi, kutilgan qoldiq `coalesce(qoldiq, 0)`, katalog katta
bo'lsa bo'laklab yoziladi.

Shu o'zgarish yangi yuk tug'dirdi: hisobda endi BUTUN katalog bor, `GET /counts/:countId` esa
hamma qatorni qaytarardi. Endi `?search=` (nom yoki SKU, serverda ILIKE) va `?limit=` (sukut 200)
bor; `itemCount`, `countedItems`, `surplusItems`, `shortageItems` SERVERDA sanaladi, shuning
uchun jarayon ko'rsatkichi va "Tuzatmalarni qo'llash" oynasidagi sonlar chegaradan mustaqil.
UI qidiruvni 300 ms kechikish bilan yuboradi, ro'yxat chegaraga tegsa shuni yozadi.
Parametrsiz so'rov avvalgidek ishlaydi — mavjud bizneslar uchun xatti-harakat o'zgarmadi.

### Naqd topshirish (12)
Funksiya bor: ERP → "Distribyutsiya → Sotuv agentlari" va "Dostavka → Agentlar". Agent
ilovasidagi "Sizdagi naqd" kartochkasiga qayerga topshirish kerakligi yozildi (uz/ru/kk).
Pulni QABUL QILUVCHI qayd etadi — ikki tomonlama nazorat saqlanadi.

Keyingi tekshiruvda ikkita haqiqiy kamchilik topildi va yopildi:
1. Sotuv agentining puli "Distribyutsiya" da, dostavka agentiniki "Dostavka" da edi — pulni
   qabul qiladigan odam ikkalasini alohida qidirardi. `GET /api/finance/agent-cash`
   (`finance.view`) ikkala turni BITTA ro'yxatda beradi; Moliya → Kassa sahifasida
   "Agentlardagi naqd (topshirilmagan)" bo'limi shu ro'yxatni ko'rsatadi va topshirishni shu
   yerdan qabul qiladi. Qoldig'i nol bo'lganlar ro'yxatga tushmaydi.
2. Dostavka agenti o'zida qancha topshirilmagan pul borligini umuman ko'rmasdi (sotuv agentida
   `AgentCashCard` bor edi). `GET /api/delivery/agent/cash` — faqat o'qish, agent bosh
   sahifasida qoldiq va qayerga topshirish yozuvi (uz/ru/kk).

Ruxsatlar O'ZGARMADI: topshirishni avvalgidek `distribution.manage` (sotuv agenti) yoki
`delivery.manage` (dostavka agenti) bor xodim qayd etadi. Ruxsati yo'q xodim faqat ko'radi.
OCHIQ SAVOL: standart `Kassir` rolida ikkala ruxsat ham yo'q — agent ilovasi "kassaga
topshiring" deydi-yu, kassirning o'zi qayd eta olmaydi. Rol modelini o'zgartirish boshqa
bizneslarga ham tegadi, shuning uchun egasining qaroriga qoldirildi.

### Dostavka nakladnoyi (13)
Umuman yo'q edi. `GET /api/delivery/waybill?agentId=&date=` (`delivery.view`; mijoz qarzi faqat
`finance.view` bilan) va `delivery-waybill-pdf.ts` — boshqa hujjatlar bilan bir xil A4 ko'rinish.
Qog'ozda: kompaniya sarlavhasi (Sozlamalar → Kompaniya dan), agent nomi va kodi, MAS'UL SHAXS
(chop etayotgan xodim), ombor, har bir yetkazma (raqam, buyurtma, mijoz, manzil, telefon, summa,
qarzi), jami bloki (yetkazmalar soni, jami summa, jami qarz) va imzolar. Tugma: Dostavka →
Yetkazmalar, agent va bitta kun tanlanganda faollashadi. Bekor qilingan yetkazma chiqmaydi.

Qog'ozni TO'G'RILASH joyi ham qo'shildi: "Nakladnoy" bosilganda avval oyna ochiladi — hujjat
raqami, MAS'UL SHAXS, agent nomi, ombor va izoh tahrirlanadi; Manzil / Telefon / Mijoz qarzi
ustunlari yoqib-o'chiriladi; yetkazmalar soni, jami summa va jami qarz o'sha yerda ko'rinadi.
Sozlamalar brauzerda kompaniya kaliti bilan eslab qolinadi (serverdagi ma'lumotga tegilmaydi).
Tuzatilgan xato: nakladnoyning BIRINCHI sahifasida kompaniya sarlavhasi chizilmasdi —
`tableOptions` birinchi sahifani ataylab o'tkazib yuboradi (chaqiruvchi chizgan deb hisoblaydi),
hisob-faktura chizardi, nakladnoy esa yo'q edi. Yangi A4 testi shuni topdi.

Testlar: `kpi.test.ts` (+3), `counts.test.ts` (+2), yangi `delivery-waybill.test.ts` (5),
`a4-documents.test.ts` (+3), `sales-agent-cash.test.ts` (+2).
Production deploy QILINMADI.

### Test holati (2026-09-24) — YOPILDI
To'liq API to'plami YASHIL: **150 fayl / 988 test**, bitta ham qizil yo'q. Frontend vitest
31 fayl / 149 test, ikkala `tsc` va `eslint` ham toza.

Kechagi "acceptance-access qizil" xulosasi NOTO'G'RI edi — kod xatosi emas. Sabab: xotira
yetmagani uchun o'ldirilgan test yurishlaridan **yetim `vitest` jarayonlari** (va bir nechta
yetim boshqaruvchi `bash` skripti) tirik qolib, o'sha `bumerp_test` bazasiga PARALLEL ulanib
turgan. Ikki `truncate` bir vaqtda ishlaganda Postgres DEADLOCK (40P01) beradi, qolgan
xatolar (`duplicate key`, "kira olmadi") shundan kelib chiqadi. Yetimlar tozalangach o'sha
fayl 6/6 yashil.

### Bu mashinada testni QANDAY yuritish kerak (8 GB)
1. **Fon rejimida yuritmang.** Nazoratchi bo'sh xotira ~500 MB ga tushganda fon buyrug'ini
   o'ldiradi; o'ldirilgan skriptning bolalari esa tirik qoladi va bazani buzadi.
   Old planda (foreground), vaqt budjeti bilan bo'lak-bo'lak yuriting.
2. **Har bo'lakdan keyin yetim jarayonlarni o'ldiring** (`node.exe` — `vitest` yoki
   `experimental-import-meta-resolve`), so'ng `pg_stat_activity` da `bumerp_test` ulanishlari
   0 ekanini tekshiring.
3. **Bo'lak o'lchami:** `acceptance*` va `security-hardening` — BITTADAN, qolganlari 4 tadan.
4. Tayyor skript: `scratchpad/run-chunks.sh <sekund>` — holatni `/tmp/api-chunks.done` da
   saqlaydi, uzilsa qolgan joyidan davom etadi.

### Blockerlar
- **Production zaxira xizmati (AUDIT-2, HIGH):** kod va hujjat tayyor (`deploy/backup/`), lekin Railway'da `bum-backup` xizmati, volume va `Cron Schedule` egasi tomonidan yaratilmagan; `BACKUP_PASSPHRASE` ham egasi kiritadi (parol repoda yo'q va hech qayerda chop etilmaydi). Shu qadamgacha production bazasining avtomatik nusxasi YO'Q
- **Android real qurilma:** `adb devices` bo'sh, emulyator uchun xotira yetmaydi — telefon ulash kerak
- **Release imzo kaliti:** egasi yaratadi va xavfsiz joyda saqlaydi (yo'qolsa ilovani yangilab bo'lmaydi); `android/keystore.properties` ga yo'li va parollar
- **Build/test xotirasi:** 8 GB mashinada Docker va Gradle birga ishlasa tizim fon vazifalarini to'xtatadi — APK Docker to'xtatilib qurildi
- **DNS:** apex `bum-erp.uz` — webspace.uz panelida egasi o'zgartiradi (Railway tarifida `bum-web` ga yana domen qo'shib bo'lmaydi: `app` va `www` band)
- **Production'da tizimga kirgan sinov:** egasining test hisobi yoki ishtiroki kerak (production admin paroli ishlatilmaydi)
- **Kassa 0.4.6 e'loni:** platforma admini kirishi kerak (o'rnatuvchi tayyor, imzosiz); API deploy qilingan (2026-09-15)
- **Bootstrap admin paroli oddiy:** API endi ishga tushishni to'xtatmaydi, faqat ogohlantiradi — almashtirish egasining Railway o'zgaruvchilarida (parol hech qayerga chiqarilmagan)
- **Kod imzolash sertifikati (CLI-1):** yangilanish o'rnatuvchisi imzosiz — sertifikat kerak (pullik, taxminiy)
- **Terminal ekvayringi (UZCARD/HUMO API):** bank yoki processing protokoli va kalitlari kerak — hozir terminal to'lovi kassir tomonidan chekka qarab kiritiladi
- **Payme / Click:** merchant ID va kalitlari kerak — integratsiya boshlanmagan
- **GitHub push:** ~~avtomatik rejimda rad etildi~~ — **yopildi** (2026-09-20): `feat/postgres-migration` GitHub'ga chiqarildi (`fc047ac..0946490`, 162 commit). Qolgani: `main` ga PR — o'tish kuni kelishilgach
- **OSRM:** Public OSRM cheklovi bor; foydalanuvchilar soni oshsa self-hosted OSRM kerak. Taxminiy talab (tekshirilmagan): O'zbekiston xaritasi uchun ~2 vCPU, 4 GB RAM, 10 GB disk; ulash — `ROUTING_OSRM_URL`, egasining tasdig'i bilan

### Eng muhim keyingi qadam
Release imzo kalitini yaratib, imzolangan APK'ni haqiqiy Android telefonda sinash: dostavshik kirishi → ish sessiyasi → GPS (fonda, ekran qulflanganda) → yangi yetkazma bildirishnomasi → "Optimal marshrut" → Google Maps / Yandex.

## Oylik tarixi, mijoz hisobi, rol chegarasi va pul topshirish hujjati (2026-09-24)

Egasi bergan 1–7 vazifa. Hammasi commit qilindi, API to'plami va `tsc`/`eslint` yashil.

### Oylik stavka tarixi va maqsadli KPI (1, 3)
Fiksatsiyalangan oylik o'zgarganda faqat YANGI qiymat qolardi — kim, qachon va nega
o'zgartirgani yo'qolardi. `employee_salary_history`: har o'zgarishda eski/yangi stavka,
qaysi oydan kuchga kirishi, izoh va o'zgartirgan xodim yoziladi; xodim kartochkasida
oylik yonida tarix tugmasi.

KPI qoidasiga MUKOFOT TURI qo'shildi: avvalgi bosqichli hisob saqlandi, yoniga "maqsad"
turi — plan bajarilsa belgilangan summa, bajarilmasa 0. Oyna qoidani jumla bilan
ko'rsatadi, shuning uchun admin formulani boshida ko'radi.

### Mijoz hisobi: pul qo'shish, ayirish va import (2, 2.6)
Balans ustuni to'g'ridan-to'g'ri tahrirlanmaydi — har harakat tarix qatori + kassa
harakati + balanslangan jurnal. Oldin faqat qo'shish bor edi; ortiqcha to'lovni qaytarish
"qo'lda tuzatish" bilan yozilardi va moliyaviy ma'noni buzardi. Endi:

- `POST /customers/:id/balance-deposit` va `.../balance-withdraw` (0082 — enum qiymati)
- `POST /customers/balance-import` (`finance.approve`) — boshlang'ich qoldiqni fayldan.
  Har qator TUZATMA tranzaksiyasi, shuning uchun qoldiq daromad deb hisoblanmaydi
  (test: `grossSales` va `netSales` 0 bo'lib qoladi). `dryRun` bilan oldindan ko'rish;
  mijoz topilmasa xato (yangi mijoz YARATILMAYDI); o'sha faylni qayta yuklash balansni
  ikki barobar qilmaydi (maqsad qiymatga keltiriladi).
- `GET /customers/:id/turnover` — oborot AYNAN `netOrderAmount` ta'rifidan hisoblanadi,
  shuning uchun mijoz kartochkasi, qarz yoshi hisoboti va kredit tekshiruvi bir xil raqam
  beradi. Javobda `openDebt` (hujjatlardan) va `cachedDebt` (`customers.total_debt`)
  yonma-yon — moslikni tekshirish uchun.

UI: mijoz qatorida "pul qo'shish" va "pul ayirish" (`sales.collect_payment`) —
"balansni to'g'rilash" (`finance.approve`) dan ATAYLAB alohida.

### Zakaz olish — alohida knopka emas, Savdo ichidagi ruxsat (4)
`sales_agent.use` endi SAVDO guruhida va "Sotuvda zakaz olish" deb nomlanadi; yon menyuda
ham pastdagi alohida blokdan Operatsiyalar guruhiga ko'chirildi. Dublikat buyurtma tizimi
yaratilmadi — o'sha mavjud agent ish joyi. Ruxsat o'chirilsa server ham 403 beradi.

### Rol chegarasi: "faqat mas'ul bo'lganlari" (5)
`roles.scopes` (jsonb, 0083). Chegara qo'yish MA'NOGA ega ruxsatlar ro'yxati bilan
chegaralangan (`sales.view`, `crm.view`, `delivery.view`) — boshqasiga qo'yilsa 400.
Mas'uliyat MAVJUD biriktirishlardan o'qiladi (agent → marshrut → mijoz; kuryer →
yetkazma), yangi jadval yo'q. Filtr SERVERDA: begona yozuvga URL orqali murojaat
"topilmadi" beradi. Ustun bo'sh bo'lsa hech narsa o'zgarmaydi; egaga qo'llanmaydi.

### Pul topshirish: submit → accept/reject (6)
Oldin topshirish DARHOL pul o'tkazmasi qilardi — qabul qiluvchi ko'rib chiqmasdan, rad
eta olmasdan. Endi topshirish HUJJAT (`cash_handovers`, 0084):
`submitted → accepted | rejected | cancelled`.

Moliyaviy qoida: topshirishda pul KO'CHMAYDI, faqat qabul qilinganda ko'chadi. Shuning
uchun rad etishda qaytariladigan yozuv yo'q — summa o'z-o'zidan agentda qoladi. Karta
tushumi jismonan agentda bo'lmaydi, shuning uchun qabulda ikkinchi marta ko'chirilmaydi
(faqat solishtirish raqami). Sanoqda farq bo'lsa kamroq qabul qilinadi, qolgani agentda.
Bitta topshiruvchida bir vaqtda faqat bitta ochiq topshirish (bazada qisman unique
indeks — ikki marta bosish dublikat yaratmaydi), takroriy qabul 409.

Shu bilan 2026-09-23 dagi OCHIQ SAVOL ham yopildi: endi topshirishni agentning o'zi
yuboradi, `finance.view`/`finance.manage` bor xodim (kassir ham) qabul qiladi yoki rad
etadi — `distribution.manage`/`delivery.manage` shart emas.

UI: Moliya → Kassa sahifasida "Pul topshirishlar" bloki — yuborish, ko'rib chiqilmaganlar
ro'yxati, qabul/rad etish (sabab majburiy) va oxirgi 10 ta tarix.

### Ko'p yetkazmani birdan nakladnoy qilish (7)
Yetkazmalar ro'yxatida belgilash ustuni va "Hammasini belgilash" — faqat yo'lga
chiqayotganlari tanlanadi. `POST /api/delivery/waybills/bulk` tanlovni SERVERDA qayta
filtrlaydi (frontendga ishonilmaydi). PDF: har yetkazma o'z sahifasidan boshlanadi.
Chop etish yetkazma holatini O'ZGARTIRMAYDI; kim, qachon va nechta chiqargani auditda.

### `tsc` qizil edi — yopildi
5 va 4-vazifa commitlari frontend typecheck'ini buzgan (API va eslint toza bo'lgani uchun
sezilmagan): `roles-section.tsx` da `filter` predikat emasligidan tur toraymasdi,
`erp-layout.tsx` da `lng` `undefined` bo'lishi mumkin edi. Ikkalasi tuzatildi.

### Hafta kuni konvensiyasi qulflandi
Egasi "agentda payshanba o'rniga juma marshruti chiqyapti" deb xabar berdi. Kod
tekshirildi: UI tugmasi (0 = dushanba) → `toApiDay` → baza (0 = yakshanba) → server
`getUTCDay()` — zanjir TO'G'RI, siljish yo'q. Buni qulflash uchun
`src/pages/distribution/_lib/days.test.ts` qo'shildi: har UI tugmasi saqlangach aynan
o'sha sananing `getDay()` qiymatiga aylanishi tekshiriladi.

Sabab bazadagi qiymatlarda deb taxmin qilinmoqda; xom qiymatlarni ko'rish uchun
production bazasiga faqat o'qish so'rovi KERAK — auto rejim `railway ssh` ni rad etdi,
shuning uchun TEKSHIRILMADI. Ehtimoliy manbalar: marshrut CSV importidagi `Kunlar (0-6)`
ustuni (qaysi kun 0 ekani hech qayerda yozilmagan, UI esa dushanbadan boshlanadi) yoki
"Kunlik o'zgartirish" da qolib ketgan biriktirish (u haftalik jadvaldan USTUN turadi).

## Sana chegarasi: biznes kuni UTC emas, UTC+5 (2026-09-24)

Egasi "agentda payshanba o'rniga juma marshruti chiqyapti, sana xatoligi bormi" deb
xabar berdi. Tekshiruv ikki qismga bo'lindi.

### 1. Marshrut kuni zanjiri — XATO YO'Q (production ma'lumoti bilan tasdiqlandi)
UI tugmasi (0 = dushanba) → `toApiDay` → baza (0 = yakshanba) → server `getUTCDay()`.
Production bazasidan o'qildi (faqat o'qish so'rovi): server sanasi `2026-09-24`, `dow=4`,
o'sha kunga hech qanday `route_assignments` yo'q, va `days` da 4 bo'lgan marshrutlar
admin panelda "Pa" deb ko'rinadiganlar bilan AYNAN bir xil:

    Лочинбек → Pitnak Marshruti      Сабиров → Mangit Amudaryo
    Султанова → Gurlan tumani        Артикова → Гурленский
    Атамуратова → Дехкон бозор

Ya'ni agentga chiqayotgan marshrut jadvalga mos. Konvensiya `days.test.ts` bilan qulflandi.

Diqqat qilinadigan joyi: 20-sentabrda yaratilgan RUSCHA nomli marshrutlar (Гурленский,
Дехкон бозор, Даритал…) va 22-sentabrdagi O'ZBEKCHA nomlilar (Gurlan tumani, Xiva…)
IKKALASI ham faol. "Гурленский" (Артикова, Ch+Pa) va "Gurlan tumani" (Султанова, Pa+Sh)
bir hududga ikki agentni bugun birga chiqaradi — bu jadval/ma'lumot masalasi, kod emas.

### 2. Haqiqiy sana xatosi — TUZATILDI
`todayIso()` biznes kunini `new Date().toISOString()` bilan, ya'ni UTC bo'yicha olardi.
Production konteyneri UTC da ishlaydi, biznes esa UTC+5 da: mahalliy vaqt bilan
**00:00–05:00 oralig'ida butun tizim bir kun orqada** edi — o'sha soatlarda yozilgan kassa
harakati va POS sotuvi kechagi sanaga tushardi, agent esa kechagi marshrutni ko'rardi.
Funksiya 118 joydan chaqiriladi, shuning uchun ta'siri butun tizim bo'ylab.

Kodning boshqa joylarida kun chegarasi allaqachon mahalliy vaqtda olinardi
(`supervisor.service.ts` `+05:00`, `delivery/reports.service.ts` `Asia/Tashkent`) —
`todayIso()` ularga zid edi.

Endi: `todayIso(now = new Date())` — UTC+5 siljishi bilan. O'zbekistonda yozgi vaqt yo'q,
shuning uchun siljish doimiy; boshqa mintaqa uchun `BUSINESS_UTC_OFFSET_MINUTES` muhit
o'zgaruvchisi. Yangi `business-day.test.ts` (4) chegarani qulflaydi: mahalliy 23:59 hali
eski kun, 00:30 esa allaqachon yangi kun va o'sha kunning hafta kuni to'g'ri chiqadi.

Sana bog'liq to'plamlar qayta yuritildi va yashil: `cash`, `sales-agent-*`,
`receivables-aging`, `settlement`, `salary`, `pos-session`, `sales`, `pos`, `finance`,
`delivery-flow`, `acceptance-distributor`, `acceptance-business-scenarios`,
`acceptance-real-world`.

### Deploy
Bugungi 1–7 vazifa va shu tuzatma production'ga chiqarildi. Tekshirildi:
`/api/finance/handovers` va `/api/delivery/waybills/bulk` — 401 (mavjud), yo'q marshrut —
404; web bundle'da "Pul topshirishlar" bloki bor.

## Agent "Mijozlar" ro'yxati bugungi marshrut emas edi (2026-09-24)

Egasi Атамуратова Шахноза ekranini yubordi: "payshanba marshruti ham chiqyapti, jumaniki
ham". Skrinshotda **Mijozlar** bo'limi va **"Hammasi"** filtri turgan edi.

### Sabab — sana emas, SO'ROV DOIRASI
`customers/page.tsx` har doim `scope=all` so'rardi. Server tomonda bu "agentga ochiq
BARCHA do'konlar" degani (`assignedRouteIds` — hafta kunidan qat'i nazar), shuning uchun
ro'yxatda payshanba marshruti (Дехкон бозор) bilan birga juma marshrutining do'konlari
(Paxtakor, Водник) ham turardi. Bugungi marshrutni ko'rsatadigan filtr umuman yo'q edi.
Serverning `scope` sukuti allaqachon `today` — faqat shu sahifa uni bosib o'tardi.

### Tuzatma
- Filtrlar: **Bugun | Hammasi | Qarzdorlar | Kechikkan**; sukut — **Bugun**.
- "Bugun" ro'yxati `/api/sales-agent/today` dan (Sotuv sahifasi bilan bir xil so'rov, keshdan
  keladi — qo'shimcha trafik yo'q), qidiruv shu ro'yxat ichida.
- Ro'yxat tepasida "Bugungi marshrut: Payshanba · Дехкон бозор" — qaysi kun va qaysi marshrut
  ekani yozib turadi.
- Bugungi marshrutda qidirilgan do'kon topilmasa — "Hamma mijozlar ichidan qidirish" tugmasi
  (boshqa kunning do'koniga to'lov uchun kirish avvalgidek ochiq).
- uz/ru/kk kalitlari qo'shildi (`weekday.0…6` to'liq kun nomlari ham).

Test: `sales-agent-stores.test.ts` (+1) — agentda bugungi va boshqa kunning marshruti bo'lsa
`scope=today` faqat bugungisini, `scope=all` ikkalasini beradi; boshqa kunning do'koni bugungi
qidiruvda chiqmaydi, "hammasi" da chiqadi, va unga kirish baribir ochiq.

### Hamma agentlarning haftalik jadvali — AUDIT (production, faqat o'qish)
Kun siljishi HECH QAYERDA yo'q. Har agent haftaning 6 kunida ishlaydi, yakshanba — dam:

    Артикова Замира    Du Спутник чакка · Se Даритал · Ch,Pa Гурленский · Ju Даритал · Sh Райцентр
    Атамуратова Шахноза Du Аерапорт Раддом+Лучевой · Se,Pa,Sh Дехкон бозор · Ch Заналний+Надмес · Ju Paxtakor+Водник
    Лочинбек           Du Bog'ot · Se Hazorasp · Ch To'rtkul · Pa Pitnak · Ju Beruniy Boston · Sh Xonqa
    Сабиров Дилшод     Du Xiva Elektroset · Se G'oybu+Xiva 2+Xiva · Ch Qo'shko'pir · Pa Mangit · Ju,Sh Yangiariq
    Султанова Шахзода  Du Xiva Shukrona · Se Xiva Kosmo · Ch Shovot · Pa,Sh Gurlan · Ju Yangibozor

Kun bo'yicha yuk: Du 272, Se 337, Ch 356, Pa 342, Ju 330, Sh 383 do'kon; yakshanba 0.

EGASI QARORIGA QOLDIRILDI (kod masalasi emas, jadval masalasi):
- `Cholish Marshruti` — agenti ham, hafta kuni ham yo'q (9 do'kon): HECH QACHON hech kimga
  chiqmaydi. Agent va kun belgilansa yoki arxivga olinsa tugaydi.
- Bitta faol mijoz hech bir faol marshrutda emas.
- Bir kunda bir nechta marshrut: Шахноза (Du, Ch, Ju) va Сабиров (Se — 3 ta, 91 do'kon).
  Bu ataylab bo'lishi mumkin (kichik marshrutlar birga yuriladi), lekin bir kunda 91 do'kon
  real bajarilmasa jadvalni bo'lish kerak.

## Hudud va kun: haftalik panorama, ko'chirish va to'qnashuv ogohlantirishi (2026-09-24)

Egasi marshrutni boshqa kunga "o'tkazgandan" keyin yana noto'g'ri chiqqanini aytdi.
Production ma'lumoti avvalgi surat bilan solishtirildi va farq aniq ko'rindi:

    OLDIN:  Лочинбек — Se: Hazorasp · Pa: Pitnak
    HOZIR:  Лочинбек — Se: Hazorasp · Pa: Hazorasp + Pitnak

Ya'ni "Hazorasp" KO'CHMAGAN — unga payshanba QO'SHILGAN, seshanba esa o'chmagan. Panel
kunlarni belgilaydi/olib tashlaydi, almashtirmaydi; buni hech narsa aytmasdi va natijada
Лочинбекда payshanba kuni 128 do'kon bo'lib qoldi (78 + 50).

Bu KOD xatosi emas — interfeys niyatni ko'rsatmasligi edi. Tuzatildi:

### Haftalik panorama (yangi)
`_components/weekly-schedule-grid.tsx` + `_lib/schedule.ts`. Qator — agent, ustun — hafta
kuni, katak — o'sha kuni yuriladigan marshrutlar va do'kon soni. Bir kunda ikkitadan ko'p
bo'lsa katak sariq va jami do'kon yoziladi; bo'sh kun kulrang; pastda kunlik yuk
(do'kon / agent / marshrut). Marshrut jadvaldagi katakdan bosiladi va formaga tushadi.
Eski "Joriy jadval" ro'yxati shu jadval bilan almashtirildi.

Alohida blok: **jadvalga tushmagan marshrutlar** — agenti yoki hafta kuni yo'q bo'lganlar
("hech qachon chiqmaydi"), ular ilgari hech qayerda ko'rinmasdi.

### Saqlashdan oldin nima o'zgarayotgani
Forma ostida: "Hozir: Seshanba → bo'ladi: Seshanba, Payshanba" va `+ Payshanba` / `− Seshanba`.
Bitta kun qo'shilgan-u eskisi turgan bo'lsa (aynan "ko'chirish" niyati) bitta tugma chiqadi:
**"Faqat Payshanba qoldirish"**.

### To'qnashuv
Agent o'sha kuni boshqa marshrutda band bo'lsa: kun tugmasida sariq nuqta, forma ostida
sariq ogohlantirish — qaysi marshrut, nechta do'kon va jami nechta bo'lishi.

Testlar: `_lib/schedule.test.ts` (4) — agent/kun kesimiga o'girish, bir kunda ikkita marshrut,
agenti/kuni yo'q marshrut jadvalga tushmasligi va kunlik yuk hisobi.

### Production analizi (faqat o'qish, 2026-09-24)
Hududlar: 14 ta, 30 marshrut, 1544 do'kon. `Urganch` — 10 marshrut / 519 do'kon (2 agent),
`Xiva` — 5 / 167, qolganlari 1 marshrutdan.

Haftada bir necha marta yuriladigan marshrutlar (ataylabmi — egasi tasdiqlashi kerak):
Дехкон бозор 3× (102), Gurlan tumani 2× (88), Hazorasp 2× (78), Yangiariq 2× (61),
Гурленский 2× (85), Даритал 2× (47).

Agent haftalik yuki (tashrif = do'kon × kun):

    Лочинбек            544 | og'ir kun 128 (Pa), yengil 65 | kunlik o'rtacha 91
    Атамуратова Шахноза 481 | og'ir kun 102,      yengil 52 | o'rtacha 80
    Артикова Замира     392 | og'ir kun  85,      yengil 47 | o'rtacha 65
    Султанова Шахзода   345 | og'ir kun  88,      yengil 19 | o'rtacha 58
    Сабиров Дилшод      336 | og'ir kun  91,      yengil 17 | o'rtacha 56

Haqiqiy tashriflar hali juda kam (30 kunda 7 ta) — tizim sinov bosqichida. MUHIMI:
"jadvaldan tashqari tashrif" 0 ta, ya'ni kun mosligi amalda ham to'g'ri ishlayapti.

### Egasining qarori: nima muammo emas (2026-09-24)
Yuqoridagi "e'tibor beriladigan joylar" ro'yxatidan ikkitasi biznes holati ekan:

1. **Bir marshrutga haftada bir necha marta chiqish NORMAL** (Дехкон бозор 3×, Gurlan 2× …).
2. **`Cholish Marshruti` ataylab bo'sh** — hali tayyorlanmagan.

Shunga ko'ra panorama qayta sozlandi, chunki ilgari ikkalasi ham sariq "ogohlantirish" edi:

- Sariq katak endi marshrut SONIGA emas, kunlik DO'KON YUKIGA qo'yiladi: agentning ish kunlari
  o'rtachasidan **1.5 baravar** og'ir kun ajratiladi (`HEAVY_DAY_RATIO`). Bir kunda bir nechta
  marshrut bo'lsa jami do'kon soni neytral yoziladi, xolos.
  Hozirgi ma'lumotda bu 30 katakdan 3 tasini ajratadi: Султанова Pa 88 va Sh 88 (o'rtacha 57),
  Сабиров Se 91 (o'rtacha 56) — ya'ni ortiqcha shovqin yo'q.
- "Jadvalga tushmagan marshrutlar" bloki sariq emas, kulrang ma'lumot: "agentga chiqmaydi
  (hali tayyor bo'lmasa, normal)".
- Tahrirlash formasidagi "band" ogohlantirishi ham neytral ma'lumotga aylandi: "Bu agentda
  o'sha kuni yana marshrut bor" + kunlik jami.

Test: `schedule.test.ts` (+1) — og'ir kun chegarasi (marshrut soni ta'sir qilmasligi va
ishlanmaydigan kun hech qachon og'ir bo'lmasligi).

## Android eski ekranni ko'rsatardi: web build eskirganini hech kim aytmasdi (2026-09-24)

Egasi ikkita ekranni yubordi: brauzerda "Mijozlar" da yangi 4 ta filtr (Bugun / Hammasi /
Qarzdorlar / Kechikkan) va "Bugungi marshrut: Payshanba · Hazorasp, Pitnak" yozuvi bor,
Android ilovasida esa eski 3 ta filtr.

### Sabab — APK emas, QAYTA YUKLANMASLIK
APK web'ni ichiga QOTIRMAYDI: `apps/mobile/capacitor.config.ts` da `server.url =
https://app.bum-erp.uz`, ya'ni ilova production saytini ochadi. Tekshirildi — uchala domen
(`app.`, `www.`, apex) bitta eng yangi bundle'ni beradi va nginx sarlavhalari ham to'g'ri:
`index.html` va `sw.js` — `no-cache`, `/assets/` — `immutable`.

Muammo shundaki, **ishlab turgan WebView sahifani qayta yuklamaydi**. Agent ilovani yopmaydi
(ish sessiyasi va fondagi GPS ochiq turadi), shuning uchun telefonda bir necha kunlik eski JS
ishlab yuraverardi. Service worker'ning "yangi versiya" xabari bu holatni qoplamaydi: u faqat
`sw.js` faylining o'zi o'zgarganda chiqadi, oddiy deployda esa u o'zgarmaydi. `app-update-banner`
ham qoplamaydi — u NATIV qobiq (APK) versiyasi haqida.

### Tuzatma — build belgisi
- `vite.config.ts` har buildga belgi qo'yadi (`__BUILD_ID__`) va shu belgini `build.json` ga
  yozadi. Fayl `/assets/` dan tashqarida, shuning uchun nginx unga `no-cache` beradi.
- `useBuildVersion` uni ishlab turgan belgi bilan solishtiradi: ilova ochilganda, old planga
  qaytganda (telefonda — ilovaga qaytish, brauzerda — tabga qaytish) va har 15 daqiqada.
- Fonda **2 daqiqadan ko'p** turgandan keyin qaytilsa — indamay qayta yuklanadi (o'sha paytda
  yarim yozilgan narsa bo'lmaydi). Qolgan hollarda "Dasturning yangi versiyasi tayyor —
  Yangilash" tugmasi chiqadi, chunki agent buyurtma yozayotgan bo'lishi mumkin.
- Brauzer va Android — BITTA kod, shuning uchun ikkalasida ham bir xil ishlaydi.

Oflayn chekka holati yopildi: service worker `/build.json` ni umuman keshlamaydi (aks holda
internet yo'qda eski nusxa qaytib, ilova oflayn holda qayta yuklanib qolardi), kesh nomi
`erp-assets-v3` ga oshirildi va tekshiruv `navigator.onLine === false` bo'lsa umuman
yuborilmaydi.

Testlar: yangi `build-version.test.ts` (5) — belgi bir xil/boshqa, belgi yo'q yoki tarmoq
uzilgan bo'lsa hech narsa qilinmasligi, `build.json` keshni chetlab o'qilishi.
Frontend to'plami: 35 fayl / 166 test yashil.

MUHIM: bu tekshiruv YANGI build bilan keladi, shuning uchun telefonda ayni paytda ochiq turgan
ESKI nusxa uni bilmaydi — bir marta ilovani yopib qayta ochish kerak. Undan keyingi hamma
deploy o'zi yetib boradi.

### Android APK 1.0.2 va imzo masalasi (2026-09-24)
Egasi APK o'rnatolmadi. Sabab — imzo: lokalda ikkita APK bor va ular BOSHQA sertifikat bilan
imzolangan (`app-debug.apk` → `CN=Android Debug`, `c1849ba8…`; `app-release.apk` →
`CN=BUM ERP, L=Nukus`, `e05d1df7…`), paket nomi va versionCode esa bir xil. Android boshqa
imzoli APK'ni mavjudining ustiga o'rnatmaydi — "noma'lum ilovalar" ruxsati bunga aloqador emas.

Egasi debug imzoni tanladi (telefonlardagi nusxa shu imzoda — o'chirish shart emas):
`bumVersionCode` 3, `bumVersionName` 1.0.2 va APK qayta qurildi. Tekshirildi: versionCode=3,
imzo o'sha `c1849ba8…`, ichidagi `capacitor.config.json` da `server.url = https://app.bum-erp.uz`.

**Build buyrug'i (muhim):** Gradle standart JDK 17 da `invalid source release: 21` beradi —
Capacitor 8 uchun JDK 21+ kerak, bu mashinada 21 yo'q, lekin Android Studio JBR (25) ishlaydi:

    cd apps/mobile && npx cap sync android
    cd android && gradlew.bat assembleDebug --no-daemon "-Dorg.gradle.java.home=C:\Program Files\Android\Android Studio\jbr"

Gradle bilan birga Docker ishlamasin (8 GB) — `docker compose stop` qilib, keyin build.

Bu masala filtrlar bilan bog'liq EMAS edi: APK faqat saytni ochadigan qobiq. Egasi tasdiqladi —
ilovani Force stop qilib qayta ochgach Android'da ham yangi 4 ta filtr chiqdi.

## Moliyaviy audit boshlandi: Bito ↔ BUM ERP (2026-09-24)

Egasi topshirig'i: Bito ERP'ning moliyaviy tizimini real kuzatuv asosida o'rganib, BUM ERP
bilan taqqoslash va farqlarni yopish. To'liq hujjat — `FINANCE_AUDIT.md`.

**Bito BLOKLANGAN:** hamma Bito MCP vositasi `Error 11009 — Both Bito access and refresh
tokens have expired ... must re-authorize via /authorize` qaytardi; `bito_profile_get_me`
avto-rejim klassifikatori tomonidan ham rad etildi. Token o'z-o'zidan yangilanmadi — bu
autentifikatsiyani chetlab o'tish bo'lardi (egasining qoidasi). Qolgan hamma faza shu
bloker ortida: FAZA 1–21, GAP matritsasi va target arxitektura.

**Bajarildi — FAZA 22 (BUM ERP moliyaviy auditi, faqat kod va sxema o'qildi, production
bazasiga tegilmadi):** obyekt modeli, hisoblar rejasi (23 hisob), 26 ta hujjat turining
moliyaviy ta'siri, to'lov zanjiri (usul → hisob → kassa harakati → jurnal), aralash to'lov
qoidalari, kassa smenasi, RBAC va yaxlitlik mexanizmlari hujjatlashtirildi.

**Bito'siz ham asoslangan ichki topilmalar** (`FINANCE_AUDIT.md` → "BUM ERP ichki topilmalar"):

- **F-1 (CRITICAL):** smena yopilishidagi kassa farqi buxgalteriyaga UMUMAN tushmaydi —
  `closeShift` va `reviewShiftDifference` na `recordCashTransaction`, na `postJournalEntry`
  chaqiradi; hisoblar rejasida kamomad/ortiqcha hisobi ham yo'q. Kamomaddan keyin tizimdagi
  kassa qoldig'i haqiqiy puldan ko'p bo'lib qoladi.
- **F-2 (CRITICAL):** mijoz to'lovini bekor qilish/to'g'rilash yo'q — `POST /payments` bor,
  bekor qilish marshruti butun API'da yo'q. Noto'g'ri kiritilgan to'lovni tuzatishning
  to'g'ri yo'li mavjud emas.
- **F-3 (HIGH):** mijoz va ta'minotchi bilan solishtirish akti (statement) yo'q.
- **F-4 / F-5 (MEDIUM):** kompaniya darajasida pul oqimi hisoboti va buxgalteriya balansi yo'q
  (aylanma balans va foyda/zarar bor).

Kod O'ZGARTIRILMADI (topshiriqning 30-qoidasi: Bito auditi tugamaguncha kod yozilmaydi),
production deploy qilinmadi.

**Keyingi qadam:** egasi `/authorize` qiladi → FAZA 1 dan Bito auditi. F-1 va F-2 Bito'siz ham
asoslangan, shuning uchun egasining ruxsati bilan ular oldinroq ham yopilishi mumkin.

## Xaridda miqdor: "dona" yonida "blok" (2026-09-24)

Egasi so'rovi (15): xarid yaratishda miqdorni dona yonida blokda ham kiritish mumkin bo'lsin —
dona yozilsa donada, blok yozilsa blokda kirsin.

Ilgari `create-order-dialog.tsx` qator birligini HAR DOIM `product.baseUnitId` qilib qo'yardi va
oynada birlik tanlovi umuman yo'q edi. Natijada ta'minotchi blok bilan sotsa ham hujjatga dona
yozilar, narx esa mahsulotning `purchasePrice` idan (import faylida u BLOK narxi bo'ladi) olinardi
— ya'ni 10 blok 10 dona bo'lib, summa 6 barobar kam chiqardi. Server tomonda konversiya
(`unitFactorToBase`) allaqachon to'g'ri ishlardi, yetmagani — kirish oynasi.

- **API:** `unitOptionsForProducts` (`catalog/conversions.ts`) — bir necha mahsulot uchun
  "qaysi birlikda kiritish mumkin" ro'yxatini BITTA so'rovda beradi (asosiy birlik birinchi,
  keyin konversiyasi bor birliklar; mahsulotga xos konversiya umumiysidan ustun).
  `GET /api/catalog/products?withUnits=true` — har mahsulotga `unitOptions[]`
  (`unitId`, `name`, `shortName`, `factor`). Bayroqsiz javob AVVALGIDEK (POS va boshqa
  ro'yxatlar qo'shimcha so'rov qilmaydi); eksport so'rovida bu parametr yo'q.
- **Web:** Miqdor katagida birlik tanlovi (mahsulotda qadoq bo'lsa — "Dona" / "Blok").
  Qator ochilganda mahsulotning XARID birligi qo'yiladi (yo'q bo'lsa — asosiy).
  Birlik almashtirilsa narx ham o'sha birlikka keltiriladi (6000/dona → Blok(6) → 36000/blok).
  Miqdor ostida omborga nechta asosiy birlik tushishi ko'rinadi ("= 60 dona").
  Yangi yaratilgan mahsulotda `unitOptions` bo'lmaydi — birlik nomi `/api/catalog/units` dan.

Qabul tomoni o'zgarmadi: u allaqachon `item.unitName` ni ko'rsatadi va qoldiqqa konversiya bilan
tushadi.

Testlar: `import-units-prices.test.ts` +3 (ro'yxat asosiy birlikni birinchi qaytaradi va
koeffitsient bilan blokni beradi; bayroqsiz so'rovda `unitOptions` umuman yo'q; begona
kompaniyaning konversiyasi qo'shilmaydi) → 24/24. Regressiya: `products`, `catalog`, `purchase`,
`purchase-csv` — 36/36. Frontend to'plami 35 fayl / 166 test yashil; `tsc` (API va web) va
`eslint` toza.

**Production (2026-09-24):** commit `62114b9`, `bum-api` va `bum-web` deploy qilindi.
API toza ko'tarildi (`Migratsiyalar qo'llandi (28ms)`, bitta `Server listening`, crash-loop yo'q),
`/api/auth/me` tashqaridan 401. Web `build.json` 06:49 dan **09:35:35Z** ga yangilandi va yangi
bundle'da (`index-0ur1D-oV.js`) `withUnits` hamda `unitOptions` bor — ya'ni yangi kod ishlayapti.
Yangi migratsiya bu bosqichda yo'q. Tizimga kirgan holda qo'lda sinov — egasi bajaradi.

### TUZATISH: standart birlik blok emas, DONA (2026-09-24)

Egasi production'da sinab ko'rdi va xatoni topdi: oyna 1 blokni 8 300 so'mda ko'rsatdi —
ya'ni BITTA DONA narxi blok narxi bo'lib qolgan edi (blokda 12 dona bor).

Sabab: qator ochilganda mahsulotning `purchase_unit_id` (blok) qo'yilardi, narx esa
`products.purchase_price` dan olinardi — u ASOSIY birlik narxi. Ikkalasi bir-biriga mos emas edi.
Men buni deploydan oldin qo'lda sinamagan edim; xulosa — "bajarildi" deyishdan oldin real ishlatib
ko'rish shart.

Tuzatma:
- Qator endi HAR DOIM asosiy birlikda ochiladi (`defaultUnitId` → `baseUnitId`); blokka
  foydalanuvchi o'zi o'tadi va o'tganda narx koeffitsientga ko'paytiriladi (8 300 → 99 600).
- Narx maydonining ostida qaysi birlik uchun ekani yoziladi ("1 blok narxi").
- Birlik mantig'i `src/pages/purchase/_lib/units.ts` ga chiqarildi (`unitsOf`, `factorOf`,
  `defaultUnitId`, `convertUnitPrice`) — endi test bilan qulflangan.

Tekshiruv (bu safar REAL):
- Yangi `create-order-dialog.test.tsx` (7 test) — oynaning O'ZI render qilinib, mahsulot
  qidiruv orqali qo'shiladi: qator "Dona" da ochiladi, 1 dona → 8 300 so'm, 12 dona → 99 600 so'm.
  Test eski xulq bilan QIZIL bo'lishi tasdiqlandi (`defaultUnitId` ni vaqtincha qaytarib sinaldi).
- Lokal to'liq zanjir (demo baza, `EZO-460`: 1 dona = 8 300, 1 blok = 12 dona):
  1 Blok × 99 600 buyurtma → jami 99 600 → qabul → **omborda 12 dona, tannarx 8 300/dona**.
- Frontend to'plami 36 fayl / 173 test yashil; `tsc` va `eslint` toza.

OCHIQ SAVOL (egasiga): mahsulot IMPORTIDA narx ustuni qadoq birligi bilan berilsa
(`purchaseUnit=bl`, `unitsPerPackage=12`, `purchasePrice=60000`), `products.purchase_price` ga
fayldagi qiymat AYNAN yoziladi — ya'ni blok narxi. Web formasida esa u dona narxi sifatida
ishlatiladi. Ikkala yo'l bitta ustunga boshqa ma'no yuklayapti; qaysi biri to'g'ri ekanini egasi
aytishi kerak (tuzatish alohida ish sifatida bajariladi).

**Production (2026-09-24, tuzatish):** commit `b23128c`, faqat `bum-web` (API o'zgarmadi).
`build.json` 09:35:35Z → **09:55:41Z**, yangi bundle `index-C9EEzso7.js`.

## Narx ikkala birlikda, oq ekran himoyasi va sotuvda blok (2026-09-24)

Egasining uchta so'rovi.

### 1. Narx dona va blokda birga

Xarid va sotuv qatorida endi IKKITA narx maydoni: tanlangan birlik narxi va ikkinchi birlik narxi
("1 dona narxi" / "1 blok narxi"). Qaysi biriga yozilsa, ikkinchisi koeffitsient bilan o'zi
hisoblanadi (8 300/dona ↔ 99 600/blok). Birlik mantig'i `src/lib/units.ts` ga chiqarildi va
xarid hamda sotuv oynasi shuni ishlatadi.

### 2. Oq ekran — xato chegarasi qo'yildi

Egasi "Dostavka" ga kirganda butun sahifa oq bo'lib qoldi (yon menyu ham yo'q). Sabab aniqlandi:
ilovada **xato chegarasi (ErrorBoundary) umuman yo'q edi** — React'da ushlanmagan istalgan xato
butun daraxtni yechib tashlaydi, shuning uchun bitta bo'limdagi xato butun ilovani o'chirardi.

- Yangi `src/components/error-boundary.tsx`: xato bo'limda ushlanadi, menyu joyida qoladi,
  foydalanuvchi xato matnini ko'radi va "Xato matnini nusxalash" bilan yubora oladi.
  Marshrut o'zgarsa chegara o'zi tiklanadi.
- Uch joyga qo'yildi: ERP layout (`Outlet`), sotuv agenti va yetkazuvchi ish joylari.
- Yangi `e2e/delivery-page-loads.spec.ts` — Dostavka sahifasi haqiqiy brauzerda ochiladi,
  ushlanmagan xato yo'q. Lokal demo ma'lumotda sahifa TOZA ochildi, ya'ni production'dagi
  xato ma'lumotga bog'liq; endi u oq ekran o'rniga sababini ko'rsatadi.

### 3. Sotuv buyurtmasi: birlik va keng ekran

- Miqdor katagida birlik tanlovi (Dona / Blok), ostida asosiy birlikdagi miqdor ("= 12 dona").
- Narx ikkala birlikda (yuqoridagidek); birlik almashsa narx va prays-list narxi ham keltiriladi.
- Oyna sarlavhasida butun ekranga yoyish tugmasi (xariddagidek, `sm:max-w-[98vw]`).

### Tekshiruv — REAL brauzerda (Playwright)

`e2e/order-units.spec.ts` (2 test, ikkalasi ham yashil):
- **Xarid:** qator Dona'da ochiladi, narx 8 300, ikkinchi maydon 99 600; Blokka o'tilganda
  asosiy maydon 99 600, ikkinchisi 8 300, qatorda "= 12 dona".
- **Sotuv:** keng ekran tugmasi holatni almashtiradi; narx 12 000/dona va 144 000/blok;
  Blokka o'tilganda 144 000 va "= 12 dona".

Frontend to'plami 37 fayl / 176 test yashil; `tsc` va `eslint` toza.

**Production (2026-09-24):** commit `14c7a33`, `bum-web` (API o'zgarmadi).
`build.json` → **10:22:21Z**, bundle `index-ChyXOyT_.js`; xato chegarasi matni bundle ichida.
Dostavka production'da yana yiqilsa — endi oq ekran o'rniga xato matni chiqadi, egasi uni
nusxalab yuboradi va sabab aniqlanadi.

## Oq ekran sababi topildi va miqdor butun son bo'ldi (2026-09-24)

### Dostavka oq ekrani — TDZ xatosi

Xato chegarasi qo'yilgandan keyin egasi aniq matnni yubordi:
`Cannot access 'w' before initialization` — `Array.filter` ichida. Production bundle'ining
o'sha joyidan (`index-ChyXOyT_.js:325:792319`) funksiya aniqlandi: **`TasksSection`**.

Sabab (`tasks-section.tsx`): `selected` holati **120-qatorda** e'lon qilinardi, lekin
**62-qatorda** ishlatilardi:

    const printable = (rows ?? []).filter(...);
    const selectedPrintable = printable.filter((task) => selected.has(task.id));  // ← TDZ

`printable` BO'SH bo'lsa callback umuman ishlamaydi — shuning uchun lokal demo bazada ham,
testda ham chiqmasdi. Production'da yo'lga chiqayotgan yetkazma bor edi → yiqildi.
Xato chegarasi yo'q edi, shuning uchun butun ilova o'chib, oq ekran qolardi.

Tuzatma: holatlar hamma hosila qiymatlardan oldin e'lon qilinadi.

**Sinf butunlay yopildi:** `@typescript-eslint/no-use-before-define` qoidasi frontendga
(`src/**`, shadcn `ui/**` dan tashqari) yoqildi. Qoida darhol `purchase/order-detail-drawer.tsx`
dagi ikkita xavfli tartibni ham topdi — ular ham to'g'rilandi. Backend va testlarda qoida
yoqilmadi (u yerda render paytida ishlaydigan kod yo'q, 14 fayl qayta tartiblanishi kerak bo'lardi).

### Miqdor butun son: dona, quti, blok, pallet

Ilgari miqdor maydoni har doim kasr qabul qilardi (`step=0.001`) — "1.5 dona" yozib bo'lardi.
Endi belgi BIRLIKNING O'ZIDA: migratsiya `0085_unit_allows_fraction` — `units.allows_fraction`
(standart `true`), dona/quti/blok/pallet uchun `false`, kg/litr/metr/gramm/ml uchun `true`.

- Belgi `GET /api/catalog/units` va mahsulot `unitOptions[]` bilan keladi.
- Xarid va sotuv oynasi: sanaladigan birlikda `step=1` va kiritilgan kasr butun songa
  yaxlitlanadi (2.6 → 3); birlik almashtirilganda miqdor ham moslanadi.
- Platforma admini yangi birlik qo'shganda belgini o'zi tanlaydi (`POST/PATCH /api/catalog/units`).

### Tekshiruv

- `e2e/order-units.spec.ts` — haqiqiy brauzerda: Blokda `step=1`, `2.6` kiritilsa `3` bo'ladi.
- `e2e/delivery-page-loads.spec.ts` — Dostavka ochiladi, ushlanmagan xato yo'q.
- `import-units-prices.test.ts` +2 (birlik belgisi va mahsulot ro'yxatidagi belgi) → 26/26,
  `catalog` 6/6; regressiya: `products`, `purchase`, `pos`, `product-cost` (32) va
  `purchase-csv`, `sales`, `sales-agent-catalog-notify`, `pos-purchase-sync` (22) — yashil.
- Frontend 37 fayl / 176 test; `tsc` (API va web) va `eslint` toza.

**Production (2026-09-24):** commit `ee22f62`, `bum-api` va `bum-web`.
Web `build.json` → **11:05:18Z**, bundle `index-DMzdjjbu.js` (ichida `allowsFraction` bor).
API sog'lom: `/api/auth/me` → 401, loglarda 500 YO'Q, so'rovlar 200 bilan javob beryapti.
Migratsiya `0085` qo'shimcha va idempotent (`add column if not exists`); API migratsiya
muvaffaqiyatsiz bo'lsa ishga tushmasdi — xizmat esa ishlayapti.

## "Nakladnoy" tugmasi belgilanganda yonadi (2026-09-24)

Egasi yetkazmani belgiladi, "Nakladnoy" esa o'chiq turaverdi. Sabab: IKKITA alohida tugma bor edi —
"Nakladnoy" faqat **agent + bitta kun** filtri bilan yonardi, belgilanganlar uchun esa yonida
"Belgilanganlar (N)" degan boshqa tugma turardi. Tugma nega o'chiqligi ekranda ko'rinmasdi.

Endi bitta tugma ikkala yo'lni qamraydi:
- yetkazmalar belgilangan bo'lsa — **"Nakladnoy (N)"**, aynan shular (har biri alohida A4 sahifada);
- belgilanmagan bo'lsa va agent + bitta kun tanlangan bo'lsa — agentning kunlik nakladnoyi;
- ikkalasi ham yo'q bo'lsa — o'chiq, tooltipda sababi: "Yetkazmalarni belgilang yoki agent va
  bitta kunni tanlang".

Bekor qilingan va yakunlangan yetkazmalarning belgilash katagi avvalgidek o'chiq — ular
nakladnoyga tushmaydi.

Testlar: yangi `tasks-section.test.tsx` (4) — ro'yxat yiqilmaydi (TDZ regressiyasi ham shu yerda
qulflandi), belgilanmaganda tugma o'chiq va sababi tooltipda, qator belgilansa tugma yonadi va
"Nakladnoy (1)" bo'ladi, bekor qilingani belgilanmaydi. Test eski xulq bilan QIZIL bo'lishi
tasdiqlandi. Frontend to'plami 38 fayl / 180 test; `tsc` va `eslint` toza;
`e2e/delivery-page-loads.spec.ts` yashil.

## Hujjat dizayneri (2026-09-24)

Egasi topshirig'i: nakladnoyni foydalanuvchi Word'ga o'xshab o'zi tahrir qila oladigan tizim.
To'liq hujjat — `DOCUMENT_DESIGNER.md`.

**Auditda topilgan production xatosi:** PDF'da kirill matn buzilardi (`Раматов Расул` →
`0 < 0 B > 2  0 A C ;`), chunki jsPDF ning `helvetica` shrifti faqat Latin-1 ni biladi.
Endi hamma hujjat PT Sans (OFL) bilan ochiladi; shrift `/fonts/` dan yuklanadi va
`setFont("helvetica")` unga yo'naltiriladi — mavjud hujjat kodi o'zgarmadi.

**Qurildi:** `document_templates` + versiyalar (migratsiya `0086`), `/api/documents` API,
maydonlar katalogi, oq ro'yxatli sanitizatsiya, shablon → A4 renderer va
**Sozlamalar → Hujjatlar** dizayneri (jonli A4 ko'rinish — haqiqiy PDF).

Moliyaviy yaxlitlik qat'iy: shablon faqat KO'RINISHni boshqaradi, summa serverdan keladi.

Testlar: API 17 (versiyalash, XSS, tannarx ruxsati, tenant), renderer 10 (ko'p sahifa va
moliyaviy yaxlitlik), brauzer e2e 2 + kirill PDF e2e 2. Frontend 40 fayl / 194 test.
Production: `5a4696b` — API toza ko'tarildi, web `build.json` 14:46:41Z.

**Hujjat dizayneri 5–6-bosqich (2026-09-24):** rasm (data URL), QR, shtrix-kod va sahifa
raqami elementlari; jadval ustunlarining tartibi va kengligi; nakladnoy chiqarish shablonga
ulandi. Shablon tuzilmaguncha nakladnoy AVVALGI ko'rinishda qoladi (`custom: false`).
Production: `d08063e`, API toza ko'tarildi, web `build.json` 16:03:37Z.

**Nakladnoy qo'llanmasi (2026-09-25):** `docs/NAKLADNOY-QOLLANMA.md` — shablon yaratishdan
A4da chop etishgacha amaliy qo'llanma (xodimlar uchun ulashiladigan sahifa ham chiqarildi).
Qo'llanmani yozayotganda nuqson topildi: dizaynerdagi "Shtrix-kod" elementining nomi
`ELEMENT_LABELS` da yo'q edi, shuning uchun tugma nomsiz chiqardi — yorliq qo'shildi.
Production: `a1a7466`, faqat `bum-web` (API o'zgarmadi), `build.json` → 2026-09-25T02:35:41Z,
bundle `index-jYkSBk2l.js`.

**Hisob-faktura va xarid shablonga ulandi (2026-09-25):** yangi
`src/lib/pdf/document-template-bridge.ts` — sotuv hisob-fakturasi va xarid buyurtmasi ham
kompaniyaning shabloni bilan chiqadi. Qoida o'sha: shablon "Standart" qilinmaguncha hujjat
AVVALGI ko'rinishda qoladi. Ko'prik qiymatni ko'chiradi, qayta hisoblamaydi (test bilan
qulflangan). Testlar: yangi `document-template-bridge.test.ts` (11) va brauzer e2e (+1);
frontend 41 fayl / 209 test. Qolgan hujjat — maosh varaqasi.

**Nakladnoy "chala" edi — tuzatildi (2026-09-25):** egasi yuborgan PDF dekodlab tekshirildi.
(1) Server nakladnoyga BUYURTMA QATORLARINI yubormasdi — endi `items` bilan keladi;
(2) ustun sarlavhalari xom kalit (`quantity`) bo'lib chiqardi — o'zbekcha nomlar qo'shildi;
(3) dizaynerda yangi jadval noto'g'ri ustunlar bilan ochilardi — endi hujjat turiga mos;
(4) maydon almashtirilganda yorliq ergashmasdi (`Kompaniya nomi: Test Market`) — tuzatildi.
Kirill va tezlik tekshirildi — muammo emas (CMap'da `Р` bor; 5 nakladnoy 141 ms).
Testlar: `delivery-template.test.ts` (9), `delivery-waybill.test.ts` (+1), brauzer e2e;
frontend 42 fayl / 218 test.

**Production (2026-09-25):** commit `0a93bf0`, `bum-api` va `bum-web`.
API toza ko'tarildi (`Migratsiyalar qo'llandi (28ms)`, bitta `Server listening`, 500 yo'q);
`/api/delivery/waybills/bulk` → 401 (marshrut bor). Web `build.json` → 04:07:57Z.

**Ko'p nakladnoy: glif buzilishi va aqlli A4 (2026-09-25):** egasi yuborgan PDF'da 2-sahifada
nomlar teshik, jami `42,200` o'rniga `2,200` edi. Sabab ma'lumotda emas — har nakladnoy
alohida PDF qilinib sahifasi nusxalanardi, glif to'plamlari esa mos kelmasdi (test bilan
tasdiqlandi: kirill glifi yakuniy shriftga umuman kirmagan). Endi hammasi BITTA hujjatga
chiziladi. Qo'shimcha: nakladnoylar A4 ga aqlli joylashadi (sig'gani birga, hujjat
o'rtasidan bo'linmaydi, kichraytirish yo'q), "Aqlli A4 / Har biri alohida varaq" tanlovi.
Testlar: `bulk-print.test.ts` (9, PDF matnini ajratib tekshiradi), `e2e/bulk-print.spec.ts` (4);
frontend 43 fayl / 228 test.
**Production (2026-09-25):** commit `b10fbb5`, faqat `bum-web` (API o'zgarmadi).
`build.json` → 07:30:21Z, bundle `index-3ShcvU5O.js`; renderer bo'lagi
`template-renderer-UtUbeZvh.js` ichida `renderDocuments` bor, sahifa nusxalash kodi yo'q.

**Nakladnoy real qabul sinovi (2026-09-25):** egasi dasturda sinab ko'rib rad etdi — ikkita
nakladnoy hamon ikki varaqqa chiqardi, jadval chiziqlari / rasm / QR tahrirlanmasdi. Sabablar
va yechimlar:

- **Ikkitasi bitta A4 ga sig'masdi**, chunki bitta nakladnoy 133 mm edi. `pdf-utils.drawSignatures`
  imzo blokiga 34 mm ajratib, tagiga yana bugungi sanani yozardi. Shablon renderi uchun ixcham
  imzo bloki yozildi (standart 22 mm, `height` bilan 12–70 mm). Nakladnoy 115 mm bo'ldi →
  ikkitasi bitta varaqda. Shablonsiz hujjatlar eski ko'rinishida qoldi.
- **Taglikda sahifa raqami ikki marta** chizilib ustma-ust tushardi (`drawFooter` va shablonning
  "sahifa raqami" elementi). `drawFooter(doc, tagline, { pageNumbers: false })` qo'shildi.
- **Dizaynerda sozlama paneli ko'rinmasdi**: Sozlamalar sahifasining `max-w-[1400px] mx-auto`
  qutisi flex ustunida cho'zilmay, 1400 px bo'lib qolardi va sahifa yon tomonga surilardi.
  `w-full` qo'shildi; jadval ustunlari `minmax(0,1fr)` ga o'tdi.
- **Oldindan ko'rishda QR umuman chizilmasdi** — namuna ma'lumotda `codes` yo'q edi.

Yangi imkoniyatlar (hammasi oq ro'yxat orqali, server tomonda qayta quriladi):
`TableStyle` (har tomon alohida, chiziq turi to'liq/uzuq/nuqtali/qo'sh, qalinlik, rang, katak
bo'shlig'i, qator balandligi, shrift, zebra, sarlavha ranglari, vertikal tekislash),
`BoxStyle` (rasm/chiziq/to'rtburchak ramkasi), `rect` elementi, rasm yuklash + nisbat qulfi +
`fit`, QR `qrLevel`/`qrMargin`/yozuv, ustun tartibi/nomi/kengligi, element nusxalash.

Yo'l-yo'lakay tuzatildi: `pnpm build` (`tsc -b`) uchta eski tip xatosida yiqilardi (deploy
faqat `vite build` ishlatgani uchun sezilmagan) — nakladnoy funksiyasining qaytish turi,
`UnitOption` importi, sotuv agenti `ErrorBoundary` ning `resetKey` i (`location.pathname`
geolokatsiya obyektida yo'q edi). PT Sans da qiya shrift yo'qligi ham tuzatildi.

Sinov: `e2e/nakladnoy-acceptance.spec.ts` (5) — haqiqiy brauzerda Dostavka bo'limidan 2/3/4/10
yetkazma tanlanadi, "Nakladnoy" bosiladi, yuklab olingan PDF pdf.js bilan rasmga aylantirilib
sahifa soni va matni tekshiriladi (rasmlar `e2e/.artifacts/nakladnoy/`).
`e2e/document-designer-acceptance.spec.ts` (7) — chiziq, ustun, rasm yuklash, QR, saqlash +
sahifani yangilash, versiyani qaytarish; QR jsQR bilan DEKODLANADI va buyurtma raqamini
ko'rsatishi tasdiqlanadi. `src/lib/pdf/template-style.test.ts` (6) — PDF ichidagi chizish
buyruqlari. Frontend 44 fayl / 234 test, API hujjat testlari 24 ta.
To'liq e2e: 104 o'tdi, 6 yiqildi — hammasi SHU ISHDAN OLDIN HAM yiqilardi (o'zgarishlarni
`git stash` qilib tasdiqlandi): `company-login` (1), `csv-import` (2), `quick-add` (1),
`sales-agent` (2). Ular alohida ish sifatida qoldi.

**Production (2026-09-25):** commit `1f99e19`, `bum-api` + `bum-web`.
API konteyneri 10:07:23Z da qayta ko'tarildi (migratsiyalar bir marta, qayta yiqilish yo'q),
`build.json` → 10:10:40Z, bundle `index-ip19EFl8.js` (yangi yozuvlar bor: "Aqlli A4",
"Jadval chiziqlari", "Rasm yuklash", "Nima kodlanadi", "Xatolikka chidamlilik"),
renderer bo'lagi `template-renderer-COHbuNrS.js` → 200. `/api/documents/fields` va
`/api/documents/templates` → 401 (marshrut bor). Production bazasida shablon SAQLAB
KO'RILMADI — egasining ma'lumotiga tegmaslik uchun; o'sha kod lokalda to'liq sinovdan o'tgan.

### Hujjat dizayneri 2-bosqich — VIZUAL (sichqoncha bilan) dizayner (2026-09-25)

**Nima qilindi (commit `7b8676b`):** shablon endi ERKIN JOYLASHUVDA (`page.layout: "free"`):
har element `x/y/width/height` (mm, varaqning yuqori-chap burchagidan) va `zIndex` bilan.
Sozlamalar → Hujjatlar: A4 varaqda element sichqoncha bilan suriladi, 8 tutqich bilan
kattalashtiriladi/kichraytiriladi (rasm va QR nisbati saqlanadi), Ctrl+bosish/ramka bilan ko'p
tanlash, tekislash (6), taqsimlash (2), qatlam (4), nusxa, Delete/Esc, strelka (1 mm / Shift
10 mm), Ctrl+Z/Y, zoom 25–200%, mm chizg'ich, katak va yopishish, aniq X/Y/eni/bo'yi, shrift
quti o'lchamidan alohida, `{{maydon}}` qo'shish, brauzerda qoralama (versiya faqat "Saqlash"
bilan). Varaqdagi har element — haqiqiy PDF rendereri chizgan rasm (pdf.js), shuning uchun
dizayner va PDF bir xil. Eski (oqim) shablon ochilganda o'lchab erkin joylashuvga o'tkaziladi;
saqlanmaguncha bazadagi shablon o'zgarmaydi. Jadval o'ssa faqat uning ostidagilar suriladi;
sahifa raqami hujjat balandligiga kirmaydi (2 nakladnoy → 1 A4 saqlanadi).

**Tekshirildi (lokal):** `pnpm build` (tsc -b + vite) ✓, eslint ✓, frontend 46 fayl / 268 test ✓,
API 155 fayl / 1078 test ✓ (bo'lak-bo'lak). Haqiqiy Chrome, sichqoncha bilan 9 ta qabul testi
(`e2e/document-designer-visual.spec.ts`) ✓: logo/maydon/QR/jadval/imzo/to'rtburchak/chiziq
surildi, kattalashtirildi, saqlandi, sahifa yangilanib joyi tekshirildi; dizayner va PDF
pikselma-piksel 100% mos; QR PDF dan dekoder bilan o'qilib joyi ±0.5 mm; Dostavkadan
2 nakladnoy → 1 A4. To'liq E2E: hammasi o'tdi. Oldingi 6 ta "eski" yiqilish (oldingi commitda
ham yiqilardi — `git stash` bilan tasdiqlandi) eskirgan testlar edi va tuzatildi: kirish namunasi
`bum`, mijozlar CRM da, "Birlikdagi dona" ustuni, sotuv agentida ilova kamerasi.

**Production (2026-09-25):** `bum-api` + `bum-web`. API 15:20:45Z da bir marta ko'tarildi
(migratsiya bir marta, qayta yiqilish yo'q), `build.json` → 15:19:41Z, bundle `index-CHrAL6jl.js`
ichida `template-free-*.js` va `pdf.worker.min-*.js` (ikkalasi 200, `application/javascript`).
`/api/auth/me` → 401. **Production'da brauzer orqali sinalmadi** — kompaniya hisobisiz kirib
bo'lmaydi va egasining ma'lumotiga tegilmadi. `bum-erp.uz` TLS muammosi hamon ochiq
(`curl` 60), tekshiruv `bum-web-production.up.railway.app` orqali.

**Brauzerda sinash:** Sozlamalar → Hujjatlar → shablon → elementni ushlab suring, burchagidan
torting → Saqlash → sahifani yangilang → "PDF" tugmasi; Dostavka → 2 yetkazma → Nakladnoy.

**Keyingi qadam:** egasi production'da dizaynerni sinab ko'rsin; `bum-erp.uz` TLS; aylantirish
(rotation) hali yo'q.

## ERP + moliya auditi — 1-bosqich (2026-09-25/26)

Egasining "PROFESSIONAL ERP + MOLIYA AUDIT" topshirig'i. Doimiy holat: `.claude/ERP-PROFESSIONAL-AUDIT.md`,
`ERP-AUDIT-PROGRESS.md`, `ERP-AUDIT-ISSUES.md` (AUD-001…027), `ERP-AUDIT-CHECKLIST.md`.

**Yopildi:**
- AUD-001 (CRITICAL) mijoz to'lovini bekor qilish: ko'rib chiqish + teskari yozuvlar (kassa, jurnal, taqsimot,
  qarz, hamyon/keshbek, komissiya, smena, yetkazma), atomik, idempotent, `finance.approve`, audit izi.
- AUD-010 (CRITICAL) kassa smenasi farqi endi kassa va jurnalga tushadi (5900 kamomad / 4300 ortiqcha).
- AUD-011 davr qulfi foydalanuvchi sanali hujjatlarda; AUD-012 qo'lda kassa/ombor harakati nazorat hisoblariga
  yozmaydi; AUD-021 inventarizatsiya tuzatmasi 1200 ga tushadi.
- AUD-005 mijoz akti, istalgan sanaga qarz, oyma-oy, aging 0–7/8–30/31–60/61–90/90+, Excel/PDF.
- Migratsiya 0087 (qo'shuvchi): `journal_lines.party_*` + backfill, to'lov holati, taqsimot jadvali.

**Tekshirildi:** eslint, `pnpm build`, frontend 268, API 158 fayl (yangi: audit-payment-reversal 8,
audit-controls 3, audit-customer-statement 3), E2E 33 fayl / 120 test (yangi: audit-customer-debt).

**Brauzerda sinash:** CRM → Mijozlar → mijoz qatoridagi 📄 "Akt"; akt'dagi to'lov qatorida "Bekor qilish";
Sotuv → Qarzdorlik → "Istalgan sanaga" / "Oyma-oy"; buyurtma kartasidagi to'lovlar ro'yxati.

**Keyingi:** AUD-013 (ta'minotchi to'lovi/xarajat/o'tkazma bekor qilish), AUD-020 ta'minotchi akti, qolgan
MEDIUM/LOW, 50 modul va 7 biznes senariysi.

**Production (2026-09-26):** commit `514bb43`, `bum-api` + `bum-web`. API bir marta ko'tarildi (migratsiya
0087 qo'llandi, qayta yiqilish yo'q), web `build.json` 19:22:17Z, yangi marshrutlar 401 (mavjud). Production
bazasida faqat o'qish tekshiruvi: 1556 mijoz — kesh = jurnal subhisobi, 0 nomuvofiqlik. Brauzer orqali
production'da sinalmadi (kompaniya hisobisiz).

## Distribution + moliya + kassa + qaytarish + hujjatlar (2026-09-26)

Egasining ustuvor vazifasi (audit AUD-013 da PAUSE). Doimiy holat: `.claude/PRIORITY-DISTRIBUTION-CASH.md`.
Qarorlar (egasi): Z1 rad etish — alohida hujjat; Z2 yuklash faqat qayd; Z3 qarzdan ortiq bank to'lovi — qarz + avans;
Z4 mas'ul faqat o'z kassasi.

**Tayyor (commitlar `92efdfe`…`d89f52d`, migratsiyalar 0088–0092 — faqat qo'shuvchi):**
- W1 nakladnoy: savdo agenti va yetkazuvchi (ism · telefon, yo'q bo'lsa "—"), bulk nakladnoy yetkazma qatoridan
  (qayta yetkazishda to'liq buyurtma miqdori chiqmaydi), QR alias; standart shablonda ixcham 2 qator.
- W2 ombor eksporti: `GET /api/inventory/stock/export`, "Eksport" va "Ombordagi miqdori bilan eksport" (Excel).
- W3 bank tushumi: `POST /api/sales/bank-receipts` — qarzgacha to'lov + qolgani avans (2300), bitta hujjat,
  bekor qilish avansni ham qaytaradi; balans to'ldirishni bekor qilish.
- W4 kassalar: `cash.own` (Kassir roliga), kassa hujjatlari (o'tkazma, to'lov usulini tuzatish/ayirboshlash,
  valyuta ayirboshlash kurs snapshoti bilan, kategoriyali kirim/chiqim), bekor qilish, kassa hisoboti; UI "Kassalar".
- W5 "Yetkazilmadi" (YT-, `delivery_refusal`) sotuvdan keyingi qaytarishdan ajratildi; qaytgan tovar holati
  (sotuvga / karantin / ta'minotchiga / shikastlangan / hisobdan chiqarish).
- W6 reys: snapshot, 3 hujjat (nakladnoy, yig'ma ×2, marshrut varag'i) mos kelishi tekshiriladi, terish/yuklash.
- Yo'l-yo'lakay: `setLockDate` UTC sana xatosi; E2E shablon tozalashi (biznes sarlavhasi); pos-mobile smenani o'zi ochadi.

**Tekshirildi:** tsc, eslint (butun repo), frontend 278 test, API 162 fayl (5 fayl tunda UTC sana tufayli yiqiladi —
`BUSINESS_UTC_OFFSET_MINUTES=0` bilan hammasi o'tadi, regressiya emas), 23-bo'lim senariysi testi
(`simulation-distribution.test.ts`), E2E barcha spec'lar (yangi: `priority-distribution-cash`), PDF QA (rasmlar).

**Brauzerda sinash:** Ombor → "Ombordagi miqdori bilan eksport"; CRM → Mijozlar → 🏛 "Bank orqali to'lov";
Moliya → "Kassalar" (rahbar), "Kassalar" menyusi (kassir, kassa biriktirilgan bo'lsa); Dostavka → "Reyslar";
buyurtma → Qaytarish → qator holati.

**Ochiq (keyingi):** kompaniyaning o'z nakladnoy shablonida yangi maydonlar dizaynerda qo'shiladi (avtomatik
o'zgartirilmaydi); standart nakladnoy jadvalida mahsulot ustunlari yo'q (mijoz ustunlari) — tavsiya; to'langan
xarajatni bekor qilish; POS qurilma analitikasida rad etish alohida emas. Keyin — AUDIT RESUMED (AUD-013).

**Production (2026-09-26 00:36Z):** `bum-api` + `bum-web` deploy qilindi (commit `d89f52d`). API bir marta ko'tarildi
(0088–0092 qo'llandi, qayta yiqilish yo'q), web `build.json` 00:36:08Z; yangi marshrutlar (`/api/sales/bank-receipts`,
`/api/finance/cash/registers`, `/api/finance/cash-documents`, `/api/inventory/stock/export`, `/api/delivery/trips`) 401 —
mavjud. Production bazasida faqat o'qish: 1556 mijoz — kesh = jurnal, 0 nomuvofiqlik; aylanma balans farqi 0.00;
yangi jadvallar va ustunlar bor; 4 ta Kassir rolida `cash.own`. Production'da brauzer orqali sinalmadi.
