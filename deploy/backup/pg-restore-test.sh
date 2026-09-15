#!/bin/sh
# BUM ERP — zaxira nusxasini TIKLASH SINOVI (zaxira borligi yetarli emas — tiklanishi tekshiriladi).
#
#   RESTORE_DATABASE_URL=postgresql://.../bum_restore_test \
#   SOURCE_DATABASE_URL=postgresql://.../bumerp \          (ixtiyoriy — qatorlar sonini solishtirish uchun)
#   BACKUP_PASSPHRASE=... \                                 (.dump.enc uchun)
#   sh pg-restore-test.sh /backups/bum-erp-20260914T000000Z.dump[.enc]
#
# Xavfsizlik: RESTORE_DATABASE_URL — alohida, bo'sh sinov bazasi bo'lishi SHART (production bazasi emas). Bazaning
# NOMI (URL'dagi oxirgi yo'l qismi — parol yoki host emas) "restore" yoki "test" ni o'z ichiga olishi, manba va
# DATABASE_URL bazasidan farq qilishi shart; aks holda skript ishlamaydi. Tiklash --clean bilan faqat shu sinov bazasiga.
# Tekshiruv: SHA-256 (fayl yonida bo'lsa), pg_restore xatosiz tugashi, migratsiyalar jadvali, asosiy jadvallar
# qatorlari soni (manba berilsa — manba bilan teng bo'lishi kerak).
set -eu

dump="${1:?zaxira fayli yo'li kerak}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL kerak (bo'sh sinov bazasi)}"

# postgresql://user:pass@host:port/dbname?params → dbname (parol va hostdagi "test" so'zi hisobga olinmaydi)
db_name() {
  printf '%s' "$1" | sed -e 's/[?#].*$//' -e 's#^[a-z]*://##' -e 's#^[^/]*/##'
}

restore_db="$(db_name "$RESTORE_DATABASE_URL")"
case "$restore_db" in
  *restore*|*test*) ;;
  *) echo "RESTORE_DATABASE_URL bazasi nomida restore yoki test bo'lishi kerak (hozir: '$restore_db')" >&2; exit 2 ;;
esac
for other in "${SOURCE_DATABASE_URL:-}" "${DATABASE_URL:-}"; do
  if [ -n "$other" ] && [ "$(db_name "$other")" = "$restore_db" ] && [ "${other%%/*}" != "" ]; then
    other_host="$(printf '%s' "$other" | sed -e 's#^[a-z]*://##' -e 's#^[^@]*@##' -e 's#/.*$##')"
    restore_host="$(printf '%s' "$RESTORE_DATABASE_URL" | sed -e 's#^[a-z]*://##' -e 's#^[^@]*@##' -e 's#/.*$##')"
    if [ "$other_host" = "$restore_host" ]; then
      echo "RESTORE_DATABASE_URL manba yoki ishlab turgan baza bilan bir xil — tiklash rad etildi" >&2
      exit 2
    fi
  fi
done

if [ -f "$dump.sha256" ]; then
  ( cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" )
else
  echo "[restore-test] ogohlantirish: $dump.sha256 yo'q — nazorat summasi tekshirilmadi"
fi

source_file="$dump"
cleanup() { :; }
case "$dump" in
  *.enc)
    : "${BACKUP_PASSPHRASE:?shifrlangan nusxa uchun BACKUP_PASSPHRASE kerak}"
    umask 077
    source_file="$(mktemp)"
    cleanup() { rm -f "$source_file"; }
    trap cleanup EXIT INT TERM
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$dump" -out "$source_file"
    ;;
esac

echo "[restore-test] tiklanmoqda..."
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$source_file"

TABLES="companies users company_members products customers sales_orders customer_payments payments cash_accounts cash_transactions journal_entries journal_lines expenses stock_levels"

count() {
  psql --dbname="$1" -Atc "select count(*) from $2" 2>/dev/null || echo "yo'q"
}

migrations="$(psql --dbname="$RESTORE_DATABASE_URL" -Atc 'select count(*) from drizzle.__drizzle_migrations')"
echo "[restore-test] migratsiyalar: $migrations"

status=0
for table in $TABLES; do
  restored="$(count "$RESTORE_DATABASE_URL" "$table")"
  if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
    source="$(count "$SOURCE_DATABASE_URL" "$table")"
    if [ "$restored" = "$source" ]; then mark="OK"; else mark="FARQ"; status=1; fi
    echo "[restore-test] $table: tiklangan=$restored manba=$source $mark"
  else
    echo "[restore-test] $table: tiklangan=$restored"
  fi
done

if [ "$status" -ne 0 ]; then
  echo "[restore-test] NATIJA: FAIL — qatorlar soni mos emas" >&2
  exit 1
fi
echo "[restore-test] NATIJA: PASS"
