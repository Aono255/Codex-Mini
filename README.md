# Codex Mini 自托管版

Codex Mini 自托管版可以让手机浏览器通过你自己的服务器控制 Mac 上正在运行的 Codex Desktop。

```text
手机浏览器 -> 公网转发服务器 -> SSH 反向隧道 -> Mac 本地服务 -> Codex Desktop CDP
```

本仓库的转发服务和 Mac 端服务都直接从源码目录运行。服务器只负责登录、设备选择和流量转发；真正的 Codex 登录状态、线程内容和执行过程仍然保留在每个用户自己的 Mac 上。

## 运行要求

Mac 端需要：

- macOS，已在 `/Applications` 安装并登录 `Codex.app`。
- Node.js 18 或更新版本。
- 系统可用的 `curl`、`python3`、`ssh`、`launchctl`。
- 一把可以登录转发服务器的 SSH 私钥。

转发服务器需要：

- 一台 Linux 服务器，Mac 可以通过 SSH 连上，手机可以通过 HTTP/HTTPS 访问。
- Node.js 18 或更新版本。
- 建议使用 Nginx 承接公网 HTTP/HTTPS 流量。

## 转发服务器部署

在服务器上克隆本仓库，例如：

```bash
git clone https://github.com/Aono255/Codex-Mini.git /opt/codex-mini
cd /opt/codex-mini
```

创建 `/etc/codex-mini/devices.json`：

```json
{
  "users": [
    {
      "user": "bill",
      "displayName": "Bill",
      "relayToken": "replace-with-random-login-token"
    }
  ],
  "devices": [
    {
      "user": "bill",
      "device": "macbook",
      "displayName": "Bill MacBook",
      "relayToken": "replace-with-random-login-token",
      "codexToken": "replace-with-random-local-token",
      "upstream": {
        "host": "127.0.0.1",
        "port": 18788,
        "protocol": "http:"
      }
    }
  ]
}
```

生成随机令牌：

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

启动转发服务：

```bash
HOST=127.0.0.1 \
PORT=18700 \
CODEX_MINI_RELAY_CONFIG=/etc/codex-mini/devices.json \
node /opt/codex-mini/server/selfhost/multi-user-relay.js
```

生产环境可以参考仓库内的 systemd 和 Nginx 模板：

- `server/selfhost/codex-mini-relay.service`
- `server/selfhost/nginx-codex-mini-relay.conf`

真实用户使用时建议启用 HTTPS。

## Mac 端部署

在 Mac 上克隆本仓库：

```bash
git clone https://github.com/Aono255/Codex-Mini.git
cd Codex-Mini
```

用一个命令安装并启动完整 Mac 端服务：

```bash
scripts/selfhost/codex-mini-selfhost.sh install \
  --user bill \
  --device macbook \
  --server relay.example.com \
  --remote-port 18788 \
  --ssh-key ~/.ssh/codex_mini_relay \
  --codex-token replace-with-random-local-token \
  --relay-token replace-with-random-login-token \
  --public-base https://relay.example.com/u/bill/macbook
```

这个命令会完成：

- 使用 CDP 参数启动 `Codex.app`，默认端口为 `39252`。
- 写入两个 LaunchAgent。
- 启动 Mac 本地 Codex Mini 服务，默认监听 `127.0.0.1:8789`。
- 建立 SSH 反向隧道，把服务器上的设备端口转发到 Mac 本地服务。
- 验证本地服务和公网入口是否可用。

如果省略 `--codex-token`，脚本会自动生成一个本地令牌并打印出来。你需要把这个值写入服务器 `/etc/codex-mini/devices.json` 中对应设备的 `codexToken` 字段。

生成的 LaunchAgent 名称：

```text
codex-mini.<user-device>.selfhost
codex-mini.<user-device>.tunnel
```

## 日常启动和修复

Mac 重启后，可以再次运行同一个 `install` 命令。它是幂等的，会用当前源码目录重新写入 LaunchAgent 并启动服务：

```bash
scripts/selfhost/codex-mini-selfhost.sh install ...
```

如果只想按已有 LaunchAgent 配置重启，不重写配置：

```bash
scripts/selfhost/codex-mini-selfhost.sh start --user bill --device macbook
```

如果这台 Mac 只安装了一个自托管设备，脚本可以自动推断设备：

```bash
scripts/selfhost/codex-mini-selfhost.sh start
```

查看本地状态：

```bash
scripts/selfhost/codex-mini-selfhost.sh status --user bill --device macbook
```

## 用户使用流程

1. 打开 `https://relay.example.com/login`。
2. 输入分配好的用户名和转发登录令牌。
3. 选择要控制的设备。
4. 浏览器进入 `/u/<user>/<device>/`。
5. Web 页面通过 SSH 反向隧道控制该用户自己的 Mac。

## CDP 控制说明

Mac 端服务通过 CDP 控制 Codex Desktop。转发服务器只负责认证用户、选择设备、注入设备对应的 `codexToken` 并代理请求。

以下能力都依赖 Mac 端 CDP：

- 发送文字和附件。
- 切换线程。
- 读取模型、权限、推理强度和上下文用量。
- 切换模型、权限和推理强度。
- 停止当前回复。
- 对队列消息应用引导。

如果页面提示无法通过 CDP 控制 Codex，可以先检查：

```bash
curl -sS http://127.0.0.1:39252/json/list | head -c 1000
curl -sS "http://127.0.0.1:8789/codex/gui-status?token=<codexToken>"
launchctl print gui/$(id -u)/codex-mini.bill-macbook.selfhost
launchctl print gui/$(id -u)/codex-mini.bill-macbook.tunnel
```

## 授权

本 fork 沿用上游的源码可用、非商业授权。完整条款见 [`LICENSE`](./LICENSE)。

原项目署名：Codex Mini by [CoimgRain](https://github.com/CoimgRain)，原仓库：https://github.com/CoimgRain/Codex-Mini
