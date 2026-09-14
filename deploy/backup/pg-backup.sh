#!/bin/sh
# BUM ERP — PostgreSQL zaxira nusxasi (bepul: pg_dump + fayl tizimi / volume).
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/backups RETENTION_DAYS=14 sh pg-backup.sh
#
# Natija: $BACKUP_DIR/bum-erp-YYYYMMDDTHHMMSSZ.dump (pg_dump custom format, siqilgan) va .sha256 fayli.
# Arxiv yozilgach `pg_restore --list` bilan o'qib tekshiriladi — buzilgan nusxa "tayyor" deb qoldirilmaydi.
# RETENTION_DAYS dan eski nusxalar o'chiriladi. Fayllar faqat egasi o'qiy oladi (umask 077).
# Parol logga chiqmaydi: ulanish satri faqat muhit o'zgaruvchisidan olinadi.
set -eu

: "${DATABASE_URL:?DATABASE_URL kerak}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

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

mv "$partial" "$target"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$target")" > "$(basename "$target").sha256" )
size="$(wc -c < "$target" | tr -d ' ')"
echo "[backup] tayyor: $(basename "$target") ($size bayt, $entries ta jadval ma'lumoti)"

# Eski nusxalarni o'chirish (faqat shu skript yaratgan nomlar)
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'bum-erp-*.dump' -o -name 'bum-erp-*.dump.sha256' \) -mtime +"$RETENTION_DAYS" -print -delete |
  sed 's/^/[backup] eski nusxa o'"'"'chirildi: /'
