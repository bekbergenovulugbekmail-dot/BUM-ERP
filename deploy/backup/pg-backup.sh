#!/bin/sh
# BUM ERP — PostgreSQL zaxira nusxasi (bepul: pg_dump + fayl tizimi / volume).
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/backups RETENTION_DAYS=14 BACKUP_PASSPHRASE=... sh pg-backup.sh
#
# Natija: $BACKUP_DIR/bum-erp-YYYYMMDDTHHMMSSZ.dump.enc (pg_dump custom format, siqilgan, AES-256/PBKDF2) va .sha256.
# BACKUP_PASSPHRASE MAJBURIY: nusxada mijoz, xodim va moliya ma'lumoti bor — shifrlanmagan nusxa uzoq
# saqlanmasligi kerak. Faqat lokal sinov uchun BACKUP_ALLOW_PLAINTEXT=1 bilan shifrsiz ruxsat etiladi.
# Arxiv yozilgach `pg_restore --list` bilan o'qib tekshiriladi — buzilgan nusxa "tayyor" deb qoldirilmaydi.
# RETENTION_DAYS dan eski nusxalar o'chiriladi. Fayllar faqat egasi o'qiy oladi (umask 077).
# Parol logga chiqmaydi: ulanish satri va shifr paroli faqat muhit o'zgaruvchisidan olinadi.
set -eu

: "${DATABASE_URL:?DATABASE_URL kerak}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "RETENTION_DAYS butun son bo'lishi kerak" >&2; exit 2 ;;
esac

umask 077
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/bum-erp-$stamp.dump"
partial="$target.partial"

echo "[backup] boshlandi: $stamp"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$partial"

# Arxivni o'qib tekshirish (jadval ro'yxati chiqmasa — xato)
entries="$(pg_restore --list "$partial" | grep -c ' TABLE DATA ' || true)"
if [ "${entries:-0}" -eq 0 ]; then
  echo "[backup] XATO: arxivda jadval ma'lumoti topilmadi" >&2
  rm -f "$partial"
  exit 1
fi

if [ -z "${BACKUP_PASSPHRASE:-}" ] && [ "${BACKUP_ALLOW_PLAINTEXT:-0}" != "1" ]; then
  echo "[backup] XATO: BACKUP_PASSPHRASE kerak (shifrsiz nusxa uchun BACKUP_ALLOW_PLAINTEXT=1)" >&2
  rm -f "$partial"
  exit 2
fi

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  target="$target.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$partial" -out "$target.partial"
  rm -f "$partial"
  mv "$target.partial" "$target"
else
  echo "[backup] OGOHLANTIRISH: BACKUP_PASSPHRASE yo'q — nusxa shifrlanmagan" >&2
  mv "$partial" "$target"
fi
( cd "$BACKUP_DIR" && sha256sum "$(basename "$target")" > "$(basename "$target").sha256" )
size="$(wc -c < "$target" | tr -d ' ')"
echo "[backup] tayyor: $(basename "$target") ($size bayt, $entries ta jadval ma'lumoti)"

# Eski nusxalarni o'chirish (faqat shu skript yaratgan nomlar)
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'bum-erp-*.dump' -o -name 'bum-erp-*.dump.enc' -o -name 'bum-erp-*.sha256' \) -mtime +"$RETENTION_DAYS" -print -delete |
  sed 's/^/[backup] eski nusxa o'"'"'chirildi: /'
