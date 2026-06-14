# Self-hosted remote control

This setup keeps Codex Mini's remote-control path on infrastructure you operate:

```text
phone browser -> public relay server -> SSH reverse tunnel -> Mac localhost Codex Mini -> Codex Desktop
```

It does not use the Codex Mini official Pro relay. Each user still runs Codex
Desktop and Codex Mini locally on their own Mac.

## Multi-user model

The shared relay server exposes one login page and one path per user/device:

```text
https://relay.example.com/login
https://relay.example.com/u/aono/mac-mini/
https://relay.example.com/u/bill/macbook/
```

Each device has two secrets:

- `relayToken`: login token for the public relay page.
- `codexToken`: local Codex Mini token used between the browser UI and the Mac
  service.

The user types only `user` and `relayToken` on `/login`, then chooses a device
from the device picker. After device selection, the relay stores HttpOnly
cookies for the user session and selected device. The browser only keeps a
harmless session marker; the relay injects the device's `codexToken` when
forwarding requests to the Mac. Different users/devices do not share browser
state because the Codex Mini UI scopes local storage by path.

If one user should choose between multiple devices after login, give those
devices the same `relayToken`. You can also define a top-level `users` array
with a user-level `relayToken`; that token can access every configured device
for the same user.

Generate URL-safe tokens with:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

## Server setup

Copy the repo to the relay server, for example `/opt/codex-mini`, then create
`/etc/codex-mini/devices.json` from
`server/selfhost/devices.example.json`:

```json
{
  "devices": [
    {
      "user": "aono",
      "device": "mac-mini",
      "relayToken": "random-login-token-for-aono",
      "codexToken": "random-local-codex-mini-token-for-aono",
      "upstream": { "host": "127.0.0.1", "port": 18787, "protocol": "http:" }
    },
    {
      "user": "bill",
      "device": "macbook",
      "relayToken": "random-login-token-for-bill",
      "codexToken": "random-local-codex-mini-token-for-bill",
      "upstream": { "host": "127.0.0.1", "port": 18788, "protocol": "http:" }
    }
  ]
}
```

Run the relay:

```bash
HOST=127.0.0.1 \
PORT=18700 \
CODEX_MINI_RELAY_CONFIG=/etc/codex-mini/devices.json \
node /opt/codex-mini/server/selfhost/multi-user-relay.js
```

For systemd, use `server/selfhost/codex-mini-relay.service`. Put Nginx in front
with `server/selfhost/nginx-codex-mini-relay.conf`. Use HTTPS for real users.

## Mac setup

Each Mac needs:

- `Codex.app` installed and signed in.
- `Codex Mini.app` installed and opened once, so the bundled Node runtime,
  `server.js`, and CDP launcher exist under
  `~/Library/Application Support/Codex Mini`.
- An SSH key that can connect to the relay server.
- A unique remote tunnel port reserved in `devices.json`.

Install per-device LaunchAgents:

```bash
scripts/selfhost/install-device-launchagents.sh \
  --user bill \
  --device macbook \
  --server relay.example.com \
  --remote-port 18788 \
  --codex-token random-local-codex-mini-token-for-bill \
  --ssh-key ~/.ssh/codex_mini_relay
```

This creates:

```text
codex-mini.bill-macbook.selfhost -> 127.0.0.1:8789 on Bill's Mac
codex-mini.bill-macbook.tunnel   -> 127.0.0.1:18788 on the relay server
```

The local service uses:

```text
HOST=127.0.0.1
PORT=8789
MOBILE_TYPER_TOKEN=<codexToken>
CODEX_MINI_LOCAL_ONLY=1
CODEX_MINI_HIDE_LAN_BASES=1
CODEX_MINI_CDP_HOST=[::1]
CODEX_MINI_CDP_PORT=39252
```

Use `scripts/selfhost/start-codex-mini-selfhost.sh` to repair and verify a Mac
stack after reboot:

```bash
export SELFHOST_TOKEN="<codexToken>"
export RELAY_TOKEN="<relayToken>"
export PUBLIC_BASE="https://relay.example.com/u/bill/macbook"
scripts/selfhost/start-codex-mini-selfhost.sh
```

## User flow

1. Open `https://relay.example.com/login`.
2. Enter the assigned user and relay token.
3. Choose a device from the device picker.
4. The relay redirects to `/u/<user>/<device>/`.
5. The Codex Mini UI controls the user's own Mac through the SSH tunnel.

If the phone can open the device page but cannot list messages, check that the
Mac is online, the tunnel LaunchAgent is running, and Codex Desktop is running
with CDP on port `39252`.
