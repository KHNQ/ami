# Shared helpers for bootBackend.sh / bootFrontend.sh / bootAdmin.sh.
# Sourced, never executed directly. (bootAll.sh predates this and keeps its
# own copies; it is untouched.)
#
# The contract with the caller: set STARTED_PORTS to the ports this script
# bound itself *after* it has started something on them. cleanup() only ever
# kills those -- a port that was already taken by something else is never
# touched.

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    # No lsof (common on minimal Linux servers): try to connect instead.
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

find_free_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

wait_for_http() {
  local url="$1" label="$2" tries=60
  while ! curl -sf -o /dev/null "$url"; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "  ✗ $label never came up (checked $url) -- see its log"
      return 1
    fi
    sleep 0.5
  done
  echo "  ✓ $label is up"
}

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null && return        # macOS
  ipconfig getifaddr en1 2>/dev/null && return
  hostname -I 2>/dev/null | awk '{print $1}' && return # Linux
  echo "localhost"
}

# `bun run dev` spawns a grandchild that actually holds the port, so killing
# the PID from `$!` leaves it running. Kill by port instead -- precise, and
# independent of how deep the process tree is.
kill_port() {
  local port="$1" pids
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null)"
    [ -z "$pids" ] && return
    kill $pids 2>/dev/null
    sleep 0.3
    pids="$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k -TERM "$port/tcp" >/dev/null 2>&1
  fi
}

STARTED_PORTS=""
CLEANED_UP=0
cleanup() {
  [ "$CLEANED_UP" -eq 1 ] && return
  CLEANED_UP=1
  echo ""
  echo "Shutting down..."
  local p
  for p in $STARTED_PORTS; do kill_port "$p"; done
  echo "Stopped."
}
trap cleanup INT TERM EXIT

# Strip a trailing slash so "http://host:3000/" and "http://host:3000" agree.
strip_slash() { echo "${1%/}"; }

# Warn (never fail) if the backend isn't answering yet -- it may simply be
# started after this machine.
warn_if_backend_unreachable() {
  local url="$1"
  if curl -sf -o /dev/null --max-time 3 "$url/products"; then
    echo "  ✓ backend reachable at $url"
  else
    echo "  ! backend not reachable at $url right now (start it, or check the URL/firewall)."
    echo "    Continuing -- the UI will work as soon as the backend is up."
  fi
}

# Installs dependencies for one directory if node_modules is missing.
ensure_deps() {
  local dir="$1" label="$2"
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing $label dependencies..."
    (cd "$dir" && bun install) || { echo "bun install failed in $dir" >&2; exit 1; }
  fi
}
