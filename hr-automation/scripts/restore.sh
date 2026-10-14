#!/usr/bin/env bash
# Restores a backup into a NEW database, so the live one is never overwritten by accident.
# Usage: scripts/restore.sh backups/hr_automation-YYYYMMDD-HHMMSS.dump [target_db_name]
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: restore.sh <backup file> [target_db_name]}"
target="${2:-hr_restore_check}"
docker exec hr-postgres psql -U hr -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $target" -c "CREATE DATABASE $target" >/dev/null
docker exec -i hr-postgres pg_restore -U hr -d "$target" --no-owner < "$file"
echo "restored into database: $target"
