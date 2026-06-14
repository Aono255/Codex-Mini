#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 18700);
const CONFIG_PATH = process.env.CODEX_MINI_RELAY_CONFIG || path.join(__dirname, 'devices.example.json');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const COOKIE_PREFIX = 'codexMiniRelay';
const BROWSER_SESSION_TOKEN = 'relay-authenticated';
const BODY_LIMIT_BYTES = Number(process.env.CODEX_MINI_RELAY_BODY_LIMIT_BYTES || 512 * 1024 * 1024);
const LOGIN_BODY_LIMIT_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = Number(process.env.CODEX_MINI_RELAY_REQUEST_TIMEOUT_MS || 300000);

let configCache = { mtimeMs: -1, devices: new Map() };

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function html(res, status, body, headers = {}) {
  const text = String(body || '');
  res.writeHead(status, {
    ...headers,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, {
    ...headers,
    location,
    'cache-control': 'no-store',
  });
  res.end();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readBody(req, limitBytes = BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function normalizePathPart(value, name) {
  const text = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(text)) {
    throw new Error(`Invalid ${name}: ${text}`);
  }
  return text;
}

function normalizeDevice(row) {
  const user = normalizePathPart(row.user, 'user');
  const device = normalizePathPart(row.device, 'device');
  const token = String(row.relayToken || '').trim();
  if (token.length < 16) throw new Error(`relayToken is too short for ${user}/${device}`);
  const codexToken = String(row.codexToken || '').trim();
  if (codexToken.length < 16) throw new Error(`codexToken is too short for ${user}/${device}`);

  const upstream = row.upstream || {};
  const host = String(upstream.host || '127.0.0.1').trim();
  const port = Number(upstream.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid upstream for ${user}/${device}`);
  }

  return {
    user,
    device,
    displayName: String(row.displayName || `${user}/${device}`).trim(),
    relayToken: token,
    codexToken,
    upstream: {
      host,
      port,
      protocol: String(upstream.protocol || 'http:'),
    },
    pathPrefix: `/u/${user}/${device}`,
  };
}

function loadConfig() {
  const stat = fs.statSync(CONFIG_PATH);
  if (configCache.devices.size && configCache.mtimeMs === stat.mtimeMs) return configCache.devices;

  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const rows = Array.isArray(parsed.devices) ? parsed.devices : [];
  const devices = new Map();
  for (const row of rows) {
    const device = normalizeDevice(row);
    devices.set(`${device.user}/${device.device}`, device);
  }
  configCache = { mtimeMs: stat.mtimeMs, devices };
  return devices;
}

function matchDevice(pathname) {
  const match = pathname.match(/^\/u\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  const devices = loadConfig();
  return devices.get(`${match[1]}/${match[2]}`) || null;
}

function cookieName(device) {
  return `${COOKIE_PREFIX}_${device.user}_${device.device}`;
}

function relayCookie(device) {
  return `${cookieName(device)}=${encodeURIComponent(device.relayToken)}; Path=${device.pathPrefix}/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

function clearRelayCookie(device) {
  return `${cookieName(device)}=; Path=${device.pathPrefix}/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function requestToken(req, url, device) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  return (
    url.searchParams.get('relayToken') ||
    req.headers['x-codex-mini-relay-token'] ||
    bearer ||
    parseCookies(req.headers.cookie || '')[cookieName(device)] ||
    ''
  );
}

function authorized(req, url, device) {
  return timingSafeEqualText(requestToken(req, url, device), device.relayToken);
}

function stripRelayToken(searchParams) {
  const next = new URLSearchParams(searchParams);
  next.delete('relayToken');
  const text = next.toString();
  return text ? `?${text}` : '';
}

function upstreamSearch(searchParams, pathname, device) {
  const next = new URLSearchParams(searchParams);
  next.delete('relayToken');
  if (pathname.startsWith('/codex/')) next.set('token', device.codexToken);
  const text = next.toString();
  return text ? `?${text}` : '';
}

function loginPage(values = {}, error = '') {
  const user = escapeHtml(values.user || '');
  const device = escapeHtml(values.device || '');
  const message = error ? `<div class="notice">${escapeHtml(error)}</div>` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0b0d10" />
  <title>Codex Mini 登录</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif; background: #0b0d10; color: #f6f7f8; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #0b0d10; }
    main { width: min(100%, 420px); }
    h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.15; letter-spacing: 0; }
    p { margin: 0 0 22px; color: #a9b0bb; font-size: 14px; line-height: 1.55; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 7px; color: #c9ced6; font-size: 13px; }
    input { width: 100%; border: 1px solid #29313b; border-radius: 8px; background: #11151b; color: #f6f7f8; padding: 13px 14px; font-size: 16px; outline: none; }
    input:focus { border-color: #7dd3fc; box-shadow: 0 0 0 3px rgba(125, 211, 252, .16); }
    button { height: 46px; border: 0; border-radius: 8px; background: #f6f7f8; color: #0b0d10; font-size: 16px; font-weight: 650; cursor: pointer; }
    .notice { margin: 0 0 14px; border: 1px solid #7f1d1d; background: #2a1012; color: #fecaca; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>Codex Mini</h1>
    <p>登录到你的远程设备。用户、设备名和访问令牌由服务器管理员分配。</p>
    ${message}
    <form method="post" action="/login" autocomplete="on">
      <label>用户<input name="user" value="${user}" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
      <label>设备<input name="device" value="${device}" autocomplete="off" autocapitalize="none" spellcheck="false" required /></label>
      <label>访问令牌<input name="relayToken" type="password" autocomplete="current-password" required /></label>
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function loginBootstrapPage(device) {
  const storageKey = `codexMini.token:${device.pathPrefix}`;
  const deviceUrl = `${device.pathPrefix}/`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>正在进入 Codex Mini</title>
</head>
<body>
  <script>
    try {
      localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(BROWSER_SESSION_TOKEN)});
    } catch {}
    location.replace(${JSON.stringify(deviceUrl)});
  </script>
</body>
</html>`;
}

async function handleLogin(req, res) {
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    return html(res, 200, loginPage({
      user: url.searchParams.get('user') || '',
      device: url.searchParams.get('device') || '',
    }));
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });

  let params;
  try {
    params = new URLSearchParams(await readBody(req, LOGIN_BODY_LIMIT_BYTES));
  } catch (error) {
    return html(res, error.status || 400, loginPage({}, error.message || '登录请求无效。'));
  }

  const values = {
    user: String(params.get('user') || '').trim(),
    device: String(params.get('device') || '').trim(),
  };
  const submittedToken = String(params.get('relayToken') || '').trim();

  let device;
  try {
    device = loadConfig().get(`${normalizePathPart(values.user, 'user')}/${normalizePathPart(values.device, 'device')}`);
  } catch {
    return html(res, 400, loginPage(values, '用户或设备名格式不正确。'));
  }

  if (!device || !timingSafeEqualText(submittedToken, device.relayToken)) {
    return html(res, 401, loginPage(values, '用户、设备或访问令牌不正确。'));
  }

  return html(res, 200, loginBootstrapPage(device), { 'set-cookie': relayCookie(device) });
}

function handleLogout(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let device = null;
  try {
    const user = normalizePathPart(url.searchParams.get('user') || '', 'user');
    const deviceId = normalizePathPart(url.searchParams.get('device') || '', 'device');
    device = loadConfig().get(`${user}/${deviceId}`) || null;
  } catch {}
  const headers = device ? { 'set-cookie': clearRelayCookie(device) } : {};
  return redirect(res, '/login', headers);
}

function rewriteSetCookies(value, device) {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows.map(cookie => {
    const text = String(cookie || '');
    if (/;\s*path=/i.test(text)) return text.replace(/;\s*path=[^;]*/i, `; Path=${device.pathPrefix}/`);
    return `${text}; Path=${device.pathPrefix}/`;
  });
}

function upstreamPath(url, device) {
  let pathname = url.pathname.slice(device.pathPrefix.length) || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return `${pathname}${upstreamSearch(url.searchParams, pathname, device)}`;
}

function proxyRequest(req, res, url, device, relayCookie) {
  const targetPath = upstreamPath(url, device);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.cookie;
  delete headers.authorization;
  delete headers['x-codex-mini-relay-token'];
  if (targetPath === '/send' || targetPath.startsWith('/send?') || targetPath.startsWith('/codex/')) {
    headers['x-mobile-typer-token'] = device.codexToken;
  }
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
  headers['x-forwarded-prefix'] = device.pathPrefix;

  const upstreamReq = http.request({
    protocol: device.upstream.protocol,
    hostname: device.upstream.host,
    port: device.upstream.port,
    method: req.method,
    path: targetPath,
    headers,
    timeout: REQUEST_TIMEOUT_MS,
  }, upstreamRes => {
    const responseHeaders = { ...upstreamRes.headers };
    if (responseHeaders.location && responseHeaders.location.startsWith('/')) {
      responseHeaders.location = `${device.pathPrefix}${responseHeaders.location}`;
    }
    responseHeaders['set-cookie'] = [relayCookie, ...rewriteSetCookies(responseHeaders['set-cookie'], device)];
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy(new Error('Upstream timeout'));
  });
  upstreamReq.on('error', error => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    json(res, 502, {
      ok: false,
      code: 'UPSTREAM_UNAVAILABLE',
      message: '设备未连接或本机 Codex Mini 不可用。',
    });
  });

  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      upstreamReq.destroy(new Error('Request body too large'));
      if (!res.headersSent) json(res, 413, { ok: false, code: 'PAYLOAD_TOO_LARGE', message: '上传内容太大。' });
      req.destroy();
      return;
    }
    upstreamReq.write(chunk);
  });
  req.on('end', () => upstreamReq.end());
  req.on('error', error => upstreamReq.destroy(error));
}

