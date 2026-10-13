#!/usr/bin/env bash
# Brings up the whole Trex stack for local testing in one command:
# database (migrate + seed on first run), backend, and frontend (via
# `vite --host` so it's reachable from another device on the same network).
#
# Usage: ./bootAll.sh
# Stop with Ctrl+C -- this traps the signal and kills only the backend/
# frontend ports THIS script itself successfully started; it never touches
# a port it didn't bind itself (e.g. if the port was already taken by
# something else, this script exits without starting anything there, and
# cleanup leaves that pre-existing process alone).

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
ADMIN_PORT="${ADMIN_PORT:-5174}"
SQLITE_FILE="${SQLITE_FILE:-trex.sqlite}"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
}

find_free_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local tries=60
  while ! curl -sf -o /dev/null "$url"; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "  ✗ $label never came up (checked $url) -- see its log above"
      return 1
    fi
    sleep 0.5
  done
  echo "  ✓ $label is up"
}

lan_ip() {
  # macOS
  ipconfig getifaddr en0 2>/dev/null && return
  ipconfig getifaddr en1 2>/dev/null && return
  # Linux fallback
  hostname -I 2>/dev/null | awk '{print $1}' && return
  echo "localhost"
}

BACKEND_PID=""
FRONTEND_PID=""
STARTED_BACKEND=0
STARTED_FRONTEND=0
STARTED_ADMIN=0

# `bun run dev` (and the subshell wrapping the frontend's `cd frontend`)
# each spawn a grandchild that's the process actually holding the port --
# killing just the PID captured via `$!` leaves that grandchild running.
# Killing by port instead is precise (only ever the exact port THIS script
# just bound) and works no matter how deep the process tree is.
kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null)"
  [ -z "$pids" ] && return
  kill $pids 2>/dev/null
  sleep 0.3
  pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null)"
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
}

CLEANED_UP=0
cleanup() {
  [ "$CLEANED_UP" -eq 1 ] && return
  CLEANED_UP=1
  echo ""
  echo "Shutting down..."
  # Only ever kill a port THIS script actually bound itself -- if we exited
  # early (e.g. the port was already taken by something else), we never set
  # the corresponding STARTED_* flag, so that pre-existing process is left
  # completely alone.
  [ "$STARTED_ADMIN" -eq 1 ] && kill_port "$ADMIN_PORT"
  [ "$STARTED_FRONTEND" -eq 1 ] && kill_port "$FRONTEND_PORT"
  [ "$STARTED_BACKEND" -eq 1 ] && kill_port "$BACKEND_PORT"
  echo "Stopped."
}
trap cleanup INT TERM EXIT

# ---------------------------------------------------------------------------
# 0. dependencies (only if missing -- fast no-op otherwise with bun)
# ---------------------------------------------------------------------------

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Installing backend dependencies..."
  bun install
fi
if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && bun install)
fi

# ---------------------------------------------------------------------------
# 1. database -- migrate always; seed only on a brand-new database
# ---------------------------------------------------------------------------

echo ""
echo "== Database =="
NEEDS_SEED=0
if [ ! -f "$ROOT_DIR/$SQLITE_FILE" ]; then
  NEEDS_SEED=1
fi

SQLITE_FILE="$SQLITE_FILE" bun run migrate

if [ "$NEEDS_SEED" -eq 1 ]; then
  echo "New database detected -- seeding an admin account and a demo product."
  SQLITE_FILE="$SQLITE_FILE" bun run seed
else
  echo "Existing database found at $SQLITE_FILE -- skipping seed."
fi

# ---------------------------------------------------------------------------
# 2. ports + LAN address
# ---------------------------------------------------------------------------

if port_in_use "$BACKEND_PORT"; then
  echo "Port $BACKEND_PORT (backend) is already in use -- set BACKEND_PORT=... to override." >&2
  exit 1
