#!/bin/bash
# Double-click this file on the Mac to start everything the office attendance connector needs:
# the database proxy, the HR Hub, the relay and the tunnel. Leave the window open; closing it (or Ctrl+C) stops it all.
# When the tunnel address is ready it is printed and copied, so you can paste it into the Keka desktop's .env as APP_URL=...
cd "$(dirname "$0")/.." || exit 1
BACKEND="$(pwd)"
LOGS="$BACKEND/.start-logs"; mkdir -p "$LOGS"
PIDS=()
stop() { echo; echo "Stopping..."; for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; exit 0; }
trap stop INT TERM

running() { lsof -iTCP:"$1" -sTCP:LISTEN -P >/dev/null 2>&1; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. Install it first."; read -r -p "Press Enter to close."; exit 1; }; }
need node; need cloudflared; need cloud-sql-proxy

caffeinate -dimsu -w $$ & PIDS+=($!)   # keep the Mac awake while this runs

if running 5432; then echo "Database proxy already running."; else
  echo "Starting the database proxy..."; cloud-sql-proxy wohlig:asia-south1:wohlig-db --port 5432 --gcloud-auth >"$LOGS/proxy.log" 2>&1 & PIDS+=($!); sleep 4
  if ! running 5432; then echo "The database proxy did not start. Run 'gcloud auth login' in Terminal, then double-click this again."; tail -3 "$LOGS/proxy.log"; read -r -p "Press Enter to close."; exit 1; fi
fi

if running 3000; then echo "HR Hub already running."; else
  echo "Starting the HR Hub..."; (exec npm start >"$LOGS/app.log" 2>&1) & PIDS+=($!)
  for i in $(seq 1 30); do running 3000 && break; sleep 1; done
  running 3000 || { echo "The HR Hub did not start. Last lines:"; tail -5 "$LOGS/app.log"; read -r -p "Press Enter to close."; exit 1; }
fi

if running 3100; then echo "Relay already running."; else
  echo "Starting the relay..."; node scripts/device-relay.mjs >"$LOGS/relay.log" 2>&1 & PIDS+=($!); sleep 1
fi

if pgrep -f "cloudflared tunnel --url http://127.0.0.1:3100" >/dev/null; then echo "Tunnel already running (restarting it for a clean address)."; pkill -f "cloudflared tunnel --url http://127.0.0.1:3100"; sleep 2; fi
echo "Starting the tunnel..."; cloudflared tunnel --url http://127.0.0.1:3100 >"$LOGS/tunnel.log" 2>&1 & PIDS+=($!)

ADDR=""
for i in $(seq 1 40); do
  ADDR=$(curl -s -m 2 http://127.0.0.1:20241/quicktunnel 2>/dev/null | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')
  [ -n "$ADDR" ] && curl -s -m 2 http://127.0.0.1:20241/ready | grep -q '"readyConnections":[1-9]' && break
  sleep 1
done
if [ -z "$ADDR" ]; then echo "The tunnel did not come up. Last lines:"; tail -5 "$LOGS/tunnel.log"; read -r -p "Press Enter to close."; exit 1; fi

LINE="APP_URL=https://$ADDR"
printf '%s' "$LINE" | pbcopy
# Keep this Mac's own copy of the connector settings in step, if it has one.
[ -f "$BACKEND/attendance-bridge/.env" ] && sed -i '' "s|^APP_URL=.*|$LINE|" "$BACKEND/attendance-bridge/.env"
echo
echo "==================================================================="
echo " Everything is running."
echo " On the Keka desktop, set this line in the connector's .env, then run run.bat again:"
echo
echo "   $LINE"
echo
echo " (It is already copied. Just paste.)"
echo "==================================================================="
echo "Leave this window open. Press Ctrl+C to stop everything."
wait
