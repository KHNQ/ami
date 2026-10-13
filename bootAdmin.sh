#!/usr/bin/env bash
# Boots ONLY the admin control room UI (admin/), pointed at a backend that
# may live on another machine.
#
# Usage:
#   BACKEND_URL=http://10.0.0.5:3000 ./bootAdmin.sh
#   ./bootAdmin.sh http://10.0.0.5:3000             # same thing
#
# Env (all optional):
#   BACKEND_URL   where the API is, as the BROWSER will reach it. If unset the
#                 backend is assumed to be on this same machine.
#   ADMIN_PORT    port to serve on (default 5174)
#   BACKEND_PORT  only used when BACKEND_URL is unset (default 3000)
#
# The backend must list this machine's address in its CORS allowlist:
#   ADMIN_URL=http://<this-machine>:5174 ./bootBackend.sh
#
# Note: admin/ compiles shared source from ../frontend/src (the @shared
# alias), so the whole repo must be checked out here, and frontend
# dependencies installed too -- this script handles both.
#
# Stop with Ctrl+C. Only the port this script bound itself is killed.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck source=scripts/boot-lib.sh
source "$ROOT_DIR/scripts/boot-lib.sh"

BACKEND_URL="$(strip_slash "${1:-${BACKEND_URL:-}}")"
BACKEND_PORT="${BACKEND_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-5174}"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

# frontend/node_modules is needed too: shared fonts and oxlint live there.
ensure_deps "$ROOT_DIR/frontend" "frontend (shared by admin)"
ensure_deps "$ROOT_DIR/admin" "admin"

ORIGINAL_PORT="$ADMIN_PORT"
ADMIN_PORT="$(find_free_port "$ADMIN_PORT")"
if [ "$ADMIN_PORT" != "$ORIGINAL_PORT" ]; then
  echo "Port $ORIGINAL_PORT is taken by something else -- using $ADMIN_PORT instead."
  echo "(Remember to allow http://<this-machine>:$ADMIN_PORT in the backend's ADMIN_URL.)"
fi

LAN_IP="$(lan_ip)"

echo ""
echo "== Admin =="
if [ -n "$BACKEND_URL" ]; then
  echo "Backend: $BACKEND_URL"
  warn_if_backend_unreachable "$BACKEND_URL"
else
  echo "Backend: same machine (localhost:$BACKEND_PORT / derived from the browsing address)"
fi

(
  cd admin
  if [ -n "$BACKEND_URL" ]; then export VITE_API_BASE_URL="$BACKEND_URL"; fi
  VITE_API_PORT="$BACKEND_PORT" \
    bun run dev -- --host --port "$ADMIN_PORT" --strictPort > "$LOG_DIR/admin.log" 2>&1
) &
ADMIN_PID=$!
STARTED_PORTS="$ADMIN_PORT"
wait_for_http "http://localhost:$ADMIN_PORT/" "Admin" || cat "$LOG_DIR/admin.log"

echo ""
echo "=========================================================="
echo " Admin is running"
echo "=========================================================="
echo " Local:     http://localhost:$ADMIN_PORT"
echo " Network:   http://$LAN_IP:$ADMIN_PORT"
echo " API:       ${BACKEND_URL:-same machine, port $BACKEND_PORT}"
echo ""
echo " Backend CORS must allow:  http://$LAN_IP:$ADMIN_PORT"
echo ""
echo " Log: $LOG_DIR/admin.log"
echo " Press Ctrl+C to stop."
echo "=========================================================="

wait "$ADMIN_PID"
