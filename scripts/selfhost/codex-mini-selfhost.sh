#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
USER_ID="$(id -u)"
DOMAIN="gui/${USER_ID}"

usage() {
  cat <<'EOF'
用法：
  scripts/selfhost/codex-mini-selfhost.sh \
    --user <relay-user> \
    --device <device-id> \
    --server <ssh-host> \
    --remote-port <server-port> \
    --ssh-key <path-to-private-key> \
    [--codex-token <local-token>] \
    [--relay-token <public-login-token>] \
    [--public-base https://relay.example.com/u/<user>/<device>] \
    [--local-port 8789] \
    [--ssh-user root] \
    [--label-suffix user-device] \
    [--codex-app /Applications/Codex.app]

动作：
  install     写入 LaunchAgent 并启动完整服务。默认动作。
  start       按已有配置启动 Codex CDP、本地服务和隧道，并执行验证。
  status      输出已有安装的本地诊断信息。

示例：
  scripts/selfhost/codex-mini-selfhost.sh install \
    --user bill \
    --device macbook \
    --server relay.example.com \
    --remote-port 18788 \
    --ssh-key ~/.ssh/codex_mini_relay \
    --relay-token bill-login-token

  scripts/selfhost/codex-mini-selfhost.sh start --user bill --device macbook
  scripts/selfhost/codex-mini-selfhost.sh status --user bill --device macbook

安装完成后，如果这台 Mac 只有一个 codex-mini.*.selfhost LaunchAgent，
start/status 也可以自动推断设备。

这个脚本会从当前源码目录启动 Mac 端服务。运行前需要安装 Codex.app、
Node.js 18+，并确保 curl、python3、ssh 可用；转发服务器配置中的
设备令牌也需要与本地令牌一致。
EOF
}

ACTION="install"
relay_user=""
device=""
server_host=""
remote_port=""
codex_token="${SELFHOST_TOKEN:-}"
relay_token="${RELAY_TOKEN:-}"
public_base="${PUBLIC_BASE:-}"
ssh_key=""
local_port="${SELFHOST_PORT:-8789}"
ssh_user="root"
label_suffix="${LABEL_SUFFIX:-}"
codex_app="${CODEX_APP:-/Applications/Codex.app}"
cdp_port="${CDP_PORT:-39252}"
generated_codex_token=0
local_port_explicit=0
cdp_port_explicit=0
ssh_user_explicit=0

if [[ -n "${SELFHOST_PORT:-}" ]]; then local_port_explicit=1; fi
if [[ -n "${CDP_PORT:-}" ]]; then cdp_port_explicit=1; fi

if [[ $# -gt 0 ]]; then
  case "$1" in
    install|start|status) ACTION="$1"; shift ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) relay_user="$2"; shift 2 ;;
    --device) device="$2"; shift 2 ;;
    --server) server_host="$2"; shift 2 ;;
    --remote-port) remote_port="$2"; shift 2 ;;
    --codex-token|--selfhost-token) codex_token="$2"; shift 2 ;;
    --relay-token) relay_token="$2"; shift 2 ;;
    --public-base) public_base="$2"; shift 2 ;;
    --ssh-key) ssh_key="$2"; shift 2 ;;
    --local-port) local_port="$2"; local_port_explicit=1; shift 2 ;;
    --ssh-user) ssh_user="$2"; ssh_user_explicit=1; shift 2 ;;
    --label-suffix) label_suffix="$2"; shift 2 ;;
    --codex-app) codex_app="$2"; shift 2 ;;
    --cdp-port) cdp_port="$2"; cdp_port_explicit=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf '\nWARN: %s\n' "$*" >&2
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required argument: $name" >&2
    usage >&2
    exit 2
  fi
}

normalize_label_suffix() {
  printf '%s' "$1" | tr -cs 'A-Za-z0-9_.-' '-'
}

xml_escape() {
  /usr/bin/python3 - "$1" <<'PY'
import html
import sys

print(html.escape(sys.argv[1], quote=True), end='')
PY
}

token() {
  /usr/bin/python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
}

