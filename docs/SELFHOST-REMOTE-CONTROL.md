# 自托管远程控制方案

这套方案把 Codex Mini 的远程控制链路放在你自己管理的基础设施上：

```text
手机浏览器 -> 公网转发服务器 -> SSH 反向隧道 -> Mac 本地 Codex Mini 服务 -> Codex Desktop
```

它不使用 Codex Mini 官方 Pro 转发服务。每个用户仍然在自己的 Mac 上运行 Codex Desktop，Mac 端 Codex Mini 服务直接从本仓库源码目录运行。

## 多用户模型

共享转发服务器提供一个登录页，并按用户和设备暴露独立路径：

```text
https://relay.example.com/login
https://relay.example.com/u/aono/mac-mini/
https://relay.example.com/u/bill/macbook/
```

每个设备有两个密钥：

- `relayToken`：用户在公网登录页使用的转发登录令牌。
- `codexToken`：转发服务器访问 Mac 本地 Codex Mini 服务时注入的本地令牌。

用户只需要在 `/login` 输入 `user` 和 `relayToken`，然后选择设备。选择设备后，转发服务器会写入 HttpOnly Cookie 来保存用户会话和当前设备。浏览器本地只保存无害的会话标记；真正访问 Mac 上游时，由转发服务器注入该设备的 `codexToken`。不同用户和不同设备的 Web 本地存储会按路径隔离。

如果一个用户登录后需要选择多个设备，可以给这些设备配置同一个 `relayToken`。也可以在顶层 `users` 数组里定义用户级 `relayToken`，这个令牌可以访问同一用户下的所有设备。

生成 URL 安全令牌：

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

## 服务器部署

把仓库放到转发服务器，例如 `/opt/codex-mini`，然后基于 `server/selfhost/devices.example.json` 创建 `/etc/codex-mini/devices.json`：

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

启动转发服务：

```bash
HOST=127.0.0.1 \
PORT=18700 \
CODEX_MINI_RELAY_CONFIG=/etc/codex-mini/devices.json \
node /opt/codex-mini/server/selfhost/multi-user-relay.js
```

systemd 可参考 `server/selfhost/codex-mini-relay.service`。公网流量建议放在 Nginx 后面，Nginx 模板见 `server/selfhost/nginx-codex-mini-relay.conf`。真实使用时建议启用 HTTPS。

## Mac 端部署

每台 Mac 需要：

- 已安装并登录 `Codex.app`。
- Node.js 18+。
- 本仓库源码目录。
- 一把可以登录转发服务器的 SSH 私钥。
- 在 `devices.json` 中为该设备预留一个唯一的远端隧道端口。

用一个命令安装并启动 Mac 端服务：

```bash
scripts/selfhost/codex-mini-selfhost.sh install \
  --user bill \
  --device macbook \
  --server relay.example.com \
  --remote-port 18788 \
  --codex-token random-local-codex-mini-token-for-bill \
  --relay-token random-login-token-for-bill \
  --ssh-key ~/.ssh/codex_mini_relay \
  --public-base https://relay.example.com/u/bill/macbook
```

它会创建：

```text
codex-mini.bill-macbook.selfhost -> Bill 的 Mac 上 127.0.0.1:8789
codex-mini.bill-macbook.tunnel   -> 转发服务器上 127.0.0.1:18788
```

本地服务使用的关键环境变量：

```text
HOST=127.0.0.1
PORT=8789
MOBILE_TYPER_TOKEN=<codexToken>
CODEX_MINI_LOCAL_ONLY=1
CODEX_MINI_HIDE_LAN_BASES=1
CODEX_MINI_CDP_HOST=[::1]
CODEX_MINI_CDP_PORT=39252
```

脚本会直接用 CDP 参数启动 `/Applications/Codex.app`，并从当前仓库源码目录运行 Mac 端服务。

## CDP 控制面

