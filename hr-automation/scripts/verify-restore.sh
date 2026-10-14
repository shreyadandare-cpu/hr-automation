#!/usr/bin/env bash
# Proves a backup is usable: restores it to a scratch database and compares row counts with the live one.
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: verify-restore.sh <backup file>}"
./scripts/restore.sh "$file" hr_restore_check >/dev/null
q() { docker exec hr-postgres psql -U hr -d "$1" -tAc "$2"; }
ok=1
for t in employees access_grants checklist_items audit_log hr_users; do
  live=$(q hr_automation "select count(*) from $t"); back=$(q hr_restore_check "select count(*) from $t")
  printf "%-18s live=%s restored=%s\n" "$t" "$live" "$back"
  [ "$live" = "$back" ] || ok=0
done
docker exec hr-postgres psql -U hr -d postgres -c "DROP DATABASE hr_restore_check" >/dev/null
[ "$ok" = 1 ] && echo "RESTORE VERIFIED" || { echo "COUNTS DIFFER"; exit 1; }
