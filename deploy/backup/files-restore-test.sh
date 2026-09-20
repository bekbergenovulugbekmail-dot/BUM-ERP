#!/bin/sh
# BUM ERP — FAYL NUSXASINI TIKLASH SINOVI (nusxa borligi yetarli emas — o'qilishi tekshiriladi).
#
#   DEST_S3_ENDPOINT=... DEST_S3_BUCKET=bum-erp-backup DEST_S3_ACCESS_KEY=... DEST_S3_SECRET_KEY=... \
#   RESTORE_DIR=/tmp/files-restore SAMPLE=25 sh files-restore-test.sh
#
# Nima qiladi: nusxadan tasodifiy N ta obyektni ALOHIDA papkaga yuklab oladi va har birining
# hajmi hamda SHA-256 xeshi nusxadagi bilan mos ekanini tekshiradi. Production saqlashiga
# YOZMAYDI va unga umuman ulanmaydi — faqat nusxadan o'qiydi.
set -eu

: "${DEST_S3_ENDPOINT:?DEST_S3_ENDPOINT kerak}"
: "${DEST_S3_BUCKET:?DEST_S3_BUCKET kerak}"
: "${DEST_S3_ACCESS_KEY:?DEST_S3_ACCESS_KEY kerak}"
: "${DEST_S3_SECRET_KEY:?DEST_S3_SECRET_KEY kerak}"
RESTORE_DIR="${RESTORE_DIR:-/tmp/files-restore}"
SAMPLE="${SAMPLE:-25}"

export RCLONE_CONFIG_DST_TYPE=s3
export RCLONE_CONFIG_DST_PROVIDER="${DEST_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_DST_ENDPOINT="$DEST_S3_ENDPOINT"
export RCLONE_CONFIG_DST_ACCESS_KEY_ID="$DEST_S3_ACCESS_KEY"
export RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$DEST_S3_SECRET_KEY"
export RCLONE_CONFIG_DST_REGION="${DEST_S3_REGION:-us-east-1}"

umask 077
rm -rf "$RESTORE_DIR"
mkdir -p "$RESTORE_DIR"

total="$(rclone size "dst:$DEST_S3_BUCKET/current" --json 2>/dev/null | sed -n 's/.*"count":\([0-9]*\).*/\1/p')"
if [ "${total:-0}" -eq 0 ]; then
  echo "[files-restore] XATO: nusxada obyekt yo'q" >&2
  exit 1
fi
echo "[files-restore] nusxada $total ta obyekt"

rclone lsf "dst:$DEST_S3_BUCKET/current" --files-only --recursive | head -n "$SAMPLE" > "$RESTORE_DIR/.sample"
checked=0
while IFS= read -r key; do
  [ -n "$key" ] || continue
  rclone copyto "dst:$DEST_S3_BUCKET/current/$key" "$RESTORE_DIR/obj" --log-level ERROR
  size="$(wc -c < "$RESTORE_DIR/obj" | tr -d ' ')"
  [ "$size" -gt 0 ] || { echo "[files-restore] XATO: bo'sh fayl — $key" >&2; exit 1; }
  local_hash="$(sha256sum "$RESTORE_DIR/obj" | cut -d' ' -f1)"
  remote_hash="$(rclone hashsum sha256 "dst:$DEST_S3_BUCKET/current/$key" --log-level ERROR 2>/dev/null | cut -d' ' -f1 || true)"
  if [ -n "$remote_hash" ] && [ "$remote_hash" != "$local_hash" ]; then
    echo "[files-restore] XATO: xesh mos emas — $key" >&2
    exit 1
  fi
  checked=$((checked + 1))
done < "$RESTORE_DIR/.sample"

rm -rf "$RESTORE_DIR"
echo "[files-restore] NATIJA: PASS — $checked ta obyekt tiklandi va yaxlitligi tekshirildi"
