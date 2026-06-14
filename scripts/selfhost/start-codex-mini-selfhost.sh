#!/usr/bin/env bash
set -euo pipefail

USER_ID="$(id -u)"
DOMAIN="gui/${USER_ID}"

SELFHOST_LABEL="${SELFHOST_LABEL:-codex-mini.selfhost}"
TUNNEL_LABEL="${TUNNEL_LABEL:-codex-mini.tunnel}"
SELFHOST_PLIST="${SELFHOST_PLIST:-${HOME}/Library/LaunchAgents/${SELFHOST_LABEL}.plist}"
TUNNEL_PLIST="${TUNNEL_PLIST:-${HOME}/Library/LaunchAgents/${TUNNEL_LABEL}.plist}"

CODEX_APP="${CODEX_APP:-/Applications/Codex.app}"
CDP_LAUNCHER="${CDP_LAUNCHER:-${HOME}/Library/Application Support/Codex Mini/bin/launch-main-codex-cdp.sh}"
CDP_PORT="${CDP_PORT:-39252}"
SELFHOST_PORT="${SELFHOST_PORT:-8789}"
SELFHOST_TOKEN="${SELFHOST_TOKEN:?Set SELFHOST_TOKEN to the Codex Mini token for this device}"
PUBLIC_BASE="${PUBLIC_BASE:?Set PUBLIC_BASE to the public URL for this device, for example https://example.com/u/aono/mac-mini}"
RELAY_TOKEN="${RELAY_TOKEN:-}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-}"
BASIC_AUTH_PASSWORD="${BASIC_AUTH_PASSWORD:-}"

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf '\nWARN: %s\n' "$*" >&2
}

json_ok() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(0 if data.get("ok") else 1)'
}

retry() {
  local attempts="$1"
  local delay="$2"
  shift 2

  local last_status=1
  for _ in $(seq 1 "$attempts"); do
    if "$@"; then
      return 0
    fi
    last_status=$?
    sleep "$delay"
  done
  return "$last_status"
}

cdp_ready() {
  curl -fsS --max-time 3 "http://127.0.0.1:${CDP_PORT}/json/list" \
    | python3 -c 'import json,sys; rows=json.load(sys.stdin); sys.exit(0 if any(x.get("type")=="page" and str(x.get("url","")).startswith("app://-/index.html") for x in rows) else 1)' \
    >/dev/null 2>&1
}

service_loaded() {
  launchctl print "${DOMAIN}/$1" >/dev/null 2>&1
}

load_or_restart_service() {
  local label="$1"
  local plist="$2"

  if [[ ! -f "$plist" ]]; then
    echo "Missing LaunchAgent plist: $plist" >&2
    return 1
  fi

  if service_loaded "$label"; then
    launchctl kickstart -k "${DOMAIN}/${label}" >/dev/null
  else
    launchctl bootstrap "$DOMAIN" "$plist"
    launchctl kickstart -k "${DOMAIN}/${label}" >/dev/null
  fi
}

quit_codex() {
  osascript -e 'tell application "Codex" to quit' >/dev/null 2>&1 || true
  sleep 2
  pkill -f "${CODEX_APP}/Contents/MacOS/Codex" >/dev/null 2>&1 || true
  pkill -f "${CODEX_APP}/Contents/Frameworks/Codex Framework.framework" >/dev/null 2>&1 || true
  pkill -f "${CODEX_APP}/Contents/Resources/codex app-server" >/dev/null 2>&1 || true
  sleep 2
}

start_codex_cdp() {
  if cdp_ready; then
    log "Codex CDP is already ready on port ${CDP_PORT}"
    return 0
  fi

  log "Starting controlled Codex with CDP"
  quit_codex

  if [[ -x "$CDP_LAUNCHER" ]]; then
    OPEN_AFTER_BUILD=1 CDP_READY_TIMEOUT_SECONDS=30 "$CDP_LAUNCHER" || true
  else
    warn "CDP launcher not found: $CDP_LAUNCHER"
  fi

  for _ in {1..10}; do
    if cdp_ready; then
      log "Codex CDP is ready"
      return 0
    fi
    sleep 1
  done

  warn "CDP launcher did not expose port ${CDP_PORT}; trying direct Codex executable"
  quit_codex
  "${CODEX_APP}/Contents/MacOS/Codex" \
    --remote-debugging-address=127.0.0.1 \
    "--remote-debugging-port=${CDP_PORT}" \
    "--remote-allow-origins=http://127.0.0.1:${CDP_PORT}" \
    --disable-background-timer-throttling \
    --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows \
    >/tmp/codex-desktop-cdp.out.log 2>/tmp/codex-desktop-cdp.err.log &

  for _ in {1..20}; do
    if cdp_ready; then
      log "Codex CDP is ready"
      return 0
    fi
    sleep 1
  done

  echo "Failed to start Codex CDP on port ${CDP_PORT}." >&2
  echo "Check logs: /tmp/codex-desktop-cdp.err.log" >&2
  return 1
}

check_selfhost() {
  local body
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:${SELFHOST_PORT}/codex/config?token=${SELFHOST_TOKEN}" 2>/dev/null)" || return 1
  printf '%s' "$body" | json_ok
}

check_public() {
  local body
  local curl_args=(-fsS --max-time 8)
  if [[ -n "$RELAY_TOKEN" ]]; then
    curl_args+=(-H "x-codex-mini-relay-token: ${RELAY_TOKEN}")
  fi
  if [[ -n "$BASIC_AUTH_USER" || -n "$BASIC_AUTH_PASSWORD" ]]; then
    curl_args+=(-u "${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}")
  fi
  body="$(curl "${curl_args[@]}" "${PUBLIC_BASE}/codex/threads?limit=1&token=${SELFHOST_TOKEN}" 2>/dev/null)" || return 1
  printf '%s' "$body" | json_ok
}

main() {
  log "Starting Codex Mini selfhost stack"

  start_codex_cdp

  log "Starting ${SELFHOST_LABEL}"
  load_or_restart_service "$SELFHOST_LABEL" "$SELFHOST_PLIST"
  sleep 2

  log "Starting ${TUNNEL_LABEL}"
  load_or_restart_service "$TUNNEL_LABEL" "$TUNNEL_PLIST"
  sleep 2

  log "Checking local selfhost API"
  retry 10 1 check_selfhost

  log "Checking public route"
  retry 10 1 check_public

  cat <<EOF

Ready.

Phone URL:
${PUBLIC_BASE}/?token=${SELFHOST_TOKEN}

Diagnostics:
launchctl print ${DOMAIN}/${SELFHOST_LABEL}
launchctl print ${DOMAIN}/${TUNNEL_LABEL}
curl -sS http://127.0.0.1:${CDP_PORT}/json/list | head -c 1000
EOF
}

main "$@"
