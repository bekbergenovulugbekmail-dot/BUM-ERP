# BUM ERP — kunlik PostgreSQL zaxirasi uchun cron xizmati (Railway cron yoki istalgan server; bepul — pg_dump).
#
#   docker build -f deploy/backup/Dockerfile -t bum-erp-backup .
#   docker run --rm -e DATABASE_URL=... -e BACKUP_PASSPHRASE=... -v bum-backups:/backups bum-erp-backup
#
# Railway: alohida xizmat, "Cron Schedule" (masalan `0 21 * * *` — Toshkent 02:00), volume `/backups` ga ulanadi,
# DATABASE_URL — ${{Postgres.DATABASE_URL}} (ichki tarmoq; bazani internetga ochish shart emas),
# BACKUP_PASSPHRASE — nusxani shifrlash paroli (Railway o'zgaruvchisi; alohida xavfsiz joyda ham saqlang).
FROM postgres:18-alpine
RUN apk add --no-cache openssl rclone
COPY deploy/backup/pg-backup.sh deploy/backup/pg-restore-test.sh \n     deploy/backup/files-backup.sh deploy/backup/files-restore-test.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/pg-backup.sh /usr/local/bin/pg-restore-test.sh \n      /usr/local/bin/files-backup.sh /usr/local/bin/files-restore-test.sh
USER postgres
CMD ["sh", "/usr/local/bin/pg-backup.sh"]
