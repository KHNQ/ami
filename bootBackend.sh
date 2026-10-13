#!/usr/bin/env bash
# Boots ONLY the API (database migrate + seed on first run, then the backend).
# Run this on the machine that owns the database.
#
# Usage:
#   FRONTEND_URL=http://10.0.0.7:5173 ADMIN_URL=http://10.0.0.8:5174 ./bootBackend.sh
#
# Env (all optional):
#   BACKEND_PORT   port to listen on (default 3000; listens on all interfaces)
#   FRONTEND_URL   browser origin(s) of the storefront, comma-separated.
#   ADMIN_URL      browser origin(s) of the admin UI, comma-separated.
#                  Both are added to CORS -- without them a browser on another
#                  machine is refused by the API. Use exactly the address you
#                  type into the browser (scheme + host + port, no path).
#   CORS_ORIGINS   full override of the allowlist (FRONTEND_URL/ADMIN_URL and
#                  the localhost defaults are still appended).
#   API_BASE_URL   how clients reach this API (default http://<lan-ip>:<port>);
#                  used for links in emails such as proforma downloads.
#   SQLITE_FILE    database file (default trex.sqlite)
#
# Stop with Ctrl+C. Only the port this script bound itself is killed.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck source=scripts/boot-lib.sh
source "$ROOT_DIR/scripts/boot-lib.sh"

BACKEND_PORT="${BACKEND_PORT:-3000}"
SQLITE_FILE="${SQLITE_FILE:-trex.sqlite}"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

ensure_deps "$ROOT_DIR" "backend"

echo ""
echo "== Database =="
NEEDS_SEED=0
[ ! -f "$ROOT_DIR/$SQLITE_FILE" ] && NEEDS_SEED=1

SQLITE_FILE="$SQLITE_FILE" bun run migrate || { echo "migrate failed" >&2; exit 1; }
if [ "$NEEDS_SEED" -eq 1 ]; then
  echo "New database detected -- seeding an admin account and a demo product."
  SQLITE_FILE="$SQLITE_FILE" bun run seed
else
  echo "Existing database found at $SQLITE_FILE -- skipping seed."
fi

if port_in_use "$BACKEND_PORT"; then
  echo "Port $BACKEND_PORT (backend) is already in use -- set BACKEND_PORT=... to override." >&2
  exit 1
fi

LAN_IP="$(lan_ip)"

# CORS allowlist: explicit override (or localhost defaults) + whatever
# frontends were announced.
ORIGINS="${CORS_ORIGINS:-http://localhost:5173,http://localhost:5174,http://$LAN_IP:5173,http://$LAN_IP:5174}"
[ -n "${FRONTEND_URL:-}" ] && ORIGINS="$ORIGINS,$FRONTEND_URL"
[ -n "${ADMIN_URL:-}" ] && ORIGINS="$ORIGINS,$ADMIN_URL"
ORIGINS="$(echo "$ORIGINS" | tr ',' '\n' | sed 's#/*$##; s/^ *//; s/ *$//' | awk 'NF && !seen[$0]++' | paste -sd, -)"

FIRST_FRONTEND="${FRONTEND_URL%%,*}"

echo ""
echo "== Backend =="
SQLITE_FILE="$SQLITE_FILE" \
PORT="$BACKEND_PORT" \
CORS_ORIGINS="$ORIGINS" \
API_BASE_URL="${API_BASE_URL:-http://$LAN_IP:$BACKEND_PORT}" \
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-${FIRST_FRONTEND:-http://localhost:5173}}" \
  bun run dev > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
STARTED_PORTS="$BACKEND_PORT"
wait_for_http "http://localhost:$BACKEND_PORT/products" "Backend" || cat "$LOG_DIR/backend.log"

echo ""
echo "=========================================================="
echo " Backend is running"
echo "=========================================================="
echo " Local:     http://localhost:$BACKEND_PORT"
echo " Network:   http://$LAN_IP:$BACKEND_PORT   <- BACKEND_URL for the other machines"
echo " CORS allows: $ORIGINS"
if [ -z "${FRONTEND_URL:-}" ] && [ -z "${ADMIN_URL:-}" ]; then
  echo ""
  echo " ! FRONTEND_URL / ADMIN_URL not set: browsers on other machines will be"
  echo "   blocked by CORS. Restart with e.g."
  echo "   FRONTEND_URL=http://<frontend-machine>:5173 ADMIN_URL=http://<admin-machine>:5174 ./bootBackend.sh"
fi
if [ "$NEEDS_SEED" -eq 1 ]; then
  echo ""
  echo " Seeded admin login:   admin@trex.local / admin12345"
  echo "                       (override with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD"
  echo "                        before first run, i.e. before $SQLITE_FILE exists)"
fi
echo ""
echo " Log: $LOG_DIR/backend.log"
echo " Press Ctrl+C to stop."
echo "=========================================================="

wait "$BACKEND_PID"
