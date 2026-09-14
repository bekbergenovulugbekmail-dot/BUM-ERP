#!/bin/sh
# BUM ERP — zaxira nusxasini TIKLASH SINOVI (zaxira borligi yetarli emas — tiklanishi tekshiriladi).
#
#   RESTORE_DATABASE_URL=postgresql://.../bum_restore_test \
#   SOURCE_DATABASE_URL=postgresql://.../bumerp \          (ixtiyoriy — qatorlar sonini solishtirish uchun)
#   sh pg-restore-test.sh /backups/bum-erp-20260914T000000Z.dump
#
# Xavfsizlik: RESTORE_DATABASE_URL — alohida, bo'sh sinov bazasi bo'lishi SHART (production bazasi emas).
# Nomida "restore" yoki "test" bo'lmasa skript ishlamaydi. Tiklash --clean bilan faqat shu sinov bazasiga.
# Tekshiruv: SHA-256 (fayl yonida bo'lsa), pg_restore xatosiz tugashi, migratsiyalar jadvali, asosiy jadvallar
# qatorlari soni (manba berilsa — manba bilan teng bo'lishi kerak).
set -eu

dump="${1:?zaxira fayli yo'li kerak}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL kerak (bo'sh sinov bazasi)}"

case "$RESTORE_DATABASE_URL" in
  *restore*|*test*) ;;
  *) echo "RESTORE_DATABASE_URL sinov bazasiga ishora qilishi kerak (nomida restore yoki test)" >&2; exit 2 ;;
esac

if [ -f "$dump.sha256" ]; then
  ( cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" )
else
  echo "[restore-test] ogohlantirish: $dump.sha256 yo'q — nazorat summasi tekshirilmadi"
fi

echo "[restore-test] tiklanmoqda..."
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$dump"

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