Mac 端 Codex Mini 服务必须通过 CDP Worker 控制 Codex Desktop。转发服务器只应该认证用户、选择设备、注入设备的 `codexToken`，再把请求代理到对应 Mac。转发服务器不应该直接读取或修改 Codex GUI 状态。

以下接口依赖 CDP 控制链路：

```text
GET  /codex/gui-status
POST /codex/approval-mode
POST /codex/model-switch
POST /codex/reasoning-mode
POST /codex/select
POST /send
```

不要用修改 `~/.codex/config.toml` 代替 CDP 来切换权限模式。Codex 输入框里可见的状态可能是线程级状态，也可能和顶层配置不同。正确做法是通过 CDP DOM 自动化读取并点击 Codex 输入框控件，然后返回 Codex 页面实际显示的状态。

自托管控制链路不要依赖 AppleScript 坐标点击、`cliclick` 或 `codex-window-point`。这些方式很容易受 macOS TCC 辅助功能权限、重启后的窗口状态和坐标变化影响，并产生类似下面的旧错误：

```text
已经收到文字，但没能自动聚焦 Codex 输入框。请确认 Codex 正在运行，且当前终端已开启辅助功能权限。
```

如果出现这条提示，通常表示 Mac 端运行的是旧的非 CDP 服务或错误的 LaunchAgent，而不是当前自托管栈。当前 CDP 链路失败时，错误信息应该明确提到 CDP DOM 控制或端口 `39252`。

常用排查命令：

```bash
launchctl print gui/$(id -u)/codex-mini.selfhost
curl -sS "http://127.0.0.1:8789/codex/health?token=<codexToken>"
curl -sS "http://127.0.0.1:8789/codex/gui-status?token=<codexToken>"
curl -sS "https://relay.example.com/u/<user>/<device>/codex/gui-status?relayToken=<relayToken>"
```

`relayToken` 只用于公网登录和设备路径。`codexToken` 只用于 Mac 本地直连请求，或由转发服务器注入给上游请求。把 `codexToken` 当公网 `relayToken` 使用时应该返回 `UNAUTHORIZED`。

生产环境转发配置是 `CODEX_MINI_RELAY_CONFIG` 指向的文件，通常是 `/etc/codex-mini/devices.json`。仓库里的 `server/selfhost/devices.example.json` 只是模板。

Mac 重启后，可以用同一个统一脚本修复并验证服务：

```bash
scripts/selfhost/codex-mini-selfhost.sh install \
  --user bill \
  --device macbook \
  --server relay.example.com \
  --remote-port 18788 \
  --codex-token "<codexToken>" \
  --relay-token "<relayToken>" \
  --ssh-key ~/.ssh/codex_mini_relay \
  --public-base "https://relay.example.com/u/bill/macbook"
```

如果不想重写 LaunchAgent，只想按已有配置重启：

```bash
scripts/selfhost/codex-mini-selfhost.sh start --user bill --device macbook
```

如果这台 Mac 只安装了一个自托管设备，`start` 和 `status` 可以从已有 LaunchAgent 自动推断设备：

```bash
scripts/selfhost/codex-mini-selfhost.sh start
scripts/selfhost/codex-mini-selfhost.sh status
```

旧的 `install-device-launchagents.sh` 和 `start-codex-mini-selfhost.sh` 文件只是兼容包装，内部会转发到统一脚本。

## 用户流程

1. 打开 `https://relay.example.com/login`。
2. 输入分配好的用户名和转发登录令牌。
3. 从设备选择页选择设备。
4. 转发服务器跳转到 `/u/<user>/<device>/`。
5. Codex Mini Web 页面通过 SSH 反向隧道控制用户自己的 Mac。

如果手机能打开设备页面但加载不到消息列表，优先检查 Mac 是否在线、隧道 LaunchAgent 是否运行，以及 Codex Desktop 是否已经用 CDP 暴露 `39252` 端口。