fi
ORIGINAL_FRONTEND_PORT="$FRONTEND_PORT"
FRONTEND_PORT="$(find_free_port "$FRONTEND_PORT")"
if [ "$FRONTEND_PORT" != "$ORIGINAL_FRONTEND_PORT" ]; then
  echo "Port $ORIGINAL_FRONTEND_PORT is taken by something else -- using $FRONTEND_PORT instead."
fi

LAN_IP="$(lan_ip)"

# ---------------------------------------------------------------------------
# 3. backend
# ---------------------------------------------------------------------------

echo ""
echo "== Backend =="
SQLITE_FILE="$SQLITE_FILE" \
PORT="$BACKEND_PORT" \
CORS_ORIGINS="http://localhost:$FRONTEND_PORT,http://$LAN_IP:$FRONTEND_PORT,http://localhost:$ADMIN_PORT,http://$LAN_IP:$ADMIN_PORT" \
  bun run dev > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
STARTED_BACKEND=1
wait_for_http "http://localhost:$BACKEND_PORT/products" "Backend" || cat "$LOG_DIR/backend.log"

# ---------------------------------------------------------------------------
# 4. frontend
# ---------------------------------------------------------------------------

echo ""
echo "== Frontend =="
(
  cd frontend
  # Deliberately passes only the PORT, never a full base URL: the frontend
  # derives the API host from whatever address you're browsing on (see
  # src/lib/api.js). Baking in the LAN IP here used to break the dev machine
  # itself, since a Mac on an iPhone hotspot can't route back to its own
  # 172.20.10.x address -- localhost worked, the LAN IP silently hung.
  VITE_API_PORT="$BACKEND_PORT" \
    bun run dev -- --host --port "$FRONTEND_PORT" --strictPort > "$LOG_DIR/frontend.log" 2>&1
) &
FRONTEND_PID=$!
STARTED_FRONTEND=1
wait_for_http "http://localhost:$FRONTEND_PORT/" "Frontend" || cat "$LOG_DIR/frontend.log"

# ---------------------------------------------------------------------------
# 5. admin control room
# ---------------------------------------------------------------------------
# A separate app (admin/) that talks to the same API. Skipped silently if its
# dependencies were never installed, so the storefront loop still works for
# anyone who doesn't need it.

if [ -d "admin/node_modules" ]; then
  echo ""
  echo "== Admin =="
  (
    cd admin
    VITE_API_PORT="$BACKEND_PORT" \
      bun run dev -- --host --port "$ADMIN_PORT" --strictPort > "$LOG_DIR/admin.log" 2>&1
  ) &
  ADMIN_PID=$!
  STARTED_ADMIN=1
  wait_for_http "http://localhost:$ADMIN_PORT/" "Admin" || cat "$LOG_DIR/admin.log"
else
  echo ""
  echo "== Admin == (skipped -- run 'cd admin && bun install' to enable)"
fi

# ---------------------------------------------------------------------------
# 6. summary
# ---------------------------------------------------------------------------

echo ""
echo "=========================================================="
echo " Trex is running"
echo "=========================================================="
echo " Backend   (local):    http://localhost:$BACKEND_PORT"
echo " Backend   (network):  http://$LAN_IP:$BACKEND_PORT"
echo " Frontend  (local):    http://localhost:$FRONTEND_PORT"
echo " Frontend  (network):  http://$LAN_IP:$FRONTEND_PORT   <- open this on your phone"
if [ "$STARTED_ADMIN" -eq 1 ]; then
  echo " Admin     (local):    http://localhost:$ADMIN_PORT"
fi
echo ""
echo " Seeded admin login:   admin@trex.local / admin12345"
echo "                       (override with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD"
echo "                        before first run, i.e. before $SQLITE_FILE exists)"
echo ""
echo " Logs: $LOG_DIR/backend.log, $LOG_DIR/frontend.log"
echo " Press Ctrl+C to stop both."
echo "=========================================================="

wait "$BACKEND_PID" "$FRONTEND_PID"
