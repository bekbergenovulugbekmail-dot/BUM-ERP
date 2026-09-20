# BUM ERP — ZAXIRA ARXITEKTURASI

> **Holat:** bu papkadagi hamma narsa — KOD va LOYIHA. Production'ga hech narsa o'rnatilmagan,
> Railway'da zaxira xizmati hali YARATILMAGAN. O'rnatish egasining qaroridan keyin bajariladi.

## 1. Nimani himoya qilamiz

| Ma'lumot | Qayerda | Nusxaga kim oladi |
|---|---|---|
| Baza (kompaniya, foydalanuvchi, savdo, xarid, to'lov, jurnal, qoldiq…) | Railway PostgreSQL (`Postgres--bSX`, ichki tarmoq) | `pg-backup.sh` |
| Savdo agenti tashrif rasmlari, mijoz vitrina rasmi, yetkazma dalillari | **Hozir bazada** (`bytea`), S3 yoqilgach — S3 | hozir `pg-backup.sh`, S3 dan keyin `files-backup.sh` |
| Mahsulot rasmi, xodim surati, xarajat cheki | Faqat S3 (bazada faqat KALIT: `image_key`, `photo_key`, `attachment_key`) | `files-backup.sh` |

**Eng muhim xulosa:** production'da fayl saqlash (S3) hali sozlanmagan — shuning uchun BUGUN baza
nusxasi hamma narsani qamraydi. **S3 yoqilgan kundan boshlab baza nusxasi YETARLI EMAS**: mahsulot
rasmi va xarajat cheki faqat S3 da bo'ladi. Shu sababli `files-backup.sh` S3 dan OLDIN ishga
tushirilishi shart — aks holda bazani tiklab, rasmlarni yo'qotadigan holat yuzaga keladi.

## 2. Xizmat

`deploy/backup/Dockerfile` — `postgres:18-alpine` + `openssl` + `rclone`. Ilova xizmatidan
(`bum-api`, `bum-web`) ALOHIDA: o'z konteyneri, o'z o'zgaruvchilari, o'z volume'i.

| Skript | Vazifasi |
|---|---|
| `pg-backup.sh` | `pg_dump` (custom, siqilgan) → AES-256/PBKDF2 shifrlash → SHA-256 → saqlash muddati |
| `pg-restore-test.sh` | Nusxani ALOHIDA sinov bazasiga tiklaydi va qatorlar sonini manba bilan solishtiradi |
| `files-backup.sh` | S3 → mustaqil S3 ga inkremental `rclone sync` + `rclone check` (xesh solishtiruvi) |
| `files-restore-test.sh` | Nusxadan namuna obyektlarni yuklab, hajmi va SHA-256 ini tekshiradi |

## 3. Maxfiylik va kirish

- Barcha kalitlar **faqat muhit o'zgaruvchisidan**: `DATABASE_URL`, `BACKUP_PASSPHRASE`,
  `SOURCE_S3_*`, `DEST_S3_*`. Repositoryda hech qanday sir yo'q (`.env` git'da kuzatilmaydi).
- `BACKUP_PASSPHRASE` **majburiy**: parolsiz nusxa yozilmaydi (`pg-backup.sh` xato bilan to'xtaydi).
  Faqat lokal sinov uchun `BACKUP_ALLOW_PLAINTEXT=1`.
- Fayllar `umask 077` bilan — faqat egasi o'qiydi. Loglarda parol, ulanish satri va token yo'q.
- Nusxa saqlash joyi production bazasi va production S3 dan **boshqa hisobda/provayderda** bo'lishi
  shart: kalit o'g'irlansa yoki hisob bloklansa nusxa ham yo'qolmasin.
- Zaxira xizmati bazaga faqat O'QISH uchun ulanadi; tiklash sinovi esa production'ga umuman
  ulanmaydi (`pg-restore-test.sh` bazaning nomida `restore`/`test` bo'lishini talab qiladi va
  manba bilan bir xil bo'lsa ishlamaydi).

## 4. Siyosat (tavsiya etiladigan jadval)

| Davriylik | Ish | Skript |
|---|---|---|
| Har kuni (Toshkent 02:00 = UTC 21:00) | Shifrlangan baza nusxasi | `pg-backup.sh` |
| Har kuni | Fayllarning inkremental nusxasi | `files-backup.sh` |
| Har hafta | Nusxa yaxlitligini to'liq tekshirish (SHA-256 + `pg_restore --list` + `rclone check`) | `pg-backup.sh` + `files-backup.sh` loglari |
| Har oy | ALOHIDA muhitda to'liq tiklash sinovi va solishtiruv | `pg-restore-test.sh` + `files-restore-test.sh` |

**Saqlash muddati:** kamida **30 kun** (`RETENTION_DAYS`, standart 30). O'chirilgan fayllar
`archive/<sana>/` ga suriladi va shu muddatdan keyin tozalanadi — tasodifiy o'chirishdan keyin ham
tiklash oynasi qoladi.

## 5. Tiklash tartibi (RTO/RPO)

1. Kerakli nusxani tanlash (`bum-erp-YYYYMMDDTHHMMSSZ.dump.enc`) va SHA-256 ni tekshirish.
2. **Yangi, bo'sh** bazaga tiklash (`pg-restore-test.sh` yoki qo'lda `pg_restore --clean`).
3. Solishtiruv: migratsiyalar soni, asosiy jadvallar qatorlari, jurnal debet = kredit,
   balanslanmagan yozuv 0 (auditda ishlatilgan so'rovlar — `FINAL-ACCEPTANCE-AUDIT-v3.md`).
4. Fayllar: `files-restore-test.sh` bilan namuna tekshiruvi, keyin `rclone sync` teskari yo'nalishda.
5. Faqat shundan keyin ilovani yangi bazaga ulash.

**RPO** (yo'qotish oynasi): kunlik nusxada — 24 soat. Undan kichik RPO kerak bo'lsa Railway'ning
o'z PITR imkoniyati yoki soatlik nusxa kerak (tarif bilan tekshirilishi shart).
**RTO** (tiklash vaqti): baza hajmi 2 MB atrofida — tiklash daqiqalar ichida; fayllar hajmi o'sgani
sari `rclone` vaqti ortadi.

## 6. Egasi bajaradigan qadamlar (hali BAJARILMAGAN)

1. Railway'da yangi xizmat: `bum-backup`, manba — shu repo, `RAILWAY_DOCKERFILE_PATH=deploy/backup/Dockerfile`.
2. Volume: `/backups` (baza nusxalari uchun) — yoki to'g'ridan-to'g'ri mustaqil S3 ga yozish.
3. Cron Schedule: `0 21 * * *`.
4. O'zgaruvchilar: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `BACKUP_PASSPHRASE=<yangi kuchli parol>`,
   `RETENTION_DAYS=30`. Parolni **alohida xavfsiz joyda** saqlang — yo'qolsa nusxa ochilmaydi.
5. Railway tarifidagi o'z zaxira/PITR imkoniyatini tekshirish (bizning nusxamiz uni almashtirmaydi,
   to'ldiradi).
6. S3 yoqilganda: ikkinchi cron — `files-backup.sh`, mustaqil provayderdagi bucket bilan.
7. Birinchi oyda qo'lda bir marta to'liq tiklash sinovi o'tkazib, natijani `MIGRATION_STATUS.md` ga yozish.
