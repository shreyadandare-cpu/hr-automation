#!/usr/bin/env bash
# Backs up the local HR database to backups/ using pg_dump inside the Docker container.
# The file contains employee names and emails: keep it private and never commit it.
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date +%Y%m%d-%H%M%S)
out="backups/hr_automation-$stamp.dump"
docker exec hr-postgres pg_dump -U hr -Fc hr_automation > "$out"
echo "backup written: $out ($(wc -c < "$out" | tr -d ' ') bytes)"
