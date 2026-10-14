#!/usr/bin/env bash
# Runs the daily offboarding job once and logs the output. Scheduled daily by launchd once approved.
set -euo pipefail
cd "$(dirname "$0")/../server"
mkdir -p ../logs
node src/run-scheduled.js >> ../logs/scheduled.log 2>&1
echo "---- $(date) done" >> ../logs/scheduled.log
