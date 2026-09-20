#!/bin/sh
# BUM ERP — FAYL SAQLASH (S3) ZAXIRASI.
#
#   SOURCE_S3_ENDPOINT=https://s3.example.uz SOURCE_S3_BUCKET=bum-erp \
#   SOURCE_S3_ACCESS_KEY=... SOURCE_S3_SECRET_KEY=... SOURCE_S3_REGION=us-east-1 \
#   DEST_S3_ENDPOINT=https://backup.example.net DEST_S3_BUCKET=bum-erp-backup \
#   DEST_S3_ACCESS_KEY=... DEST_S3_SECRET_KEY=... DEST_S3_REGION=us-east-1 \
#   sh files-backup.sh
#
# Nega kerak: baza nusxasi YETARLI EMAS. Mahsulot rasmi, xodim surati va xarajat cheki faqat
# S3 da yashaydi (`products.image_key`, `employees.photo_key`, `expenses.attachment_key` — bular
# faqat KALIT). Bazani tiklab, fayllarni yo'qotib qo'yadigan arxitektura qabul qilinmaydi.
#
# Eslatma: savdo agenti tashrif rasmlari, mijoz vitrina rasmi va yetkazma dalillari S3 sozlanmagan
# paytda BAZADA (`bytea`) saqlanadi — ularni `pg-backup.sh` qamrab oladi. S3 yoqilgach yangi
# tashrif rasmlari S3 ga tushadi va shu skript ularni ham oladi.
#
# Nusxa INKREMENTAL (`rclone sync`): faqat o'zgargan obyektlar ko'chiriladi. Manba o'chirilgan
# obyektni nusxada darhol o'chirmaydi — `--backup-dir` bilan sanali papkaga surib qo'yadi, shunda
# tasodifiy o'chirishdan keyin ham tiklash mumkin.
#
# Maxfiylik: kalitlar faqat muhit o'zgaruvchisidan olinadi, logga chiqmaydi (`--log-level NOTICE`,
# rclone parollarni ko'rsatmaydi). Nusxa boshqa provayder/hisobda bo'lishi SHART — production
# saqlashi buzilganda yoki kalit o'g'irlanganda nusxa ham yo'qolmasin.
set -eu

: "${SOURCE_S3_ENDPOINT:?SOURCE_S3_ENDPOINT kerak}"
: "${SOURCE_S3_BUCKET:?SOURCE_S3_BUCKET kerak}"
: "${SOURCE_S3_ACCESS_KEY:?SOURCE_S3_ACCESS_KEY kerak}"
: "${SOURCE_S3_SECRET_KEY:?SOURCE_S3_SECRET_KEY kerak}"
: "${DEST_S3_ENDPOINT:?DEST_S3_ENDPOINT kerak}"
: "${DEST_S3_BUCKET:?DEST_S3_BUCKET kerak}"
: "${DEST_S3_ACCESS_KEY:?DEST_S3_ACCESS_KEY kerak}"
: "${DEST_S3_SECRET_KEY:?DEST_S3_SECRET_KEY kerak}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "RETENTION_DAYS butun son bo'lishi kerak" >&2; exit 2 ;;
esac

export RCLONE_CONFIG_SRC_TYPE=s3
export RCLONE_CONFIG_SRC_PROVIDER="${SOURCE_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_SRC_ENDPOINT="$SOURCE_S3_ENDPOINT"
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$SOURCE_S3_ACCESS_KEY"
export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$SOURCE_S3_SECRET_KEY"
export RCLONE_CONFIG_SRC_REGION="${SOURCE_S3_REGION:-us-east-1}"

export RCLONE_CONFIG_DST_TYPE=s3
export RCLONE_CONFIG_DST_PROVIDER="${DEST_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_DST_ENDPOINT="$DEST_S3_ENDPOINT"
export RCLONE_CONFIG_DST_ACCESS_KEY_ID="$DEST_S3_ACCESS_KEY"
export RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$DEST_S3_SECRET_KEY"
export RCLONE_CONFIG_DST_REGION="${DEST_S3_REGION:-us-east-1}"

echo "[files] boshlandi: $stamp"

# O'chirilgan/almashtirilgan obyektlar yo'qolmasin — sanali arxivga suriladi
rclone sync "src:$SOURCE_S3_BUCKET" "dst:$DEST_S3_BUCKET/current" \
  --backup-dir "dst:$DEST_S3_BUCKET/archive/$stamp" \
  --fast-list --transfers 8 --checkers 16 --log-level NOTICE

# Yaxlitlik: manba va nusxa xeshlari solishtiriladi (nusxa "bor" bo'lishi yetarli emas)
rclone check "src:$SOURCE_S3_BUCKET" "dst:$DEST_S3_BUCKET/current" --one-way --fast-list --log-level NOTICE

objects="$(rclone size "dst:$DEST_S3_BUCKET/current" --json 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p')"
bytes="$(rclone size "dst:$DEST_S3_BUCKET/current" --json 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
echo "[files] tayyor: ${objects:-?} ta obyekt, ${bytes:-?} bayt"

# Eski arxiv papkalari (o'chirilgan fayllar tarixi) — saqlash muddatidan keyin tozalanadi
rclone delete "dst:$DEST_S3_BUCKET/archive" --min-age "${RETENTION_DAYS}d" --rmdirs --log-level NOTICE || true
echo "[files] $RETENTION_DAYS kundan eski arxiv tozalandi"
