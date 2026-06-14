# Self-hosted remote control

This setup keeps Codex Mini's control path on your own infrastructure:

```text
phone browser -> your HTTPS/HTTP reverse proxy -> SSH reverse tunnel -> Mac localhost Codex Mini -> Codex Desktop
```

It does not require the Codex Mini official relay. Each Mac still needs a local
Codex Desktop session and a local Codex Mini service.

## Mac requirements

- Install and sign in to `Codex.app`.
- Install `Codex Mini.app` so the bundled Node runtime, `server.js`, and CDP
  launcher exist under `~/Library/Application Support/Codex Mini`.
- Run Codex with CDP enabled on `127.0.0.1:39252`.
- Run a selfhost Codex Mini LaunchAgent bound to `127.0.0.1`.
- Run an SSH reverse tunnel from the Mac to the public server.

Use `scripts/selfhost/start-codex-mini-selfhost.sh` to repair and verify the
local stack.

Required environment:

```bash
export SELFHOST_TOKEN="<per-device-token>"
export PUBLIC_BASE="http://example.com/codex-mini-beta/aono"
export BASIC_AUTH_USER="<optional-basic-auth-user>"
export BASIC_AUTH_PASSWORD="<optional-basic-auth-password>"
scripts/selfhost/start-codex-mini-selfhost.sh
```

The selfhost service should use these environment settings:

```text
HOST=127.0.0.1
PORT=8789
MOBILE_TYPER_TOKEN=<per-device-token>
CODEX_MINI_BETA=0
CODEX_MINI_LOCAL_ONLY=1
CODEX_MINI_RELAY_BASES=
CODEX_MINI_BETA_RELAY_BASE=
CODEX_MINI_LICENSE_API_BASE=
CODEX_MINI_HIDE_LAN_BASES=1
CODEX_MINI_CDP_HOST=[::1]
CODEX_MINI_CDP_PORT=39252
```

`CODEX_MINI_HIDE_LAN_BASES=1` prevents the phone UI from auto-switching to a
private LAN address that is unreachable outside the Mac's network.

## Shared server layout

Multiple users can share one public server if each user/device gets isolated
credentials and a separate local upstream port:

```text
/codex-mini-beta/aono -> 127.0.0.1:18787 -> Aono's Mac 127.0.0.1:8789
/codex-mini-beta/bill -> 127.0.0.1:18788 -> Bill's Mac 127.0.0.1:8789
```

The browser URL for each device is:

```text
http://server.example/codex-mini-beta/<device-id>/?token=<device-token>
```

Subdomains are also fine, but path routing with `/codex-mini-beta/<device-id>`
matches the existing Codex Mini frontend base-path detection and avoids patching
the UI.

## Nginx example

```nginx
map $uri $codex_mini_upstream {
    default "";
    ~^/codex-mini-beta/aono(?:/|$) http://127.0.0.1:18787;
    ~^/codex-mini-beta/bill(?:/|$) http://127.0.0.1:18788;
}

server {
    listen 80;
    server_name _;

    auth_basic "Codex Mini";
    auth_basic_user_file /etc/nginx/.codex-mini.htpasswd;

    client_max_body_size 512m;

    location ~ ^/codex-mini-beta/[^/]+(?:/.*)?$ {
        if ($codex_mini_upstream = "") { return 404; }
        proxy_pass $codex_mini_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

For production use, put HTTPS in front of this server.