function serveDeviceStatic(req, res, url, device, relayCookie) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let pathname = decodeURIComponent(url.pathname.slice(device.pathPrefix.length) || '/');
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath);
  const headers = {
    'content-type': mimeTypes[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    'content-length': stat.size,
    'set-cookie': relayCookie,
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function handleRelay(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: '请求地址无效。' });
  }

  let device;
  try {
    device = matchDevice(url.pathname);
  } catch (error) {
    return json(res, 500, { ok: false, code: 'CONFIG_ERROR', message: error.message || '配置读取失败。' });
  }
  if (!device) return json(res, 404, { ok: false, code: 'DEVICE_NOT_FOUND', message: '设备不存在。' });

  if (!authorized(req, url, device)) {
    if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
      return redirect(res, `/login?user=${encodeURIComponent(device.user)}&device=${encodeURIComponent(device.device)}`);
    }
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  const setCookie = relayCookie(device);
  if (url.pathname === device.pathPrefix) {
    return redirect(res, `${device.pathPrefix}/${stripRelayToken(url.searchParams)}`, { 'set-cookie': setCookie });
  }
  if (serveDeviceStatic(req, res, url, device, setCookie)) return;
  proxyRequest(req, res, url, device, setCookie);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') return redirect(res, '/login');
  if (req.url === '/login' || req.url.startsWith('/login?')) return handleLogin(req, res);
  if (req.method === 'GET' && (req.url === '/logout' || req.url.startsWith('/logout?'))) return handleLogout(req, res);
  if (req.method === 'GET' && req.url === '/healthz') {
    return json(res, 200, { ok: true, service: 'codex-mini-multi-user-relay', now: new Date().toISOString() });
  }
  return handleRelay(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Mini multi-user relay listening on http://${HOST}:${PORT}`);
  console.log(`Config: ${CONFIG_PATH}`);
});