json_ok() {
  /usr/bin/python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(0 if data.get("ok") else 1)'
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

discover_single_label_suffix() {
  local plists=()
  local plist
  local name
  local suffix
  shopt -s nullglob
  plists=("$HOME"/Library/LaunchAgents/codex-mini.*.selfhost.plist)
  shopt -u nullglob
  if [[ "${#plists[@]}" -eq 1 ]]; then
    plist="${plists[0]}"
    name="$(basename "$plist")"
    suffix="${name#codex-mini.}"
    suffix="${suffix%.selfhost.plist}"
    printf '%s' "$suffix"
    return 0
  fi
  if [[ "${#plists[@]}" -gt 1 ]]; then
    echo "发现多个自托管 LaunchAgent。请传入 --user 和 --device，或传入 --label-suffix。" >&2
  else
    echo "没有找到自托管 LaunchAgent。请先运行 install。" >&2
  fi
  return 1
}

prepare_identity() {
  if [[ -z "$label_suffix" && -n "$relay_user" && -n "$device" ]]; then
    label_suffix="${relay_user}-${device}"
  fi
  if [[ -z "$label_suffix" && "$ACTION" != "install" ]]; then
    label_suffix="$(discover_single_label_suffix)" || exit 2
  fi
  if [[ "$ACTION" == "install" ]]; then
    require_value "--user" "$relay_user"
    require_value "--device" "$device"
  fi
  if [[ -z "$label_suffix" ]]; then
    echo "Missing --user/--device or --label-suffix." >&2
    usage >&2
    exit 2
  fi
  label_suffix="$(normalize_label_suffix "$label_suffix")"
}

load_existing_config() {
  local selfhost_file
  local value
  selfhost_file="$(selfhost_plist)"
  [[ -f "$selfhost_file" ]] || return 0

  if [[ -z "$codex_token" ]]; then
    codex_token="$(plist_env_value "$selfhost_file" MOBILE_TYPER_TOKEN)"
  fi
  if [[ "$local_port_explicit" == "0" ]]; then
    value="$(plist_env_value "$selfhost_file" PORT)"
    if [[ -n "$value" ]]; then local_port="$value"; fi
  fi
  if [[ "$cdp_port_explicit" == "0" ]]; then
    value="$(plist_env_value "$selfhost_file" CODEX_MINI_CDP_PORT)"
    if [[ -n "$value" ]]; then cdp_port="$value"; fi
  fi
  if [[ -z "$public_base" ]]; then
    public_base="$(plist_env_value "$selfhost_file" CODEX_MINI_PUBLIC_BASE)"
  fi
  if [[ -z "$remote_port" ]]; then
    remote_port="$(plist_env_value "$selfhost_file" CODEX_MINI_RELAY_REMOTE_PORT)"
  fi
  if [[ -z "$server_host" ]]; then
    server_host="$(plist_env_value "$selfhost_file" CODEX_MINI_RELAY_SSH_HOST)"
  fi
  if [[ -z "$ssh_key" ]]; then
    ssh_key="$(plist_env_value "$selfhost_file" CODEX_MINI_RELAY_SSH_KEY)"
  fi
  if [[ "$ssh_user_explicit" == "0" ]]; then
    value="$(plist_env_value "$selfhost_file" CODEX_MINI_RELAY_SSH_USER)"
    if [[ -n "$value" ]]; then ssh_user="$value"; fi
  fi
  if [[ -z "$relay_user" ]]; then
    relay_user="$(plist_env_value "$selfhost_file" CODEX_MINI_RELAY_USER)"
  fi
  if [[ -z "$device" ]]; then
    device="$(plist_env_value "$selfhost_file" CODEX_MINI_RELAY_DEVICE)"
  fi
}

validate_common() {
  prepare_identity
  load_existing_config

  if [[ "$ACTION" == "install" ]]; then
    require_value "--server" "$server_host"
    require_value "--remote-port" "$remote_port"
    require_value "--ssh-key" "$ssh_key"
  else
    if [[ ! -f "$(selfhost_plist)" ]]; then
      echo "Missing LaunchAgent plist: $(selfhost_plist)" >&2
      echo "请先运行 install，或传入正确的 --user/--device/--label-suffix。" >&2
      exit 1
    fi
    if [[ "$ACTION" == "start" && ! -f "$(tunnel_plist)" ]]; then
      echo "Missing LaunchAgent plist: $(tunnel_plist)" >&2
      echo "请先运行 install，或传入正确的 --user/--device/--label-suffix。" >&2
      exit 1
    fi
  fi

  if [[ -n "$relay_user" && ! "$relay_user" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
    echo "--user may only contain letters, numbers, underscores, and dashes." >&2
    exit 2
  fi
  if [[ -n "$device" && ! "$device" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
    echo "--device may only contain letters, numbers, underscores, and dashes." >&2
    exit 2
  fi
  if [[ ! "$local_port" =~ ^[0-9]+$ || "$local_port" -lt 1 || "$local_port" -gt 65535 ]]; then
    echo "--local-port must be a valid TCP port." >&2
    exit 2
  fi
  if [[ -n "$remote_port" && ( ! "$remote_port" =~ ^[0-9]+$ || "$remote_port" -lt 1 || "$remote_port" -gt 65535 ) ]]; then
    echo "--remote-port must be a valid TCP port." >&2
    exit 2
  fi
  if [[ ! "$cdp_port" =~ ^[0-9]+$ || "$cdp_port" -lt 1 || "$cdp_port" -gt 65535 ]]; then
    echo "--cdp-port must be a valid TCP port." >&2
    exit 2
  fi
  if [[ -n "$codex_token" && ! "$codex_token" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
    echo "--codex-token must be at least 16 URL-safe characters." >&2
    exit 2
  fi
  if [[ -n "$ssh_key" && ! -f "$ssh_key" ]]; then
    echo "SSH key not found: $ssh_key" >&2
    exit 1
  fi
  if [[ ! -f "$PROJECT_DIR/server.js" || ! -f "$PROJECT_DIR/public/index.html" ]]; then
    echo "这个脚本必须从 Codex Mini 源码目录中运行。" >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "需要 Node.js 18 或更新版本。请先安装 Node，例如使用 Homebrew：brew install node" >&2
    exit 1
  fi
  node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 18) process.exit(1)' || {
    echo "Node.js 18+ is required. Current node is too old: $(node -v)" >&2
    exit 1
  }

  if [[ -z "$codex_token" && "$ACTION" == "install" ]]; then
    codex_token="$(token)"
    generated_codex_token=1
  fi
  if [[ -z "$codex_token" ]]; then
    echo "缺少 --codex-token，且没有从现有 LaunchAgent 中读到本地令牌。请先运行 install，或传入 --codex-token。" >&2
    exit 2
  fi
  if [[ -z "$public_base" && -n "$server_host" && -n "$relay_user" && -n "$device" ]]; then
    public_base="http://${server_host}/u/${relay_user}/${device}"
  fi
}

app_support_dir() {
  printf '%s/Library/Application Support/Codex Mini Selfhost/%s\n' "$HOME" "$label_suffix"
}

selfhost_label() {
  printf 'codex-mini.%s.selfhost\n' "$label_suffix"
}

tunnel_label() {
  printf 'codex-mini.%s.tunnel\n' "$label_suffix"
}

selfhost_plist() {
  printf '%s/Library/LaunchAgents/%s.plist\n' "$HOME" "$(selfhost_label)"
}

tunnel_plist() {
  printf '%s/Library/LaunchAgents/%s.plist\n' "$HOME" "$(tunnel_label)"
}

state_dir() {
  printf '%s/.codex-mini-%s\n' "$HOME" "$label_suffix"
}

plist_env_value() {
  local plist="$1"
  local key="$2"
  /usr/bin/python3 - "$plist" "$key" <<'PY'
import plistlib
import sys

path, key = sys.argv[1], sys.argv[2]
try:
    with open(path, 'rb') as fh:
        data = plistlib.load(fh)
    print((data.get('EnvironmentVariables') or {}).get(key, ''))
except Exception:
    print('')
PY
}

cdp_ready() {
  curl -fsS --max-time 3 "http://127.0.0.1:${cdp_port}/json/list" \
    | /usr/bin/python3 -c 'import json,sys; rows=json.load(sys.stdin); sys.exit(0 if any(x.get("type")=="page" and str(x.get("url","")).startswith("app://-/index.html") for x in rows) else 1)' \
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
  pkill -f "${codex_app}/Contents/MacOS/Codex" >/dev/null 2>&1 || true
  pkill -f "${codex_app}/Contents/Frameworks/Codex Framework.framework" >/dev/null 2>&1 || true
  pkill -f "${codex_app}/Contents/Resources/codex app-server" >/dev/null 2>&1 || true
  sleep 2
}

start_codex_cdp() {
  if cdp_ready; then
    log "Codex CDP is already ready on port ${cdp_port}"
    return 0
  fi
  if [[ ! -x "${codex_app}/Contents/MacOS/Codex" ]]; then
    echo "Codex executable not found: ${codex_app}/Contents/MacOS/Codex" >&2
    echo "请先安装 Codex.app 并完成登录，再启动 Codex Mini 自托管服务。" >&2
    return 1
  fi

  log "正在用 CDP 端口 ${cdp_port} 启动 Codex.app"
  quit_codex
  "${codex_app}/Contents/MacOS/Codex" \
    --remote-debugging-address=127.0.0.1 \
    "--remote-debugging-port=${cdp_port}" \
    "--remote-allow-origins=http://127.0.0.1:${cdp_port}" \
    --disable-background-timer-throttling \
    --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows \
    >/tmp/codex-desktop-cdp.out.log 2>/tmp/codex-desktop-cdp.err.log &

  for _ in {1..30}; do
    if cdp_ready; then
      log "Codex CDP is ready"
      return 0
    fi
    sleep 1
  done

  echo "Failed to start Codex CDP on port ${cdp_port}." >&2
  echo "Check logs: /tmp/codex-desktop-cdp.err.log" >&2
  return 1
}

write_launchagents() {
  local app_support
  local node_bin
  local selfhost
  local tunnel
  local selfhost_file
  local tunnel_file
  app_support="$(app_support_dir)"
  node_bin="$(command -v node)"
  selfhost="$(selfhost_label)"
  tunnel="$(tunnel_label)"
  selfhost_file="$(selfhost_plist)"
  tunnel_file="$(tunnel_plist)"

  mkdir -p "$HOME/Library/LaunchAgents" "$app_support/logs" "$(state_dir)"

  local x_selfhost x_tunnel x_node_bin x_server_js x_project_dir x_app_support
  local x_local_port x_codex_token x_cdp_port x_state_dir x_public_base
  local x_remote_port x_server_host x_ssh_key x_ssh_user x_relay_user x_device
  x_selfhost="$(xml_escape "$selfhost")"
  x_tunnel="$(xml_escape "$tunnel")"
  x_node_bin="$(xml_escape "$node_bin")"
  x_server_js="$(xml_escape "${PROJECT_DIR}/server.js")"
  x_project_dir="$(xml_escape "$PROJECT_DIR")"
  x_app_support="$(xml_escape "$app_support")"
  x_local_port="$(xml_escape "$local_port")"
  x_codex_token="$(xml_escape "$codex_token")"
  x_cdp_port="$(xml_escape "$cdp_port")"
  x_state_dir="$(xml_escape "$(state_dir)")"
  x_public_base="$(xml_escape "$public_base")"
  x_remote_port="$(xml_escape "$remote_port")"
  x_server_host="$(xml_escape "$server_host")"
  x_ssh_key="$(xml_escape "$ssh_key")"
  x_ssh_user="$(xml_escape "$ssh_user")"
  x_relay_user="$(xml_escape "$relay_user")"
  x_device="$(xml_escape "$device")"

  cat >"$selfhost_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${x_selfhost}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${x_node_bin}</string>
    <string>${x_server_js}</string>
  </array>
  <key>WorkingDirectory</key><string>${x_project_dir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_MINI_APP_NAME</key><string>Codex Mini Selfhost</string>
    <key>HOST</key><string>127.0.0.1</string>
    <key>PORT</key><string>${x_local_port}</string>
    <key>MOBILE_TYPER_TOKEN</key><string>${x_codex_token}</string>
    <key>CODEX_MINI_BETA</key><string>0</string>
    <key>CODEX_MINI_LOCAL_ONLY</key><string>1</string>
    <key>CODEX_MINI_HIDE_LAN_BASES</key><string>1</string>
    <key>CODEX_MINI_RELAY_BASES</key><string></string>
    <key>CODEX_MINI_BETA_RELAY_BASE</key><string></string>
    <key>CODEX_MINI_LICENSE_API_BASE</key><string></string>
    <key>CODEX_MINI_CDP_HOST</key><string>[::1]</string>
    <key>CODEX_MINI_CDP_PORT</key><string>${x_cdp_port}</string>
    <key>CODEX_MINI_MAX_BODY_BYTES</key><string>536870912</string>
    <key>CODEX_MINI_STATE_DIR</key><string>${x_state_dir}</string>
    <key>CODEX_MINI_PUBLIC_BASE</key><string>${x_public_base}</string>
    <key>CODEX_MINI_RELAY_USER</key><string>${x_relay_user}</string>
    <key>CODEX_MINI_RELAY_DEVICE</key><string>${x_device}</string>
    <key>CODEX_MINI_RELAY_REMOTE_PORT</key><string>${x_remote_port}</string>
    <key>CODEX_MINI_RELAY_SSH_HOST</key><string>${x_server_host}</string>
    <key>CODEX_MINI_RELAY_SSH_USER</key><string>${x_ssh_user}</string>
    <key>CODEX_MINI_RELAY_SSH_KEY</key><string>${x_ssh_key}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${x_app_support}/logs/selfhost.out.log</string>
  <key>StandardErrorPath</key><string>${x_app_support}/logs/selfhost.err.log</string>
</dict>
</plist>
EOF

  cat >"$tunnel_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${x_tunnel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string>
    <string>-N</string>
    <string>-T</string>
    <string>-i</string>
    <string>${x_ssh_key}</string>
    <string>-o</string>
    <string>ExitOnForwardFailure=yes</string>
    <string>-o</string>
    <string>ServerAliveInterval=30</string>
    <string>-o</string>
    <string>ServerAliveCountMax=3</string>
    <string>-o</string>
    <string>StrictHostKeyChecking=accept-new</string>
    <string>-R</string>
    <string>127.0.0.1:${x_remote_port}:127.0.0.1:${x_local_port}</string>
    <string>${x_ssh_user}@${x_server_host}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${x_app_support}/logs/tunnel.out.log</string>
  <key>StandardErrorPath</key><string>${x_app_support}/logs/tunnel.err.log</string>
</dict>
</plist>
EOF

  chmod 600 "$selfhost_file" "$tunnel_file"
}

check_selfhost() {
  local body
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:${local_port}/codex/config?token=${codex_token}" 2>/dev/null)" || return 1
  printf '%s' "$body" | json_ok
}

check_public() {
  [[ -n "$public_base" ]] || return 0
  if [[ "$generated_codex_token" == "1" ]]; then
    warn "Public route check skipped because --codex-token was generated. Update devices.json with the printed codexToken, then rerun start to verify."
    return 0
  fi
  if [[ -z "$relay_token" ]]; then
    warn "Public route check skipped because --relay-token was not provided."
    return 0
  fi
  local body
  local curl_args=(-fsS --max-time 8)
  curl_args+=(-H "x-codex-mini-relay-token: ${relay_token}")
  body="$(curl "${curl_args[@]}" "${public_base}/codex/health" 2>/dev/null)" || return 1
  printf '%s' "$body" | json_ok
}

install_stack() {
  log "Writing LaunchAgents from source checkout"
  write_launchagents
  launchctl bootout "$DOMAIN" "$(selfhost_plist)" >/dev/null 2>&1 || true
  launchctl bootout "$DOMAIN" "$(tunnel_plist)" >/dev/null 2>&1 || true
  start_stack
}

start_stack() {
  start_codex_cdp
  log "正在启动 $(selfhost_label)"
  load_or_restart_service "$(selfhost_label)" "$(selfhost_plist)"
  sleep 2
  log "正在启动 $(tunnel_label)"
  load_or_restart_service "$(tunnel_label)" "$(tunnel_plist)"
  sleep 2
  log "Checking local self-host API"
  retry 10 1 check_selfhost
  log "Checking public route"
  retry 10 1 check_public
  print_summary
}

print_summary() {
  printf '\nReady.\n\n'
  printf 'Local URL:\nhttp://127.0.0.1:%s/?token=%s\n\n' "$local_port" "$codex_token"
  if [[ -n "$public_base" ]]; then
    printf 'Phone URL:\n%s/\n\n' "${public_base%/}"
  fi
  if [[ -n "$relay_user" && -n "$device" && -n "$remote_port" ]]; then
    cat <<EOF
Relay devices.json entry should use:
  user:       ${relay_user}
  device:     ${device}
  codexToken: ${codex_token}
  upstream:   127.0.0.1:${remote_port}

EOF
  fi
  cat <<EOF
Diagnostics:
launchctl print ${DOMAIN}/$(selfhost_label)
launchctl print ${DOMAIN}/$(tunnel_label)
curl -sS "http://127.0.0.1:${local_port}/codex/gui-status?token=${codex_token}"
EOF
}

status_stack() {
  launchctl print "${DOMAIN}/$(selfhost_label)" 2>/dev/null || true
  launchctl print "${DOMAIN}/$(tunnel_label)" 2>/dev/null || true
  curl -sS "http://127.0.0.1:${local_port}/codex/health?token=${codex_token}" || true
  printf '\n'
  curl -sS "http://127.0.0.1:${cdp_port}/json/list" | head -c 1000 || true
  printf '\n'
}

validate_common

case "$ACTION" in
  install) install_stack ;;
  start) start_stack ;;
  status) status_stack ;;
  *) echo "Unknown action: $ACTION" >&2; usage >&2; exit 2 ;;
esac
