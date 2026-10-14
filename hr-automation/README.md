# HR automation backend

Local build: PostgreSQL in Docker, an MCP server in Node.js, stand-in connectors (no real accounts are touched).

## Start (after a restart)
1. Open Docker Desktop and wait until it is running.
2. `docker start hr-postgres` (first time only: see "First setup").
3. `cd server && npm install && npm run migrate && npm run seed`
4. `HR_USER_EMAIL=shreya.dandare@wohlig.com node src/index.js`

## First setup
```
docker run -d --name hr-postgres -e POSTGRES_USER=hr -e POSTGRES_PASSWORD=hr_local_only \
  -e POSTGRES_DB=hr_automation -p 5432:5432 postgres:16
```
The password above is for this local container only. Production secrets live in Secret Manager.

## Tests
`cd server && npm test` (needs the database running). Tests create "TEST ..." employees and remove them afterwards.
Simulate a failing tool: `STUB_FAIL=github`. Simulate access that did not close: `STUB_LEAK=claude`.

## Backups
- `scripts/backup.sh` writes a dump to `backups/` (private: it holds employee names and emails).
- `scripts/verify-restore.sh <file>` restores to a scratch database and compares row counts.

## Emergency stop
Tool `set_automation_paused` (admin) stops all automatic tool changes. Use the manual runbook while it is on.
