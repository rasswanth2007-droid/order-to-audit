#!/bin/sh
# Nightly logical backup (cron). Restore test: createdb o2a_restore && psql o2a_restore < file.sql
set -e
mkdir -p backups
docker compose exec -T db pg_dump -U o2a o2a > "backups/o2a_$(date +%F).sql"
find backups -name 'o2a_*.sql' -mtime +30 -delete
