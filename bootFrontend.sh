#!/usr/bin/env bash
# Boots ONLY the customer storefront (frontend/), pointed at a backend that
# may live on another machine.
#
# Usage:
#   BACKEND_URL=http://10.0.0.5:3000 ./bootFrontend.sh
#   ./bootFrontend.sh http://10.0.0.5:3000          # same thing
#
# Env (all optional):
#   BACKEND_URL    where the API is, as the BROWSER will reach it. If unset the
#                  backend is assumed to be on this same machine (the app then
#                  derives the API host from the address you browse on).
#   ADMIN_URL      where the admin UI lives, for the storefront's link to it
#                  (e.g. http://10.0.0.8:5174). Unset = same host, port 5174.
#   FRONTEND_PORT  port to serve on (default 5173)
#   BACKEND_PORT   only used when BACKEND_URL is unset (default 3000)
#
# The backend must list this machine's address in its CORS allowlist:
#   FRONTEND_URL=http://<this-machine>:5173 ./bootBackend.sh
#
# Stop with Ctrl+C. Only the port this script bound itself is killed.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck source=scripts/boot-lib.sh
source "$ROOT_DIR/scripts/boot-lib.sh"

BACKEND_URL="$(strip_slash "${1:-${BACKEND_URL:-}}")"
ADMIN_URL="$(strip_slash "${ADMIN_URL:-}")"
BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

ensure_deps "$ROOT_DIR/frontend" "frontend"

ORIGINAL_PORT="$FRONTEND_PORT"
FRONTEND_PORT="$(find_free_port "$FRONTEND_PORT")"
if [ "$FRONTEND_PORT" != "$ORIGINAL_PORT" ]; then
  echo "Port $ORIGINAL_PORT is taken by something else -- using $FRONTEND_PORT instead."
  echo "(Remember to allow http://<this-machine>:$FRONTEND_PORT in the backend's FRONTEND_URL.)"
fi

LAN_IP="$(lan_ip)"

echo ""
echo "== Frontend =="
if [ -n "$BACKEND_URL" ]; then
  echo "Backend: $BACKEND_URL"
  warn_if_backend_unreachable "$BACKEND_URL"
else
  echo "Backend: same machine (localhost:$BACKEND_PORT / derived from the browsing address)"
fi

(
  cd frontend
  # With BACKEND_URL we bake the full URL in (the API is on a different
  # host); without it we pass only the port and the app derives the host from
  # whatever address it is browsed on -- see src/lib/api.js.
  if [ -n "$BACKEND_URL" ]; then export VITE_API_BASE_URL="$BACKEND_URL"; fi
  [ -n "$ADMIN_URL" ] && export VITE_ADMIN_URL="$ADMIN_URL"
  VITE_API_PORT="$BACKEND_PORT" \
    bun run dev -- --host --port "$FRONTEND_PORT" --strictPort > "$LOG_DIR/frontend.log" 2>&1
) &
FRONTEND_PID=$!
STARTED_PORTS="$FRONTEND_PORT"
wait_for_http "http://localhost:$FRONTEND_PORT/" "Frontend" || cat "$LOG_DIR/frontend.log"

echo ""
echo "=========================================================="
echo " Frontend is running"
echo "=========================================================="
echo " Local:     http://localhost:$FRONTEND_PORT"
echo " Network:   http://$LAN_IP:$FRONTEND_PORT   <- open this on your phone"
echo " API:       ${BACKEND_URL:-same machine, port $BACKEND_PORT}"
echo ""
echo " Backend CORS must allow:  http://$LAN_IP:$FRONTEND_PORT"
echo ""
echo " Log: $LOG_DIR/frontend.log"
echo " Press Ctrl+C to stop."
echo "=========================================================="

wait "$FRONTEND_PID"
