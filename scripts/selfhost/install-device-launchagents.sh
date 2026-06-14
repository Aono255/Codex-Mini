#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  install-device-launchagents.sh \
    --user <relay-user> \
    --device <device-id> \
    --server <ssh-host> \
    --remote-port <server-port> \
    --codex-token <local-codex-mini-token> \
    --ssh-key <path-to-private-key> \
    [--local-port 8789] \
    [--ssh-user root] \
    [--label-suffix user-device]

This installs two macOS LaunchAgents:
  codex-mini.<suffix>.selfhost  -> local Codex Mini on 127.0.0.1:<local-port>
  codex-mini.<suffix>.tunnel    -> SSH reverse tunnel to 127.0.0.1:<remote-port> on the server

The public relay server must contain a matching devices.json entry:
  user=<relay-user>, device=<device-id>, codexToken=<local-codex-mini-token>, upstream.port=<server-port>
EOF
}

relay_user=""
device=""
server_host=""
remote_port=""
codex_token=""
ssh_key=""
local_port="8789"
ssh_user="root"
label_suffix=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) relay_user="$2"; shift 2 ;;
    --device) device="$2"; shift 2 ;;
    --server) server_host="$2"; shift 2 ;;
    --remote-port) remote_port="$2"; shift 2 ;;
    --codex-token) codex_token="$2"; shift 2 ;;
    --ssh-key) ssh_key="$2"; shift 2 ;;
    --local-port) local_port="$2"; shift 2 ;;
    --ssh-user) ssh_user="$2"; shift 2 ;;
    --label-suffix) label_suffix="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required argument: $name" >&2
    usage >&2
    exit 2
  fi
}

require_value "--user" "$relay_user"
require_value "--device" "$device"
require_value "--server" "$server_host"
require_value "--remote-port" "$remote_port"
require_value "--codex-token" "$codex_token"
require_value "--ssh-key" "$ssh_key"

if [[ ! "$relay_user" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "--user may only contain letters, numbers, underscores, and dashes." >&2
  exit 2
fi
if [[ ! "$device" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "--device may only contain letters, numbers, underscores, and dashes." >&2
  exit 2
fi
if [[ ! "$codex_token" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
  echo "--codex-token must be at least 16 URL-safe characters: letters, numbers, underscores, or dashes." >&2
  exit 2
fi
if [[ ! "$local_port" =~ ^[0-9]+$ || "$local_port" -lt 1 || "$local_port" -gt 65535 ]]; then
  echo "--local-port must be a valid TCP port." >&2
  exit 2
fi
if [[ ! "$remote_port" =~ ^[0-9]+$ || "$remote_port" -lt 1 || "$remote_port" -gt 65535 ]]; then
  echo "--remote-port must be a valid TCP port." >&2
  exit 2
fi

if [[ -z "$label_suffix" ]]; then
  label_suffix="${relay_user}-${device}"
fi
label_suffix="$(printf '%s' "$label_suffix" | tr -cs 'A-Za-z0-9_.-' '-')"

app_support="${HOME}/Library/Application Support/Codex Mini"
node_bin="${app_support}/node/node"
server_js="${app_support}/server.js"
cdp_launcher="${app_support}/bin/launch-main-codex-cdp.sh"

if [[ ! -x "$node_bin" || ! -f "$server_js" ]]; then
  echo "Codex Mini app runtime not found under: ${app_support}" >&2
  echo "Install and open Codex Mini.app once before running this script." >&2
  exit 1
fi
if [[ ! -f "$ssh_key" ]]; then
  echo "SSH key not found: $ssh_key" >&2
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${app_support}/logs"

selfhost_label="codex-mini.${label_suffix}.selfhost"
tunnel_label="codex-mini.${label_suffix}.tunnel"
selfhost_plist="${HOME}/Library/LaunchAgents/${selfhost_label}.plist"
tunnel_plist="${HOME}/Library/LaunchAgents/${tunnel_label}.plist"
state_dir="${HOME}/.codex-mini-${label_suffix}"

cat >"$selfhost_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${selfhost_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${server_js}</string>
  </array>
  <key>WorkingDirectory</key><string>${app_support}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_MINI_APP_NAME</key><string>Codex Mini Selfhost</string>
    <key>HOST</key><string>127.0.0.1</string>
    <key>PORT</key><string>${local_port}</string>
    <key>MOBILE_TYPER_TOKEN</key><string>${codex_token}</string>
    <key>CODEX_MINI_BETA</key><string>0</string>
    <key>CODEX_MINI_LOCAL_ONLY</key><string>1</string>
    <key>CODEX_MINI_HIDE_LAN_BASES</key><string>1</string>
    <key>CODEX_MINI_RELAY_BASES</key><string></string>
    <key>CODEX_MINI_BETA_RELAY_BASE</key><string></string>
    <key>CODEX_MINI_LICENSE_API_BASE</key><string></string>
    <key>CODEX_MINI_CDP_HOST</key><string>[::1]</string>
    <key>CODEX_MINI_CDP_PORT</key><string>39252</string>
    <key>CODEX_MINI_MAX_BODY_BYTES</key><string>536870912</string>
    <key>CODEX_MINI_STATE_DIR</key><string>${state_dir}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${app_support}/logs/${label_suffix}.selfhost.out.log</string>
  <key>StandardErrorPath</key><string>${app_support}/logs/${label_suffix}.selfhost.err.log</string>
</dict>
</plist>
EOF

cat >"$tunnel_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${tunnel_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string>
    <string>-N</string>
    <string>-T</string>
    <string>-i</string>
    <string>${ssh_key}</string>
    <string>-o</string>
    <string>ExitOnForwardFailure=yes</string>
    <string>-o</string>
    <string>ServerAliveInterval=30</string>
    <string>-o</string>
    <string>ServerAliveCountMax=3</string>
    <string>-o</string>
    <string>StrictHostKeyChecking=accept-new</string>
    <string>-R</string>
    <string>127.0.0.1:${remote_port}:127.0.0.1:${local_port}</string>
    <string>${ssh_user}@${server_host}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${app_support}/logs/${label_suffix}.tunnel.out.log</string>
  <key>StandardErrorPath</key><string>${app_support}/logs/${label_suffix}.tunnel.err.log</string>
</dict>
</plist>
EOF

domain="gui/$(id -u)"
launchctl bootout "$domain" "$selfhost_plist" >/dev/null 2>&1 || true
launchctl bootout "$domain" "$tunnel_plist" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$selfhost_plist"
launchctl bootstrap "$domain" "$tunnel_plist"
launchctl kickstart -k "${domain}/${selfhost_label}"
launchctl kickstart -k "${domain}/${tunnel_label}"

cat <<EOF
Installed:
  ${selfhost_plist}
  ${tunnel_plist}

Labels:
  ${selfhost_label}
  ${tunnel_label}

Optional CDP launcher:
  ${cdp_launcher}

Check:
  launchctl print ${domain}/${selfhost_label}
  launchctl print ${domain}/${tunnel_label}
  curl -sS http://127.0.0.1:${local_port}/codex/health?token=${codex_token}
EOF
