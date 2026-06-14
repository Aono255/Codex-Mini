#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { URL } = require('url');

const APP_NAME = process.env.CODEX_MINI_APP_NAME || 'Codex Mini';
const PLATFORM_LABELS = {
  mac: 'Mac',
  windows: 'Windows',
  linux: 'Linux',
  unknown: 'Unknown',
};
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.MOBILE_TYPER_TOKEN || crypto.randomBytes(12).toString('base64url');
const RELAY_BASES_RAW = Object.prototype.hasOwnProperty.call(process.env, 'CODEX_MINI_RELAY_BASES')
  ? process.env.CODEX_MINI_RELAY_BASES
  : 'http://47.110.74.238/codex-mini';
const RELAY_BASES = RELAY_BASES_RAW
  .split(',')
  .map(value => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const LOCAL_ONLY_MODE = process.env.CODEX_MINI_LOCAL_ONLY === '1';
const BETA_MODE = process.env.CODEX_MINI_BETA === '1';
const LICENSE_API_BASE = (process.env.CODEX_MINI_LICENSE_API_BASE || 'http://47.110.74.238').replace(/\/+$/, '');
const BETA_RELAY_PUBLIC_BASE = (process.env.CODEX_MINI_BETA_RELAY_BASE || 'http://47.110.74.238/codex-mini-beta').replace(/\/+$/, '');
const BETA_TUNNEL_BASE = (process.env.CODEX_MINI_BETA_TUNNEL_BASE || BETA_RELAY_PUBLIC_BASE).replace(/\/+$/, '');
const CODEX_MINI_LICENSE_PUBLIC_KEY_BASE64 = process.env.CODEX_MINI_LICENSE_PUBLIC_KEY_BASE64 || 'ol0nBI8Zkkxe9SguTtIEpZ/UQUbjpGTyTxCRER36i0Y=';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = Number(process.env.CODEX_MINI_MAX_BODY_BYTES || 512 * 1024 * 1024);
const MAX_TEXT_LENGTH = 8000;
const MAX_ATTACHMENTS = Number(process.env.CODEX_MINI_MAX_ATTACHMENTS || 0);
const MAX_ATTACHMENT_BYTES = Number(process.env.CODEX_MINI_MAX_ATTACHMENT_BYTES || 0);
const BETA_TUNNEL_POLL_MS = Number(process.env.CODEX_MINI_BETA_TUNNEL_POLL_MS || 25000);
const BETA_TUNNEL_IDLE_REPOLL_MS = Number(process.env.CODEX_MINI_BETA_TUNNEL_IDLE_REPOLL_MS || 25);
const BETA_TUNNEL_JOB_REPOLL_MS = Number(process.env.CODEX_MINI_BETA_TUNNEL_JOB_REPOLL_MS || 0);
const BETA_TUNNEL_HTTP_AGENT = new http.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4, timeout: 0 });
const BETA_TUNNEL_HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 4, timeout: 0 });
const BETA_LOCAL_FORWARD_AGENT = new http.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8, timeout: 0 });
const UPLOAD_DIR = path.join(os.tmpdir(), 'codex-mini-uploads');
const UPLOAD_CACHE_RETENTION_MS = Number(process.env.CODEX_MINI_UPLOAD_CACHE_RETENTION_MS || 7 * 24 * 60 * 60 * 1000);
const UPLOAD_CACHE_CLEANUP_INTERVAL_MS = Number(process.env.CODEX_MINI_UPLOAD_CACHE_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000);
const STATE_DIR = process.env.CODEX_MINI_STATE_DIR || path.join(os.homedir(), BETA_MODE ? '.codex-mini-beta' : '.codex-mini');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const GENERATED_IMAGE_DIR = path.join(STATE_DIR, 'generated-images');
const TASK_COMPLETION_NOTIFY_STORE_FILE = path.join(STATE_DIR, 'completion-notifications.json');

const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CODEX_SESSION_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl');
const CODEX_DESKTOP_LOGS_DIR = path.join(os.homedir(), 'Library', 'Logs', 'com.openai.codex');
const CODEX_SESSION_TAIL_BYTES = 5 * 1024 * 1024;
const CODEX_ACTIVITY_TAIL_BYTES = 512 * 1024;
const CODEX_ACTIVITY_LOOKBACK_BYTES = CODEX_SESSION_TAIL_BYTES;
const CODEX_RUNTIME_STALE_MS = 2 * 60 * 60 * 1000;
const CODEX_HISTORY_TAIL_BYTES = 128 * 1024 * 1024;
const CODEX_TITLE_SCAN_BYTES = 12 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 120;
const GUI_FAILURE_REPORT_LIMIT = 80;
const GUI_FAILURE_LOG_SCAN_BYTES = 2 * 1024 * 1024;
const GUI_FAILURE_LOG_RECENT_MS = 15 * 60 * 1000;
const RECENT_SEND_TTL_MS = 5 * 60 * 1000;
const TASK_COMPLETION_NOTIFY_POLL_MS = Number(process.env.CODEX_MINI_TASK_COMPLETION_NOTIFY_POLL_MS || 4000);
const TASK_COMPLETION_NOTIFY_SCAN_LIMIT = Number(process.env.CODEX_MINI_TASK_COMPLETION_NOTIFY_SCAN_LIMIT || 240);
const TASK_COMPLETION_NOTIFY_RECENT_MS = Number(process.env.CODEX_MINI_TASK_COMPLETION_NOTIFY_RECENT_MS || 7 * 24 * 60 * 60 * 1000);
const CODEX_THREAD_SYNC_FRESH_MS = 5000;
const CODEX_CDP_THREAD_SETTLE_MS = 560;
const CODEX_CDP_ACTIVE_THREAD_SETTLE_MS = Number(process.env.CODEX_MINI_CDP_ACTIVE_THREAD_SETTLE_MS || 140);
const CODEX_COMMAND_SETTLE_MS = 180;
const CODEX_CDP_HOST = process.env.CODEX_MINI_CDP_HOST || 'localhost';
const CODEX_CDP_PORT = Number(process.env.CODEX_MINI_CDP_PORT || 39252);
const CODEX_CDP_TIMEOUT_MS = Number(process.env.CODEX_MINI_CDP_TIMEOUT_MS || 5000);
const CONTROLLED_CODEX_ABNORMAL_CODE = 'CONTROLLED_CODEX_ABNORMAL';
const CONTROLLED_CODEX_ABNORMAL_MESSAGE = '受控 Codex 异常，请在电脑界面打开受控 Codex';
const NORMAL_CODEX_EXECUTABLE_PATH = '/Applications/Codex.app/Contents/MacOS/Codex';
const CODEX_PLUS_APP_PATH_FRAGMENT = '/Applications/Codex Plus.app/';
const CODEX_SESSION_FILE_CACHE_MS = 1200;
const CODEX_THREAD_LIST_CACHE_MS = 1200;
const CODEX_PROJECT_ORDER_CACHE_MS = 2500;

function currentPlatformInfo() {
  const rawPlatform = String(process.platform || '').toLowerCase();
  const platform = rawPlatform === 'darwin'
    ? 'mac'
    : rawPlatform === 'win32'
      ? 'windows'
      : rawPlatform === 'linux'
        ? 'linux'
        : 'unknown';
  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform] || PLATFORM_LABELS.unknown,
    osRelease: String(os.release() || '').slice(0, 80),
  };
}
const CODEX_REMOTE_THREAD_LIST_CACHE_MS = Number(process.env.CODEX_MINI_REMOTE_THREAD_LIST_CACHE_MS || 15000);
const CODEX_REMOTE_THREAD_LIST_FAILURE_CACHE_MS = Number(process.env.CODEX_MINI_REMOTE_THREAD_LIST_FAILURE_CACHE_MS || 60000);
const CODEX_ACCOUNT_SCOPE_STALE_MS = Number(process.env.CODEX_MINI_ACCOUNT_SCOPE_STALE_MS || 10 * 60 * 1000);
const CODEX_REMOTE_HISTORY_TIMEOUT_MS = Number(process.env.CODEX_MINI_REMOTE_HISTORY_TIMEOUT_MS || 12000);
const CODEX_HISTORY_INITIAL_TAIL_BYTES = 8 * 1024 * 1024;
const COMMON_MODEL_TARGETS = {
  'official-5.5': { id: 'gpt-5.5', version: '5.5', source: 'official', label: '5.5', displayName: 'GPT-5.5' },
  'official-5.4': { id: 'gpt-5.4', version: '5.4', source: 'official', label: '5.4', displayName: 'GPT-5.4' },
  'official-5.4-mini': { id: 'gpt-5.4-mini', version: 'mini', source: 'official', label: 'mini', displayName: 'GPT-5.4-Mini' },
  'official-5.3-codex': { id: 'gpt-5.3-codex', version: '5.3', source: 'official', label: '5.3', displayName: 'GPT-5.3-Codex' },
  'official-5.2': { id: 'gpt-5.2', version: '5.2', source: 'official', label: '5.2', displayName: 'GPT-5.2' },
  'relay-5.5': { id: 'aimami_relay_7b88c03bae', version: '5.5', source: 'relay', label: '5.5', displayName: 'LR_5.5（中转）' },
  'relay-5.4': { id: 'aimami_relay_5a4253ddfa', version: '5.4', source: 'relay', label: '5.4', displayName: 'LR_5.4（中转）' },
  'relay-v2.5': { id: 'aimami_relay_39b7fb759d', version: 'v2.5', source: 'relay', label: 'V2.5', displayName: 'mimo-v2.5（中转）' },
  'relay-v2.5-pro': { id: 'aimami_relay_4a00ce000d', version: 'v2.5-pro', source: 'relay', label: 'V2.5 Pro', displayName: 'mimo-v2.5-pro（中转）' },
  'relay-v4': { id: 'aimami_relay_44e0f92761', version: 'v4', source: 'relay', label: 'V4', displayName: 'deepseek-v4-flash（中转）' },
  'relay-v4-pro': { id: 'aimami_relay_2496da78eb', version: 'v4-pro', source: 'relay', label: 'V4 Pro', displayName: 'deepseek-v4-pro（中转）' },
};

const PERMISSION_MODE_TARGETS = {
  request: { key: 'request', label: '请求批准', displayName: '请求批准', aliases: ['请求批准', '请求审批', 'Ask for approval', 'Ask'] },
  auto: { key: 'auto', label: '替我审批', displayName: '替我审批', aliases: ['替我审批', '自动审批', 'Auto', 'Suggest'] },
  full: { key: 'full', label: '完全访问权限', displayName: '完全访问权限', aliases: ['完全访问权限', '完全访问', 'Full access'] },
  custom: { key: 'custom', label: '自定义 (config.toml)', displayName: '自定义 (config.toml)', aliases: ['自定义 (config.toml)', '自定义', 'config.toml', 'Custom'] },
};
const REASONING_MODE_TARGETS = {
  low: { key: 'low', value: 'low', label: '低', displayName: '低' },
  medium: { key: 'medium', value: 'medium', label: '中', displayName: '中' },
  high: { key: 'high', value: 'high', label: '高', displayName: '高' },
  xhigh: { key: 'xhigh', value: 'xhigh', label: '超高', displayName: '超高' },
};
const recentSendRequests = new Map();
let lastCodexThreadActivation = { threadId: '', at: 0 };
let codexSessionFilesCache = { at: 0, files: [] };
let threadIndexCache = { mtimeMs: 0, size: 0, byId: null };
const sessionMetaCache = new Map();
const firstUserMessageCache = new Map();
const firstUserMessageAtCache = new Map();
const latestUserMessageAtCache = new Map();
const runtimeSummaryCache = new Map();
const codexThreadListCache = new Map();
let codexCurrentAccountThreadScopeCache = { at: 0, scope: null };
let codexCurrentAccountThreadScopeInFlight = null;
let lastGoodCodexAccountThreadScope = { at: 0, scope: null };
let modelCatalogCache = { mtimeMs: -1, path: '', models: null };
let keepAwakeProcess = null;
let keepAwakeStartedAt = '';
let keepAwakeUserActiveTimer = null;
let keepAwakeUserActiveProcess = null;
let cdpTitleStatusRefreshInFlight = false;
let cdpTitleStatusLastAt = 0;
let cdpTitleStatusWatcherStarted = false;
let cdpTitleStatusWatcherBusy = false;
let cdpTitleStatusLastRequestId = '';
let codexProjectOrderCache = { at: 0, projects: [] };
let codexRemoteSidebarThreadCache = { at: 0, threads: [] };
const remoteThreadMetaCache = new Map();
const remoteSessionFileCache = new Map();
const remoteHostThreadListCache = new Map();
let taskCompletionNotifyTimer = null;
let taskCompletionNotifyStartedAt = 0;
let taskCompletionNotifyBusy = false;
const taskCompletionNotifyInFlight = new Set();

function fileCacheSignature(stat) {
  return stat ? `${stat.size}:${stat.mtimeMs}` : '';
}

function boundedSet(map, key, value, limit = 300) {
  if (map.size >= limit && !map.has(key)) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
  return value;
}

function invalidateCodexThreadListCache() {
  codexThreadListCache.clear();
}

// 只用于只读 CDP DOM 读取：短 TTL 合并手机/平板多页面的高频轮询，任何 POST 操作后整体失效
const cdpReadMicroCache = new Map();

function invalidateCdpReadMicroCache() {
  cdpReadMicroCache.clear();
}

function cdpReadShared(key, ttlMs, reader) {
  const now = Date.now();
  const entry = cdpReadMicroCache.get(key);
  if (entry) {
    if (entry.promise) return entry.promise;
    if (now - entry.at <= ttlMs) return Promise.resolve(entry.value);
  }
  const promise = Promise.resolve()
    .then(reader)
    .then(value => {
      boundedSet(cdpReadMicroCache, key, { at: Date.now(), value }, 60);
      return value;
    })
    .catch(error => {
      cdpReadMicroCache.delete(key);
      throw error;
    });
  boundedSet(cdpReadMicroCache, key, { at: now, promise }, 60);
  return promise;
}

function invalidateCodexThreadDiscoveryCaches(options = {}) {
  invalidateCodexThreadListCache();
  codexCurrentAccountThreadScopeCache = { at: 0, scope: null };
  // 保留失败退避标记，force 刷新不应让刚失联的 SSH 主机每轮都重新等连接超时
  for (const [key, entry] of remoteHostThreadListCache) {
    if (!entry || !entry.failed) remoteHostThreadListCache.delete(key);
  }
  if (!options.deep) return;
  codexSessionFilesCache = { at: 0, files: [] };
  threadIndexCache = { mtimeMs: 0, size: 0, byId: null };
  sessionMetaCache.clear();
  firstUserMessageCache.clear();
  firstUserMessageAtCache.clear();
  runtimeSummaryCache.clear();
}

function isKeepAwakeActive() {
  return Boolean(keepAwakeProcess && keepAwakeProcess.exitCode === null && !keepAwakeProcess.killed);
}

function isKeepAwakeDesired() {
  return Boolean(readCodexMiniState().keepAwakeDesired);
}

function setKeepAwakeDesired(enabled) {
  const state = readCodexMiniState();
  return writeCodexMiniState({ ...state, keepAwakeDesired: Boolean(enabled) });
}

function ensureKeepAwakeDesired() {
  if (!BETA_MODE || !isKeepAwakeDesired() || isKeepAwakeActive()) return;
  try {
    startKeepAwake({ persist: false });
  } catch (error) {
    console.warn('Codex Mini failed to restore keep-awake:', error?.message || error);
  }
}

function keepAwakeStatus() {
  ensureKeepAwakeDesired();
  const enabled = isKeepAwakeActive();
  return {
    enabled,
    desired: isKeepAwakeDesired(),
    startedAt: enabled ? keepAwakeStartedAt : '',
    command: 'caffeinate -dims + caffeinate -u -t 86400',
    prevents: [
      'system-idle-sleep',
      'display-idle-sleep',
      'system-sleep-on-ac-power',
      'disk-idle-sleep',
      'screen-saver-by-user-active-assertion',
    ],
  };
}

function isKeepAwakeUserActiveActive() {
  return Boolean(keepAwakeUserActiveProcess && keepAwakeUserActiveProcess.exitCode === null && !keepAwakeUserActiveProcess.killed);
}

function startKeepAwakeUserActiveAssertion(caffeinatePath = '/usr/bin/caffeinate') {
  if (!isKeepAwakeActive()) return;
  if (isKeepAwakeUserActiveActive()) return;
  const child = spawn(caffeinatePath, ['-u', '-t', '86400'], { stdio: 'ignore' });
  keepAwakeUserActiveProcess = child;
  child.on('exit', () => {
    if (keepAwakeUserActiveProcess === child) keepAwakeUserActiveProcess = null;
  });
  child.on('error', () => {
    if (keepAwakeUserActiveProcess === child) keepAwakeUserActiveProcess = null;
  });
}

function startKeepAwakeUserActivePulse(caffeinatePath = '/usr/bin/caffeinate') {
  if (keepAwakeUserActiveTimer) return;
  startKeepAwakeUserActiveAssertion(caffeinatePath);
  keepAwakeUserActiveTimer = setInterval(() => startKeepAwakeUserActiveAssertion(caffeinatePath), 30000);
  keepAwakeUserActiveTimer.unref?.();
}

function stopKeepAwakeUserActivePulse() {
  if (keepAwakeUserActiveTimer) clearInterval(keepAwakeUserActiveTimer);
  keepAwakeUserActiveTimer = null;
  const child = keepAwakeUserActiveProcess;
  keepAwakeUserActiveProcess = null;
  if (child && child.exitCode === null && !child.killed) {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function startKeepAwake(options = {}) {
  if (options.persist !== false) setKeepAwakeDesired(true);
  if (isKeepAwakeActive()) return keepAwakeStatus();
  const caffeinatePath = '/usr/bin/caffeinate';
  if (!fs.existsSync(caffeinatePath)) {
    const error = new Error('这台 Mac 没有找到 caffeinate，无法阻止休眠。');
    error.code = 'CAFFEINATE_NOT_FOUND';
    throw error;
  }
  const child = spawn(caffeinatePath, ['-dims'], { stdio: 'ignore' });
  keepAwakeProcess = child;
  keepAwakeStartedAt = new Date().toISOString();
  child.on('exit', () => {
    if (keepAwakeProcess === child) {
      keepAwakeProcess = null;
      keepAwakeStartedAt = '';
      stopKeepAwakeUserActivePulse();
    }
  });
  child.on('error', () => {
    if (keepAwakeProcess === child) {
      keepAwakeProcess = null;
      keepAwakeStartedAt = '';
      stopKeepAwakeUserActivePulse();
    }
  });
  startKeepAwakeUserActivePulse(caffeinatePath);
  return keepAwakeStatus();
}

function stopKeepAwake(options = {}) {
  if (options.persist !== false) setKeepAwakeDesired(false);
  const child = keepAwakeProcess;
  keepAwakeProcess = null;
  keepAwakeStartedAt = '';
  stopKeepAwakeUserActivePulse();
  if (child && child.exitCode === null && !child.killed) {
    try { child.kill('SIGTERM'); } catch {}
  }
  return keepAwakeStatus();
}

function cleanupKeepAwake() {
  stopKeepAwake({ persist: false });
}

function readCodexConfigText() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
  } catch {
    return '';
  }
}

function tomlStringValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]*)"\\s*$`, 'm'));
  return match ? match[1] : '';
}

function labelFromModelName(name = '') {
  const text = String(name || '').trim();
  if (!text) return '';
  if (/mini/i.test(text)) return 'mini';
  const versionMatch = text.match(/(?:^|[^0-9A-Za-z])(5\.\d+)(?!\d)/);
  if (versionMatch) return versionMatch[1];
  return text
    .replace(/[（(].*?[）)]/g, '')
    .replace(/^GPT-/i, '')
    .replace(/^gpt-/i, '')
    .replace(/^codex-/i, '')
    .trim() || text;
}

function modelSourceFromIdOrName(id = '', displayName = '') {
  const text = `${id} ${displayName}`.trim();
  if (/^gpt-/i.test(String(id || '').trim()) || /^GPT-?/i.test(String(displayName || '').trim())) return 'official';
  if (/中转|LR_|CX_|mimo|deepseek|aimami_relay/i.test(text)) return 'relay';
  return 'local';
}

function modelVersionFromIdOrName(id = '', displayName = '') {
  const displayText = String(displayName || '').trim();
  const idText = String(id || '').trim();
  const text = `${displayText} ${idText}`.trim();
  if (/mini/i.test(displayText) || /mini/i.test(idText)) return 'mini';
  const versionMatch = displayText.match(/(?:^|[^0-9A-Za-z])(5\.\d+)(?!\d)/)
    || idText.match(/(?:^|[^0-9A-Za-z])(5\.\d+)(?!\d)/);
  if (versionMatch) return versionMatch[1];
  if (/v?2\.5.*pro/i.test(displayText)) return 'v2.5-pro';
  if (/v?2\.5/i.test(displayText)) return 'v2.5';
  if (/(?:^|[^0-9A-Za-z])v?4(?:[^0-9A-Za-z].*pro|$)/i.test(displayText)) return 'v4-pro';
  if (/(?:^|[^0-9A-Za-z])v?4(?![0-9A-Za-z])/i.test(displayText)) return 'v4';
  return '';
}

function normalizeModelOption(row = {}) {
  const id = String(row.slug || row.id || row.model || '').trim();
  if (!id) return null;
  const displayName = String(row.display_name || row.name || row.label || id).trim();
  const source = modelSourceFromIdOrName(id, displayName);
  const version = modelVersionFromIdOrName(id, displayName);
  return {
    key: id,
    id,
    label: labelFromModelName(displayName || id),
    displayName: displayName || id,
    source,
    version,
  };
}

function readModelCatalogOptions() {
  const configText = readCodexConfigText();
  const catalogPath = tomlStringValue(configText, 'model_catalog_json');
  const resolvedPath = catalogPath.startsWith('~') ? path.join(os.homedir(), catalogPath.slice(1)) : catalogPath;
  const fallback = () => {
    const current = tomlStringValue(configText, 'model');
    return current ? [{ key: current, id: current, label: labelFromModelName(current), displayName: current, source: 'local' }] : [];
  };
  if (!resolvedPath) return fallback();
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return fallback();
  }
  if (modelCatalogCache.models && modelCatalogCache.path === resolvedPath && modelCatalogCache.mtimeMs === stat.mtimeMs) {
    return modelCatalogCache.models;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const models = (Array.isArray(parsed.models) ? parsed.models : [])
      .filter(row => row && row.visibility !== 'hide')
      .map(normalizeModelOption)
      .filter(Boolean);
    modelCatalogCache = { path: resolvedPath, mtimeMs: stat.mtimeMs, models };
    return models.length ? models : fallback();
  } catch {
    return fallback();
  }
}

function findModelOption(id = '') {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  return readModelCatalogOptions().find(item => item.id === targetId || item.key === targetId || item.displayName === targetId || item.label === targetId) || null;
}

const TOP_CONTROL_KEYS = ['newThread', 'route'];
const REQUIRED_TOP_CONTROL_KEYS = new Set();

function defaultTopControlsSettings() {
  return {
    order: [...TOP_CONTROL_KEYS],
    visible: Object.fromEntries(TOP_CONTROL_KEYS.map(key => [key, true])),
  };
}

function normalizeTopControlsSettings(value = {}) {
  const defaults = defaultTopControlsSettings();
  const source = value && typeof value === 'object' ? value : {};
  const order = [];
  for (const key of Array.isArray(source.order) ? source.order : []) {
    if (TOP_CONTROL_KEYS.includes(key) && !order.includes(key)) order.push(key);
  }
  for (const key of defaults.order) {
    if (!order.includes(key)) order.push(key);
  }
  const visibleSource = source.visible && typeof source.visible === 'object' ? source.visible : {};
  const visible = {};
  for (const key of TOP_CONTROL_KEYS) {
    visible[key] = REQUIRED_TOP_CONTROL_KEYS.has(key)
      ? true
      : (typeof visibleSource[key] === 'boolean' ? visibleSource[key] : defaults.visible[key]);
  }
  return { order, visible };
}

function normalizeProjectSortMode(value) {
  return value === 'codex' ? 'codex' : 'recent';
}

function defaultAppearanceSettings() {
  return {
    colorFlowEnabled: true,
    signatureColorEnabled: true,
    signatureEnabled: true,
    signatureText: '',
    projectSortMode: 'recent',
    theme: 'dark',
    topControls: defaultTopControlsSettings(),
  };
}

function defaultTaskCompletionNotifySettings() {
  return {
    enabled: false,
    channel: 'imessage',
    recipient: '',
  };
}

function normalizeTaskCompletionNotifySettings(value = {}) {
  const defaults = defaultTaskCompletionNotifySettings();
  const source = value && typeof value === 'object' ? value : {};
  const channel = String(source.channel || defaults.channel).trim().toLowerCase();
  return {
    enabled: source.enabled === true,
    channel: channel === 'imessage' ? 'imessage' : defaults.channel,
    recipient: typeof source.recipient === 'string' ? source.recipient.trim().slice(0, 120) : defaults.recipient,
  };
}

function normalizeAppearanceSettings(value = {}) {
  const defaults = defaultAppearanceSettings();
  const source = value && typeof value === 'object' ? value : {};
  const signatureText = typeof source.signatureText === 'string' ? source.signatureText.trim().slice(0, 80) : defaults.signatureText;
  return {
    colorFlowEnabled: typeof source.colorFlowEnabled === 'boolean' ? source.colorFlowEnabled : defaults.colorFlowEnabled,
    signatureColorEnabled: typeof source.signatureColorEnabled === 'boolean' ? source.signatureColorEnabled : defaults.signatureColorEnabled,
    signatureEnabled: typeof source.signatureEnabled === 'boolean' ? source.signatureEnabled : defaults.signatureEnabled,
    signatureText,
    projectSortMode: normalizeProjectSortMode(source.projectSortMode || defaults.projectSortMode),
    theme: source.theme === 'light' ? 'light' : 'dark',
    topControls: normalizeTopControlsSettings(source.topControls),
  };
}

function currentAppearanceSettings() {
  return normalizeAppearanceSettings(readCodexMiniState().appearanceSettings);
}

function emptyCodexMiniState() {
  return {
    pinnedThreadIds: [],
    archivedThreadIds: [],
    titleOverrides: {},
    guiFailureReports: {},
    codexMiniDeviceId: '',
    codexMiniLicenseToken: '',
    codexMiniLicenseActivatedAt: '',
    keepAwakeDesired: false,
    remoteThreadHosts: [],
    appearanceSettings: defaultAppearanceSettings(),
    taskCompletionNotify: defaultTaskCompletionNotifySettings(),
  };
}

function readCodexMiniState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const normalized = {
      pinnedThreadIds: Array.isArray(parsed.pinnedThreadIds) ? parsed.pinnedThreadIds.filter(isCodexThreadId) : [],
      archivedThreadIds: Array.isArray(parsed.archivedThreadIds) ? parsed.archivedThreadIds.filter(isCodexThreadId) : [],
      titleOverrides: parsed.titleOverrides && typeof parsed.titleOverrides === 'object' ? parsed.titleOverrides : {},
      guiFailureReports: normalizeGuiFailureReports(parsed.guiFailureReports),
      codexMiniDeviceId: typeof parsed.codexMiniDeviceId === 'string' ? parsed.codexMiniDeviceId : '',
      codexMiniLicenseToken: typeof parsed.codexMiniLicenseToken === 'string' ? parsed.codexMiniLicenseToken : '',
      codexMiniLicenseActivatedAt: typeof parsed.codexMiniLicenseActivatedAt === 'string' ? parsed.codexMiniLicenseActivatedAt : '',
      keepAwakeDesired: parsed.keepAwakeDesired === true,
      remoteThreadHosts: normalizeRemoteThreadHosts(parsed.remoteThreadHosts),
      appearanceSettings: normalizeAppearanceSettings(parsed.appearanceSettings),
      taskCompletionNotify: normalizeTaskCompletionNotifySettings(parsed.taskCompletionNotify),
    };
    if ('codexMiniRemoteAdminToken' in parsed || 'codexMiniRemoteAdminTokenCreatedAt' in parsed) {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(STATE_FILE, `${JSON.stringify(normalized, null, 2)}
`, 'utf8');
      } catch {}
    }
    return normalized;
  } catch {
    return emptyCodexMiniState();
  }
}

function writeCodexMiniState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const normalized = {
    pinnedThreadIds: [...new Set((state.pinnedThreadIds || []).filter(isCodexThreadId))],
    archivedThreadIds: [...new Set((state.archivedThreadIds || []).filter(isCodexThreadId))],
    titleOverrides: state.titleOverrides && typeof state.titleOverrides === 'object' ? state.titleOverrides : {},
    guiFailureReports: normalizeGuiFailureReports(state.guiFailureReports),
    codexMiniDeviceId: typeof state.codexMiniDeviceId === 'string' ? state.codexMiniDeviceId : '',
    codexMiniLicenseToken: typeof state.codexMiniLicenseToken === 'string' ? state.codexMiniLicenseToken : '',
    codexMiniLicenseActivatedAt: typeof state.codexMiniLicenseActivatedAt === 'string' ? state.codexMiniLicenseActivatedAt : '',
    keepAwakeDesired: state.keepAwakeDesired === true,
    remoteThreadHosts: normalizeRemoteThreadHosts(state.remoteThreadHosts),
    appearanceSettings: normalizeAppearanceSettings(state.appearanceSettings),
    taskCompletionNotify: normalizeTaskCompletionNotifySettings(state.taskCompletionNotify),
  };
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  invalidateCodexThreadListCache();
  return normalized;
}


function base64UrlDecode(value = '') {
  let base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  base64 += '='.repeat((4 - base64.length % 4) % 4);
  return Buffer.from(base64, 'base64');
}

function getCodexMiniDeviceId() {
  const state = readCodexMiniState();
  if (state.codexMiniDeviceId) return state.codexMiniDeviceId;
  state.codexMiniDeviceId = crypto.randomUUID();
  writeCodexMiniState(state);
  return state.codexMiniDeviceId;
}



function ed25519PublicKeyFromRawBase64(rawBase64) {
  const raw = Buffer.from(rawBase64 || '', 'base64');
  if (raw.length !== 32) return null;
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

function verifyCodexMiniLicenseToken(token = '') {
  const normalized = String(token || '').replace(/\s+/g, '');
  const parts = normalized.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = ed25519PublicKeyFromRawBase64(CODEX_MINI_LICENSE_PUBLIC_KEY_BASE64);
    if (!key) return null;
    const ok = crypto.verify(null, Buffer.from(parts[0], 'utf8'), key, base64UrlDecode(parts[1]));
    if (!ok) return null;
    return JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
  } catch {
    return null;
  }
}

function codexMiniEntitlementFromToken(token = '', deviceId = getCodexMiniDeviceId()) {
  const payload = verifyCodexMiniLicenseToken(token);
  if (!payload || payload.product !== 'codex-mini') return { active: false, reason: 'NO_LICENSE' };
  if (payload.deviceId && payload.deviceId !== deviceId) return { active: false, reason: 'DEVICE_MISMATCH', payload };
  const expiresAt = payload.expiresAt || '';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return { active: false, reason: 'EXPIRED', payload };
  return { active: true, reason: '', plan: payload.plan || 'unknown', expiresAt, limits: payload.limits || {}, payload };
}

function codexMiniLimitsForPlan(plan = '') {
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  const bytes = plan === 'trial' ? 1 * gb : plan === 'monthly' ? 20 * gb : plan === 'quarterly' ? 90 * gb : (plan === 'annual' || plan === 'lifetime') ? 480 * gb : 0;
  return { bytes, maxImageBytes: 5 * mb, maxRequestBytes: 20 * mb, imageHourlyLimit: 10, imageDailyLimit: 50 };
}

function currentCodexMiniEntitlement() {
  const state = readCodexMiniState();
  const deviceId = getCodexMiniDeviceId();
  const token = state.codexMiniLicenseToken || '';
  const entitlement = codexMiniEntitlementFromToken(token, deviceId);
  return { deviceId, token: entitlement.active ? token : '', licenseToken: entitlement.active ? token : '', ...entitlement };
}

function codexMiniPurchaseURLs() {
  const base = (process.env.CODEX_MINI_PURCHASE_BASE_URL || '').trim();
  const plans = ['monthly', 'quarterly', 'annual'];
  const out = {};
  for (const plan of plans) {
    const explicit = (process.env[`CODEX_MINI_${plan.toUpperCase()}_PURCHASE_URL`] || '').trim();
    const sku = (process.env[`CODEX_MINI_${plan.toUpperCase()}_SKU_ID`] || '').trim();
    if (explicit) out[plan] = explicit;
    else if (base && sku) out[plan] = `${base}${base.includes('?') ? '&' : '?'}sku=${encodeURIComponent(sku)}`;
    else if (base) out[plan] = base;
  }
  return out;
}

async function codexMiniRemoteEntitlement(deviceId = getCodexMiniDeviceId()) {
  if (!LICENSE_API_BASE) return null;
  const response = await licenseApiFetch(`/api/codex-mini/entitlements/${encodeURIComponent(deviceId)}`, { method: 'GET', timeoutMs: 2200 });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `授权状态查询失败：HTTP ${response.status}`);
  return data;
}

async function licenseApiFetch(pathname, options = {}) {
  const url = new URL(pathname, `${LICENSE_API_BASE}/`);
  const timeoutMs = Number(options.timeoutMs || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, {
      signal: controller?.signal,
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleCodexMiniLicenseStatus(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const entitlement = currentCodexMiniEntitlement();
  let remote = null;
  try { remote = await codexMiniRemoteEntitlement(entitlement.deviceId); } catch {}
  return json(res, 200, {
    ok: true,
    ...entitlement,
    remoteActive: Boolean(remote?.active),
    purchaseURLs: Object.keys(codexMiniPurchaseURLs()).length ? codexMiniPurchaseURLs() : (remote?.purchaseURLs || {}),
    licenseApiBase: LICENSE_API_BASE,
  });
}

async function handleCodexMiniTrial(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const deviceId = getCodexMiniDeviceId();
  try {
    const response = await licenseApiFetch('/api/codex-mini/trials/start', { method: 'POST', body: { deviceID: deviceId } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.valid || !data.licenseToken) throw new Error(data.message || data.error || '试用授权失败');
    const entitlement = codexMiniEntitlementFromToken(data.licenseToken, deviceId);
    if (!entitlement.active) throw new Error('授权服务器返回的试用 token 无效');
    const state = readCodexMiniState();
    state.codexMiniDeviceId = deviceId;
    state.codexMiniLicenseToken = data.licenseToken;
    state.codexMiniLicenseActivatedAt = new Date().toISOString();
    writeCodexMiniState(state);
    startBetaTunnelSoon();
    return json(res, 200, { ok: true, message: '7 天 Pro 会员试用已开启', deviceId, ...entitlement });
  } catch (error) {
    return json(res, 502, { ok: false, code: 'LICENSE_SERVER_FAILED', message: error.message || '连接授权服务器失败。' });
  }
}

async function handleCodexMiniLicenseActivate(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  let payload = {};
  try { payload = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: '请求格式不正确。' }); }
  const licenseKey = String(payload.licenseKey || '').trim();
  if (!licenseKey) return json(res, 400, { ok: false, code: 'EMPTY_LICENSE', message: '请先粘贴授权码。' });
  const deviceId = getCodexMiniDeviceId();
  try {
    const response = await licenseApiFetch('/api/codex-mini/licenses/activate', { method: 'POST', body: { licenseKey, deviceID: deviceId } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.valid || !data.licenseToken) throw new Error(data.message || data.error || '授权码激活失败');
    const entitlement = codexMiniEntitlementFromToken(data.licenseToken, deviceId);
    if (!entitlement.active) throw new Error('授权服务器返回的 licenseToken 无效');
    const state = readCodexMiniState();
    state.codexMiniDeviceId = deviceId;
    state.codexMiniLicenseToken = data.licenseToken;
    state.codexMiniLicenseActivatedAt = new Date().toISOString();
    writeCodexMiniState(state);
    startBetaTunnelSoon();
    return json(res, 200, { ok: true, deviceId, ...entitlement, reason: data.reason || entitlement.reason || '', message: data.message || '授权码激活成功，已绑定当前设备。' });
  } catch (error) {
    return json(res, 502, { ok: false, code: 'LICENSE_ACTIVATE_FAILED', message: error.message || '授权码激活失败。' });
  }
}



let betaTunnelStarted = false;
let betaTunnelBusy = false;
let betaTunnelTimer = null;

function betaRelayBaseForDevice(deviceId = getCodexMiniDeviceId()) {
  return `${BETA_RELAY_PUBLIC_BASE}/${encodeURIComponent(deviceId)}`;
}

function startBetaTunnelSoon() {
  if (!BETA_MODE) return;
  if (betaTunnelTimer) return;
  betaTunnelTimer = setTimeout(() => {
    betaTunnelTimer = null;
    startBetaTunnel();
  }, 250);
}

function startBetaTunnel() {
  if (!BETA_MODE || betaTunnelStarted) return;
  const entitlement = currentCodexMiniEntitlement();
  if (!entitlement.active || !entitlement.licenseToken) return;
  betaTunnelStarted = true;
  betaTunnelLoop().catch(error => {
    betaTunnelStarted = false;
    console.error('[codex-mini-beta] tunnel stopped:', error && error.message || error);
    setTimeout(startBetaTunnelSoon, Math.max(5000, BETA_TUNNEL_POLL_MS));
  });
}

async function betaTunnelLoop() {
  while (true) {
    const entitlement = currentCodexMiniEntitlement();
    if (!entitlement.active || !entitlement.licenseToken) {
      betaTunnelStarted = false;
      return;
    }
    let repollDelayMs = BETA_TUNNEL_IDLE_REPOLL_MS;
    if (!betaTunnelBusy) {
      betaTunnelBusy = true;
      try {
        const job = await pollBetaTunnel(entitlement);
        if (job && job.requestId) {
          await handleBetaTunnelJob(entitlement, job);
          repollDelayMs = BETA_TUNNEL_JOB_REPOLL_MS;
        }
      } finally {
        betaTunnelBusy = false;
      }
    }
    if (repollDelayMs > 0) await delay(repollDelayMs);
  }
}

function betaTunnelRequestJson(pathname, payload = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(`${BETA_TUNNEL_BASE}${pathname}`);
    } catch (error) {
      reject(error);
      return;
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const isHttps = target.protocol === 'https:';
    const transport = isHttps ? https : http;
    const timeoutMs = Number(options.timeoutMs || 30000);
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method: 'POST',
      path: `${target.pathname}${target.search}`,
      agent: isHttps ? BETA_TUNNEL_HTTPS_AGENT : BETA_TUNNEL_HTTP_AGENT,
      timeout: timeoutMs,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        connection: 'keep-alive',
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 0, headers: res.headers, data, raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error('A1 tunnel request timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pollBetaTunnel(entitlement) {
  const platformInfo = currentPlatformInfo();
  const response = await betaTunnelRequestJson('/tunnel/poll', {
    deviceId: entitlement.deviceId,
    licenseToken: entitlement.licenseToken,
    appName: APP_NAME,
    platform: platformInfo.platform,
    platformLabel: platformInfo.platformLabel,
    osRelease: platformInfo.osRelease,
  }, { timeoutMs: Math.max(35000, BETA_TUNNEL_POLL_MS + 10000) });
  const data = response.data || {};
  if (!response.ok) throw new Error(data.message || data.error || `A1 tunnel poll failed: ${response.status}`);
  return data.request || null;
}

async function handleBetaTunnelJob(entitlement, job) {
  let result;
  try {
    result = await forwardBetaTunnelJob(job);
  } catch (error) {
    result = {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ ok: false, code: 'LOCAL_FORWARD_FAILED', message: error.message || '本机转发失败。' }), 'utf8'),
    };
  }
  const headers = {};
  for (const [key, value] of Object.entries(result.headers || {})) {
    const lower = key.toLowerCase();
    if (['set-cookie', 'transfer-encoding', 'connection', 'content-length'].includes(lower)) continue;
    if (Array.isArray(value)) headers[key] = value.join(', ');
    else if (value != null) headers[key] = String(value);
  }
  const response = await betaTunnelRequestJson('/tunnel/respond', {
    deviceId: entitlement.deviceId,
    licenseToken: entitlement.licenseToken,
    requestId: job.requestId,
    status: result.status || 200,
    headers,
    bodyBase64: Buffer.from(result.body || '').toString('base64'),
  }, { timeoutMs: 30000 });
  if (!response.ok) {
    const data = response.data || {};
    // 中转端已丢弃的过期请求只能跳过；抛错会杀死隧道循环，积压的过期请求会让隧道反复重启、新请求全部超时
    if (response.status === 404 || data.code === 'REQUEST_NOT_FOUND') {
      console.warn(`[codex-mini-beta] skip expired tunnel job ${job.requestId}`);
      return;
    }
    throw new Error(data.message || data.error || `A1 tunnel respond failed: ${response.status}`);
  }
}

function forwardBetaTunnelJob(job) {
  return new Promise((resolve, reject) => {
    const method = String(job.method || 'GET').toUpperCase();
    const requestPath = String(job.path || '/').startsWith('/') ? String(job.path || '/') : '/';
    const body = job.bodyBase64 ? Buffer.from(String(job.bodyBase64), 'base64') : Buffer.alloc(0);
    const headers = { ...(job.headers || {}) };
    delete headers.host;
    headers.host = `127.0.0.1:${PORT}`;
    headers['x-codex-mini-beta-relay'] = '1';
    if (body.length) headers['content-length'] = String(body.length);
    const upstream = http.request({ host: '127.0.0.1', port: PORT, method, path: requestPath, headers, timeout: 120000, agent: BETA_LOCAL_FORWARD_AGENT }, upstreamRes => {
      const chunks = [];
      upstreamRes.on('data', chunk => chunks.push(chunk));
      upstreamRes.on('end', () => resolve({ status: upstreamRes.statusCode || 200, headers: upstreamRes.headers, body: Buffer.concat(chunks) }));
    });
    upstream.on('timeout', () => upstream.destroy(new Error('local service timeout')));
    upstream.on('error', reject);
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

function normalizeGuiFailureReports(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [threadId, rows] of Object.entries(value)) {
    if (!isCodexThreadId(threadId) || !Array.isArray(rows)) continue;
    const normalizedRows = rows
      .map(row => ({
        turnId: typeof row.turnId === 'string' ? row.turnId : '',
        text: truncateText(normalizeHistoryText(row.text || ''), 2000),
        capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : '',
        completedAt: typeof row.completedAt === 'string' ? row.completedAt : '',
        source: typeof row.source === 'string' ? row.source : 'unknown',
      }))
      .filter(row => row.text)
      .slice(-GUI_FAILURE_REPORT_LIMIT);
    if (normalizedRows.length) out[threadId] = normalizedRows;
  }
  return out;
}

function setThreadSetMembership(list, threadId, enabled) {
  const set = new Set((Array.isArray(list) ? list : []).filter(isCodexThreadId));
  if (enabled) set.add(threadId);
  else set.delete(threadId);
  return [...set];
}

function truncateText(value, max = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => item && (item.text || item.message || '')).filter(Boolean).join('\\n');
}

function decodePossiblyEncodedPath(value = '') {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('file://')) {
    try { text = new URL(text).pathname; } catch { text = text.replace(/^file:\/\//, ''); }
  }
  try { text = decodeURIComponent(text); } catch {}
  text = text.replace(/^~(?=\/)/, os.homedir());
  return text;
}

function normalizeLocalFileReference(value = '') {
  let text = decodePossiblyEncodedPath(value)
    .replace(/[\s`'"<>]+$/g, '')
    .replace(/[)\]}.。,，;；:：!！?？]+$/g, '')
    .trim();
  if (!path.isAbsolute(text)) return '';
  return path.normalize(text);
}

const RESPONSE_ATTACHMENT_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg',
  'pdf', 'zip', 'txt', 'md', 'csv', 'json', 'docx', 'xlsx', 'pptx', 'psd', 'psb',
  'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'dmg', 'stl', '3mf', 'bin',
];
const RESPONSE_ATTACHMENT_EXT_PATTERN = RESPONSE_ATTACHMENT_EXTENSIONS.join('|');
const RESPONSE_ATTACHMENT_LOCAL_PATH_PATTERN = String.raw`(?:file:\/\/)?\/(?:Users|var|tmp|private|Volumes)\/[^\n\r<>"'\x60]*?\.(?:${RESPONSE_ATTACHMENT_EXT_PATTERN})(?=$|[\s)\]}.。,，;；:：!！?？])`;

function extractLocalFileReferencesFromText(text = '') {
  const out = [];
  const add = value => {
    const normalized = normalizeLocalFileReference(value);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  };
  const source = String(text || '');
  const markdownLinkRe = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  let match;
  while ((match = markdownLinkRe.exec(source))) add(match[1]);

  const bareRe = new RegExp(RESPONSE_ATTACHMENT_LOCAL_PATH_PATTERN, 'gi');
  while ((match = bareRe.exec(source))) add(match[0]);
  return out;
}

function stripCodexAppDirectives(text = '') {
  let value = String(text || '').replace(/\r\n/g, '\n');
  value = value
    .split('\n')
    .filter(line => !/^\s*::[a-z][a-z0-9-]*\{.*\}\s*$/i.test(line))
    .join('\n')
    .replace(/```[a-z0-9_-]*[ \t]*\n[ \t\n]*```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return value;
}

function stripResponseAttachmentReferences(text = '') {
  let value = stripCodexAppDirectives(text);
  const markdownLocalFileLinkRe = new RegExp(
    String.raw`!?\[[^\]]*\]\s*\((?:file:\/\/)?\/(?:Users|var|tmp|private|Volumes)\/[^)\n\r]*?\.(?:${RESPONSE_ATTACHMENT_EXT_PATTERN})(?:[?#][^)\n\r]*)?\)`,
    'gi'
  );
  value = value.replace(markdownLocalFileLinkRe, '');
  value = value.replace(new RegExp(RESPONSE_ATTACHMENT_LOCAL_PATH_PATTERN, 'gi'), '');
  value = value
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, '').replace(/^[ \t]*[()[\]，,。.;；:：-]+[ \t]*$/g, ''))
    .filter(line => !/^[ \t]*\[[^\]\n]+\.(?:png|jpe?g|gif|webp|heic|svg|pdf|zip|txt|md|csv|json|docx|xlsx|pptx|psd|psb|mp4|mov|webm|mp3|wav|m4a|dmg|stl|3mf|bin)\][ \t]*$/i.test(line))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return value;
}

function mimeForFilePath(filePath = '') {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function responseAttachmentLimitFor(kind = 'file') {
  return kind === 'image' ? IMAGE_ATTACHMENT_BYTES : VIDEO_OR_FILE_ATTACHMENT_BYTES;
}

function responseAttachmentFromPath(filePath = '', threadId = '') {
  const normalized = normalizeLocalFileReference(filePath);
  if (!normalized) return null;
  let stat;
  try { stat = fs.statSync(normalized); } catch { return null; }
  if (!stat.isFile()) return null;
  const name = path.basename(normalized);
  const mime = mimeForFilePath(normalized);
  const kind = attachmentKindFromMime(mime, name);
  const size = stat.size;
  const tooLarge = size > responseAttachmentLimitFor(kind);
  const params = new URLSearchParams({ thread: threadId, path: normalized });
  const previewParams = new URLSearchParams({ thread: threadId, path: normalized, inline: '1' });
  return {
    name,
    mime,
    kind,
    size,
    tooLarge,
    limit: responseAttachmentLimitFor(kind),
    downloadPath: `/codex/file?${params.toString()}`,
    previewPath: kind === 'image' && !tooLarge ? `/codex/file?${previewParams.toString()}` : '',
  };
}

function mergeAttachmentRows(rows = []) {
  const out = [];
  const seen = new Set();
  for (const item of rows) {
    if (!item) continue;
    const key = item.downloadPath || item.previewPath || item.name || JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractResponseAttachments(text = '', threadId = '') {
  return extractLocalFileReferencesFromText(text)
    .map(filePath => responseAttachmentFromPath(filePath, threadId))
    .filter(Boolean);
}

function isImageGenerationToolName(name = '') {
  const normalized = String(name || '').split('.').pop().replace(/[-_]/g, '').toLowerCase();
  return normalized === 'imagegen' || normalized === 'imagegeneration' || normalized === 'generateimage';
}

function generatedImageExtensionFromMime(mime = '') {
  const value = String(mime || '').toLowerCase();
  if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  if (value === 'image/svg+xml') return 'svg';
  return 'png';
}

function generatedImagePathFromBase64(base64 = '', mime = 'image/png', threadId = '') {
  if (!isCodexThreadId(threadId)) return '';
  const normalizedBase64 = String(base64 || '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) return '';
  const estimatedBytes = Math.floor(normalizedBase64.length * 3 / 4);
  if (estimatedBytes > IMAGE_ATTACHMENT_BYTES) return '';
  let buffer;
  try { buffer = Buffer.from(normalizedBase64, 'base64'); } catch { return ''; }
  if (!buffer.length || buffer.length > IMAGE_ATTACHMENT_BYTES) return '';
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = generatedImageExtensionFromMime(mime);
  const dir = path.join(GENERATED_IMAGE_DIR, threadId);
  const filePath = path.join(dir, `ai-generated-${hash.slice(0, 16)}.${ext}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch {
    return '';
  }
}

function extractDataImageUrlsDeep(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    if (!value.includes('data:image/')) return out;
    const re = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/gi;
    let match;
    while ((match = re.exec(value))) {
      out.push(`data:${match[1].toLowerCase()};base64,${String(match[2] || '').replace(/\s+/g, '')}`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractDataImageUrlsDeep(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) extractDataImageUrlsDeep(item, out);
  }
  return out;
}

function generatedImagePathFromDataUrl(dataUrl = '', threadId = '') {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return '';
  const mime = match[1].toLowerCase();
  return generatedImagePathFromBase64(match[2], mime, threadId);
}

function generatedImageAttachmentsFromToolOutput(payload = {}, toolName = '', threadId = '') {
  if (!isImageGenerationToolName(toolName)) return [];
  const dataUrls = extractDataImageUrlsDeep(payload.output || payload.result || payload.content || []);
  return mergeAttachmentRows(dataUrls
    .map(dataUrl => generatedImagePathFromDataUrl(dataUrl, threadId))
    .filter(Boolean)
    .map(filePath => responseAttachmentFromPath(filePath, threadId))
    .filter(Boolean));
}

function generatedImageAttachmentsFromEvent(payload = {}, threadId = '') {
  if (!isCodexThreadId(threadId) || payload.type !== 'image_generation_end') return [];
  const attachments = [];

  const savedPath = normalizeLocalFileReference(payload.saved_path || payload.savedPath || '');
  if (savedPath) {
    const attachment = responseAttachmentFromPath(savedPath, threadId);
    if (attachment && attachment.kind === 'image' && !attachment.tooLarge) attachments.push(attachment);
  }
  if (attachments.length) return mergeAttachmentRows(attachments);

  const result = payload.result || payload.image || payload.data || '';
  if (typeof result === 'string') {
    const filePath = result.startsWith('data:image/')
      ? generatedImagePathFromDataUrl(result, threadId)
      : generatedImagePathFromBase64(result, payload.mime || payload.mime_type || 'image/png', threadId);
    const attachment = responseAttachmentFromPath(filePath, threadId);
    if (attachment && attachment.kind === 'image' && !attachment.tooLarge) attachments.push(attachment);
  } else {
    const dataUrls = extractDataImageUrlsDeep(result);
    for (const dataUrl of dataUrls) {
      const attachment = responseAttachmentFromPath(generatedImagePathFromDataUrl(dataUrl, threadId), threadId);
      if (attachment && attachment.kind === 'image' && !attachment.tooLarge) attachments.push(attachment);
    }
  }

  return mergeAttachmentRows(attachments);
}

function safeContentDispositionName(name = 'attachment') {
  return String(name || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'attachment';
}

function contentDispositionValue(inline, name = 'attachment') {
  return `${inline ? 'inline' : 'attachment'}; filename="${safeContentDispositionName(name)}"; filename*=UTF-8''${encodeURIComponent(name || 'attachment')}`;
}

function normalizeHistoryText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function isInternalCodexHandoffText(value = '') {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return false;
  if (/Another language model started to solve this problem and produced a summary of its thinking process/i.test(text)) return true;

  const markers = [
    /^Handoff summary\b/im,
    /^Current progress\b/im,
    /^Current code progress\b/im,
    /^Current task\b/im,
    /^Key project rules\b/im,
    /^Key decisions made\b/im,
    /^Branch \/ Git state\b/im,
    /^Testing history\b/im,
    /^What remains to be done\b/im,
    /^Useful references\b/im,
    /^Likely next action\b/im,
    /^Need do next\b/im,
    /Final response must mention:/i,
    /Use this to build on the work that has already been done/i,
  ];
  const score = markers.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  return score >= 2 && /(handoff summary|another language model|what remains to be done|need do next|final response must mention|current progress|current code progress)/i.test(text);
}

function sanitizeAssistantHistoryText(value = '') {
  const text = normalizeHistoryText(value);
  return isInternalCodexHandoffText(text) ? '' : text;
}

function extractPlainTextDeep(value, seen = new Set()) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const out = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...extractPlainTextDeep(item, seen));
    return out;
  }

  for (const key of ['message', 'detail', 'details', 'error', 'reason', 'description', 'status', 'code', 'title', 'text']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) out.push(...extractPlainTextDeep(value[key], seen));
  }
  return out;
}

function isFailureLikePayload(payload = {}) {
  const type = String(payload.type || '').toLowerCase();
  const status = String(payload.status || '').toLowerCase();
  const code = String(payload.code || '').toLowerCase();
  return (
    /(?:error|fail|failed|failure|timeout|rate_limit|unavailable|overload|abort|cancel|interrupt)/.test(type) ||
    /(?:error|fail|failed|failure|timeout|rate_limit|unavailable|overload|abort|cancel|interrupt)/.test(status) ||
    /(?:error|fail|failed|failure|timeout|rate_limit|unavailable|overload|abort|cancel|interrupt)/.test(code) ||
    payload.error != null ||
    payload.detail != null ||
    payload.details != null ||
    payload.reason != null
  );
}

function isTerminalFailurePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  const type = String(payload.type || '').toLowerCase();
  return (
    type === 'turn_aborted' ||
    /(?:^|_)(?:failed|failure|error|timeout|cancelled|canceled|aborted|interrupted)$/.test(type) ||
    (
      isFailureLikePayload(payload) &&
      /(?:abort|cancel|interrupt|fail|error|timeout|unavailable|overload)/.test(type)
    )
  );
}

function extractFailureTextFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || !isFailureLikePayload(payload)) return '';
  const text = extractPlainTextDeep(payload)
    .map(value => normalizeHistoryText(value))
    .filter(Boolean)
    .filter(value => !/^(true|false|null|undefined)$/i.test(value))
    .join('\\n');
  return truncateText(text, 1600);
}

function emptyCodexFailureText() {
  return 'Codex GUI 这次没有返回可显示回复。会话日志也没有写入可读取的失败提示原文；请在电脑 Codex GUI 查看原始失败提示。';
}

function decodeLogQuotedValue(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function safeParseJsonText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonAssignment(line, key) {
  const marker = `${key}=`;
  const start = line.indexOf(marker);
  if (start < 0) return null;
  const open = line.indexOf('{', start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return line.slice(open, i + 1);
    }
  }
  return null;
}

function extractDesktopLogFailureText(line) {
  const raw = String(line || '');
  if (!/(?:\berror\b|failed|failure|Forbidden|unexpected status|channel affinity|AiMaMi|revoked|Unauthorized)/i.test(raw)) return '';
  if (/(?:git\.command\.complete|worker_rpc_response_error|Conversation state not found|Received turn\/(?:started|completed) for unknown conversation|Item not found in turn state)/i.test(raw)) return '';
  const candidates = [];
  for (const key of ['error', 'result']) {
    const jsonText = extractJsonAssignment(raw, key);
    const parsed = jsonText ? safeParseJsonText(jsonText) : null;
    const directText = parsed && typeof parsed === 'object'
      ? normalizeHistoryText(parsed.message || parsed.detail || parsed.error || parsed.reason || '')
      : '';
    const text = parsed ? (directText || extractFailureTextFromPayload(parsed) || truncateText(extractPlainTextDeep(parsed).map(value => normalizeHistoryText(value)).filter(Boolean).join('\n'), 2000)) : '';
    if (text) candidates.push(text);
  }
  for (const key of ['errorMessage', 'message', 'detail']) {
    const match = raw.match(new RegExp(`(?:^|\\s)${key}="((?:\\\\.|[^"])*)"`, 'i'));
    if (match) candidates.push(decodeLogQuotedValue(match[1]));
  }
  if (!candidates.length && /(?:unexpected status|Forbidden|channel affinity|AiMaMi)/i.test(raw)) {
    candidates.push(raw.replace(/^\S+\s+\w+\s+\[[^\]]+\]\s*/, '').trim());
  }
  const text = uniqueList(candidates
    .map(value => normalizeHistoryText(value))
    .filter(Boolean)
    .filter(value => !/^Request failed$/i.test(value)))
    .join('\\n');
  return truncateText(text, 2000);
}

function scoreDesktopFailureLine(line, text, options = {}) {
  const raw = String(line || '');
  const failure = String(text || '');
  if (!failure) return 0;
  let score = 1;
  const threadId = isCodexThreadId(options.threadId) ? options.threadId : '';
  const turnId = typeof options.turnId === 'string' ? options.turnId : '';
  if (threadId && raw.includes(threadId)) score += 80;
  if (turnId && raw.includes(turnId)) score += 80;
  if (/Structured turn failed/i.test(failure)) score += 55;
  if (/unexpected status|Forbidden|channel affinity|AiMaMi/i.test(failure)) score += 45;
  if (/refresh token was revoked|log out and sign in again|access token could not be refreshed/i.test(failure)) score += 45;
  if (/Failed to generate thread title/i.test(raw) && /Structured turn failed/i.test(failure)) score += 25;
  if (/Conversation state not found|unknown conversation|Failed to write temporary index tree snapshot|remote\.upstream\.url/i.test(failure)) score -= 80;
  return score;
}

function recentCodexDesktopLogFiles(referenceMs = Date.now()) {
  return walkFiles(CODEX_DESKTOP_LOGS_DIR, file => file.endsWith('.log'))
    .map(file => {
      try {
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(item => item.mtimeMs >= referenceMs - GUI_FAILURE_LOG_RECENT_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 40)
    .map(item => item.file);
}

function findCodexDesktopFailureText(options = {}) {
  const threadId = isCodexThreadId(options.threadId) ? options.threadId : '';
  const turnId = typeof options.turnId === 'string' ? options.turnId : '';
  const startedMs = Date.parse(options.startedAt || '') || 0;
  const completedMs = Date.parse(options.completedAt || '') || Date.now();
  const minMs = startedMs ? startedMs - 60 * 1000 : completedMs - GUI_FAILURE_LOG_RECENT_MS;
  const maxMs = completedMs + 2 * 60 * 1000;
  const matches = [];
  for (const file of recentCodexDesktopLogFiles(completedMs)) {
    let lines;
    try {
      lines = readTailLinesWithLimit(file, GUI_FAILURE_LOG_SCAN_BYTES);
    } catch {
      continue;
    }
    for (const line of lines) {
      const lineMs = Date.parse(line.slice(0, 24));
      if (Number.isFinite(lineMs) && (lineMs < minMs || lineMs > maxMs)) continue;
      const text = extractDesktopLogFailureText(line);
      const score = scoreDesktopFailureLine(line, text, options);
      if (score >= 50) matches.push({ text, lineMs: Number.isFinite(lineMs) ? lineMs : 0, score });
    }
  }
  matches.sort((a, b) => b.score - a.score || b.lineMs - a.lineMs);
  return matches[0] ? matches[0].text : '';
}

function findStoredGuiFailureText(threadId, options = {}) {
  if (!isCodexThreadId(threadId)) return '';
  const rows = readCodexMiniState().guiFailureReports[threadId] || [];
  const turnId = typeof options.turnId === 'string' ? options.turnId : '';
  if (turnId) {
    const exact = [...rows].reverse().find(row => row.turnId === turnId && row.text);
    if (exact) return exact.text;
  }
  const completedMs = Date.parse(options.completedAt || '') || 0;
  if (completedMs) {
    const close = [...rows].reverse().find(row => {
      const rowMs = Date.parse(row.completedAt || row.capturedAt || '') || 0;
      return row.text && rowMs && Math.abs(rowMs - completedMs) <= GUI_FAILURE_LOG_RECENT_MS;
    });
    if (close) return close.text;
  }
  const latest = rows[rows.length - 1];
  return latest && latest.text ? latest.text : '';
}

function storeGuiFailureText(threadId, report = {}) {
  if (!isCodexThreadId(threadId)) return '';
  const text = truncateText(normalizeHistoryText(report.text || ''), 2000);
  if (!text || text === emptyCodexFailureText()) return '';
  const state = readCodexMiniState();
  const rows = state.guiFailureReports[threadId] || [];
  const turnId = typeof report.turnId === 'string' ? report.turnId : '';
  const completedAt = typeof report.completedAt === 'string' ? report.completedAt : '';
  const existingIndex = rows.findIndex(row => (turnId && row.turnId === turnId) || (completedAt && row.completedAt === completedAt && row.text === text));
  const row = {
    turnId,
    text,
    capturedAt: new Date().toISOString(),
    completedAt,
    source: typeof report.source === 'string' ? report.source : 'codex_desktop',
  };
  if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...row };
  else rows.push(row);
  state.guiFailureReports[threadId] = rows.slice(-GUI_FAILURE_REPORT_LIMIT);
  writeCodexMiniState(state);
  return text;
}

function resolveFailureTextForTurn(threadId, options = {}) {
  const sessionText = normalizeHistoryText(options.failureText || '');
  if (sessionText) {
    storeGuiFailureText(threadId, { ...options, text: sessionText, source: 'codex_session' });
    return sessionText;
  }
  const storedText = findStoredGuiFailureText(threadId, options);
  if (storedText) return storedText;
  const desktopText = findCodexDesktopFailureText({ ...options, threadId });
  if (desktopText) return storeGuiFailureText(threadId, { ...options, text: desktopText, source: 'codex_desktop_log' }) || desktopText;
  return '';
}

function cleanUserHistoryText(value) {
  const text = normalizeHistoryText(value);
  const marker = '## My request for Codex:';
  const index = text.indexOf(marker);
  if (index >= 0) return normalizeHistoryText(text.slice(index + marker.length));
  return normalizeHistoryText(text.replace(/# Files mentioned by the user:[\s\S]*$/i, ''));
}

function normalizeHistoryMessageFingerprint(value) {
  return cleanUserHistoryText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function isSyntheticCodexUserMessage(value) {
  const text = cleanUserHistoryText(value);
  if (!text) return true;
  return isInternalCodexHandoffText(text);
}

function isPlaceholderThreadName(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return [
    '未命名线程',
    '未命名',
    'untitled',
    'untitled thread',
    'new thread',
  ].includes(text);
}

function summarizeThreadTitle(value, maxLength = 34) {
  let text = cleanUserHistoryText(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, '[key]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[token]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/[#>*_[\]()~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function walkFiles(dir, predicate, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function listCodexSessionFiles(options = {}) {
  const now = Date.now();
  if (!options.force && codexSessionFilesCache.files.length && now - codexSessionFilesCache.at <= CODEX_SESSION_FILE_CACHE_MS) {
    return codexSessionFilesCache.files;
  }
  const files = walkFiles(CODEX_SESSIONS_DIR, file => file.endsWith('.jsonl'));
  codexSessionFilesCache = { at: now, files };
  return files;
}

function threadIdFromSessionFile(file) {
  return (path.basename(file || '').match(/([a-f0-9]{8}-[a-f0-9-]{27,})\.jsonl$/i) || [])[1] || '';
}

function normalizeComparableMessage(value) {
  return cleanUserHistoryText(value).replace(/\s+/g, ' ').trim();
}

function findLatestCodexSessionFile(options = {}) {
  const excludeThreadId = isCodexThreadId(options.excludeThreadId) ? options.excludeThreadId : '';
  const afterMs = Number(options.afterMs) || 0;
  const expectedCwd = validLocalDirectory(options.cwd || '');
  const files = listCodexSessionFiles(afterMs ? { force: true } : {});
  let best = null;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      const threadId = threadIdFromSessionFile(file);
      if (excludeThreadId && threadId === excludeThreadId) continue;
      if (afterMs && stat.mtimeMs < afterMs - 2500) continue;
      if (expectedCwd) {
        const metaCwd = validLocalDirectory(readSessionMeta(file).cwd || '');
        if (metaCwd !== expectedCwd) continue;
      }
      if (!best || stat.mtimeMs > best.mtimeMs) best = { file, mtimeMs: stat.mtimeMs };
    } catch {
      // ignore disappearing files
    }
  }
  return best && best.file;
}

function findCodexSessionFileByName(name) {
  if (!name || name.includes('/') || name.includes('..')) return null;
  const files = listCodexSessionFiles();
  return files.find(file => path.basename(file) === name) || null;
}

function findCodexSessionFileByThreadId(threadId) {
  if (!isCodexThreadId(threadId)) return null;
  const files = listCodexSessionFiles();
  let best = null;
  for (const file of files) {
    if (!path.basename(file).includes(threadId)) continue;
    try {
      const stat = fs.statSync(file);
      if (!best || stat.mtimeMs > best.mtimeMs) best = { file, mtimeMs: stat.mtimeMs };
    } catch {}
  }
  return best && best.file;
}

function safeRemoteSshAlias(value = '') {
  const alias = String(value || '').replace(/^remote-ssh-discovered:/, '').trim();
  return /^[A-Za-z0-9._-]+$/.test(alias) ? alias : '';
}

function normalizeRemoteThreadHosts(value = []) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of rows) {
    const remoteHostId = normalizeRemoteThreadHostId(item && item.remoteHostId || item && item.hostId || '');
    const remoteAlias = safeRemoteSshAlias(item && item.remoteAlias || remoteHostId);
    if (!remoteAlias) continue;
    const key = remoteHostId || `remote-ssh-discovered:${remoteAlias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      remoteHostId: key,
      remoteAlias,
      projectName: String(item && item.projectName || item && item.label || remoteAlias).trim().slice(0, 80) || remoteAlias,
      remoteProjectId: String(item && (item.remoteProjectId || item.projectId) || '').trim().slice(0, 120),
      updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  }
  return out.slice(0, 20);
}

function normalizeRemoteThreadHostId(value = '') {
  return String(value || '').trim();
}

function isCodexThreadId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(value);
}

function readThreadIndex() {
  let stat = null;
  try { stat = fs.statSync(CODEX_SESSION_INDEX); } catch {}
  if (
    stat &&
    threadIndexCache.byId &&
    threadIndexCache.mtimeMs === stat.mtimeMs &&
    threadIndexCache.size === stat.size
  ) {
    return new Map(threadIndexCache.byId);
  }
  const byId = new Map();
  try {
    const lines = fs.readFileSync(CODEX_SESSION_INDEX, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (!item.id) continue;
        byId.set(item.id, {
          id: item.id,
          name: item.thread_name || '',
          updatedAt: item.updated_at || '',
        });
      } catch {}
    }
  } catch {}
  if (stat) threadIndexCache = { mtimeMs: stat.mtimeMs, size: stat.size, byId: new Map(byId) };
  return byId;
}

function findFirstCodexUserMessage(file, maxBytes = CODEX_TITLE_SCAN_BYTES) {
  let stat;
  try { stat = fs.statSync(file); } catch { return ''; }
  const cacheKey = `${file}:${fileCacheSignature(stat)}:${maxBytes}`;
  if (firstUserMessageCache.has(cacheKey)) return firstUserMessageCache.get(cacheKey);
  const limit = Math.min(stat.size, maxBytes);
  const chunkSize = 64 * 1024;
  const maxLineBytes = 2 * 1024 * 1024;
  let fd;
  let carry = '';
  let skippingLongLine = false;

  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(chunkSize);
    let offset = 0;
    while (offset < limit) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(chunkSize, limit - offset), offset);
      if (!bytes) break;
      offset += bytes;
      let text = buffer.toString('utf8', 0, bytes);

      if (skippingLongLine) {
        const newline = text.indexOf('\n');
        if (newline < 0) continue;
        text = text.slice(newline + 1);
        skippingLongLine = false;
      }

      carry += text;
      if (carry.length > maxLineBytes) {
        const newline = carry.indexOf('\n');
        if (newline < 0) {
          carry = '';
          skippingLongLine = true;
          continue;
        }
      }

      let newlineIndex;
      while ((newlineIndex = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newlineIndex);
        carry = carry.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        const payload = item.payload || {};
        if (item.type === 'event_msg' && payload.type === 'user_message') {
          const title = summarizeThreadTitle(payload.message || '');
          if (title) return boundedSet(firstUserMessageCache, cacheKey, title);
        }
      }
    }

    if (carry.trim() && carry.length <= maxLineBytes) {
      try {
        const item = JSON.parse(carry);
        const payload = item.payload || {};
        if (item.type === 'event_msg' && payload.type === 'user_message') {
          return boundedSet(firstUserMessageCache, cacheKey, summarizeThreadTitle(payload.message || ''));
        }
      } catch {}
    }
  } catch {
    return '';
  } finally {
    if (typeof fd === 'number') {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return boundedSet(firstUserMessageCache, cacheKey, '');
}

function findCodexUserMessageAt(file, { latest = false, maxBytes = CODEX_TITLE_SCAN_BYTES } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return ''; }
  const cache = latest ? latestUserMessageAtCache : firstUserMessageAtCache;
  const scanBytes = latest ? Math.min(stat.size, Math.max(CODEX_SESSION_TAIL_BYTES, 16 * 1024 * 1024)) : Math.min(stat.size, maxBytes);
  const cacheKey = `${file}:${fileCacheSignature(stat)}:${latest ? 'latest' : `first:${maxBytes}`}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const chunkSize = 64 * 1024;
  const maxLineBytes = 2 * 1024 * 1024;
  let fd;
  let carry = '';
  let skippingLongLine = false;
  let found = '';

  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(chunkSize);
    let offset = latest ? Math.max(0, stat.size - scanBytes) : 0;
    const limit = latest ? stat.size : scanBytes;
    if (offset > 0) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(chunkSize, limit - offset), offset);
      const text = buffer.toString('utf8', 0, bytes);
      const newline = text.indexOf('\n');
      if (newline >= 0) carry = text.slice(newline + 1);
      else skippingLongLine = true;
      offset += bytes;
    }

    while (offset < limit) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(chunkSize, limit - offset), offset);
      if (!bytes) break;
      offset += bytes;
      let text = buffer.toString('utf8', 0, bytes);

      if (skippingLongLine) {
        const newline = text.indexOf('\n');
        if (newline < 0) continue;
        text = text.slice(newline + 1);
        skippingLongLine = false;
      }

      carry += text;
      if (carry.length > maxLineBytes) {
        const newline = carry.indexOf('\n');
        if (newline < 0) {
          carry = '';
          skippingLongLine = true;
          continue;
        }
      }

      let newlineIndex;
      while ((newlineIndex = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newlineIndex);
        carry = carry.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        const payload = item.payload || {};
        if (item.type === 'event_msg' && payload.type === 'user_message' && item.timestamp) {
          if (!latest) return boundedSet(cache, cacheKey, item.timestamp);
          found = item.timestamp;
        }
      }
    }

    if (carry.trim() && carry.length <= maxLineBytes) {
      try {
        const item = JSON.parse(carry);
        const payload = item.payload || {};
        if (item.type === 'event_msg' && payload.type === 'user_message' && item.timestamp) {
          if (!latest) return boundedSet(cache, cacheKey, item.timestamp);
          found = item.timestamp;
        }
      } catch {}
    }
  } catch {
    return '';
  } finally {
    if (typeof fd === 'number') {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return boundedSet(cache, cacheKey, found);
}

function findFirstCodexUserMessageAt(file, maxBytes = CODEX_TITLE_SCAN_BYTES) {
  return findCodexUserMessageAt(file, { latest: false, maxBytes });
}

function findLatestCodexUserMessageAt(file) {
  return findCodexUserMessageAt(file, { latest: true });
}

function readSessionMeta(file) {
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  const cacheKey = stat ? `${file}:${fileCacheSignature(stat)}` : '';
  if (cacheKey && sessionMetaCache.has(cacheKey)) return sessionMetaCache.get(cacheKey);
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const lines = buffer.toString('utf8', 0, bytes).split('\n').filter(Boolean).slice(0, 80);
      for (const line of lines) {
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        if (item.type === 'session_meta' && item.payload) return cacheKey ? boundedSet(sessionMetaCache, cacheKey, item.payload) : item.payload;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
  return cacheKey ? boundedSet(sessionMetaCache, cacheKey, {}) : {};
}

function isSubagentSessionMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.thread_source === 'subagent') return true;
  const source = meta.source;
  if (source && typeof source === 'object' && source.subagent) return true;
  return Boolean(meta.parent_thread_id && (meta.agent_nickname || meta.agent_role || meta.multi_agent_version));
}

function userMessageMatchScore(file, sinceMs = 0, text = '') {
  const expected = normalizeComparableMessage(text);
  const items = readJsonlTailObjects(file, CODEX_TITLE_SCAN_BYTES);
  let score = 0;
  for (const item of items) {
    const payload = item.payload || {};
    if (item.type !== 'event_msg' || payload.type !== 'user_message') continue;
    const t = Date.parse(item.timestamp || '');
    if (sinceMs && Number.isFinite(t) && t < sinceMs - 2500) continue;
    const actual = normalizeComparableMessage(payload.message || '');
    if (!actual && expected) continue;
    score = Math.max(score, 10);
    if (Number.isFinite(t)) score += Math.max(0, Math.min(25, Math.round((t - sinceMs) / 1000) + 20));
    if (expected && actual) {
      if (actual === expected) score += 100;
      else if (actual.includes(expected) || expected.includes(actual)) score += 70;
    }
  }
  return score;
}

function findCodexSessionFileForNewSend(options = {}) {
  const sinceMs = Number(options.sinceMs) || 0;
  const text = typeof options.text === 'string' ? options.text : '';
  const expectedCwd = validLocalDirectory(options.cwd || '');
  const excludeThreadId = isCodexThreadId(options.excludeThreadId) ? options.excludeThreadId : '';
  const files = listCodexSessionFiles({ force: true });
  let best = null;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      const threadId = threadIdFromSessionFile(file);
      if (excludeThreadId && threadId === excludeThreadId) continue;
      if (sinceMs && stat.mtimeMs < sinceMs - 2500) continue;
      let score = userMessageMatchScore(file, sinceMs, text);
      if (score <= 0 && text.trim()) continue;
      const metaCwd = validLocalDirectory(readSessionMeta(file).cwd || '');
      if (expectedCwd) {
        if (metaCwd !== expectedCwd) continue;
        score += 35;
      }
      score += Math.max(0, Math.min(20, Math.round((stat.mtimeMs - sinceMs) / 1000) + 10));
      if (!best || score > best.score || (score === best.score && stat.mtimeMs > best.mtimeMs)) {
        best = { file, score, mtimeMs: stat.mtimeMs };
      }
    } catch {
      // ignore disappearing files
    }
  }
  return best && best.file;
}

async function waitForCodexSessionFileForNewSend(options = {}, timeoutMs = 2600) {
  const deadline = Date.now() + timeoutMs;
  let file = null;
  while (Date.now() <= deadline) {
    file = findCodexSessionFileForNewSend(options);
    if (file) return file;
    await delay(220);
  }
  return findCodexSessionFileForNewSend(options);
}

function readJsonlTailObjects(file, maxBytes) {
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  const start = Math.max(0, stat.size - maxBytes);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  } finally {
    if (typeof fd === 'number') {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function summarizeCodexRuntimeItems(items, stat = null) {
  let status = 'idle';
  let active = false;
  let startedAt = '';
  let completedAt = '';
  let updatedAt = stat ? new Date(stat.mtimeMs).toISOString() : '';
  let turnId = '';
  let sawRuntimeActivity = false;
  let sawTaskMarker = false;

  for (const item of items) {
    const payload = item.payload || {};
    if (item.timestamp) updatedAt = item.timestamp;
    if (item.type === 'response_item' || (item.type === 'event_msg' && payload.type && !String(payload.type).startsWith('task_'))) {
      sawRuntimeActivity = true;
    }
    if (item.type === 'turn_context' && payload.turn_id) turnId = payload.turn_id;
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      sawTaskMarker = true;
      status = 'running';
      active = true;
      startedAt = item.timestamp || startedAt;
      completedAt = '';
      turnId = payload.turn_id || turnId;
      updatedAt = item.timestamp || updatedAt;
    }
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      sawTaskMarker = true;
      status = 'complete';
      active = false;
      completedAt = item.timestamp || completedAt;
      updatedAt = item.timestamp || updatedAt;
    }
    if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      sawTaskMarker = true;
      status = 'error';
      active = false;
      completedAt = item.timestamp || completedAt;
      turnId = payload.turn_id || turnId;
      updatedAt = item.timestamp || updatedAt;
    }
  }

  return { status, active, startedAt, completedAt, updatedAt, turnId, sawRuntimeActivity, sawTaskMarker };
}

function quickCodexRuntimeFromFile(file, stat = null) {
  let fileStat = stat;
  if (!fileStat) {
    try { fileStat = fs.statSync(file); } catch { fileStat = null; }
  }
  const cacheKey = fileStat ? `${file}:${fileCacheSignature(fileStat)}` : '';
  if (cacheKey && runtimeSummaryCache.has(cacheKey)) return runtimeSummaryCache.get(cacheKey);
  const isFresh = fileStat ? Date.now() - fileStat.mtimeMs <= CODEX_RUNTIME_STALE_MS : false;
  let runtime = summarizeCodexRuntimeItems(readJsonlTailObjects(file, CODEX_ACTIVITY_TAIL_BYTES), fileStat);

  if (
    runtime.status === 'idle' &&
    runtime.sawRuntimeActivity &&
    !runtime.sawTaskMarker &&
    isFresh &&
    fileStat &&
    fileStat.size > CODEX_ACTIVITY_TAIL_BYTES
  ) {
    runtime = summarizeCodexRuntimeItems(readJsonlTailObjects(file, CODEX_ACTIVITY_LOOKBACK_BYTES), fileStat);
  }

  if (runtime.status === 'idle' && runtime.sawRuntimeActivity && !runtime.sawTaskMarker && isFresh) {
    runtime.status = 'running';
    runtime.active = true;
  }
  if (runtime.status === 'running' && fileStat && !isFresh) {
    runtime.status = 'idle';
    runtime.active = false;
  }

  const { status, active, startedAt, completedAt, updatedAt, turnId } = runtime;
  return cacheKey
    ? boundedSet(runtimeSummaryCache, cacheKey, { status, active, startedAt, completedAt, updatedAt, turnId }, 600)
    : { status, active, startedAt, completedAt, updatedAt, turnId };
}

function latestCodexThreadSnippet(file) {
  const items = readJsonlTailObjects(file, CODEX_ACTIVITY_TAIL_BYTES);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] || {};
    const payload = item.payload || {};
    let text = '';

    if (item.type === 'event_msg') {
      if (payload.type === 'user_message') text = cleanUserHistoryText(payload.message || '');
      else if (payload.type === 'agent_message') text = sanitizeAssistantHistoryText(payload.message || '');
      else if (payload.type === 'task_started') text = '开始处理新的任务';
      else if (payload.type === 'task_complete') text = sanitizeAssistantHistoryText(payload.last_agent_message || '') || '回复完成';
      else text = extractFailureTextFromPayload(payload);
    } else if (item.type === 'response_item') {
      if (payload.type === 'reasoning') text = extractReasoningText(payload);
      else if (payload.type === 'function_call') text = formatToolCall(payload);
      else if (payload.type === 'message') text = sanitizeAssistantHistoryText(extractMessageText(payload.content));
    }

    text = stripResponseAttachmentReferences(normalizeHistoryText(text))
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      return {
        text: truncateText(text, 140),
        at: item.timestamp || '',
      };
    }
  }
  return { text: '', at: '' };
}

function envBool(name, fallback = false) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function taskCompletionNotifySettings() {
  const stateSettings = normalizeTaskCompletionNotifySettings(readCodexMiniState().taskCompletionNotify);
  const envRecipient = String(
    process.env.CODEX_MINI_TASK_COMPLETION_IMESSAGE_TO ||
    process.env.CODEX_MINI_IMESSAGE_NOTIFY_TO ||
    ''
  ).trim();
  const envEnabled = Object.prototype.hasOwnProperty.call(process.env, 'CODEX_MINI_TASK_COMPLETION_NOTIFY_ENABLED')
    ? envBool('CODEX_MINI_TASK_COMPLETION_NOTIFY_ENABLED', false)
    : Object.prototype.hasOwnProperty.call(process.env, 'CODEX_MINI_IMESSAGE_NOTIFY_ENABLED')
      ? envBool('CODEX_MINI_IMESSAGE_NOTIFY_ENABLED', false)
      : stateSettings.enabled;

  return {
    enabled: envEnabled,
    channel: 'imessage',
    recipient: envRecipient || stateSettings.recipient,
  };
}

function readTaskCompletionNotifyStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TASK_COMPLETION_NOTIFY_STORE_FILE, 'utf8'));
    const sent = parsed.sent && typeof parsed.sent === 'object' ? parsed.sent : {};
    return { sent };
  } catch {
    return { sent: {} };
  }
}

function writeTaskCompletionNotifyStore(store = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const sentSource = store.sent && typeof store.sent === 'object' ? store.sent : {};
  const cutoff = Date.now() - TASK_COMPLETION_NOTIFY_RECENT_MS;
  const rows = Object.entries(sentSource)
    .map(([key, value]) => {
      const sentAt = typeof value === 'string' ? value : value?.sentAt || '';
      return { key, sentAt, ms: Date.parse(sentAt) || 0 };
    })
    .filter(row => row.key && (!row.ms || row.ms >= cutoff))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 1000);
  const sent = Object.fromEntries(rows.map(row => [row.key, row.sentAt || new Date().toISOString()]));
  fs.writeFileSync(TASK_COMPLETION_NOTIFY_STORE_FILE, `${JSON.stringify({ sent }, null, 2)}\n`, 'utf8');
  return { sent };
}

function taskCompletionAlreadyNotified(key) {
  if (!key) return true;
  return Object.prototype.hasOwnProperty.call(readTaskCompletionNotifyStore().sent, key);
}

function markTaskCompletionNotified(key) {
  if (!key) return;
  const store = readTaskCompletionNotifyStore();
  store.sent[key] = new Date().toISOString();
  writeTaskCompletionNotifyStore(store);
}

function formatNotifyDuration(ms) {
  const value = Number(ms) || 0;
  if (!value) return '';
  const seconds = Math.max(1, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}分${restSeconds}秒` : `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}小时${restMinutes}分钟` : `${hours}小时`;
}

function cleanNotificationSummary(text = '') {
  return stripResponseAttachmentReferences(normalizeHistoryText(text))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayTitleForCompletion(file, threadId, fallback = '') {
  const state = readCodexMiniState();
  const override = state.titleOverrides && state.titleOverrides[threadId];
  if (override && typeof override.name === 'string' && override.name.trim()) {
    return summarizeThreadTitle(override.name, 28);
  }
  const indexed = readThreadIndex().get(threadId);
  if (indexed && !isPlaceholderThreadName(indexed.name)) return summarizeThreadTitle(indexed.name, 28);
  return summarizeThreadTitle(fallback || findFirstCodexUserMessage(file) || 'Codex', 28) || 'Codex';
}

function taskCompletionsForNotification(file) {
  const threadId = threadIdFromSessionFile(file);
  if (!isCodexThreadId(threadId)) return [];

  const items = readJsonlTailObjects(file, Math.max(CODEX_SESSION_TAIL_BYTES, CODEX_ACTIVITY_LOOKBACK_BYTES));
  let currentTurnId = '';
  let currentStartedAt = '';
  let currentUserTitle = '';
  let latestUserTitle = '';
  let latestAssistantText = '';
  const completions = [];

  for (const item of items) {
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'user_message') {
      const title = summarizeThreadTitle(payload.message || '', 28);
      if (title) latestUserTitle = title;
    }
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      currentTurnId = payload.turn_id || '';
      currentStartedAt = item.timestamp || '';
      currentUserTitle = latestUserTitle;
      latestAssistantText = '';
    }
    if (item.type === 'turn_context' && payload.turn_id) currentTurnId = payload.turn_id || currentTurnId;
    if (item.type === 'event_msg' && payload.type === 'agent_message' && payload.message) {
      latestAssistantText = sanitizeAssistantHistoryText(payload.message);
    }
    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const text = sanitizeAssistantHistoryText(extractMessageText(payload.content));
      if (text) latestAssistantText = text;
    }
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      const completedAt = item.timestamp || '';
      const completedMs = Date.parse(completedAt) || 0;
      const startedMs = Date.parse(currentStartedAt) || 0;
      const turnId = payload.turn_id || currentTurnId || '';
      const key = `${threadId}:${turnId || currentStartedAt || completedAt}`;
      const title = displayTitleForCompletion(file, threadId, currentUserTitle || latestUserTitle);
      completions.push({
        key,
        threadId,
        title,
        startedAt: currentStartedAt,
        completedAt,
        completedMs,
        durationMs: startedMs && completedMs ? Math.max(0, completedMs - startedMs) : 0,
        summary: cleanNotificationSummary(sanitizeAssistantHistoryText(payload.last_agent_message || '') || latestAssistantText || 'Codex 已完成回复'),
      });
    }
  }

  return completions;
}

function buildTaskCompletionNotificationMessage(completion) {
  const rawTitle = summarizeThreadTitle(completion.title || 'Codex', 28) || 'Codex';
  const title = `任务已完成：${rawTitle}`;
  const summary = wrapNotificationSummary(completion.summary || 'Codex 已完成回复');
  const duration = formatNotifyDuration(completion.durationMs);
  const summaryLines = summary.split('\n').filter(Boolean);
  const lines = [title, `完成情况：${summaryLines.shift() || 'Codex 已完成回复'}`];
  lines.push(...summaryLines);
  if (duration) lines.push(`用时：${duration}`);
  return lines.join('\n');
}

function wrapNotificationSummary(text = '', options = {}) {
  const maxLength = Number(options.maxLength) || 220;
  const lineLength = Number(options.lineLength) || 42;
  const maxLines = Number(options.maxLines) || 6;
  const summary = truncateText(cleanNotificationSummary(text), maxLength) || 'Codex 已完成回复';
  const normalized = summary
    .replace(/\s+([-*•]\s+)/g, '\n$1')
    .replace(/\s*(。|！|？|；|;|!|\?)\s*/g, '$1\n')
    .replace(/\s*(，|、)\s*/g, '$1');
  const lines = [];
  for (const rawPart of normalized.split('\n')) {
    const part = rawPart.trim();
    if (!part) continue;
    let current = '';
    for (const token of part.match(new RegExp(`.{1,${lineLength}}`, 'g')) || [part]) {
      if (!current) current = token;
      else if ((current + token).length <= lineLength) current += token;
      else {
        lines.push(current);
        current = token;
      }
    }
    if (current) lines.push(current);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines).join('\n') || summary;
}

function sendIMessage(recipient, message) {
  const address = String(recipient || '').trim();
  if (!address) return Promise.reject(new Error('iMessage recipient is empty'));
  const script = `
on run argv
  set targetAddress to item 1 of argv
  set bodyText to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetAddress of targetService
    send bodyText to targetBuddy
  end tell
end run
`;
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script, address, message], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}${stderr ? `: ${String(stderr).trim()}` : ''}`;
        reject(error);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function checkTaskCompletionNotifications() {
  if (taskCompletionNotifyBusy) return;
  const settings = taskCompletionNotifySettings();
  if (!settings.enabled || !settings.recipient || TASK_COMPLETION_NOTIFY_POLL_MS <= 0) return;
  taskCompletionNotifyBusy = true;
  try {
    const now = Date.now();
    const startedAt = taskCompletionNotifyStartedAt || now;
    const files = listCodexSessionFiles({ force: true })
      .map(file => {
        try {
          const stat = fs.statSync(file);
          return { file, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(10, TASK_COMPLETION_NOTIFY_SCAN_LIMIT));

    for (const row of files) {
      if (row.mtimeMs < startedAt - TASK_COMPLETION_NOTIFY_RECENT_MS) break;
      const completions = taskCompletionsForNotification(row.file);
      for (const completion of completions) {
        if (!completion || !completion.completedMs) continue;
        if (completion.completedMs < startedAt - 2000) continue;
        if (completion.completedMs < now - TASK_COMPLETION_NOTIFY_RECENT_MS) continue;
        if (taskCompletionNotifyInFlight.has(completion.key) || taskCompletionAlreadyNotified(completion.key)) continue;

        taskCompletionNotifyInFlight.add(completion.key);
        try {
          await sendIMessage(settings.recipient, buildTaskCompletionNotificationMessage(completion));
          markTaskCompletionNotified(completion.key);
        } finally {
          taskCompletionNotifyInFlight.delete(completion.key);
        }
      }
    }
  } catch (error) {
    console.warn('Codex Mini task completion iMessage notification failed:', error?.message || error);
  } finally {
    taskCompletionNotifyBusy = false;
  }
}

function startTaskCompletionNotificationWatcher() {
  // Disabled intentionally: task completion notifications are handled only by
  // the global native Codex hooks.Stop hook in ~/.codex/config.toml.
  // Keep this no-op so Codex Mini cannot create a second iMessage sender.
  return;
}

function displayPathName(cwd) {
  if (!cwd) return '对话';
  const normalized = path.normalize(cwd);
  if (normalized === os.homedir()) return '~';
  if (normalized === path.parse(normalized).root) return normalized;
  return path.basename(normalized) || normalized;
}

function classifyThreadProject(cwd) {
  const normalized = cwd ? path.normalize(cwd) : '';
  const codexScratchRoot = path.join(os.homedir(), 'Documents', 'Codex');
  const relativeToScratch = normalized ? path.relative(codexScratchRoot, normalized) : '';
  const isGeneratedProjectless = Boolean(
    normalized &&
    relativeToScratch &&
    !relativeToScratch.startsWith('..') &&
    !path.isAbsolute(relativeToScratch) &&
    /^\d{4}-\d{2}-\d{2}(?:$|[\/])/.test(relativeToScratch)
  );

  if (!normalized || isGeneratedProjectless) {
    return {
      isProjectThread: false,
      projectKey: 'conversation',
      projectName: '对话',
      projectPath: '',
    };
  }

  return {
    isProjectThread: true,
    projectKey: normalized,
    projectName: displayPathName(normalized),
    projectPath: normalized,
  };
}

function cleanSidebarThreadTitle(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:刚刚|昨天|前天|\d+\s*(?:秒|分钟|小时|天|周|个月|年)|\d+\s*分)\s*$/, '')
    .trim();
}

function relativeSidebarTimeMs(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const now = Date.now();
  let match = text.match(/(\d+)\s*秒\s*$/);
  if (match) return now - Number(match[1]) * 1000;
  match = text.match(/(\d+)\s*(?:分钟|分)\s*$/);
  if (match) return now - Number(match[1]) * 60 * 1000;
  match = text.match(/(\d+)\s*小时\s*$/);
  if (match) return now - Number(match[1]) * 60 * 60 * 1000;
  match = text.match(/(\d+)\s*天\s*$/);
  if (match) return now - Number(match[1]) * 24 * 60 * 60 * 1000;
  match = text.match(/(\d+)\s*周\s*$/);
  if (match) return now - Number(match[1]) * 7 * 24 * 60 * 60 * 1000;
  if (/刚刚$/.test(text)) return now;
  if (/昨天$/.test(text)) return now - 24 * 60 * 60 * 1000;
  if (/前天$/.test(text)) return now - 2 * 24 * 60 * 60 * 1000;
  return 0;
}

function rememberRemoteThreadMeta(item = {}) {
  if (!isCodexThreadId(item.id) || !item.remoteHostId) return;
  boundedSet(remoteThreadMetaCache, item.id, {
    id: item.id,
    remoteHostId: item.remoteHostId,
    remoteAlias: item.remoteAlias || safeRemoteSshAlias(item.remoteHostId),
    projectName: item.projectName || '',
    projectId: item.remoteProjectId || '',
    name: item.name || '',
  }, 500);
}

function rememberRemoteThreadHost(item = {}) {
  const host = normalizeRemoteThreadHosts([item])[0];
  if (!host) return;
  const state = readCodexMiniState();
  const next = normalizeRemoteThreadHosts([host, ...(state.remoteThreadHosts || [])]);
  writeCodexMiniState({ ...state, remoteThreadHosts: next });
}

function remoteThreadFromSessionSummary(summary = {}, host = {}) {
  const id = String(summary.id || '').trim();
  if (!isCodexThreadId(id)) return null;
  const remoteAlias = safeRemoteSshAlias(host.remoteAlias || host.remoteHostId || '');
  if (!remoteAlias) return null;
  const remoteHostId = host.remoteHostId || `remote-ssh-discovered:${remoteAlias}`;
  const updatedMs = Number(summary.mtimeMs) || Date.parse(summary.updatedAt || summary.timestamp || '') || Date.now();
  // 同一台 SSH 主机上可能有多个 Codex 项目（不同工作目录）。会话文件本身不带“桌面项目”信息，
  // 若用 host 记住的单一 projectName，会把整台主机的会话都并进同一个项目（客户反馈：同主机的第二个项目被吞）。
  // 改用每个会话自己的 cwd 区分项目：projectKey 以 cwd 为准，projectName 取 cwd 末段目录名。
  const cwd = String(summary.cwd || '').trim();
  const cwdName = cwd ? (cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || '') : '';
  const projectName = cwdName || host.projectName || remoteAlias;
  const projectDiscriminator = cwd || host.remoteProjectId || projectName;
  const name = String(summary.name || '').replace(/\s+/g, ' ').trim() || '未命名线程';
  return {
    id,
    name,
    nameSource: summary.nameSource || 'remote_session',
    updatedAt: new Date(updatedMs).toISOString(),
    effectiveUpdatedMs: updatedMs,
    effectiveUpdatedAt: new Date(updatedMs).toISOString(),
    guardianSortMs: updatedMs,
    mtimeMs: updatedMs,
    cwd: summary.cwd || '',
    source: 'remote_ssh_session',
    threadSource: 'remote_ssh',
    sessionFile: '',
    remoteSessionFile: summary.remoteSessionFile || '',
    latestSnippet: summary.latestSnippet || name,
    latestSnippetAt: new Date(updatedMs).toISOString(),
    firstUserMessageAt: summary.firstUserMessageAt || summary.timestamp || new Date(updatedMs).toISOString(),
    latestUserMessageAt: summary.latestUserMessageAt || summary.timestamp || new Date(updatedMs).toISOString(),
    runtimeStatus: 'idle',
    runtimeActive: false,
    pinned: false,
    isProjectThread: true,
    projectKey: `remote:${remoteHostId}:${projectDiscriminator}`,
    projectName,
    projectPath: cwd,
    remoteProjectId: host.remoteProjectId || '',
    remoteHostId,
    remoteAlias,
    domThreadId: `local:${id}`,
    isRemoteThread: true,
  };
}

async function listRemoteHostThreads(host = {}, options = {}) {
  const remoteAlias = safeRemoteSshAlias(host.remoteAlias || host.remoteHostId || '');
  if (!remoteAlias) return [];
  const cacheKey = `${remoteAlias}:${options.limit || 40}`;
  const cached = remoteHostThreadListCache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.at;
    // 主机刚失败过就退避，不要每轮都等 SSH 连接超时拖慢线程列表；force 也只允许 15 秒后重试
    const ttl = cached.failed
      ? (options.force ? 15000 : CODEX_REMOTE_THREAD_LIST_FAILURE_CACHE_MS)
      : (options.force ? 0 : CODEX_REMOTE_THREAD_LIST_CACHE_MS);
    if (ttl && age <= ttl) return cached.threads;
  }
  const script = `python3 - <<'PY'
import glob, json, os, re
rows = []
for f in glob.glob(os.path.expanduser("~/.codex/sessions/**/*.jsonl"), recursive=True):
    try:
        st = os.stat(f)
    except OSError:
        continue
    rows.append((st.st_mtime, f))
rows.sort(reverse=True)
out = []
for mtime, f in rows[:${Math.max(1, Math.min(80, Number(options.limit) || 40))}]:
    match = re.search(r"([a-f0-9]{8}-[a-f0-9-]{27,})\\.jsonl$", os.path.basename(f), re.I)
    if not match:
        continue
    tid = match.group(1)
    meta = {}
    first_user = ""
    try:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    item = json.loads(line)
                except Exception:
                    continue
                payload = item.get("payload") or {}
                if item.get("type") == "session_meta":
                    meta = payload
                if not first_user and item.get("type") == "event_msg" and payload.get("type") == "user_message":
                    first_user = " ".join(str(payload.get("message") or "").split())
                if meta and first_user:
                    break
    except Exception:
        pass
    out.append({
        "id": tid,
        "name": first_user[:80] or meta.get("title") or "未命名线程",
        "nameSource": "first_user_message" if first_user else "remote_session",
        "cwd": meta.get("cwd") or "",
        "timestamp": meta.get("timestamp") or "",
        "updatedAt": meta.get("timestamp") or "",
        "mtimeMs": int(mtime * 1000),
        "remoteSessionFile": f,
        "latestSnippet": first_user[:160],
    })
print(json.dumps(out, ensure_ascii=False))
PY`;
  const result = await runCommandOutput('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', remoteAlias, script], CODEX_REMOTE_HISTORY_TIMEOUT_MS);
  if (!result.ok) {
    // SSH 不可达时沿用上次成功列表，远程线程不因主机瞬断而从手机端消失
    const staleThreads = cached && Array.isArray(cached.threads) ? cached.threads : [];
    boundedSet(remoteHostThreadListCache, cacheKey, { at: Date.now(), threads: staleThreads, failed: true }, 50);
    return staleThreads;
  }
  let parsed = [];
  try { parsed = JSON.parse(result.stdout || '[]'); } catch { parsed = []; }
  const threads = Array.isArray(parsed)
    ? parsed.map(item => remoteThreadFromSessionSummary(item, host)).filter(Boolean)
    : [];
  boundedSet(remoteHostThreadListCache, cacheKey, { at: Date.now(), threads, failed: false }, 50);
  for (const thread of threads) rememberRemoteThreadMeta(thread);
  return threads;
}

async function listConfiguredRemoteThreads(options = {}) {
  const hosts = normalizeRemoteThreadHosts(options.hosts || readCodexMiniState().remoteThreadHosts);
  const groups = await Promise.all(hosts.map(host => listRemoteHostThreads(host, { force: options.force, limit: options.limit }).catch(() => [])));
  return groups.flat();
}

async function cdpReadRemoteSidebarThreads(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && codexRemoteSidebarThreadCache.threads.length && now - codexRemoteSidebarThreadCache.at <= CODEX_REMOTE_THREAD_LIST_CACHE_MS) {
    return codexRemoteSidebarThreadCache.threads;
  }
  if (force && codexRemoteSidebarThreadCache.threads.length && now - codexRemoteSidebarThreadCache.at <= 5000) {
    return codexRemoteSidebarThreadCache.threads;
  }
  const rows = await withCodexCdp(async client => {
    const result = await cdpEvaluate(client, `(async () => {
      const visible = ${cdpVisibleHelperSource()};
      const domClick = ${cdpDomClickHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const clickProjectToggle = el => {
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        try { el.focus?.({ preventScroll: true }); } catch {}
        const rect = el.getBoundingClientRect();
        const base = {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          clientX: rect.left + Math.max(36, Math.min(rect.width - 8, rect.width * 0.22)),
          clientY: rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2)),
        };
        for (const event of [
          new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }),
          new MouseEvent('mousedown', { ...base, buttons: 1 }),
          new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }),
          new MouseEvent('mouseup', { ...base, buttons: 0 }),
          new MouseEvent('click', base),
        ]) el.dispatchEvent(event);
      };
      const projectElements = () => [...document.querySelectorAll('[data-app-action-sidebar-project-row],[data-app-action-sidebar-project-label]')]
        .filter(visible);
      const remoteProjectCandidates = projectElements()
        .filter(el => {
          const id = el.getAttribute('data-app-action-sidebar-project-id') || '';
          const label = el.getAttribute('data-app-action-sidebar-project-label') || normalize(el.innerText);
          if (!id || id.startsWith('/')) return false;
          if (/^(对话|置顶|项目|设置)$/.test(label)) return false;
          return el.getAttribute('data-app-action-sidebar-project-collapsed') === 'true' || el.getAttribute('aria-expanded') === 'false';
        })
        .map(el => ({
          id: el.getAttribute('data-app-action-sidebar-project-id') || '',
          label: el.getAttribute('data-app-action-sidebar-project-label') || normalize(el.innerText),
        }));
      for (const item of remoteProjectCandidates) {
        const row = projectElements().find(el => (el.getAttribute('data-app-action-sidebar-project-id') || '') === item.id);
        if (row && (row.getAttribute('data-app-action-sidebar-project-collapsed') === 'true' || row.getAttribute('aria-expanded') === 'false')) {
          clickProjectToggle(row);
          await sleep(260);
        }
      }
      if (remoteProjectCandidates.length) await sleep(360);

      // 远程项目即使展开，其线程列表仍可能被侧边栏“展开显示”按钮折叠，只露出少数几条（客户反馈：默认约 5 条）。
      // 点开远程项目区域内的“展开显示”，把完整远程线程加载进 DOM；多轮以应对展开后又冒出的下一个按钮。
      const nearestProjectId = top => {
        const rows = projectElements().map(el => ({
          id: el.getAttribute('data-app-action-sidebar-project-id') || '',
          top: el.getBoundingClientRect().top,
        })).sort((a, b) => a.top - b.top);
        let current = '';
        for (const p of rows) { if (p.top <= top + 1) current = p.id || ''; else break; }
        return current;
      };
      for (let pass = 0; pass < 4; pass += 1) {
        const expandButtons = [...document.querySelectorAll('button')]
          .filter(b => visible(b) && normalize(b.innerText) === '展开显示');
        let clicked = 0;
        for (const btn of expandButtons) {
          // 只点远程项目（本地项目 id 以 / 开头）下的“展开显示”，不动本地侧边栏
          const pid = nearestProjectId(btn.getBoundingClientRect().top);
          if (pid && !pid.startsWith('/')) { clickProjectToggle(btn); clicked += 1; await sleep(140); }
        }
        if (!clicked) break;
        await sleep(280);
      }

      const projectRows = projectElements().map(el => {
          const rect = el.getBoundingClientRect();
          return {
            label: el.getAttribute('data-app-action-sidebar-project-label') || normalize(el.innerText),
            id: el.getAttribute('data-app-action-sidebar-project-id') || '',
            top: rect.top,
            bottom: rect.bottom,
          };
        })
        .sort((a, b) => a.top - b.top);
      const projectForTop = top => {
        let current = null;
        for (const project of projectRows) {
          if (project.top <= top + 1) current = project;
          else break;
        }
        return current || {};
      };
      const threads = [...document.querySelectorAll('[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]')]
        .filter(visible)
        .map(el => {
          const rect = el.getBoundingClientRect();
          const hostId = el.getAttribute('data-app-action-sidebar-thread-host-id') || '';
          const rawId = el.getAttribute('data-app-action-sidebar-thread-id') || '';
          const project = projectForTop(rect.top);
          return {
            rawId,
            hostId,
            kind: el.getAttribute('data-app-action-sidebar-thread-kind') || '',
            active: el.getAttribute('data-app-action-sidebar-thread-active') || '',
            title: el.getAttribute('data-app-action-sidebar-thread-title') || '',
            text: normalize(el.innerText).slice(0, 220),
            projectName: project.label || '',
            projectId: project.id || '',
            top: rect.top,
          };
        })
        .filter(item => item.hostId && item.hostId !== 'local' && item.rawId);
      return threads;
    })()`);
    return Array.isArray(result) ? result : [];
  });
  const threads = rows
    .map(row => {
      const id = normalizeCodexDomThreadId(row.rawId || '');
      const hostId = normalizeRemoteThreadHostId(row.hostId || '');
      const remoteAlias = safeRemoteSshAlias(hostId);
      if (!isCodexThreadId(id) || !remoteAlias) return null;
      const updatedMs = relativeSidebarTimeMs(row.text) || Date.now();
      const name = cleanSidebarThreadTitle(row.title || row.text) || '未命名线程';
      const projectName = row.projectName || remoteAlias;
      return {
        id,
        name,
        nameSource: row.title ? 'codex_sidebar_title' : 'codex_sidebar_text',
        updatedAt: new Date(updatedMs).toISOString(),
        effectiveUpdatedMs: updatedMs,
        effectiveUpdatedAt: new Date(updatedMs).toISOString(),
        guardianSortMs: updatedMs,
        mtimeMs: updatedMs,
        cwd: '',
        source: 'codex_desktop_sidebar',
        threadSource: 'remote_ssh',
        sessionFile: '',
        remoteSessionFile: '',
        latestSnippet: cleanSidebarThreadTitle(row.text || name),
        latestSnippetAt: new Date(updatedMs).toISOString(),
        firstUserMessageAt: new Date(updatedMs).toISOString(),
        latestUserMessageAt: new Date(updatedMs).toISOString(),
        runtimeStatus: row.active === 'true' ? 'active' : 'idle',
        runtimeActive: false,
        pinned: false,
        isProjectThread: true,
        projectKey: `remote:${hostId}:${row.projectId || projectName}`,
        projectName,
        projectPath: '',
        remoteProjectId: row.projectId || '',
        remoteHostId: hostId,
        remoteAlias,
        domThreadId: row.rawId,
        isRemoteThread: true,
      };
    })
    .filter(Boolean);
  codexRemoteSidebarThreadCache = { at: Date.now(), threads };
  for (const thread of threads) {
    rememberRemoteThreadMeta(thread);
    rememberRemoteThreadHost(thread);
  }
  return threads;
}

function listCodexThreads(limit = 80, options = {}) {
  const normalizedLimit = Math.max(1, Math.min(160, Number(limit) || 80));
  const force = Boolean(options.force);
  const syncRestoredArchived = Boolean(options.syncRestoredArchived);
  const includeSubagents = Boolean(options.includeSubagents);
  const allowedThreadIds = options.allowedThreadIds instanceof Set ? options.allowedThreadIds : null;
  const scopeKey = allowedThreadIds ? [...allowedThreadIds].sort().join(',') : 'all';
  const cacheKey = `${normalizedLimit}:${syncRestoredArchived ? 'sync' : 'normal'}:${includeSubagents ? 'with-subagents' : 'no-subagents'}:${scopeKey}`;
  if (force) invalidateCodexThreadDiscoveryCaches({ deep: true });
  const cached = codexThreadListCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at <= CODEX_THREAD_LIST_CACHE_MS) return cached.threads;
  let miniState = readCodexMiniState();
  const sessionFiles = listCodexSessionFiles({ force });
  if (syncRestoredArchived && Array.isArray(miniState.archivedThreadIds) && miniState.archivedThreadIds.length) {
    const activeSessionThreadIds = new Set(sessionFiles.map(threadIdFromSessionFile).filter(isCodexThreadId));
    const nextArchivedThreadIds = miniState.archivedThreadIds.filter(id => !activeSessionThreadIds.has(id));
    if (nextArchivedThreadIds.length !== miniState.archivedThreadIds.length) {
      miniState = writeCodexMiniState({ ...miniState, archivedThreadIds: nextArchivedThreadIds });
    }
  }
  const pinnedThreadIds = new Set(miniState.pinnedThreadIds || []);
  const archivedThreadIds = new Set(miniState.archivedThreadIds || []);
  const titleOverrides = miniState.titleOverrides || {};
  const byId = readThreadIndex();
  for (const file of sessionFiles) {
    const match = path.basename(file).match(/([a-f0-9]{8}-[a-f0-9-]{27,})\.jsonl$/i);
    if (!match) continue;
    const id = match[1];
    try {
      const stat = fs.statSync(file);
      const meta = readSessionMeta(file);
      if (!includeSubagents && isSubagentSessionMeta(meta)) continue;
      const runtime = quickCodexRuntimeFromFile(file, stat);
      const latestSnippet = latestCodexThreadSnippet(file);
      const firstUserMessageAt = findFirstCodexUserMessageAt(file);
      const latestUserMessageAt = findLatestCodexUserMessageAt(file);
      const project = classifyThreadProject(meta.cwd || '');
      const existing = byId.get(id) || { id, name: '', updatedAt: '' };
      const fallbackName = isPlaceholderThreadName(existing.name) ? findFirstCodexUserMessage(file) : '';
      existing.name = isPlaceholderThreadName(existing.name) ? (fallbackName || '未命名线程') : existing.name;
      existing.nameSource = fallbackName && existing.name === fallbackName ? 'first_user_message' : 'index';
      const override = titleOverrides[id];
      if (override && typeof override.name === 'string' && override.name.trim()) {
        const overrideTime = Date.parse(override.renamedAt || '') || 0;
        const indexTime = Date.parse(existing.updatedAt || '') || 0;
        if (!indexTime || !overrideTime || indexTime <= overrideTime + 2000 || existing.name === override.name || isPlaceholderThreadName(existing.name)) {
          existing.name = override.name.trim();
          existing.nameSource = 'codex_mini_override';
        }
      }
      existing.sessionFile = path.basename(file);
      existing.mtimeMs = stat.mtimeMs;
      existing.updatedAt = existing.updatedAt || meta.timestamp || new Date(stat.mtimeMs).toISOString();
      existing.effectiveUpdatedMs = Math.max(Date.parse(existing.updatedAt) || 0, stat.mtimeMs || 0);
      existing.cwd = meta.cwd || '';
      existing.source = meta.source || '';
      existing.threadSource = meta.thread_source || '';
      existing.runtimeStatus = runtime.status;
      existing.runtimeActive = runtime.active;
      existing.runtimeStartedAt = runtime.startedAt;
      existing.runtimeCompletedAt = runtime.completedAt;
      existing.runtimeUpdatedAt = runtime.updatedAt;
      existing.runtimeTurnId = runtime.turnId;
      existing.latestSnippet = latestSnippet.text;
      existing.latestSnippetAt = latestSnippet.at;
      existing.firstUserMessageAt = firstUserMessageAt || existing.firstUserMessageAt || meta.timestamp || existing.updatedAt || '';
      existing.latestUserMessageAt = latestUserMessageAt || existing.latestUserMessageAt || existing.firstUserMessageAt || meta.timestamp || existing.updatedAt || '';
      existing.pinned = pinnedThreadIds.has(id);
      Object.assign(existing, project);
      byId.set(id, existing);
    } catch {}
  }
  const threads = [...byId.values()]
    .filter(item => item.sessionFile && !archivedThreadIds.has(item.id) && (!allowedThreadIds || allowedThreadIds.has(item.id)))
    .map(item => {
      const effectiveUpdatedMs = item.effectiveUpdatedMs || Math.max(Date.parse(item.updatedAt) || 0, item.mtimeMs || 0);
      const userSortMs = Math.max(
        Date.parse(item.latestUserMessageAt || '') || 0,
        Date.parse(item.runtimeStartedAt || '') || 0,
        Date.parse(item.firstUserMessageAt || '') || 0
      );
      const guardianSortMs = userSortMs || effectiveUpdatedMs;
      return { ...item, effectiveUpdatedMs, effectiveUpdatedAt: new Date(effectiveUpdatedMs).toISOString(), guardianSortMs };
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.guardianSortMs - a.guardianSortMs || b.effectiveUpdatedMs - a.effectiveUpdatedMs)
    .slice(0, normalizedLimit);
  boundedSet(codexThreadListCache, cacheKey, { at: Date.now(), threads }, 20);
  return threads;
}

async function listCodexThreadsWithRemote(limit = 80, options = {}) {
  const normalizedLimit = Math.max(1, Math.min(160, Number(limit) || 80));
  const localThreads = listCodexThreads(normalizedLimit, options);
  const allowedRemoteThreadIds = options.allowedRemoteThreadIds instanceof Set ? options.allowedRemoteThreadIds : null;
  let remoteThreads = [];
  const configuredRemoteHosts = normalizeRemoteThreadHosts(readCodexMiniState().remoteThreadHosts);
  if (!allowedRemoteThreadIds || allowedRemoteThreadIds.size) {
    try {
      remoteThreads = await listConfiguredRemoteThreads({ hosts: configuredRemoteHosts, force: options.force, limit: 40 });
    } catch {
      remoteThreads = [];
    }
    if (!remoteThreads.length && !configuredRemoteHosts.length) {
      try {
        const discovered = await cdpReadRemoteSidebarThreads({ force: false });
        remoteThreads = discovered.length ? discovered : remoteThreads;
      } catch {}
    }
  }
  if (allowedRemoteThreadIds) {
    // 远程线程跟随 Codex 桌面侧边栏过滤：只显示侧边栏当前账号下出现的远程线程，不把 SSH 上所有会话都倒出来。
    // allowedRemoteThreadIds 由 handleThreads 用“展开后的完整侧边栏远程列表”填好（见那里的折叠展开逻辑），
    // 所以这里按白名单过滤即可，既只显示桌面侧边栏有的、又不会被折叠时只露出的少数几条限制。
    remoteThreads = remoteThreads.filter(item => allowedRemoteThreadIds.has(item.id));
    const covered = new Set(remoteThreads.map(item => item.id));
    if (covered.size < allowedRemoteThreadIds.size && codexRemoteSidebarThreadCache.threads.length) {
      for (const item of codexRemoteSidebarThreadCache.threads) {
        if (allowedRemoteThreadIds.has(item.id) && !covered.has(item.id)) {
          remoteThreads.push(item);
          covered.add(item.id);
        }
      }
    }
  }
  // 名字以 Codex 桌面端为准：SSH 直读拿到的是服务器原始信息（cwd 目录名 + 会话首句），
  // 用 CDP 读到的桌面侧边栏项目别名 / 线程标题 / 项目分组按线程 id 覆盖，让手机端与桌面端完全一致。
  // 用 map 生成新对象，避免污染 listRemoteHostThreads 的缓存条目。
  if (codexRemoteSidebarThreadCache.threads.length) {
    const domById = new Map(codexRemoteSidebarThreadCache.threads.map(item => [item.id, item]));
    remoteThreads = remoteThreads.map(remote => {
      const dom = domById.get(remote.id);
      if (!dom) return remote;
      return {
        ...remote,
        name: dom.name || remote.name,
        nameSource: dom.name ? (dom.nameSource || remote.nameSource) : remote.nameSource,
        latestSnippet: dom.latestSnippet || remote.latestSnippet,
        projectName: dom.projectName || remote.projectName,
        projectKey: dom.projectKey || remote.projectKey,
        remoteProjectId: dom.remoteProjectId || remote.remoteProjectId,
      };
    });
  }
  const byId = new Map(localThreads.map(item => [item.id, item]));
  for (const remote of remoteThreads) {
    if (!isCodexThreadId(remote.id) || byId.has(remote.id)) continue;
    byId.set(remote.id, remote);
  }
  return [...byId.values()]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.guardianSortMs || 0) - (a.guardianSortMs || 0) || (b.effectiveUpdatedMs || 0) - (a.effectiveUpdatedMs || 0))
    .slice(0, normalizedLimit);
}

async function cdpReadCurrentAccountThreadScope(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && codexCurrentAccountThreadScopeCache.scope && now - codexCurrentAccountThreadScopeCache.at <= CODEX_THREAD_LIST_CACHE_MS) {
    return { ...codexCurrentAccountThreadScopeCache.scope, cached: true };
  }
  // 多个页面同时轮询时合并为同一次 CDP DOM 读取
  if (!force && codexCurrentAccountThreadScopeInFlight) return codexCurrentAccountThreadScopeInFlight;
  let inFlight;
  inFlight = cdpReadCurrentAccountThreadScopeNow().finally(() => {
    if (codexCurrentAccountThreadScopeInFlight === inFlight) codexCurrentAccountThreadScopeInFlight = null;
  });
  codexCurrentAccountThreadScopeInFlight = inFlight;
  return inFlight;
}

async function cdpReadCurrentAccountThreadScopeNow() {
  let scope;
  try {
    scope = await withCodexCdp(async client => {
    const result = await cdpEvaluate(client, `(() => {
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const threadIdFromValue = value => {
        const match = String(value || '').match(/[a-f0-9]{8}-[a-f0-9-]{27,}/i);
        return match ? match[0] : '';
      };
      const visible = ${cdpVisibleHelperSource()};
      const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-id],[data-app-action-sidebar-thread-row]')];
      const threads = [];
      const seen = new Set();
      const remoteThreadIds = [];
      const remoteSeen = new Set();
      let visibleCount = 0;
      for (const row of rows) {
        const hostId = row.getAttribute('data-app-action-sidebar-thread-host-id') || '';
        const rawId = row.getAttribute('data-app-action-sidebar-thread-id') || row.dataset?.appActionSidebarThreadId || '';
        const id = threadIdFromValue(rawId);
        if (!id) continue;
        if (hostId && hostId !== 'local') {
          if (!remoteSeen.has(id)) {
            remoteSeen.add(id);
            remoteThreadIds.push(id);
          }
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        const isVisible = visible(row);
        if (isVisible) visibleCount += 1;
        threads.push({
          id,
          rawId,
          visible: isVisible,
          active: row.getAttribute('data-app-action-sidebar-thread-active') === 'true'
            || row.getAttribute('aria-current') === 'page'
            || row.getAttribute('aria-selected') === 'true',
          title: normalize(row.getAttribute('data-app-action-sidebar-thread-title') || row.innerText || row.textContent).slice(0, 180),
        });
      }
      let remoteCollapsedProjectCount = 0;
      for (const el of document.querySelectorAll('[data-app-action-sidebar-project-row],[data-app-action-sidebar-project-label]')) {
        const projectId = el.getAttribute('data-app-action-sidebar-project-id') || '';
        if (!projectId || projectId.startsWith('/')) continue;
        const label = el.getAttribute('data-app-action-sidebar-project-label') || normalize(el.innerText);
        if (/^(对话|置顶|项目|设置)$/.test(label)) continue;
        if (el.getAttribute('data-app-action-sidebar-project-collapsed') === 'true' || el.getAttribute('aria-expanded') === 'false') remoteCollapsedProjectCount += 1;
      }
      const active = threads.find(item => item.active) || null;
      return {
        ok: true,
        available: threads.length > 0,
        threadIds: threads.map(item => item.id),
        threadCount: threads.length,
        visibleCount,
        remoteThreadIds,
        remoteCollapsedProjectCount,
        activeThreadId: active ? active.id : '',
        samples: threads.slice(0, 12),
      };
    })()`);
    return result && result.ok ? result : { ok: false, available: false, threadIds: [], threadCount: 0, visibleCount: 0, remoteThreadIds: [], remoteCollapsedProjectCount: 0, activeThreadId: '', samples: [] };
    });
  } catch (error) {
    // CDP 瞬时不可用时回退最近一次成功的账号范围，避免线程列表被瞬时清空、手机端选中线程跳走
    if (lastGoodCodexAccountThreadScope.scope && Date.now() - lastGoodCodexAccountThreadScope.at <= CODEX_ACCOUNT_SCOPE_STALE_MS) {
      return { ...lastGoodCodexAccountThreadScope.scope, cached: true, stale: true };
    }
    throw error;
  }

  const normalizedIds = uniqueList((scope.threadIds || []).map(normalizeCodexDomThreadId).filter(isCodexThreadId), 1000);
  const normalizedRemoteIds = uniqueList((scope.remoteThreadIds || []).map(normalizeCodexDomThreadId).filter(isCodexThreadId), 1000);
  const normalizedScope = {
    ok: true,
    available: normalizedIds.length > 0,
    source: 'codex-dom-current-account-local',
    threadIds: normalizedIds,
    threadCount: normalizedIds.length,
    visibleCount: Number(scope.visibleCount) || 0,
    remoteThreadIds: normalizedRemoteIds,
    remoteThreadCount: normalizedRemoteIds.length,
    remoteCollapsedProjectCount: Number(scope.remoteCollapsedProjectCount) || 0,
    activeThreadId: normalizeCodexDomThreadId(scope.activeThreadId || ''),
    samples: Array.isArray(scope.samples) ? scope.samples : [],
    updatedAt: new Date().toISOString(),
  };
  codexCurrentAccountThreadScopeCache = { at: Date.now(), scope: normalizedScope };
  lastGoodCodexAccountThreadScope = { at: Date.now(), scope: normalizedScope };
  return { ...normalizedScope, cached: false };
}

async function handleThreads(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const limit = Math.max(1, Math.min(160, Number(url.searchParams.get('limit')) || 80));
  const force = url.searchParams.get('force') === '1';
  const syncRestoredArchived = force || url.searchParams.get('syncRestoredArchived') === '1';
  const includeSubagents = url.searchParams.get('includeSubagents') === '1';
  const includeAllSessions = url.searchParams.get('includeAllSessions') === '1';
  const currentAccountOnly = !includeAllSessions && url.searchParams.get('currentAccountOnly') === '1';
  let threadScope = null;
  let allowedThreadIds = null;
  let allowedRemoteThreadIds = null;
  if (currentAccountOnly) {
    try {
      threadScope = await cdpReadCurrentAccountThreadScope({ force });
      allowedThreadIds = new Set(threadScope.threadIds || []);
      allowedRemoteThreadIds = new Set(threadScope.remoteThreadIds || []);
      if (allowedRemoteThreadIds.size > 0 || (Number(threadScope.remoteCollapsedProjectCount) || 0) > 0) {
        // 远程项目即使在侧边栏展开，其线程列表也可能被“展开显示”按钮折叠，只露出少数几条（客户反馈：默认约 5 条）。
        // 所以只要侧边栏出现过远程线程、或有折叠的远程项目，就调 cdpReadRemoteSidebarThreads 展开读取完整远程列表并入白名单：
        // 既保持“只显示桌面侧边栏有的远程线程”，又不被折叠数量限制。该函数自带缓存/TTL，
        // force=false 时 TTL 内复用快照、不会每轮真点击；force=1 时才强制重新展开。
        try {
          const discovered = await cdpReadRemoteSidebarThreads({ force });
          for (const item of discovered) {
            if (isCodexThreadId(item.id)) allowedRemoteThreadIds.add(item.id);
          }
        } catch {
          // 展开失败时退回最近快照，至少不丢已知的远程线程
          for (const item of codexRemoteSidebarThreadCache.threads) {
            if (isCodexThreadId(item.id)) allowedRemoteThreadIds.add(item.id);
          }
        }
      }
    } catch (error) {
      const explained = explainTargetError(error, 'codex');
      allowedThreadIds = new Set();
      allowedRemoteThreadIds = new Set();
      threadScope = { ok: false, available: false, source: 'codex-dom-current-account-local', ...explained };
    }
  }
  const threads = await listCodexThreadsWithRemote(limit, { force, syncRestoredArchived, includeSubagents, allowedThreadIds, allowedRemoteThreadIds });
  const message = currentAccountOnly && threadScope && threadScope.available === false && !threads.length
    ? '暂时无法读取当前 Codex 账号的线程列表'
    : '';
  return json(res, 200, { ok: true, threads, ...(threadScope ? { threadScope } : {}), ...(message ? { message } : {}) });
}

function readTailLines(file) {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - CODEX_SESSION_TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text.split('\n').filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

function readStatusLines(file) {
  return readTailLinesWithLimit(file, CODEX_STATUS_TAIL_BYTES);
}

function readTailLinesWithLimit(file, maxBytes) {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text.split('\n').filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

function countCodexHistoryMessages(lines, maxNeeded = MAX_HISTORY_MESSAGES) {
  let count = 0;
  let currentTurn = null;
  const userEventFingerprints = new Set();
  const need = Math.max(1, Math.min(Number(maxNeeded) || MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES));
  for (const line of lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      currentTurn = { hasAssistant: false };
      continue;
    }
    if (item.type === 'event_msg' && payload.type === 'user_message') {
      const text = cleanUserHistoryText(payload.message);
      const attachments = extractUserAttachments(payload);
      const fingerprint = normalizeHistoryMessageFingerprint(text);
      if (fingerprint) userEventFingerprints.add(fingerprint);
      if (text || attachments.length) count += 1;
    } else if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const text = cleanUserHistoryText(extractMessageText(payload.content));
      const fingerprint = normalizeHistoryMessageFingerprint(text);
      if (text && !isSyntheticCodexUserMessage(text) && fingerprint && !userEventFingerprints.has(fingerprint)) {
        userEventFingerprints.add(fingerprint);
        count += 1;
      }
    } else if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer') {
      const text = sanitizeAssistantHistoryText(extractMessageText(payload.content));
      if (text) {
        count += 1;
        if (currentTurn) currentTurn.hasAssistant = true;
      }
    } else if (item.type === 'event_msg' && payload.type === 'task_complete') {
      const rawLastMessage = normalizeHistoryText(payload.last_agent_message || '');
      const lastMessage = sanitizeAssistantHistoryText(rawLastMessage);
      if (currentTurn && !currentTurn.hasAssistant && !isInternalCodexHandoffText(rawLastMessage)) count += lastMessage ? 1 : 1;
      currentTurn = null;
    } else if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      if (currentTurn && !currentTurn.hasAssistant) count += 1;
      currentTurn = null;
    }
    if (count >= need) return count;
  }
  return count;
}

function readHistoryLinesAdaptive(file, desiredMessages = MAX_HISTORY_MESSAGES) {
  const stat = fs.statSync(file);
  const maxBytes = Math.min(stat.size, CODEX_HISTORY_TAIL_BYTES);
  const desired = Math.max(1, Math.min(Number(desiredMessages) || MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES));

  if (maxBytes <= CODEX_HISTORY_INITIAL_TAIL_BYTES * 6) {
    return { lines: readTailLinesWithLimit(file, maxBytes), stat, scannedBytes: maxBytes };
  }

  const initialBytes = Math.min(CODEX_HISTORY_INITIAL_TAIL_BYTES, maxBytes);
  const initialLines = readTailLinesWithLimit(file, initialBytes);
  if (countCodexHistoryMessages(initialLines, desired) >= desired) {
    return { lines: initialLines, stat, scannedBytes: initialBytes };
  }

  return { lines: readTailLinesWithLimit(file, maxBytes), stat, scannedBytes: maxBytes };
}

function extractUserAttachments(payload) {
  const paths = [];
  const pushPath = value => {
    const text = String(value || '').trim();
    if (!text || !text.startsWith('/')) return;
    paths.push(text);
  };
  for (const key of ['local_images', 'images']) {
    if (!Array.isArray(payload[key])) continue;
    for (const item of payload[key]) {
      if (typeof item === 'string') pushPath(item);
      else if (item && typeof item.path === 'string') pushPath(item.path);
      else if (item && typeof item.filePath === 'string') pushPath(item.filePath);
    }
  }

  const message = String(payload && payload.message || '');
  const filesIndex = message.search(/^# Files mentioned by the user:\s*$/mi);
  if (filesIndex >= 0) {
    const afterFiles = message.slice(filesIndex);
    const requestIndex = afterFiles.search(/^## My request for Codex:\s*$/mi);
    const filesBlock = requestIndex >= 0 ? afterFiles.slice(0, requestIndex) : afterFiles;
    for (const line of filesBlock.split(/\r?\n/)) {
      const match = line.match(/^##\s+[^:]+:\s*(\/[^\r\n]+?)\s*$/);
      if (match) paths.push(match[1]);
    }
  }

  return uniqueList(paths.filter(Boolean), 30);
}

const HISTORY_ATTACHMENT_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.psd': 'image/vnd.adobe.photoshop',
  '.psb': 'image/vnd.adobe.photoshop',
  '.3mf': 'model/3mf',
  '.stl': 'model/stl',
};

function mimeForHistoryAttachment(filePath = '') {
  return HISTORY_ATTACHMENT_MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function historyAttachmentFromPath(filePath) {
  const name = path.basename(String(filePath || '')) || 'attachment';
  const mime = mimeForHistoryAttachment(name);
  let size = 0;
  try { size = fs.statSync(filePath).size; } catch {}
  const kind = attachmentKindFromMime(mime, name);
  return { filePath, name, mime, type: mime, size, kind };
}

function summarizeHistoryAttachmentKinds(attachments = []) {
  const counts = { image: 0, video: 0, file: 0 };
  for (const item of attachments) counts[item.kind === 'image' ? 'image' : item.kind === 'video' ? 'video' : 'file'] += 1;
  return [
    counts.image ? `${counts.image} 张图片` : '',
    counts.video ? `${counts.video} 个视频` : '',
    counts.file ? `${counts.file} 个文件` : '',
  ].filter(Boolean).join('、') || `${attachments.length} 个附件`;
}

function parseCodexThreadHistoryFile(threadId, file, limit = MAX_HISTORY_MESSAGES, options = {}) {
  const messages = [];
  const userEventFingerprints = new Set();
  let currentTurn = null;
  function historyDurationText(startedAt = '', completedAt = '') {
    const startMs = Date.parse(startedAt || '');
    const endMs = Date.parse(completedAt || '');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '';
    const total = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  function historyCompleteLabel(startedAt = '', completedAt = '') {
    const duration = historyDurationText(startedAt, completedAt);
    return duration ? `Codex · 已处理 ${duration}` : 'Codex';
  }
  function historyFailureLabel(startedAt = '', completedAt = '') {
    const duration = historyDurationText(startedAt, completedAt);
    return duration ? `Codex · 失败 ${duration}` : 'Codex';
  }
  const historyTail = readHistoryLinesAdaptive(file, limit);
  for (const line of historyTail.lines) {
    try {
      const item = JSON.parse(line);
      const payload = item.payload || {};
      if (item.type === 'event_msg' && payload.type === 'user_message') {
        const fingerprint = normalizeHistoryMessageFingerprint(cleanUserHistoryText(payload.message));
        if (fingerprint) userEventFingerprints.add(fingerprint);
      }
    } catch {
      /* ignore partial/corrupt lines */
    }
  }
  for (const line of historyTail.lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload || {};

    if (item.type === 'event_msg' && payload.type === 'task_started') {
      currentTurn = { hasAssistant: false, assistantIndex: -1, failureText: '', startedAt: item.timestamp || '', turnId: payload.turn_id || '', toolNamesByCallId: new Map(), generatedAttachments: [] };
      continue;
    }

    if (currentTurn && item.type === 'event_msg') {
      currentTurn.failureText = currentTurn.failureText || extractFailureTextFromPayload(payload);
      const generated = generatedImageAttachmentsFromEvent(payload, threadId);
      if (generated.length) currentTurn.generatedAttachments = mergeAttachmentRows([...(currentTurn.generatedAttachments || []), ...generated]);
    }

    if (currentTurn && item.type === 'turn_context') {
      currentTurn.turnId = payload.turn_id || currentTurn.turnId;
    }

    if (currentTurn && item.type === 'response_item' && payload.type === 'function_call' && payload.call_id) {
      currentTurn.toolNamesByCallId.set(payload.call_id, payload.name || '');
    }

    if (currentTurn && item.type === 'response_item' && payload.type === 'function_call_output' && payload.call_id) {
      const generated = generatedImageAttachmentsFromToolOutput(payload, currentTurn.toolNamesByCallId.get(payload.call_id) || '', threadId);
      if (generated.length) currentTurn.generatedAttachments = mergeAttachmentRows([...(currentTurn.generatedAttachments || []), ...generated]);
    }

    if (item.type === 'event_msg' && payload.type === 'user_message') {
      const text = cleanUserHistoryText(payload.message);
      const attachmentRows = extractUserAttachments(payload).map(historyAttachmentFromPath);
      const fingerprint = normalizeHistoryMessageFingerprint(text);
      if (fingerprint) userEventFingerprints.add(fingerprint);
      if (text || attachmentRows.length) {
        messages.push({
          role: 'user',
          label: attachmentRows.length ? `你 · ${summarizeHistoryAttachmentKinds(attachmentRows)}` : '你',
          text: text || (attachmentRows.length ? ' ' : ''),
          attachments: attachmentRows,
          timestamp: item.timestamp || '',
        });
      }
      continue;
    }

    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const text = cleanUserHistoryText(extractMessageText(payload.content));
      const fingerprint = normalizeHistoryMessageFingerprint(text);
      if (text && !isSyntheticCodexUserMessage(text) && fingerprint && !userEventFingerprints.has(fingerprint)) {
        userEventFingerprints.add(fingerprint);
        messages.push({
          role: 'user',
          label: '你 · 引导',
          text,
          attachments: [],
          timestamp: item.timestamp || '',
          guidance: true,
        });
      }
      continue;
    }

    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const isFinal = payload.phase === 'final_answer';
      if (!isFinal) continue;
      const text = sanitizeAssistantHistoryText(extractMessageText(payload.content));
      if (text) {
        const attachments = mergeAttachmentRows([...(currentTurn?.generatedAttachments || []), ...extractResponseAttachments(text, threadId)]);
        const visibleText = stripResponseAttachmentReferences(text);
        if (!visibleText && !attachments.length) continue;
        const assistantIndex = messages.length;
        messages.push({
          role: 'assistant',
          label: 'Codex',
          text: visibleText || ' ',
          attachments,
          timestamp: item.timestamp || '',
        });
        if (currentTurn) {
          currentTurn.hasAssistant = true;
          currentTurn.assistantIndex = assistantIndex;
        }
      }
      continue;
    }

    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      const rawLastMessage = normalizeHistoryText(payload.last_agent_message || '');
      const lastMessage = sanitizeAssistantHistoryText(rawLastMessage);
      const completedAt = item.timestamp || '';
      if (currentTurn && !currentTurn.hasAssistant) {
        const failureText = resolveFailureTextForTurn(threadId, {
          turnId: currentTurn.turnId || '',
          startedAt: currentTurn.startedAt || '',
          completedAt,
          failureText: currentTurn.failureText || '',
        });
        const generatedAttachments = currentTurn.generatedAttachments || [];
        if (!lastMessage && !failureText && !generatedAttachments.length && isInternalCodexHandoffText(rawLastMessage)) {
          currentTurn = null;
          continue;
        }
        const assistantText = lastMessage || failureText || (generatedAttachments.length ? '' : emptyCodexFailureText());
        const attachments = mergeAttachmentRows([...generatedAttachments, ...extractResponseAttachments(assistantText, threadId)]);
        const visibleText = stripResponseAttachmentReferences(assistantText);
        messages.push({
          role: 'assistant',
          label: failureText ? historyFailureLabel(currentTurn.startedAt, completedAt) : historyCompleteLabel(currentTurn.startedAt, completedAt),
          text: visibleText || (attachments.length ? ' ' : emptyCodexFailureText()),
          attachments,
          timestamp: completedAt || currentTurn.startedAt || '',
        });
      } else if (currentTurn && currentTurn.hasAssistant && currentTurn.assistantIndex >= 0 && messages[currentTurn.assistantIndex]) {
        messages[currentTurn.assistantIndex].label = historyCompleteLabel(currentTurn.startedAt, completedAt);
        messages[currentTurn.assistantIndex].attachments = mergeAttachmentRows([...(messages[currentTurn.assistantIndex].attachments || []), ...(currentTurn.generatedAttachments || [])]);
        if (!messages[currentTurn.assistantIndex].text && messages[currentTurn.assistantIndex].attachments.length) messages[currentTurn.assistantIndex].text = ' ';
      }
      currentTurn = null;
    }

    if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      const failureText = normalizeHistoryText(extractFailureTextFromPayload(payload) || currentTurn?.failureText || '');
      if (currentTurn && !currentTurn.hasAssistant) {
        messages.push({
          role: 'assistant',
          label: historyFailureLabel(currentTurn.startedAt, item.timestamp || ''),
          text: failureText || emptyCodexFailureText(),
          timestamp: item.timestamp || currentTurn.startedAt || '',
        });
      } else if (currentTurn && currentTurn.hasAssistant && currentTurn.assistantIndex >= 0 && messages[currentTurn.assistantIndex]) {
        messages[currentTurn.assistantIndex].label = historyFailureLabel(currentTurn.startedAt, item.timestamp || '');
      }
      currentTurn = null;
    }
  }

  return {
    ok: true,
    available: true,
    threadId,
    sessionFile: path.basename(file),
    remote: Boolean(options.remote),
    remoteHostId: options.remoteHostId || '',
    remoteAlias: options.remoteAlias || '',
    remoteSessionFile: options.remoteSessionFile || '',
    truncated: historyTail.stat.size > CODEX_HISTORY_TAIL_BYTES,
    messages: messages.slice(-Math.max(1, Math.min(Number(limit) || MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES))),
  };
}

function parseCodexThreadHistory(threadId, limit = MAX_HISTORY_MESSAGES) {
  const file = findCodexSessionFileByThreadId(threadId);
  if (!file) {
    return {
      ok: true,
      available: false,
      threadId,
      sessionFile: '',
      messages: [],
      message: '没有找到所选线程的 Codex 会话文件。',
    };
  }
  return parseCodexThreadHistoryFile(threadId, file, limit);
}

function remoteHistoryCachePath(threadId, alias) {
  const safeAlias = safeRemoteSshAlias(alias) || 'remote';
  return path.join(STATE_DIR, 'remote-sessions', safeAlias, `${threadId}.jsonl`);
}

function shellSingleQuote(value = '') {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function findRemoteCodexSessionFile(threadId, alias) {
  if (!isCodexThreadId(threadId)) return '';
  const remoteAlias = safeRemoteSshAlias(alias);
  if (!remoteAlias) return '';
  const cacheKey = `${remoteAlias}:${threadId}`;
  const cached = remoteSessionFileCache.get(cacheKey);
  if (cached && cached.file && Date.now() - cached.at <= 30000) return cached.file;
  const script = `find ~/.codex/sessions -type f -name '*${threadId}.jsonl' 2>/dev/null | sort | tail -n 1`;
  const result = await runCommandOutput('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', remoteAlias, script], CODEX_REMOTE_HISTORY_TIMEOUT_MS);
  const file = result.ok ? result.stdout.trim().split('\n').filter(Boolean).pop() || '' : '';
  if (file && !file.includes('\0') && file.endsWith(`${threadId}.jsonl`)) {
    boundedSet(remoteSessionFileCache, cacheKey, { at: Date.now(), file }, 300);
    return file;
  }
  return '';
}

async function fetchRemoteCodexSessionFile(threadId, remoteMeta = {}) {
  const remoteAlias = safeRemoteSshAlias(remoteMeta.remoteAlias || remoteMeta.remoteHostId || '');
  if (!isCodexThreadId(threadId) || !remoteAlias) return null;
  const remoteFile = await findRemoteCodexSessionFile(threadId, remoteAlias);
  if (!remoteFile) return null;
  const remoteReadCommand = `tail -c ${CODEX_HISTORY_TAIL_BYTES} -- ${shellSingleQuote(remoteFile)}`;
  const result = await runCommandBuffer('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', remoteAlias, remoteReadCommand], CODEX_REMOTE_HISTORY_TIMEOUT_MS, CODEX_HISTORY_TAIL_BYTES + 1024 * 1024);
  if (!result.ok || !result.stdout.length) return null;
  const localFile = remoteHistoryCachePath(threadId, remoteAlias);
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  fs.writeFileSync(localFile, result.stdout);
  return {
    localFile,
    remoteFile,
    remoteAlias,
    remoteHostId: remoteMeta.remoteHostId || `remote-ssh-discovered:${remoteAlias}`,
  };
}

async function parseRemoteCodexThreadHistory(threadId, limit = MAX_HISTORY_MESSAGES) {
  let meta = remoteThreadMetaCache.get(threadId) || null;
  if (!meta) {
    const hosts = normalizeRemoteThreadHosts(readCodexMiniState().remoteThreadHosts);
    for (const host of hosts) {
      const remoteFile = await findRemoteCodexSessionFile(threadId, host.remoteAlias).catch(() => '');
      if (remoteFile) {
        meta = {
          id: threadId,
          remoteHostId: host.remoteHostId,
          remoteAlias: host.remoteAlias,
          projectName: host.projectName,
          remoteProjectId: host.remoteProjectId,
        };
        rememberRemoteThreadMeta(meta);
        break;
      }
    }
  }
  if (!meta) return null;
  const fetched = await fetchRemoteCodexSessionFile(threadId, meta);
  if (!fetched) {
    return {
      ok: true,
      available: false,
      remote: true,
      threadId,
      sessionFile: '',
      messages: [],
      message: '没有从远程 SSH 主机读取到这个线程的 Codex 会话文件。',
      remoteHostId: meta.remoteHostId || '',
      remoteAlias: meta.remoteAlias || '',
    };
  }
  return parseCodexThreadHistoryFile(threadId, fetched.localFile, limit, {
    remote: true,
    remoteHostId: fetched.remoteHostId,
    remoteAlias: fetched.remoteAlias,
    remoteSessionFile: fetched.remoteFile,
  });
}

async function remoteCodexStatusOptions(threadId) {
  if (!isCodexThreadId(threadId)) return null;
  let meta = remoteThreadMetaCache.get(threadId) || null;
  if (!meta) {
    const hosts = normalizeRemoteThreadHosts(readCodexMiniState().remoteThreadHosts);
    for (const host of hosts) {
      const remoteFile = await findRemoteCodexSessionFile(threadId, host.remoteAlias).catch(() => '');
      if (remoteFile) {
        meta = {
          id: threadId,
          remoteHostId: host.remoteHostId,
          remoteAlias: host.remoteAlias,
          projectName: host.projectName,
          remoteProjectId: host.remoteProjectId,
        };
        rememberRemoteThreadMeta(meta);
        break;
      }
    }
  }
  if (!meta) return null;
  const fetched = await fetchRemoteCodexSessionFile(threadId, meta);
  if (!fetched) return null;
  return {
    file: fetched.localFile,
    remote: true,
    remoteHostId: fetched.remoteHostId,
    remoteAlias: fetched.remoteAlias,
    remoteSessionFile: fetched.remoteFile,
    sinceSkewMs: 3000,
  };
}

async function handleThreadHistory(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const threadId = url.searchParams.get('thread') || '';
    if (!isCodexThreadId(threadId)) {
      return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
    }
    const localHistory = parseCodexThreadHistory(threadId, url.searchParams.get('limit') || MAX_HISTORY_MESSAGES);
    if (localHistory.available) return json(res, 200, localHistory);
    const remoteHistory = await parseRemoteCodexThreadHistory(threadId, url.searchParams.get('limit') || MAX_HISTORY_MESSAGES);
    return json(res, 200, remoteHistory || localHistory);
  } catch (error) {
    return json(res, 500, { ok: false, code: 'CODEX_HISTORY_FAILED', message: '读取 Codex 聊天记录失败。', detail: String(error && error.message || error) });
  }
}

function extractReasoningText(payload) {
  const parts = [];
  if (Array.isArray(payload.summary)) {
    for (const item of payload.summary) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item.text === 'string') parts.push(item.text);
      else if (item && typeof item.summary === 'string') parts.push(item.summary);
    }
  }
  if (Array.isArray(payload.content)) {
    for (const item of payload.content) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item.text === 'string') parts.push(item.text);
    }
  }
  if (typeof payload.text === 'string') parts.push(payload.text);
  const visible = parts.map(x => String(x).trim()).filter(Boolean).join('\\n');
  return visible;
}

function parseToolArguments(payload) {
  const raw = payload.arguments || payload.input || '';
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { raw: String(raw) }; }
}

function shellQuotePattern() {
  return String.raw`(?:(?:"[^"]+")|(?:'[^']+')|(?:\\\S|\S)+)`;
}

function stripShellQuotes(value) {
  let text = String(value || '').trim();
  while ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text.replace(/\\([\s"'])/g, '$1');
}

function shortPath(value) {
  const text = stripShellQuotes(value).replace(/^~\//, '~/');
  if (!text) return '';
  const home = os.homedir();
  const normalized = text.startsWith(home) ? `~${text.slice(home.length)}` : text;
  if (/^[./~\w-].*\.(?:js|ts|tsx|jsx|html|css|json|jsonl|md|txt|sh|swift|py|yml|yaml|webmanifest|png|jpg|jpeg|gif|svg)$/i.test(normalized)) {
    return normalized.replace(/^\.\//, '');
  }
  return normalized.replace(/^\.\//, '');
}


function isLikelyToolFile(value) {
  const text = stripShellQuotes(value);
  if (!text || text.startsWith('-') || text.startsWith('<') || /^\d+$/.test(text)) return false;
  if (/^[A-Z_]+$/.test(text)) return false;
  return /[./~]/.test(text) || /\.[A-Za-z0-9]{1,12}$/.test(text);
}

function uniqueList(values, limit = 3) {
  const out = [];
  for (const value of values) {
    const text = shortPath(value);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function joinToolTargets(values) {
  const list = uniqueList(values, 4);
  if (!list.length) return '';
  return list.join(', ');
}

function extractCommandFiles(cmd) {
  const files = [];
  const token = shellQuotePattern();
  const commandPatterns = [
    new RegExp(String.raw`\bsed\s+(?:-[A-Za-z]+\s+)?${token}\s+(${token})`, 'g'),
    new RegExp(String.raw`\bnl\s+(?:-[A-Za-z]+\s+)*(${token})`, 'g'),
    new RegExp(String.raw`\b(?:cat|head|tail)\s+(?:-[A-Za-z0-9]+\s+)*(?:-n\s+\d+\s+)?(${token})`, 'g'),
  ];
  for (const re of commandPatterns) {
    let match;
    while ((match = re.exec(cmd))) files.push(match[1]);
  }
  const redirectMatch = cmd.match(/<\s*([^\s|;&]+)/);
  if (redirectMatch && !/<<\s*$/.test(cmd.slice(Math.max(0, redirectMatch.index - 3), redirectMatch.index + 1))) files.push(redirectMatch[1]);
  return uniqueList(files.filter(isLikelyToolFile), 4);
}

function extractSearchTargets(cmd) {
  const afterGlob = cmd.replace(/--glob\s+(?:"[^"]+"|'[^']+'|\S+)/g, '');
  const matches = [...afterGlob.matchAll(/(?:^|\s)([./~\w-][^\s|;&]*\.(?:js|ts|tsx|jsx|html|css|json|jsonl|md|txt|sh|swift|py|yml|yaml|webmanifest))(?:\s|$)/gi)];
  return uniqueList(matches.map(match => match[1]), 4);
}

function truncateCommand(cmd, max = 120) {
  const oneLine = String(cmd || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  const home = os.homedir();
  const text = oneLine.startsWith(home) ? `~${oneLine.slice(home.length)}` : oneLine.replace(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function patchStats(patch) {
  const files = [];
  let added = 0;
  let removed = 0;
  for (const line of String(patch || '').split('\n')) {
    const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/) || line.match(/^@@\s+(.+?)\s*$/);
    if (fileMatch && !fileMatch[1].startsWith('@@')) files.push(fileMatch[1].trim());
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('***')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { files: uniqueList(files, 3), added, removed };
}

function patchStatsFromChanges(changes = {}) {
  const files = [];
  let added = 0;
  let removed = 0;
  for (const [filePath, change] of Object.entries(changes || {})) {
    if (filePath) files.push(filePath);
    const diff = String(change && change.unified_diff || '');
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return { files: uniqueList(files, 3), added, removed };
}

function formatPatchApplyEnd(payload = {}) {
  const stats = patchStatsFromChanges(payload.changes || {});
  const target = stats.files.length ? stats.files.join(', ') : '文件';
  const delta = stats.added || stats.removed ? ` +${stats.added} -${stats.removed}` : '';
  return `${payload.success === false ? '编辑失败' : '已编辑'} ${target}${delta}`;
}

function formatToolCall(payload, options = {}) {
  const rawName = String(payload.name || 'tool');
  const name = rawName.split('.').pop();
  const args = parseToolArguments(payload);

  if (name === 'exec_command') {
    const cmd = String(args.cmd || args.raw || '').trim();
    const files = extractCommandFiles(cmd);
    if (files.length) return `Read ${files.join(', ')}`;

    if (/\b(?:rg|grep)\b/.test(cmd)) {
      const targets = joinToolTargets(extractSearchTargets(cmd));
      return targets ? `Search ${targets}` : 'Search project files';
    }
    if (/\bfind\b/.test(cmd)) return 'Find files';
    if (/\bls\b/.test(cmd)) return 'List files';
    if (/\bgit\s+diff\b/.test(cmd)) return `Review diff${joinToolTargets(extractSearchTargets(cmd)) ? ` in ${joinToolTargets(extractSearchTargets(cmd))}` : ''}`;
    if (/\bgit\s+status\b/.test(cmd)) return 'Check git status';
    if (/\bgit\b/.test(cmd)) return `Run git: ${truncateCommand(cmd, 90)}`;
    if (/\b(?:node --check|npm run check)\b/.test(cmd)) return 'Run checks';
    if (/\bcurl\b/.test(cmd)) return `Check endpoint: ${truncateCommand(cmd, 100)}`;
    if (/\b(?:npm start|node\s+server\.js)\b/.test(cmd)) return 'Start local service';
    if (/\.codex\/sessions|session_index\.jsonl|Codex session/.test(cmd)) return 'Inspect Codex session log';
    if (/\b(?:python3|node\s+-)\b/.test(cmd)) return `Run script: ${truncateCommand(cmd, 90)}`;
    return `Run: ${truncateCommand(cmd) || 'local command'}`;
  }

  if (name === 'apply_patch') {
    const patch = typeof args.raw === 'string' ? args.raw : String(payload.arguments || '');
    const stats = patchStats(patch);
    const target = stats.files.length ? stats.files.join(', ') : 'files';
    const delta = stats.added || stats.removed ? ` +${stats.added} -${stats.removed}` : '';
    return `${options.complete ? '已编辑' : '正在编辑'} ${target}${delta}`;
  }

  if (name === 'write_stdin') return 'Read command output';
  if (name === 'view_image') return `View image${args.path ? ` ${shortPath(args.path)}` : ''}`;
  if (name === 'read_mcp_resource') return `Read resource${args.uri ? ` ${shortPath(args.uri)}` : ''}`;
  if (name.includes('browser') || name.includes('chrome')) return 'Check browser page';
  return `${rawName}${Object.keys(args).length ? ` ${truncateText(JSON.stringify(args), 120)}` : ''}`;
}

function toolStepTypeFromCall(payload) {
  const rawName = String(payload.name || 'tool');
  const name = rawName.split('.').pop();
  const args = parseToolArguments(payload);
  if (name === 'apply_patch') return 'edit';
  if (name === 'exec_command') {
    const cmd = String(args.cmd || args.raw || '').trim();
    if (extractCommandFiles(cmd).length) return 'read';
    if (/\b(?:rg|grep|find)\b/.test(cmd)) return 'search';
    if (/\bgit\s+diff\b/.test(cmd)) return 'diff';
    if (/\b(?:node --check|npm run check|npm test|pnpm test|yarn test)\b/.test(cmd)) return 'check';
    if (/\bgit\b/.test(cmd)) return 'git';
    return 'command';
  }
  if (name === 'write_stdin') return 'command';
  if (name === 'view_image') return 'preview';
  return 'tool';
}

function enrichToolStep(step, payload, options = {}) {
  return {
    ...step,
    toolType: toolStepTypeFromCall(payload),
    toolName: String(payload.name || '').split('.').pop() || 'tool',
    state: options.complete ? 'complete' : 'running',
  };
}

async function cdpApplyQueuedGuidanceToCodex(text, threadId = '', options = {}) {
  return withCodexCdp(async client => {
    let selected = { ok: true, skipped: true };
    if (threadId) {
      const active = await cdpReadActiveThreadFast(client).catch(error => ({ ok: false, error: String(error && error.message || error) }));
      if (active.ok && normalizeCodexDomThreadId(active.activeThreadId) === normalizeCodexDomThreadId(threadId)) {
        lastCodexThreadActivation = { threadId, at: Date.now() };
        selected = {
          ok: true,
          method: 'cdp-active-thread-fast-path',
          threadId,
          alreadyActive: true,
          fastPath: true,
          activeId: active.rawActiveThreadId || active.activeThreadId,
          activeThreadText: active.activeThreadText || '',
        };
        await delay(options.settleMs ?? CODEX_CDP_ACTIVE_THREAD_SETTLE_MS);
      } else {
        selected = await cdpClickThread(client, threadId, { settleMs: options.settleMs });
      }
    }
    const guidance = await cdpClickQueuedGuidanceButton(client, text);
    return { ok: Boolean(guidance?.ok), method: 'cdp-queued-guidance', selected, guidance };
  });
}


function contextUsageFromItems(items) {
  let windowTokens = 0;
  let latestUsage = null;
  let updatedAt = '';

  for (const item of items) {
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      const value = Number(payload.model_context_window || 0);
      if (Number.isFinite(value) && value > 0) windowTokens = value;
    }
    if (item.type !== 'event_msg' || payload.type !== 'token_count') continue;
    const info = payload.info || {};
    const value = Number(info.model_context_window || 0);
    if (Number.isFinite(value) && value > 0) windowTokens = value;
    const usage = info.last_token_usage || info.current_token_usage || null;
    if (usage && typeof usage === 'object') {
      latestUsage = usage;
      updatedAt = item.timestamp || updatedAt;
    }
  }

  if (!latestUsage || !windowTokens) {
    return {
      available: false,
      usedTokens: 0,
      windowTokens: windowTokens || 0,
      remainingTokens: windowTokens || 0,
      percent: null,
      updatedAt,
    };
  }

  const inputTokens = Number(latestUsage.input_tokens || 0) || 0;
  const outputTokens = Number(latestUsage.output_tokens || 0) || 0;
  const totalTokens = Number(latestUsage.total_tokens || 0) || 0;
  let usedTokens = totalTokens || (inputTokens + outputTokens) || inputTokens;
  if (usedTokens > windowTokens * 1.15 && inputTokens > 0 && inputTokens <= windowTokens * 1.15) {
    usedTokens = inputTokens + outputTokens;
  }
  usedTokens = Math.max(0, Math.round(usedTokens));
  const percent = Math.max(0, Math.min(100, (usedTokens / windowTokens) * 100));

  return {
    available: true,
    usedTokens,
    windowTokens,
    remainingTokens: Math.max(0, Math.round(windowTokens - usedTokens)),
    percent,
    updatedAt,
  };
}

function modelInfoFromId(modelId = '', updatedAt = '') {
  const id = String(modelId || '').trim();
  const target = Object.values(COMMON_MODEL_TARGETS).find(item => item.id === id);
  if (target) return { available: true, id, version: target.version, source: target.source, label: target.label, displayName: target.displayName, updatedAt };
  const option = findModelOption(id);
  if (option) return { ...option, available: true, updatedAt };

  if (id === 'gpt-5.5') return { available: true, id, version: '5.5', source: 'official', label: '5.5', displayName: 'GPT-5.5', updatedAt };
  if (id === 'gpt-5.4') return { available: true, id, version: '5.4', source: 'official', label: '5.4', displayName: 'GPT-5.4', updatedAt };
  if (id === 'gpt-5.4-mini') return { available: true, id, version: 'mini', source: 'official', label: 'mini', displayName: 'GPT-5.4 Mini', updatedAt };
  if (id === 'gpt-5.3-codex') return { available: true, id, version: '5.3', source: 'official', label: '5.3', displayName: 'GPT-5.3 Codex', updatedAt };
  if (id === 'gpt-5.2') return { available: true, id, version: '5.2', source: 'official', label: '5.2', displayName: 'GPT-5.2', updatedAt };

  return {
    available: Boolean(id),
    id,
    version: '',
    source: id.startsWith('gpt-') ? 'official' : id ? 'unknown' : '',
    label: '',
    displayName: id,
    updatedAt,
  };
}

function modelInfoFromDisplayName(displayName = '', updatedAt = '') {
  const text = String(displayName || '').replace(/\s+/g, ' ').trim();
  if (!text) return modelInfoFromId('', updatedAt);
  const bareVersionMatch = text.match(/^v?\d+(?:\.\d+)?(?:\s*pro)?$/i);
  if (bareVersionMatch) {
    const version = text.match(/\b(5\.\d+)\b/)?.[1] || text;
    if (version === '5.2' || version === '5.3') {
      return { available: true, id: `gpt-${version}`, version, source: 'official', label: version, displayName: text, updatedAt };
    }
    return { available: false, id: text, version: text, source: 'unknown', label: text, displayName: text, updatedAt };
  }
  const common = Object.values(COMMON_MODEL_TARGETS).find(item => item.displayName === text || item.id === text);
  if (common) return { available: true, id: common.id, version: common.version, source: common.source, label: common.label, displayName: common.displayName, updatedAt };
  const option = readModelCatalogOptions().find(item => item.displayName === text || item.id === text);
  if (option) return { ...option, available: true, updatedAt };
  const officialMatch = text.match(/^GPT-?(\d+(?:\.\d+)?)(?:[-\s]?(Mini|Codex))?/i);
  if (officialMatch) {
    const version = officialMatch[2] && /mini/i.test(officialMatch[2]) ? 'mini' : officialMatch[1];
    return { available: true, id: text.toLowerCase().replace(/\s+/g, '-'), version, source: 'official', label: version, displayName: text, updatedAt };
  }
  const officialShortMatch = text.match(/^(?:gpt[-\s]*)?(5\.\d+)(?:[-\s]?(Mini|Codex))?$/i);
  if (officialShortMatch && !/中转|LR_|CX_|mimo|deepseek|aimami_relay/i.test(text)) {
    const version = officialShortMatch[2] && /mini/i.test(officialShortMatch[2]) ? 'mini' : officialShortMatch[1];
    const suffix = officialShortMatch[2] ? `-${officialShortMatch[2].toLowerCase()}` : '';
    return { available: true, id: `gpt-${officialShortMatch[1]}${suffix}`, version, source: 'official', label: version, displayName: text, updatedAt };
  }
  return { available: true, id: text, version: '', source: /中转|LR_|CX_|mimo|deepseek/i.test(text) ? 'relay' : 'unknown', label: text, displayName: text, updatedAt };
}

function currentModelFromItems(items) {
  let modelId = '';
  let updatedAt = '';
  for (const item of items) {
    const payload = item.payload || {};
    if (item.type === 'session_meta' && payload.model) {
      modelId = payload.model;
      updatedAt = item.timestamp || payload.timestamp || updatedAt;
    }
    if (item.type === 'turn_context' && payload.model) {
      modelId = payload.model;
      updatedAt = item.timestamp || updatedAt;
    }
  }
  return modelInfoFromId(modelId, updatedAt);
}

function reasoningModeFromValue(value = '', updatedAt = '') {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    low: 'low',
    '低': 'low',
    medium: 'medium',
    med: 'medium',
    middle: 'medium',
    '中': 'medium',
    high: 'high',
    '高': 'high',
    xhigh: 'xhigh',
    'x-high': 'xhigh',
    'extra-high': 'xhigh',
    extreme: 'xhigh',
    max: 'xhigh',
    '超高': 'xhigh',
    '极高': 'xhigh',
  };
  const key = aliases[raw] || '';
  const target = key ? REASONING_MODE_TARGETS[key] : null;
  return {
    available: Boolean(target || raw),
    key: target?.key || '',
    value: target?.value || raw,
    label: target?.label || '',
    displayName: target?.displayName || value || '',
    updatedAt,
  };
}

function currentReasoningModeFromItems(items) {
  let value = '';
  let updatedAt = '';
  for (const item of items) {
    const payload = item.payload || {};
    const settings = payload.collaboration_mode && typeof payload.collaboration_mode === 'object'
      ? payload.collaboration_mode.settings || {}
      : {};
    const reasoning = payload.reasoning && typeof payload.reasoning === 'object' ? payload.reasoning : {};
    const next = payload.reasoning_effort || payload.reasoningMode || payload.reasoning_mode || settings.reasoning_effort || reasoning.effort || '';
    if (item.type === 'turn_context' && next) {
      value = next;
      updatedAt = item.timestamp || updatedAt;
    }
  }
  return reasoningModeFromValue(value, updatedAt);
}

function stepFromEvent(item) {
  const payload = item.payload || {};
  if (item.type === 'event_msg') {
    const failureText = extractFailureTextFromPayload(payload);
    if (failureText) return { kind: 'error', label: '失败', text: failureText, time: item.timestamp };
    if (payload.type === 'task_started') return { kind: 'start', label: '开始', text: '开始处理这条消息', time: item.timestamp };
    if (payload.type === 'task_complete') return { kind: 'complete', label: '完成', text: '回复完成', time: item.timestamp };
    if (payload.type === 'patch_apply_end') {
      return {
        kind: 'tool',
        label: '工具',
        text: formatPatchApplyEnd(payload),
        callId: payload.call_id || '',
        toolType: 'edit',
        toolName: 'apply_patch',
        state: 'complete',
        time: item.timestamp,
      };
    }
    if (payload.type === 'agent_message' && payload.message) {
      const text = sanitizeAssistantHistoryText(payload.message);
      return text ? { kind: 'thinking', label: '思考', text, time: item.timestamp } : null;
    }
    return null;
  }

  if (item.type === 'response_item') {
    if (payload.type === 'custom_tool_call') {
      const toolPayload = {
        ...payload,
        arguments: payload.input || payload.arguments || '',
      };
      return enrichToolStep({ kind: 'tool', label: '工具', text: formatToolCall(toolPayload), callId: payload.call_id || '', time: item.timestamp }, toolPayload);
    }
    if (payload.type === 'reasoning') {
      const text = extractReasoningText(payload);
      return text ? { kind: 'thinking', label: '思考', text, time: item.timestamp } : null;
    }
    if (payload.type === 'function_call') {
      return enrichToolStep({ kind: 'tool', label: '工具', text: formatToolCall(payload), callId: payload.call_id || '', time: item.timestamp }, payload);
    }
    if (payload.type === 'message') {
      const text = sanitizeAssistantHistoryText(extractMessageText(payload.content));
      if (text && payload.role === 'assistant' && payload.phase === 'commentary') return { kind: 'thinking', label: '思考', text: truncateText(text, 1200), time: item.timestamp };
      if (text && payload.role === 'assistant') return { kind: payload.phase === 'final_answer' ? 'final' : 'assistant', label: '回复', text: truncateText(text, 1200), time: item.timestamp };
    }
  }
  return null;
}

function parseCodexStatus(options = {}) {
  const sinceMs = options.since ? Date.parse(options.since) : 0;
  const sinceSkewMs = Math.max(0, Math.min(Number(options.sinceSkewMs) || 0, 30 * 60 * 1000));
  const effectiveSinceMs = sinceMs ? Math.max(0, sinceMs - sinceSkewMs) : 0;
  const includeGuidanceMessages = options.guidance === true;
  const wantsExactSession = Boolean(options.threadId || options.sessionFile);
  const requestedFile = options.file || (options.threadId ? findCodexSessionFileByThreadId(options.threadId) : options.sessionFile ? findCodexSessionFileByName(options.sessionFile) : null);
  const file = requestedFile || (wantsExactSession ? null : findLatestCodexSessionFile({
    afterMs: options.expectNewThread ? sinceMs : 0,
    excludeThreadId: options.excludeThreadId || '',
    cwd: options.cwd || '',
  }));
  if (!file) {
    return {
      ok: true,
      available: false,
      active: Boolean(options.expectNewThread && sinceMs),
      status: wantsExactSession ? 'missing' : options.expectNewThread && sinceMs ? 'waiting' : 'idle',
      threadId: options.threadId || '',
      sessionFile: options.sessionFile || '',
      remote: Boolean(options.remote),
      remoteHostId: options.remoteHostId || '',
      remoteAlias: options.remoteAlias || '',
      remoteSessionFile: options.remoteSessionFile || '',
      message: wantsExactSession ? '没有找到所选线程的 Codex 会话文件。' : '还没有找到 Codex 会话文件。',
      steps: [],
      preview: options.expectNewThread && sinceMs ? '已发送，等待 Codex 创建新线程记录…' : '还没有找到这个线程的回复记录。',
      final: '',
      durationMs: 0,
    };
  }

  const rawItems = [];
  for (const line of readStatusLines(file)) {
    try { rawItems.push(JSON.parse(line)); } catch { /* ignore partial/corrupt lines */ }
  }

  let startIndex = -1;
  if (sinceMs) {
    for (let i = 0; i < rawItems.length; i += 1) {
      const t = Date.parse(rawItems[i].timestamp || '');
      if (Number.isFinite(t) && t >= sinceMs) {
        startIndex = i;
        break;
      }
    }
  }
  if (startIndex < 0 && effectiveSinceMs && effectiveSinceMs !== sinceMs) {
    for (let i = 0; i < rawItems.length; i += 1) {
      const t = Date.parse(rawItems[i].timestamp || '');
      if (Number.isFinite(t) && t >= effectiveSinceMs) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex < 0) {
    for (let i = rawItems.length - 1; i >= 0; i -= 1) {
      if (rawItems[i].type === 'event_msg' && rawItems[i].payload && rawItems[i].payload.type === 'task_started') {
        startIndex = i;
        break;
      }
    }
  }
  if (startIndex < 0) startIndex = Math.max(0, rawItems.length - 80);

  // If watching a specific send, begin at the first task_started after that send when possible.
  if (sinceMs) {
    let exactTaskStartIndex = -1;
    for (let i = startIndex; i < rawItems.length; i += 1) {
      const item = rawItems[i];
      const t = Date.parse(item.timestamp || '');
      if (Number.isFinite(t) && t >= sinceMs && item.type === 'event_msg' && item.payload && item.payload.type === 'task_started') {
        exactTaskStartIndex = i;
        break;
      }
    }
    if (exactTaskStartIndex >= 0) {
      startIndex = exactTaskStartIndex;
    } else if (effectiveSinceMs && effectiveSinceMs !== sinceMs) {
      let skewedTaskStartIndex = -1;
      for (let i = startIndex; i < rawItems.length; i += 1) {
        const item = rawItems[i];
        const t = Date.parse(item.timestamp || '');
        if (Number.isFinite(t) && t >= effectiveSinceMs && item.type === 'event_msg' && item.payload && item.payload.type === 'task_started') {
          skewedTaskStartIndex = i;
        }
      }
      if (skewedTaskStartIndex >= 0) startIndex = skewedTaskStartIndex;
    }
  }

  const turnItems = rawItems.slice(startIndex).filter(item => {
    if (!sinceMs) return true;
    const t = Date.parse(item.timestamp || '');
    return !Number.isFinite(t) || t >= effectiveSinceMs;
  });
  const allUserEventFingerprints = new Set();
  for (const item of rawItems) {
    const payload = item.payload || {};
    if (item.type !== 'event_msg' || payload.type !== 'user_message') continue;
    const fingerprint = normalizeHistoryMessageFingerprint(cleanUserHistoryText(payload.message || ''));
    if (fingerprint) allUserEventFingerprints.add(fingerprint);
  }

  let active = Boolean(sinceMs);
  let completed = false;
  let turnId = null;
  let final = '';
  let preview = '';
  let startedAt = '';
  let completedAt = '';
  let sawTaskStarted = false;
  let failureText = '';
  let emptyComplete = false;
  let turnUserMessage = '';
  let turnUserMessageAt = '';
  let turnUserLabel = '';
  let turnUserAttachments = [];
  const guidanceMessages = [];
  const turnUserEventFingerprints = new Set(allUserEventFingerprints);
  const steps = [];
  const seenThinking = new Set();
  const toolCallsById = new Map();
  const toolStepIndexById = new Map();
  const generatedAttachments = [];

  for (const item of turnItems) {
    const payload = item.payload || {};
    failureText = failureText || extractFailureTextFromPayload(payload);
    if (item.type === 'event_msg' && payload.type === 'task_started') {
      active = true;
      sawTaskStarted = true;
      turnId = payload.turn_id || turnId;
      startedAt = startedAt || item.timestamp || '';
    }
    if (item.type === 'turn_context') turnId = payload.turn_id || turnId;
    if (item.type === 'event_msg' && payload.type === 'user_message') {
      // 桌面端直接发送的消息也写在这轮日志里，带回手机端补成用户气泡
      const userText = cleanUserHistoryText(payload.message || '');
      const userAttachments = extractUserAttachments(payload).map(historyAttachmentFromPath);
      if (userText || userAttachments.length) {
        const fingerprint = normalizeHistoryMessageFingerprint(userText);
        if (fingerprint) turnUserEventFingerprints.add(fingerprint);
        turnUserMessage = userText || ' ';
        turnUserMessageAt = item.timestamp || '';
        turnUserLabel = userAttachments.length ? `你 · ${summarizeHistoryAttachmentKinds(userAttachments)}` : '你';
        turnUserAttachments = userAttachments;
      }
    }
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      active = false;
      completed = true;
      completedAt = item.timestamp || completedAt;
      const rawLastMessage = normalizeHistoryText(payload.last_agent_message || '');
      const lastMessage = sanitizeAssistantHistoryText(rawLastMessage);
      final = lastMessage || final;
      if (!lastMessage && !final && !preview && sawTaskStarted && !isInternalCodexHandoffText(rawLastMessage)) emptyComplete = true;
    }
    if (item.type === 'event_msg' && isTerminalFailurePayload(payload)) {
      active = false;
      completed = true;
      completedAt = item.timestamp || completedAt;
      turnId = payload.turn_id || turnId;
    }

    if (item.type === 'event_msg') {
      const generated = generatedImageAttachmentsFromEvent(payload, threadIdFromSessionFile(file));
      if (generated.length) generatedAttachments.push(...generated);
    }

    if (includeGuidanceMessages && item.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const text = cleanUserHistoryText(extractMessageText(payload.content));
      const fingerprint = normalizeHistoryMessageFingerprint(text);
      if (text && !isSyntheticCodexUserMessage(text) && fingerprint && !turnUserEventFingerprints.has(fingerprint)) {
        turnUserEventFingerprints.add(fingerprint);
        guidanceMessages.push({
          role: 'user',
          label: '你 · 引导',
          text,
          timestamp: item.timestamp || '',
          guidance: true,
        });
      }
    }

    let completedExistingToolStep = false;
    if (
      (
        (item.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) ||
        (item.type === 'event_msg' && payload.type === 'patch_apply_end')
      ) &&
      payload.call_id &&
      toolStepIndexById.has(payload.call_id)
    ) {
      const callPayload = toolCallsById.get(payload.call_id);
      const stepIndex = toolStepIndexById.get(payload.call_id);
      if (callPayload && steps[stepIndex]) {
        steps[stepIndex].state = 'complete';
        if (item.type === 'event_msg' && payload.type === 'patch_apply_end') {
          steps[stepIndex].text = formatPatchApplyEnd(payload);
          steps[stepIndex].toolType = 'edit';
        } else if (String(callPayload.name || '').split('.').pop() === 'apply_patch') {
          steps[stepIndex].text = formatToolCall(callPayload, { complete: true });
        }
      }
      completedExistingToolStep = item.type === 'event_msg' && payload.type === 'patch_apply_end';
      const generated = generatedImageAttachmentsFromToolOutput(payload, callPayload?.name || '', threadIdFromSessionFile(file));
      if (generated.length) generatedAttachments.push(...generated);
    }

    if (completedExistingToolStep) continue;
    const step = stepFromEvent(item);
    if (!step) continue;
    if (step.kind === 'thinking') {
      const key = step.text || 'thinking';
      if (seenThinking.has(key)) continue;
      seenThinking.add(key);
    }
    if ((step.kind === 'assistant' || step.kind === 'final') && step.text) preview = step.text;
    if (step.kind === 'final' && step.text) final = step.text;
    if (['start', 'thinking', 'tool', 'complete', 'error'].includes(step.kind)) {
      if (step.kind === 'tool' && step.callId) {
        toolCallsById.set(step.callId, payload);
        toolStepIndexById.set(step.callId, steps.length);
      }
      steps.push(step);
    }
  }

  const context = contextUsageFromItems(rawItems);
  const model = currentModelFromItems(rawItems);
  const reasoningMode = currentReasoningModeFromItems(rawItems);
  const threadId = threadIdFromSessionFile(file);
  const failed = completed && !final && (emptyComplete || Boolean(failureText));
  const finalFailureText = failed
    ? (resolveFailureTextForTurn(threadId, { turnId, startedAt, completedAt, failureText }) || emptyCodexFailureText())
    : '';
  const statusSteps = steps.slice(-30);
  if (failed && finalFailureText && !statusSteps.some(step => step.kind === 'error' && step.text === finalFailureText)) {
    statusSteps.push({ kind: 'error', label: '失败', text: finalFailureText, time: completedAt || new Date(fs.statSync(file).mtimeMs).toISOString() });
  }
  const lastStep = statusSteps[statusSteps.length - 1] || steps[steps.length - 1];
  const status = failed ? 'error' : completed ? 'complete' : active ? 'running' : 'idle';
  const waiting = sinceMs && !steps.length;
  const startMs = Date.parse(startedAt || '') || sinceMs || 0;
  const endMs = completedAt ? Date.parse(completedAt) : Date.now();
  const durationMs = startMs ? Math.max(0, endMs - startMs) : 0;
  const visiblePreview = final || preview || finalFailureText || (waiting ? '已发送，等待 Codex 开始回复…' : active ? 'Codex 正在回复…' : '暂无可显示回复。');
  const attachments = mergeAttachmentRows([...generatedAttachments, ...extractResponseAttachments(final || preview || finalFailureText || '', threadId)]);
  const visibleFinal = final ? stripResponseAttachmentReferences(final) : final;
  const cleanedPreview = stripResponseAttachmentReferences(visiblePreview) || (attachments.length ? ' ' : (final ? '' : visiblePreview));
  return {
    ok: true,
    available: true,
    active: waiting ? true : active,
    status: waiting ? 'waiting' : status,
    turnId,
    sessionFile: path.basename(file),
    threadId,
    remote: Boolean(options.remote),
    remoteHostId: options.remoteHostId || '',
    remoteAlias: options.remoteAlias || '',
    remoteSessionFile: options.remoteSessionFile || '',
    updatedAt: lastStep ? lastStep.time : new Date(fs.statSync(file).mtimeMs).toISOString(),
    startedAt,
    completedAt,
    durationMs,
    context,
    model,
    reasoningMode,
    processText: statusSteps.map(step => `${step.label || '事件'}：${step.text || ''}`).join('\\n'),
    preview: cleanedPreview,
    final: visibleFinal || '',
    error: finalFailureText,
    attachments,
    steps: statusSteps,
    turnUserMessage,
    turnUserMessageAt,
    turnUserLabel,
    turnUserAttachments,
    guidanceMessages: includeGuidanceMessages ? guidanceMessages : [],
  };
}

async function handleCodexStatus(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const options = {
      since: url.searchParams.get('since') || '',
      sessionFile: url.searchParams.get('session') || '',
      threadId: url.searchParams.get('thread') || '',
      expectNewThread: url.searchParams.get('expectNewThread') === '1',
      excludeThreadId: url.searchParams.get('excludeThread') || '',
      cwd: url.searchParams.get('cwd') || '',
      guidance: url.searchParams.get('guidance') === '1',
    };
    const localStatus = parseCodexStatus(options);
    if (localStatus.available || !options.threadId || options.expectNewThread) {
      return json(res, 200, localStatus);
    }
    const remoteOptions = await remoteCodexStatusOptions(options.threadId);
    if (!remoteOptions) return json(res, 200, localStatus);
    return json(res, 200, parseCodexStatus({ ...options, ...remoteOptions }));
  } catch (error) {
    return json(res, 500, { ok: false, code: 'CODEX_STATUS_FAILED', message: '读取 Codex 回复状态失败。', detail: String(error && error.message || error) });
  }
}

async function handleCodexGuiStatus(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const threadId = url.searchParams.get('thread') || '';
    if (threadId && !isCodexThreadId(threadId)) {
      return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
    }
    const status = await cdpReadShared(`gui-status:${threadId}`, 1200, () => cdpReadCodexGuiStatus(threadId));
    return json(res, 200, status);
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '读取 Codex CDP Worker 当前模型/推理状态失败。' });
  }
}

async function handleSelectThread(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  if (!isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    await activateCodexThread(threadId);
    return json(res, 200, { ok: true, threadId, message: '已切换到所选 Codex 线程。' });
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}


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
    ...corsHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-mobile-typer-token',
    'access-control-allow-private-network': 'true',
  };
}

function options(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (MAX_BODY_BYTES > 0 && size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求内容太大，请减少附件或分批发送。'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromHeader = req.headers['x-mobile-typer-token'];
  const fromQuery = url.searchParams.get('token');
  const fromCookie = parseCookies(req.headers.cookie || '').codexMiniToken;
  if (fromHeader === TOKEN || fromQuery === TOKEN || fromCookie === TOKEN) return true;
  return false;
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

function cleanupRecentSendRequests() {
  const cutoff = Date.now() - RECENT_SEND_TTL_MS;
  for (const [id, entry] of recentSendRequests) {
    if (!entry || entry.createdAt < cutoff) recentSendRequests.delete(id);
  }
}

function cleanupUploadCache(now = Date.now()) {
  if (!Number.isFinite(UPLOAD_CACHE_RETENTION_MS) || UPLOAD_CACHE_RETENTION_MS <= 0) return;
  let entries;
  try { entries = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }); } catch { return; }
  const cutoff = now - UPLOAD_CACHE_RETENTION_MS;
  for (const entry of entries) {
    const filePath = path.join(UPLOAD_DIR, entry.name);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    const lastTouched = stat.mtimeMs || 0;
    if (!lastTouched || lastTouched >= cutoff) continue;
    try { fs.rmSync(filePath, { recursive: true, force: true }); } catch {}
  }
}

function startUploadCacheCleanup() {
  cleanupUploadCache();
  if (!Number.isFinite(UPLOAD_CACHE_CLEANUP_INTERVAL_MS) || UPLOAD_CACHE_CLEANUP_INTERVAL_MS <= 0) return;
  setInterval(cleanupUploadCache, UPLOAD_CACHE_CLEANUP_INTERVAL_MS).unref?.();
}

function normalizeClientRequestId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9._:-]{8,120}$/.test(id) ? id : '';
}

function explainTargetError(error, target) {
  const raw = String(error && (error.message || error.stderr) || '');
  if (target === 'codex') {
    if (error && error.code === CONTROLLED_CODEX_ABNORMAL_CODE) {
      return {
        code: CONTROLLED_CODEX_ABNORMAL_CODE,
        message: CONTROLLED_CODEX_ABNORMAL_MESSAGE,
        detail: raw,
      };
    }
    return {
      code: 'CODEX_CDP_FAILED',
      message: '已经收到请求，但没能通过 CDP DOM 控制 Codex。请确认 Codex CDP Worker 正在运行，且 CDP 端口 39252 可连接。',
      detail: raw,
    };
  }
  return {
    code: 'UNSUPPORTED_TARGET',
    message: '当前版本已移除旧 macOS 自动化，只支持通过 CDP DOM 控制 Codex。',
    detail: raw,
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runCommandOutput(command, args = [], timeoutMs = 1200) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error });
    });
  });
}

function runCommandBuffer(command, args = [], timeoutMs = 1200, maxBuffer = 8 * 1024 * 1024) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer, encoding: 'buffer' }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || Buffer.alloc(0), stderr: stderr ? String(stderr) : '', error });
    });
  });
}

async function normalCodexProcessIsRunning() {
  const result = await runCommandOutput('/bin/ps', ['-axo', 'command='], 1400);
  const output = `${result.stdout}\n${result.stderr}`;
  return output.split('\n').some(line => {
    const command = line.trim();
    if (!command.includes(NORMAL_CODEX_EXECUTABLE_PATH)) return false;
    if (command.includes(CODEX_PLUS_APP_PATH_FRAGMENT)) return false;
    return true;
  });
}

function controlledCodexAbnormalError(cause) {
  const reason = String(cause && cause.message || cause || '').trim();
  const error = new Error(reason ? `${CONTROLLED_CODEX_ABNORMAL_MESSAGE}。${reason}` : CONTROLLED_CODEX_ABNORMAL_MESSAGE);
  error.code = CONTROLLED_CODEX_ABNORMAL_CODE;
  return error;
}

function hasFreshCodexThreadActivation(threadId) {
  return Boolean(
    isCodexThreadId(threadId) &&
    lastCodexThreadActivation.threadId === threadId &&
    Date.now() - lastCodexThreadActivation.at <= CODEX_THREAD_SYNC_FRESH_MS
  );
}

async function fetchJsonWithTimeout(url, timeoutMs = CODEX_CDP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function cdpHostForUrl(host = CODEX_CDP_HOST) {
  const raw = String(host || '').trim() || 'localhost';
  if (raw.startsWith('[') && raw.endsWith(']')) return raw;
  return raw.includes(':') ? `[${raw}]` : raw;
}

async function getCodexCdpPage() {
  const hostCandidates = [CODEX_CDP_HOST, '[::1]', '127.0.0.1', 'localhost']
    .map(cdpHostForUrl)
    .filter((host, index, list) => host && list.indexOf(host) === index);
  const errors = [];
  for (const host of hostCandidates) {
    try {
      const targets = await fetchJsonWithTimeout(`http://${host}:${CODEX_CDP_PORT}/json/list`, Math.min(CODEX_CDP_TIMEOUT_MS, 1500));
      const page = targets.find(target => target.type === 'page' && target.url === 'app://-/index.html')
        || targets.find(target => target.type === 'page' && String(target.url || '').startsWith('app://-/index.html'))
        || targets.find(target => target.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
      errors.push(`${host}: no page target`);
    } catch (error) {
      errors.push(`${host}: ${error.message || error}`);
    }
  }
  const fallbackError = new Error(`Codex CDP 页面不可用，请用 scripts/selfhost/codex-mini-selfhost.sh start 启动 Codex.app 的 CDP Worker，端口 ${CODEX_CDP_PORT}。尝试过：${errors.join('；')}`);
  if (await normalCodexProcessIsRunning().catch(() => false)) {
    throw controlledCodexAbnormalError(fallbackError);
  }
  throw fallbackError;
}

async function connectCodexCdp() {
  if (typeof WebSocket !== 'function') throw new Error('当前 Node 运行时不支持 WebSocket，无法连接 CDP。');
  // 页面目标能拿到说明 Codex 正在运行；WebSocket 握手 / Runtime.enable 的瞬时失败重试一次通常即可恢复
  let page = await getCodexCdpPage();
  try {
    return await openCodexCdpClient(page);
  } catch {
    await delay(150);
    page = await getCodexCdpPage();
    return openCodexCdpClient(page);
  }
}

async function openCodexCdpClient(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  const eventWaiters = new Map();
  ws.onmessage = event => {
    let message;
    try {
      message = JSON.parse(String(event.data || '{}'));
    } catch {
      return;
    }
    if (message.method && eventWaiters.has(message.method)) {
      const waiters = eventWaiters.get(message.method) || [];
      eventWaiters.delete(message.method);
      for (const waiter of waiters) waiter.resolve(message.params || {});
    }
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Codex CDP WebSocket 连接超时。')), CODEX_CDP_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = error => {
      clearTimeout(timer);
      reject(error);
    };
  }).catch(error => {
    try { ws.close(); } catch {}
    throw error;
  });
  const client = {
    page,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} 超时。`));
        }, CODEX_CDP_TIMEOUT_MS);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    waitForEvent(method, timeoutMs = CODEX_CDP_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        const wrapped = { resolve: null };
        const timer = setTimeout(() => {
          const waiters = (eventWaiters.get(method) || []).filter(item => item !== wrapped);
          if (waiters.length) eventWaiters.set(method, waiters);
          else eventWaiters.delete(method);
          reject(new Error(`CDP ${method} 事件超时。`));
        }, timeoutMs);
        wrapped.resolve = value => { clearTimeout(timer); resolve(value); };
        const waiters = eventWaiters.get(method) || [];
        waiters.push(wrapped);
        eventWaiters.set(method, waiters);
      });
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
  try {
    await client.call('Runtime.enable');
  } catch (error) {
    client.close();
    throw error;
  }
  await client.call('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  return client;
}

async function withCodexCdp(fn) {
  const client = await connectCodexCdp();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function cdpEvaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const exception = details.exception || {};
    const description = exception.description || exception.value || details.text || 'Codex CDP DOM 执行失败。';
    throw new Error(String(description).slice(0, 1200));
  }
  return result.result && result.result.value;
}

function normalizeCodexDomThreadId(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/[a-f0-9]{8}-[a-f0-9-]{27,}/i);
  if (match) return match[0];
  return text.replace(/^local:/, '').replace(/^cloud:/, '');
}

async function cdpReadActiveThreadFast(client) {
  const result = await cdpEvaluate(client, `(() => {
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
    const normalizeThreadId = value => String(value || '').trim().replace(/^local:/, '').replace(/^cloud:/, '');
    const activeRow = document.querySelector('[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id]')
      || document.querySelector('[aria-current="page"][data-app-action-sidebar-thread-id]')
      || document.querySelector('[aria-selected="true"][data-app-action-sidebar-thread-id]')
      || null;
    const rawActiveThreadId = activeRow ? (activeRow.getAttribute('data-app-action-sidebar-thread-id') || '') : '';
    const activeThreadId = normalizeThreadId(rawActiveThreadId);
    return {
      ok: Boolean(activeThreadId),
      activeThreadId,
      rawActiveThreadId,
      activeThreadText: activeRow ? normalize(activeRow.innerText || activeRow.textContent).slice(0, 180) : '',
    };
  })()`);
  return {
    ...result,
    activeThreadId: normalizeCodexDomThreadId(result?.activeThreadId || ''),
    rawActiveThreadId: result?.rawActiveThreadId || '',
  };
}

function codexMiniTitleStatusPayload() {
  const keep = keepAwakeStatus();
  return {
    appName: APP_NAME,
    apiBase: `http://127.0.0.1:${PORT}`,
    token: TOKEN,
    service: {
      online: true,
      label: 'Mini',
      fallbackLabel: 'Mini',
    },
    keepAwake: {
      available: Boolean(BETA_MODE),
      enabled: Boolean(keep.enabled),
      label: keep.enabled ? '保持亮屏已开启' : '已关闭保持亮屏',
    },
    updatedAt: new Date().toISOString(),
  };
}

function scheduleCodexMiniTitleStatusRefresh(options = {}) {
  const now = Date.now();
  if (!options.force && now - cdpTitleStatusLastAt < 1800) return;
  if (cdpTitleStatusRefreshInFlight) return;
  cdpTitleStatusRefreshInFlight = true;
  cdpTitleStatusLastAt = now;
  withCodexCdp(async client => {
    await cdpInjectCodexMiniTitleStatus(client);
  }).catch(() => {}).finally(() => {
    cdpTitleStatusRefreshInFlight = false;
  });
}

async function cdpInjectCodexMiniTitleStatus(client) {
  const payload = codexMiniTitleStatusPayload();
  return cdpEvaluate(client, `(() => {
    const payload = ${JSON.stringify(payload)};
    const ROOT_ID = 'codex-mini-title-status-root';
    const UI_VERSION = 'title-status-v20-fixed-titlebar-anchor-180-9-20260607';
    let host = document.getElementById(ROOT_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ROOT_ID;
      document.documentElement.appendChild(host);
    }
    host.style.cssText = [
      'position:fixed',
      'top:9px',
      'left:180px',
      'z-index:2147483647',
      'width:max-content',
      'height:26px',
      'pointer-events:auto',
      '-webkit-app-region:no-drag',
      'user-select:none'
    ].join(';');
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (root.__codexMiniUiVersion !== UI_VERSION) {
      if (host.__codexMiniCompactTimer) clearInterval(host.__codexMiniCompactTimer);
      if (host.__codexMiniCompactRaf) cancelAnimationFrame(host.__codexMiniCompactRaf);
      host.__codexMiniMutationObserver?.disconnect?.();
      host.__codexMiniFastListenersInstalled = false;
      root.innerHTML = \`
        <style>
          :host { all: initial; }
          .wrap {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 26px;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          .service-pill {
            height: 26px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 0 8px;
            border-radius: 999px;
            color: rgba(235, 255, 241, .96);
            background: rgba(43, 185, 84, .22);
            border: 1px solid rgba(74, 222, 128, .40);
            box-shadow: 0 0 14px rgba(34, 197, 94, .12), inset 0 1px 0 rgba(255,255,255,.10);
            font-size: 11.5px;
            font-weight: 750;
            line-height: 1;
            letter-spacing: -.18px;
            white-space: nowrap;
            pointer-events: auto;
            cursor: pointer;
            appearance: none;
            -webkit-app-region: no-drag;
          }
          .service-pill:hover { background: rgba(43, 185, 84, .30); border-color: rgba(74, 222, 128, .55); }
          .service-pill:active { transform: scale(.97); }
          .dot, .compact-dot {
            width: 7px;
            height: 7px;
            flex: 0 0 auto;
            border-radius: 999px;
            background: #3ee56f;
            box-shadow: 0 0 9px rgba(62, 229, 111, .75);
          }
          .compact-dot { display: none; width: 8px; height: 8px; }
          :host(.is-light) .service-pill {
            color: rgba(14, 111, 54, .98);
            background: rgba(241, 253, 246, .94);
            border-color: rgba(34, 197, 94, .50);
            box-shadow: 0 1px 5px rgba(15, 23, 42, .12), inset 0 1px 0 rgba(255,255,255,.88);
          }
          :host(.is-light) .dot, :host(.is-light) .compact-dot {
            background: #22c55e;
            box-shadow: 0 0 0 1px rgba(34, 197, 94, .24), 0 0 8px rgba(34, 197, 94, .42);
          }
          .keep-btn {
            width: 26px;
            height: 26px;
            box-sizing: border-box;
            display: inline-grid;
            place-items: center;
            padding: 0;
            border-radius: 999px;
            border: 1px solid rgba(185, 196, 211, .28);
            background: rgba(185, 196, 211, .10);
            color: rgba(232, 238, 247, .70);
            appearance: none;
            cursor: pointer;
            -webkit-app-region: no-drag;
            pointer-events: auto;
          }
          .keep-btn:hover { background: rgba(185, 196, 211, .16); }
          :host(.is-light) .keep-btn {
            color: rgba(30, 41, 59, .74);
            background: rgba(255, 255, 255, .84);
            border-color: rgba(100, 116, 139, .34);
            box-shadow: 0 1px 5px rgba(15, 23, 42, .10), inset 0 1px 0 rgba(255,255,255,.88);
          }
          :host(.is-light) .keep-btn:hover { background: rgba(248, 250, 252, .96); }
          .keep-btn:active { transform: scale(.93); }
          .keep-btn.is-on {
            color: rgba(31, 25, 9, .82);
            background: rgba(255, 230, 138, .88);
            border-color: rgba(255, 230, 138, .48);
            box-shadow: 0 0 16px rgba(255, 214, 138, .22);
          }
          .keep-btn.is-busy { opacity: .62; cursor: wait; }
          .keep-btn[hidden] { display: none; }
          .keep-btn svg { width: 14px; height: 14px; display: block; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; }
          :host(.is-compact) { pointer-events: none; }
          :host(.is-compact) .wrap { display: none; }
        </style>
        <div class="wrap" part="wrap">
          <span class="compact-dot" title="Mini"></span>
          <span class="service-pill" data-service title="Codex Mini Selfhost 正在运行" role="status" aria-label="Codex Mini Selfhost 正在运行"><span class="dot"></span><span data-service-text>Mini</span></span>
        </div>
      \`;
      const keepButton = root.querySelector('[data-keep]');
      keepButton?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const state = window.__codexMiniTitleStatusPayload || payload;
        if (!state.keepAwake?.available || keepButton.classList.contains('is-busy')) return;
        const nextEnabled = !state.keepAwake.enabled;
        keepButton.classList.add('is-busy');
        const nextState = {
          ...state,
          keepAwake: {
            ...state.keepAwake,
            enabled: nextEnabled,
            label: nextEnabled ? '保持亮屏已开启' : '已关闭保持亮屏',
          },
          updatedAt: new Date().toISOString(),
        };
        window.__codexMiniTitleStatusUpdate?.(nextState);
        window.__codexMiniKeepAwakeRequest = {
          id: String(Date.now()) + '-' + Math.random().toString(36).slice(2),
          enabled: nextEnabled,
          at: Date.now(),
        };
        const done = () => keepButton.classList.remove('is-busy');
        setTimeout(done, 1100);
      }, { capture: true });
      root.__codexMiniUiVersion = UI_VERSION;
    }
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const updateCapsuleTone = () => {
      const html = document.documentElement;
      const dark = html.classList.contains('electron-dark') || html.classList.contains('dark');
      const light = html.classList.contains('electron-light') || html.classList.contains('light') || (!dark && window.matchMedia?.('(prefers-color-scheme: light)')?.matches);
      host.classList.toggle('is-light', Boolean(light));
    };
    const restoreSidebarShift = () => {
      const shiftedNodes = [...document.querySelectorAll('[data-codex-mini-sidebar-shifted]')];
      const remembered = window.__codexMiniSidebarShiftRoot;
      if (remembered && remembered.isConnected && !shiftedNodes.includes(remembered)) shiftedNodes.push(remembered);
      for (const shifted of shiftedNodes) {
        shifted.style.transform = shifted.dataset.codexMiniOriginalTransform || '';
        shifted.style.transition = shifted.dataset.codexMiniOriginalTransition || '';
        shifted.removeAttribute('data-codex-mini-sidebar-shifted');
        delete shifted.dataset.codexMiniOriginalTransform;
        delete shifted.dataset.codexMiniOriginalTransition;
      }
      window.__codexMiniSidebarShiftRoot = null;
    };
    const fixedTitleStatusPosition = () => ({ left: 180, top: 9 });
    const updateCompact = () => {
      updateCapsuleTone();
      restoreSidebarShift();
      const visibleThreads = [...document.querySelectorAll('[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]')]
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return visible(el) && rect.left < 280 && rect.width > 120 && rect.top > 40;
        });
      const navButtons = [...document.querySelectorAll('button')]
        .filter(el => {
          const rect = el.getBoundingClientRect();
          const text = String(el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
          return visible(el) && rect.left < 100 && rect.width > 96 && rect.top > 36 && /快速对话|新对话|搜索|插件|自动化/.test(text);
        })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const sidebarExpanded = navButtons.length >= 2 || visibleThreads.length > 0;
      host.classList.toggle('is-compact', !sidebarExpanded);
      if (!sidebarExpanded) {
        host.style.display = 'none';
        return;
      }
      host.classList.remove('is-compact');
      host.style.display = 'block';
      const position = fixedTitleStatusPosition();
      host.style.left = position.left + 'px';
      host.style.top = position.top + 'px';
    };
    const scheduleCompactUpdate = () => {
      if (host.__codexMiniCompactRaf) cancelAnimationFrame(host.__codexMiniCompactRaf);
      host.__codexMiniCompactRaf = requestAnimationFrame(() => {
        host.__codexMiniCompactRaf = 0;
        updateCompact();
      });
    };
    if (host.__codexMiniCompactTimer) clearInterval(host.__codexMiniCompactTimer);
    host.__codexMiniCompactTimer = setInterval(updateCompact, 80);
    if (!host.__codexMiniFastListenersInstalled) {
      window.addEventListener('resize', scheduleCompactUpdate, { passive: true });
      document.addEventListener('click', () => {
        scheduleCompactUpdate();
        setTimeout(scheduleCompactUpdate, 40);
        setTimeout(scheduleCompactUpdate, 120);
        setTimeout(scheduleCompactUpdate, 260);
      }, true);
      const observer = new MutationObserver(() => scheduleCompactUpdate());
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-expanded', 'aria-hidden', 'data-state'] });
      host.__codexMiniMutationObserver = observer;
      host.__codexMiniFastListenersInstalled = true;
    }
    window.__codexMiniTitleStatusUpdate = nextPayload => {
      window.__codexMiniTitleStatusPayload = nextPayload;
      const keepButton = root.querySelector('[data-keep]');
      const serviceText = root.querySelector('[data-service-text]');
      if (serviceText) serviceText.textContent = nextPayload.service?.online ? (nextPayload.service?.label || 'Mini') : (nextPayload.service?.fallbackLabel || 'Mini');
      if (keepButton) {
        const available = Boolean(nextPayload.keepAwake?.available);
        const enabled = Boolean(nextPayload.keepAwake?.enabled);
        keepButton.hidden = !available;
        keepButton.classList.toggle('is-on', enabled);
        const label = nextPayload.keepAwake?.label || (enabled ? '保持亮屏已开启' : '已关闭保持亮屏');
        keepButton.title = label;
        keepButton.setAttribute('aria-label', label);
      }
      updateCompact();
    };
    window.__codexMiniTitleStatusUpdate(payload);
    return { ok: true, injected: true, keepAwake: payload.keepAwake, version: UI_VERSION };
  })()`);
}

function startCodexMiniTitleStatusWatcher() {
  if (cdpTitleStatusWatcherStarted || !BETA_MODE) return;
  cdpTitleStatusWatcherStarted = true;
  setInterval(() => {
    pollCodexMiniTitleStatusRequest().catch(() => {});
  }, 900).unref?.();
}

async function pollCodexMiniTitleStatusRequest() {
  if (cdpTitleStatusWatcherBusy) return;
  cdpTitleStatusWatcherBusy = true;
  try {
    const requests = await withCodexCdp(client => cdpEvaluate(client, `(() => {
      const keepReq = window.__codexMiniKeepAwakeRequest || null;
      const result = { keepAwake: null };
      if (keepReq && keepReq.id) {
        result.keepAwake = { id: String(keepReq.id), enabled: Boolean(keepReq.enabled), at: Number(keepReq.at || 0) };
        window.__codexMiniKeepAwakeRequestHandledId = result.keepAwake.id;
        window.__codexMiniKeepAwakeRequest = null;
      }
      return result.keepAwake ? result : null;
    })()`));
    const request = requests?.keepAwake || null;
    if (!request || !request.id || request.id === cdpTitleStatusLastRequestId) return;
    cdpTitleStatusLastRequestId = request.id;
    request.enabled ? startKeepAwake() : stopKeepAwake();
    scheduleCodexMiniTitleStatusRefresh({ force: true });
  } finally {
    cdpTitleStatusWatcherBusy = false;
  }
}

async function cdpReadCodexGuiStatus(threadId = '') {
  return withCodexCdp(async client => {
    await cdpInjectCodexMiniTitleStatus(client).catch(() => null);
    const result = await cdpEvaluate(client, `(() => {
      const wantedThreadId = ${jsLiteral(threadId)};
      const visible = ${cdpVisibleHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const normalizeThreadId = value => String(value || '').trim().replace(/^local:/, '').replace(/^cloud:/, '');
      const reasoningLabels = ['极低', '低', '中', '高', '超高'];
      const permissionLabels = ['请求批准', '替我审批', '完全访问权限', '完全访问', '自定义 (config.toml)', '自定义'];
      const activeRow = [...document.querySelectorAll('[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]')]
        .filter(el => el.getAttribute('role') === 'button' || el.hasAttribute('data-app-action-sidebar-thread-row'))
        .find(el => el.getAttribute('data-app-action-sidebar-thread-active') === 'true' || el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-selected') === 'true') || null;
      const rawActiveThreadId = activeRow ? (activeRow.getAttribute('data-app-action-sidebar-thread-id') || '') : '';
      const activeThreadId = normalizeThreadId(rawActiveThreadId);
      const activeThreadText = activeRow ? normalize(activeRow.innerText).slice(0, 180) : '';
      const triggers = [...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
        .filter(visible)
        .map(button => ({ text: normalize(button.innerText), rect: button.getBoundingClientRect() }))
        .filter(item => item.text)
        .sort((a, b) => b.rect.y - a.rect.y || b.rect.x - a.rect.x);
      const footerText = triggers[0]?.text || '';
      const footerParts = footerText.split(' ').filter(Boolean);
      const maybeReasoning = footerParts[footerParts.length - 1] || '';
      const reasoningLabel = reasoningLabels.includes(maybeReasoning) ? maybeReasoning : '';
      const modelDisplayName = reasoningLabel ? footerParts.slice(0, -1).join(' ') : footerText;
      const permissionButton = [...document.querySelectorAll('button')]
        .filter(visible)
        .map(button => ({ text: normalize(button.innerText), rect: button.getBoundingClientRect() }))
        .filter(item => permissionLabels.some(label => item.text === label || item.text.includes(label)) && item.rect.y > window.innerHeight * 0.45)
        .sort((a, b) => b.rect.y - a.rect.y || a.rect.x - b.rect.x)[0] || null;
      const permissionText = permissionButton ? permissionButton.text : '';
      const scrollers = [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll('*')]
        .filter(el => {
          try { return el && el.scrollLeft > 0; } catch { return false; }
        })
        .map(el => ({ tag: el.tagName || '', id: el.id || '', className: String(el.className || '').slice(0, 80), scrollLeft: el.scrollLeft }))
        .slice(0, 20);
      return {
        ok: true,
        activeThreadId,
        rawActiveThreadId,
        activeThreadText,
        requestedThreadId: wantedThreadId,
        activeThreadMatches: wantedThreadId ? activeThreadId === wantedThreadId : null,
        footerText,
        modelDisplayName,
        reasoningLabel,
        permissionText,
        triggerCount: triggers.length,
        scrollers,
      };
    })()`);
    const updatedAt = new Date().toISOString();
    return {
      ok: true,
      available: Boolean(result && result.ok),
      ...(result || {}),
      activeThreadId: normalizeCodexDomThreadId(result?.activeThreadId || ''),
      requestedThreadId: normalizeCodexDomThreadId(threadId || result?.requestedThreadId || ''),
      activeThreadMatches: threadId ? normalizeCodexDomThreadId(result?.activeThreadId || '') === normalizeCodexDomThreadId(threadId) : result?.activeThreadMatches,
      model: modelInfoFromDisplayName(result?.modelDisplayName || '', updatedAt),
      reasoningMode: reasoningModeFromValue(result?.reasoningLabel || '', updatedAt),
      permissionMode: permissionModeFromDisplayName(result?.permissionText || '', updatedAt),
      updatedAt,
    };
  });
}

function permissionModeFromDisplayName(value = '', updatedAt = new Date().toISOString()) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const compact = text.toLowerCase();
  if (/config\.toml|自定义/.test(compact)) return { ...PERMISSION_MODE_TARGETS.custom, available: true, displayText: text || PERMISSION_MODE_TARGETS.custom.label, updatedAt };
  if (/完全访问/.test(text) || /full access/i.test(text)) return { ...PERMISSION_MODE_TARGETS.full, available: true, displayText: text || PERMISSION_MODE_TARGETS.full.label, updatedAt };
  if (/替我审批/.test(text) || /auto|suggest/i.test(text)) return { ...PERMISSION_MODE_TARGETS.auto, available: true, displayText: text || PERMISSION_MODE_TARGETS.auto.label, updatedAt };
  if (/请求批准|请求审批/.test(text) || /ask/i.test(text)) return { ...PERMISSION_MODE_TARGETS.request, available: true, displayText: text || PERMISSION_MODE_TARGETS.request.label, updatedAt };
  return { key: 'unknown', label: text || '未知', displayName: text || '未知', available: false, displayText: text, updatedAt };
}

async function cdpSwitchPermissionMode(threadId = '', targetKey = '') {
  const target = PERMISSION_MODE_TARGETS[String(targetKey || '').trim()] || null;
  if (!target) {
    const error = new Error('权限模式不正确。');
    error.status = 400;
    error.code = 'BAD_PERMISSION_MODE';
    throw error;
  }
  return withCodexCdp(async client => {
    const selected = threadId ? await cdpClickThread(client, threadId, { settleMs: 180 }) : { ok: true, skipped: true };
    const result = await cdpEvaluate(client, `(async () => {
      const target = ${JSON.stringify(target)};
      const allTargets = ${JSON.stringify(PERMISSION_MODE_TARGETS)};
      const visible = ${cdpVisibleHelperSource()};
      const domClick = ${cdpDomClickHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const labels = Object.values(allTargets).flatMap(item => [item.label, item.displayName, ...(item.aliases || [])]).filter(Boolean);
      const matchesAnyMode = text => labels.some(label => normalize(text) === normalize(label) || normalize(text).includes(normalize(label)));
      const matchesTarget = text => [target.label, target.displayName, ...(target.aliases || [])].filter(Boolean).some(label => normalize(text) === normalize(label) || normalize(text).includes(normalize(label)));
      const getTrigger = () => [...document.querySelectorAll('button')]
        .filter(visible)
        .map(button => ({ button, text: normalize(button.innerText || button.getAttribute('aria-label') || button.title), rect: button.getBoundingClientRect() }))
        .filter(item => item.text && matchesAnyMode(item.text) && item.rect.y > window.innerHeight * 0.45)
        .sort((a, b) => b.rect.y - a.rect.y || a.rect.x - b.rect.x)[0] || null;
      let trigger = getTrigger();
      if (!trigger) return { ok: false, reason: '找不到 Codex 底部权限按钮' };
      const beforeText = trigger.text;
      if (matchesTarget(beforeText)) return { ok: true, alreadySelected: true, beforeText, afterText: beforeText, clickedText: '' };

      domClick(trigger.button);
      await sleep(240);
      let menuItems = [];
      const deadline = Date.now() + 1600;
      let targetItem = null;
      while (Date.now() < deadline && !targetItem) {
        await sleep(100);
        menuItems = [...document.querySelectorAll('[role="menuitem"],[cmdk-item],button')]
          .filter(visible)
          .map(item => ({ item, text: normalize(item.innerText || item.getAttribute('aria-label') || item.title), role: item.getAttribute('role') || '', rect: item.getBoundingClientRect() }))
          .filter(entry => entry.text && matchesAnyMode(entry.text));
        targetItem = menuItems.find(entry => matchesTarget(entry.text)) || null;
      }
      if (!targetItem) {
        return { ok: false, reason: '找不到目标权限菜单项', targetKey: target.key, beforeText, items: menuItems.map(item => item.text).slice(0, 20) };
      }
      domClick(targetItem.item);
      let afterText = '';
      const afterDeadline = Date.now() + 2000;
      while (Date.now() < afterDeadline) {
        await sleep(120);
        trigger = getTrigger();
        afterText = trigger ? trigger.text : '';
        if (matchesTarget(afterText)) break;
      }
      if (!matchesTarget(afterText)) return { ok: false, reason: '已点击目标权限，但 Codex 页脚没有确认切换成功', targetKey: target.key, beforeText, clickedText: targetItem.text, afterText };
      return { ok: true, targetKey: target.key, beforeText, clickedText: targetItem.text, afterText };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || `CDP 权限模式切换失败：${target.label}`);
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { ...result, selected };
  });
}

async function cdpReadApprovalPrompt(threadId = '') {
  return withCodexCdp(async client => {
    const selected = { ok: true, skipped: true, noThreadSwitch: true, requestedThreadId: threadId || '' };
    const result = await cdpEvaluate(client, `(() => {
      const visible = ${cdpVisibleHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const buttonText = el => normalize(el.innerText || el.getAttribute('aria-label') || el.title);
      const normalizeThreadId = value => String(value || '').trim().replace(/^local:/, '').replace(/^cloud:/, '');
      const requestedThreadId = normalizeThreadId(${jsLiteral(threadId)});
      const readActiveThread = () => {
        const activeRow = [...document.querySelectorAll('[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]')]
          .filter(el => el.getAttribute('role') === 'button' || el.hasAttribute('data-app-action-sidebar-thread-row'))
          .find(el => el.getAttribute('data-app-action-sidebar-thread-active') === 'true' || el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-selected') === 'true') || null;
        const activeThreadId = normalizeThreadId(activeRow ? (activeRow.getAttribute('data-app-action-sidebar-thread-id') || '') : '');
        return { activeThreadId, activeThreadText: activeRow ? normalize(activeRow.innerText || activeRow.textContent).slice(0, 180) : '' };
      };
      const activeThread = readActiveThread();
      if (requestedThreadId && activeThread.activeThreadId !== requestedThreadId) {
        return { ok: true, available: false, threadMismatch: true, requestedThreadId, ...activeThread };
      }
      const allowPattern = /允许|批准|同意|确认|继续|执行|运行|^是$|^1[.、。]?\\s*是$|yes|allow|approve|confirm|continue|run/i;
      const allowAlwaysPattern = /不再(?:询问|问)|以后.*(?:不再|都|总是|始终|允许)|始终|总是|每次|一直|类似|always|don'?t ask|do not ask/i;
      const denyPattern = /拒绝|不允许|取消|^否|请告知|如何调整|deny|reject|no|cancel/i;
      const submitPattern = /^提交\\s*⏎$/;
      const skipPattern = /^跳过$/;
      const isButtonLike = item => {
        const tag = String(item?.tag || item?.control?.tagName || '').toUpperCase();
        const role = String(item?.role || item?.control?.getAttribute?.('role') || '').toLowerCase();
        return tag === 'BUTTON' || role === 'button';
      };
      const isSubmitButton = item => isButtonLike(item) && submitPattern.test(normalize(item?.text || ''));
      const isSkipButton = item => isButtonLike(item) && skipPattern.test(normalize(item?.text || ''));
      const promptPattern = /用户要求做|用户请求|是否允许|是否要|是否继续|需要.*(?:允许|批准|确认)|批准|审批|权限|命令|工具|sandbox|approval|permission|confirm/i;
      const strongPromptPattern = /用户要求做|用户请求|是否允许|是否要|是否继续|需要.*(?:允许|批准|确认)|Codex .*?(?:想要|需要|请求)|批准|审批|approval|permission/i;
      const promptTitlePattern = /^(是否允许|是否要|是否继续|用户要求做|用户请求|Codex .*?(?:想要|需要|请求)|.*\\?)\\b/i;
      const approvalControlSelector = 'button,[role="button"],[role="radio"],[role="option"],[aria-checked],label,[tabindex],textarea,input[type="text"],input:not([type]),[contenteditable="true"]';
      const allControlsFor = root => [...root.querySelectorAll(approvalControlSelector)]
        .filter(visible)
        .map((control, index) => {
          const rect = control.getBoundingClientRect();
          return { control, index, text: buttonText(control), role: control.getAttribute('role') || '', tag: control.tagName || '', disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'), checked: control.getAttribute('aria-checked') || '', rect: { w: rect.width, h: rect.height } };
        })
        .filter(item => item.text && item.text.length <= 220 && item.rect.w >= 24 && item.rect.h > 0 && item.rect.h <= 140);
      const buttonsFor = root => allControlsFor(root)
        .filter(item => /^(BUTTON|LABEL)$/i.test(item.tag || '') || /button|radio|option/.test(item.role) || item.control.hasAttribute('aria-checked') || classifyChoice(item))
        .filter(item => !isSkipButton(item));
      const textInputsFor = root => [...root.querySelectorAll('textarea,input[type="text"],input:not([type]),[contenteditable="true"]')].filter(visible);
      const isChoiceOrActionLine = line => {
        const text = normalize(line);
        if (!text) return true;
        if (/^[123][.、。]?$/.test(text)) return true;
        if (/^(?:[123][.、。]?\\s*)?(?:是|否|拒绝|允许|允许一次|以后不问|不再询问|总是允许|提交|跳过|发送|回复)(?:$|[，,：:]|\\s*$)/i.test(text)) return true;
        if (/^(?:跳过|提交|发送|回复|展开)$/i.test(text)) return true;
        return false;
      };
      const isAssistantStatusLine = line => {
        const text = normalize(line);
        return /^(?:生效方式|当前是否已生效|用户需要做什么|我本轮没有自动|我本轮没有|已改源码|已构建|已安装|已同步|已重启|已验证|验证|生效|用户需要操作|用户操作|无需操作)(?:$|[：:，,]|\\s)/.test(text)
          || /^任务已完成[：:]/.test(text)
          || /^完成情况[：:]/.test(text)
          || /^用时[：:]/.test(text)
          || /^Codex Mini Pro By/i.test(text);
      };
      const isCommandLine = line => {
        const text = normalize(line);
        return /^(?:\\/bin\\/\\w+\\s+-lc\\s+['"]?)?(?:mkdir|cp|mv|rm|python3?|node|npm|git|bash|zsh|sh|shasum|chmod|cat|sed|awk|rg)\\b/i.test(text)
          || /^(?:\\.{1,2}\\/|~\\/|\\/[\\w./ -]*|(?:[\\w.-]+\\/)+)[^\\s]*(?:\\.sh|\\.js|\\.py|\\.command)(?:\\s|$)/i.test(text)
          || /^(?:\\.\\/)?scripts\\/[\\w./-]+(?:\\s|$)/i.test(text)
          || (/\\$HOME|\\/Users\\/|~\\/|&&/.test(text) && /\\b(?:mkdir|cp|mv|rm|python3?|node|npm|git|bash|zsh|shasum)\\b/i.test(text));
      };
      const semanticTextLinesFor = root => {
        const blockedSelector = 'button,[role="button"],[role="radio"],[role="option"],[aria-checked],label,textarea,input,[contenteditable="true"],pre,code,kbd,samp';
        const lines = [];
        try {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              const value = normalize(node.nodeValue || '');
              if (!value) return NodeFilter.FILTER_REJECT;
              const parent = node.parentElement;
              if (!parent || !visible(parent)) return NodeFilter.FILTER_REJECT;
              const blocked = parent.closest(blockedSelector);
              if (blocked && blocked !== root) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          while (walker.nextNode()) lines.push(normalize(walker.currentNode.nodeValue || ''));
        } catch (_) {}
        return lines;
      };
      const promptLineFor = (root, buttons = []) => {
        const buttonTexts = new Set(buttons.map(item => normalize(item.text)).filter(Boolean));
        const raw = String(root.innerText || root.textContent || '');
        const seenLines = new Set();
        const lines = [...semanticTextLinesFor(root), ...raw.split(/\\n+/)]
          .map(line => normalize(line))
          .filter(Boolean)
          .filter(line => {
            const key = line.toLowerCase();
            if (seenLines.has(key)) return false;
            seenLines.add(key);
            return true;
          })
          .filter(line => !buttonTexts.has(line))
          .filter(line => !isAssistantStatusLine(line))
          .filter(line => !isChoiceOrActionLine(line))
          .filter(line => !isCommandLine(line));
        const scored = lines.map((line, index) => {
          let score = 0;
          if (/需要|请|是否|允许|批准|确认|用户要求|用户请求|Codex .*?(?:想要|需要|请求)|\\?$/.test(line)) score += 120;
          if (/功能|同步|运行副本|入口|读取|修改|执行|继续|操作|命令/.test(line)) score += 35;
          if (/\\/Users\\/|\\$HOME|\\b(?:mkdir|cp|mv|rm|python3?|node|npm|git|bash|zsh|shasum)\\b|&&/.test(line)) score -= 90;
          if (/^[123][.、。]?/.test(line)) score -= 120;
          score -= Math.max(0, line.length - 220) / 4;
          score -= index;
          return { line, score };
        }).sort((a, b) => b.score - a.score);
        return scored[0]?.line || '';
      };
      const displayTextFor = (root, buttons = []) => {
        const promptLine = promptLineFor(root, buttons);
        if (promptLine) return promptLine.slice(0, 2400);
        const buttonTexts = new Set(buttons.map(item => normalize(item.text)).filter(Boolean));
        const raw = String(root.innerText || root.textContent || '');
        const lines = raw.split(/\\n+/)
          .map(line => normalize(line))
          .filter(Boolean)
          .filter(line => !buttonTexts.has(line))
          .filter(line => !isChoiceOrActionLine(line));
        const compact = lines.join('\\n').trim();
        return (compact || normalize(raw)).slice(0, 2400);
      };
      const rankSummary = item => {
        const text = normalize(item?.text || '');
        let score = 0;
        if (item?.promptText) score += 180;
        if (/是否允许|是否要|需要.*是否允许|用户要求做|用户请求|Codex .*?(?:想要|需要|请求)/.test(text)) score += 120;
        if (/\\/Users\\/|~\\/|\\b(?:mv|cp|rm|mkdir|python|python3|node|npm|git|bash|zsh)\\b/.test(text)) score += 45;
        if (Array.isArray(item?.choices) && item.choices.length >= 2) score += 25;
        if (/^(?:[123][.、。]?\\s*)?(?:是|否)?$/.test(text) && !/是否允许|是否要|用户要求做|用户请求/.test(text)) score -= 180;
        if (/^(?:1[.、。]?\\s*)?是(?:\\s|$)/.test(text) && !/是否允许|是否要|用户要求做|用户请求/.test(text)) score -= 80;
        score -= Math.max(0, text.length - 1800) / 80;
        return score;
      };
      const classifyChoice = item => {
        const text = normalize(item.text);
        if (!text || submitPattern.test(text) || skipPattern.test(text)) return '';
        const tag = String(item.tag || item.control?.tagName || '').toUpperCase();
        const role = String(item.role || item.control?.getAttribute?.('role') || '');
        const numberedChoice = /^[123][.、。](?:\\s*|$)/.test(text);
        const shortYesNo = /^(是|否|yes|no)$/i.test(text);
        const interactiveChoice = /^(BUTTON|LABEL)$/i.test(tag) || /button|radio|option/.test(role) || item.control?.hasAttribute?.('aria-checked');
        const focusableChoice = item.control?.hasAttribute?.('tabindex') && (numberedChoice || shortYesNo);
        const choiceShape = interactiveChoice || focusableChoice;
        if (!choiceShape || (promptTitlePattern.test(text) && !/^[123][.、。](?:\\s*|$)/.test(text))) return '';
        if (/^3[.、。](?:\\s*|$)/.test(text)) return 'deny';
        if (/^2[.、。](?:\\s*|$)/.test(text)) return 'allowAlways';
        if (allowAlwaysPattern.test(text)) return 'allowAlways';
        if (denyPattern.test(text)) return 'deny';
        if (/^(?:1[.、。]\\s*)?是$/.test(text) || /^1[.、。](?:\\s*|$)/.test(text)) return 'allow';
        if (allowPattern.test(text) && text.length <= 24) return 'allow';
        return '';
      };
      const summarize = (root, source) => {
        const text = normalize(root.innerText || root.textContent || '');
        if (!text || !promptPattern.test(text)) return null;
        const buttons = buttonsFor(root).map(({ index, text, disabled, role, checked, tag }) => ({ index, text, disabled, role, checked, tag }));
        const displayChoiceText = value => normalize(value).replace(/^[123][.、。]\s*/, '');
        const choices = buttons
          .map(item => ({ ...item, rawText: item.text, text: displayChoiceText(item.text), type: classifyChoice(item) }))
          .filter(item => item.type);
        const hasApprovalButtons = buttons.some(item => allowPattern.test(item.text) && !isSubmitButton(item)) && buttons.some(item => denyPattern.test(item.text));
        const hasChoiceSubmit = choices.length >= 2 && buttons.some(item => isSubmitButton(item));
        const hasChoiceSet = choices.some(item => item.type === 'allow') && choices.some(item => item.type === 'allowAlways' || item.type === 'deny');
        const hasStrongCardPrompt = source !== 'approval-card' || strongPromptPattern.test(text);
        if (!hasStrongCardPrompt) return null;
        if (!hasApprovalButtons && !hasChoiceSubmit && !hasChoiceSet) return null;
        const rect = root.getBoundingClientRect();
        const promptText = promptLineFor(root, buttons);
        return {
          ok: true,
          available: true,
          source: hasChoiceSubmit ? 'approval-card' : source,
          text: displayTextFor(root, buttons),
          promptText,
          rawText: text.slice(0, 2400),
          threadId: activeThread.activeThreadId || requestedThreadId,
          requestedThreadId,
          activeThreadId: activeThread.activeThreadId,
          activeThreadText: activeThread.activeThreadText,
          buttons,
          choices,
          allowLabel: choices.find(item => item.type === 'allow')?.text || buttons.find(item => allowPattern.test(item.text) && !isSubmitButton(item))?.text || '',
          allowAlwaysLabel: choices.find(item => item.type === 'allowAlways')?.text || '',
          denyLabel: choices.find(item => item.type === 'deny')?.text || buttons.find(item => denyPattern.test(item.text))?.text || '',
          submitLabel: buttons.find(item => isSubmitButton(item))?.text || '',
          hasTextInput: textInputsFor(root).length > 0,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      };
      const summarizeCodexApprovalSurface = root => {
        const titleEl = root.querySelector('.text-base.font-medium') || [...root.querySelectorAll('div,span')]
          .filter(visible)
          .find(el => {
            if (el.closest('button,[role="button"],[role="radio"],textarea,input,pre,code,kbd,samp')) return false;
            const text = normalize(el.innerText || el.textContent || '');
            return text && /是否允许|是否要|是否继续|用户要求做|用户请求|Codex .*?(?:想要|需要|请求)/.test(text);
          });
        const promptText = normalize(titleEl?.innerText || titleEl?.textContent || promptLineFor(root, []));
        if (!promptText) return null;
        const radioControls = [...root.querySelectorAll('button[role="radio"]')]
          .filter(visible)
          .map((control, index) => {
            const rect = control.getBoundingClientRect();
            const label = normalize(control.getAttribute('aria-label') || control.innerText || control.textContent || '');
            return { control, index, text: label, role: control.getAttribute('role') || '', tag: control.tagName || '', disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'), checked: control.getAttribute('aria-checked') || '', rect: { w: rect.width, h: rect.height } };
          })
          .filter(item => item.text);
        const textInput = [...root.querySelectorAll('textarea,input[type="text"],input:not([type]),[contenteditable="true"]')].filter(visible)[0] || null;
        const denyText = normalize(textInput?.getAttribute?.('placeholder') || textInput?.innerText || textInput?.value || '');
        const actionButtons = [...root.querySelectorAll('button')]
          .filter(visible)
          .map((control, index) => ({ index, text: normalize(control.innerText || control.textContent || control.getAttribute('aria-label') || ''), disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'), role: control.getAttribute('role') || '', tag: control.tagName || '', checked: control.getAttribute('aria-checked') || '' }))
          .filter(item => item.text);
        const choices = [];
        if (radioControls[0]) choices.push({ index: radioControls[0].index, text: radioControls[0].text, disabled: radioControls[0].disabled, role: radioControls[0].role, checked: radioControls[0].checked, type: 'allow' });
        if (radioControls[1]) choices.push({ index: radioControls[1].index, text: radioControls[1].text, disabled: radioControls[1].disabled, role: radioControls[1].role, checked: radioControls[1].checked, type: 'allowAlways' });
        if (denyText) choices.push({ index: 2, text: denyText, disabled: false, role: 'textbox', checked: '', type: 'deny' });
        if (choices.length < 2) return null;
        const rect = root.getBoundingClientRect();
        return {
          ok: true,
          available: true,
          source: 'approval-surface',
          text: promptText.slice(0, 2400),
          promptText: promptText.slice(0, 2400),
          rawText: normalize(root.innerText || root.textContent || '').slice(0, 2400),
          threadId: activeThread.activeThreadId || requestedThreadId,
          requestedThreadId,
          activeThreadId: activeThread.activeThreadId,
          activeThreadText: activeThread.activeThreadText,
          buttons: actionButtons,
          choices,
          allowLabel: choices.find(item => item.type === 'allow')?.text || '',
          allowAlwaysLabel: choices.find(item => item.type === 'allowAlways')?.text || '',
          denyLabel: choices.find(item => item.type === 'deny')?.text || '',
          submitLabel: actionButtons.find(item => isSubmitButton(item))?.text || '',
          skipLabel: actionButtons.find(item => isSkipButton(item))?.text || '',
          hasTextInput: Boolean(textInput),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };
      };
      const codexApprovalSurface = [...document.querySelectorAll('[data-codex-approval-surface]')]
        .filter(visible)
        .map(root => summarizeCodexApprovalSurface(root))
        .find(Boolean);
      if (codexApprovalSurface) return codexApprovalSurface;
      const dialog = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')]
        .filter(visible)
        .map(root => summarize(root, root.getAttribute('role') || 'dialog'))
        .find(Boolean);
      if (dialog) return dialog;
      return { ok: true, available: false, requestedThreadId, activeThreadId: activeThread.activeThreadId, activeThreadText: activeThread.activeThreadText };
    })()`);
    return { ok: true, selected, ...(result || { available: false }) };
  });
}

async function cdpActOnApprovalPrompt(threadId = '', action = '', text = '') {
  return withCodexCdp(async client => {
    const selected = { ok: true, skipped: true, noThreadSwitch: true, requestedThreadId: threadId || '' };
    const result = await cdpEvaluate(client, `(async () => {
      const requestedAction = ${jsLiteral(action)};
      const requestedText = ${JSON.stringify(String(text || '').slice(0, MAX_TEXT_LENGTH))};
      const visible = ${cdpVisibleHelperSource()};
      const domClick = ${cdpDomClickHelperSource()};
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const buttonText = el => normalize(el.innerText || el.getAttribute('aria-label') || el.title);
      const clickOnce = el => {
        if (!el) return;
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        try { el.focus?.({ preventScroll: true }); } catch {}
        try { el.click?.(); } catch {
          const rect = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            clientX: rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2)),
            clientY: rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2)),
          }));
        }
      };
      const normalizeThreadId = value => String(value || '').trim().replace(/^local:/, '').replace(/^cloud:/, '');
      const requestedThreadId = normalizeThreadId(${jsLiteral(threadId)});
      const readActiveThread = () => {
        const activeRow = [...document.querySelectorAll('[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]')]
          .filter(el => el.getAttribute('role') === 'button' || el.hasAttribute('data-app-action-sidebar-thread-row'))
          .find(el => el.getAttribute('data-app-action-sidebar-thread-active') === 'true' || el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-selected') === 'true') || null;
        const activeThreadId = normalizeThreadId(activeRow ? (activeRow.getAttribute('data-app-action-sidebar-thread-id') || '') : '');
        return { activeThreadId, activeThreadText: activeRow ? normalize(activeRow.innerText || activeRow.textContent).slice(0, 180) : '' };
      };
      const activeThread = readActiveThread();
      if (requestedThreadId && activeThread.activeThreadId !== requestedThreadId) {
        return { ok: false, reason: '这个 Codex 审批卡片不属于当前手机正在查看的线程，已阻止跨线程操作', code: 'APPROVAL_THREAD_MISMATCH', requestedThreadId, ...activeThread };
      }
      const allowPattern = /允许|批准|同意|确认|继续|执行|运行|^是$|^1[.、。]?\\s*是$|yes|allow|approve|confirm|continue|run/i;
      const allowAlwaysPattern = /不再(?:询问|问)|以后.*(?:不再|都|总是|始终|允许)|始终|总是|每次|一直|类似|always|don'?t ask|do not ask/i;
      const denyPattern = /拒绝|不允许|取消|^否|请告知|如何调整|deny|reject|no|cancel/i;
      const submitPattern = /^提交\\s*⏎$/;
      const skipPattern = /^跳过$/;
      const isButtonLike = item => {
        const tag = String(item?.tag || item?.control?.tagName || '').toUpperCase();
        const role = String(item?.role || item?.control?.getAttribute?.('role') || '').toLowerCase();
        return tag === 'BUTTON' || role === 'button';
      };
      const isSubmitButton = item => isButtonLike(item) && submitPattern.test(normalize(item?.text || ''));
      const isSkipButton = item => isButtonLike(item) && skipPattern.test(normalize(item?.text || ''));
      const promptPattern = /用户要求做|用户请求|是否允许|是否要|是否继续|需要.*(?:允许|批准|确认)|批准|审批|权限|命令|工具|sandbox|approval|permission|confirm/i;
      const strongPromptPattern = /用户要求做|用户请求|是否允许|是否要|是否继续|需要.*(?:允许|批准|确认)|Codex .*?(?:想要|需要|请求)|批准|审批|approval|permission/i;
      const promptTitlePattern = /^(是否允许|是否要|是否继续|用户要求做|用户请求|Codex .*?(?:想要|需要|请求)|.*\\?)\\b/i;
      const approvalControlSelector = 'button,[role="button"],[role="radio"],[role="option"],[aria-checked],label,[tabindex],textarea,input[type="text"],input:not([type]),[contenteditable="true"]';
      const controlsFor = root => [...root.querySelectorAll(approvalControlSelector)]
        .filter(visible)
        .map(control => {
          const rect = control.getBoundingClientRect();
          return { control, text: buttonText(control) || normalize(control.getAttribute?.('placeholder') || control.value || ''), role: control.getAttribute('role') || '', tag: control.tagName || '', disabled: Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true'), rect: { w: rect.width, h: rect.height } };
        })
        .filter(item => item.text && item.text.length <= 220 && item.rect.w >= 24 && item.rect.h > 0 && item.rect.h <= 140 && !item.disabled && !isSkipButton(item))
        .filter(item => /^(BUTTON|LABEL|TEXTAREA|INPUT)$/i.test(item.tag || '') || /button|radio|option/.test(item.role) || item.control.hasAttribute('aria-checked') || classifyChoice(item) || isSubmitButton(item));
      const inputsFor = root => [...root.querySelectorAll('textarea,input[type="text"],input:not([type]),[contenteditable="true"]')].filter(visible);
      const rankRoot = root => {
        const text = normalize(root?.innerText || root?.textContent || '');
        const rect = root?.getBoundingClientRect?.() || { width: 0, height: 0 };
        let score = 0;
        if (/是否允许|是否要|需要.*是否允许|用户要求做|用户请求|Codex .*?(?:想要|需要|请求)/.test(text)) score += 120;
        if (/\\/Users\\/|~\\/|\\b(?:mv|cp|rm|mkdir|python|python3|node|npm|git|bash|zsh)\\b/.test(text)) score += 45;
        if (/提交|发送|回复/.test(text)) score += 15;
        if (/^(?:1[.、。]?\\s*)?是(?:\\s|$)/.test(text) && !/是否允许|是否要|用户要求做|用户请求/.test(text)) score -= 80;
        score -= Math.max(0, text.length - 2600) / 80;
        return score + Math.min(20, (rect.width * rect.height) / 50000);
      };
      const classifyChoice = item => {
        const text = normalize(item.text);
        if (!text || submitPattern.test(text) || skipPattern.test(text)) return '';
        const tag = String(item.tag || item.control?.tagName || '').toUpperCase();
        const role = String(item.role || item.control?.getAttribute?.('role') || '');
        const numberedChoice = /^[123][.、。](?:\\s*|$)/.test(text);
        const shortYesNo = /^(是|否|yes|no)$/i.test(text);
        const interactiveChoice = /^(BUTTON|LABEL)$/i.test(tag) || /button|radio|option/.test(role) || item.control?.hasAttribute?.('aria-checked');
        const focusableChoice = item.control?.hasAttribute?.('tabindex') && (numberedChoice || shortYesNo);
        const choiceShape = interactiveChoice || focusableChoice;
        if (/^(TEXTAREA|INPUT)$/i.test(tag) && denyPattern.test(text)) return 'deny';
        if (!choiceShape || (promptTitlePattern.test(text) && !/^[123][.、。](?:\\s*|$)/.test(text))) return '';
        if (/^3[.、。](?:\\s*|$)/.test(text)) return 'deny';
        if (/^2[.、。](?:\\s*|$)/.test(text)) return 'allowAlways';
        if (allowAlwaysPattern.test(text)) return 'allowAlways';
        if (denyPattern.test(text)) return 'deny';
        if (/^(?:1[.、。]\\s*)?是$/.test(text) || /^1[.、。](?:\\s*|$)/.test(text)) return 'allow';
        if (allowPattern.test(text) && text.length <= 24) return 'allow';
        return '';
      };
      const isPromptRoot = root => {
        const text = normalize(root.innerText || root.textContent || '');
        if (!text || !promptPattern.test(text) || !strongPromptPattern.test(text)) return false;
        const controls = controlsFor(root);
        const hasApprovalButtons = controls.some(item => allowPattern.test(item.text) && !isSubmitButton(item)) && controls.some(item => denyPattern.test(item.text));
        const choices = controls.map(item => classifyChoice(item)).filter(Boolean);
        const hasChoiceSubmit = choices.length >= 2 && controls.some(item => isSubmitButton(item));
        const hasChoiceSet = choices.includes('allow') && (choices.includes('allowAlways') || choices.includes('deny'));
        return hasApprovalButtons || hasChoiceSubmit || hasChoiceSet;
      };
      const findPromptRoot = () => {
        const surface = [...document.querySelectorAll('[data-codex-approval-surface]')].filter(visible).find(isPromptRoot);
        if (surface) return surface;
        const dialog = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')].filter(visible).find(isPromptRoot);
        if (dialog) return dialog;
        return null;
      };
      const root = findPromptRoot();
      if (!root) return { ok: false, reason: '当前没有可操作的 Codex 审批弹窗或审批卡片' };
      let controls = controlsFor(root);
      const input = inputsFor(root)[0] || null;
      const clickableFor = item => {
        const direct = item.control;
        const tag = String(item?.tag || direct?.tagName || '').toUpperCase();
        if (/^(TEXTAREA|INPUT)$/i.test(tag) && classifyChoice(item) === 'deny') {
          const denyRow = direct?.closest?.('.group, [class*="items-start"], [class*="justify-between"]');
          if (denyRow && root.contains(denyRow)) return denyRow;
        }
        const parent = direct?.closest?.('button,[role="button"],[role="radio"],[role="option"],[aria-checked],[tabindex],label');
        return parent && root.contains(parent) ? parent : direct;
      };
      let usedDenyFallbackText = false;
      const writeInputText = (value, options = {}) => {
        let textValue = String(value || '');
        if (options.denyFallback && !textValue.trim()) {
          textValue = '拒绝';
          usedDenyFallbackText = true;
        }
        if (!input) return false;
        input.focus();
        if (input.isContentEditable) {
          input.textContent = textValue;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: textValue }));
        } else {
          const proto = Object.getPrototypeOf(input);
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor?.set) descriptor.set.call(input, textValue);
          else input.value = textValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      };
      const denyChoiceFor = () => controls.find(item => classifyChoice(item) === 'deny') || controls.find(item => denyPattern.test(item.text));
      const activateDenyChoice = async () => {
        const denyChoice = denyChoiceFor();
        if (denyChoice) {
          domClick(clickableFor(denyChoice));
          await sleep(80);
        }
        if (input) {
          const denyInputItem = { control: input, text: normalize(input.getAttribute?.('placeholder') || input.value || ''), role: input.getAttribute?.('role') || '', tag: input.tagName || '' };
          domClick(clickableFor(denyInputItem));
          input.focus();
          writeInputText(requestedText, { denyFallback: true });
        }
        await sleep(100);
        // The desktop submit button may be disabled before the third option is selected
        // or before textarea content is written. Re-read controls after activation.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          controls = controlsFor(root);
          if (controls.some(item => isSubmitButton(item))) break;
          await sleep(80);
        }
      };
      if (requestedAction === 'deny') {
        await activateDenyChoice();
      } else if (requestedText && input) {
        writeInputText(requestedText);
        await sleep(100);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          controls = controlsFor(root);
          if (controls.some(item => isSubmitButton(item))) break;
          await sleep(80);
        }
      }
      const promptTextBefore = normalize(root.innerText || root.textContent || '');
      const submit = controls.find(item => isSubmitButton(item)) || null;
      const interactiveScore = item => {
        const tag = String(item.tag || item.control?.tagName || '').toUpperCase();
        const role = String(item.role || item.control?.getAttribute?.('role') || '');
        let score = 0;
        if (/radio|option/.test(role)) score += 80;
        if (/button/.test(role) || tag === 'BUTTON') score += 70;
        if (item.control?.hasAttribute?.('aria-checked')) score += 60;
        if (item.control?.hasAttribute?.('tabindex')) score += 45;
        if (tag === 'LABEL') score += 35;
        if (tag === 'DIV') score += 10;
        if (tag === 'SPAN') score -= 20;
        score -= Math.min(30, String(item.text || '').length / 20);
        return score;
      };
      const choices = controls
        .map(item => ({ ...item, type: classifyChoice(item), score: interactiveScore(item) }))
        .filter(item => item.type)
        .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
      let target = null;
      let targetType = '';
      if (requestedAction === 'deny' || requestedAction === 'submit') target = submit;
      else if (requestedAction === 'allowAlways') target = choices.find(item => item.type === 'allowAlways') || controls.find(item => /^2[.、。](?:\\s*|$)/.test(item.text)) || controls.find(item => allowAlwaysPattern.test(item.text)) || choices.find(item => item.type === 'allow') || controls.find(item => allowPattern.test(item.text) && !isSubmitButton(item));
      else if (requestedAction === 'allow') target = choices.find(item => item.type === 'allow') || controls.find(item => allowPattern.test(item.text) && !isSubmitButton(item));
      if (!target) return { ok: false, reason: '找不到对应的审批操作按钮', action: requestedAction, buttons: controls.map(item => item.text).slice(0, 24), hasTextInput: Boolean(input) };
      targetType = classifyChoice(target) || (isSubmitButton(target) ? 'submit' : 'button');
      const targetEl = clickableFor(target);
      if (isSubmitButton(target)) clickOnce(targetEl);
      else domClick(targetEl);
      await sleep(320);
      let submittedBy = '';
      let missingSubmitAfterChoice = false;
      let gone = false;
      let changed = false;
      for (let attempt = 0; attempt < 14; attempt += 1) {
        await sleep(180);
        if (!document.body.contains(root) || !visible(root)) { gone = true; break; }
        const nowText = normalize(root.innerText || root.textContent || '');
        changed = nowText && nowText !== promptTextBefore;
        if (!isPromptRoot(root)) { gone = true; break; }
        if (changed && !/是否允许|用户要求做|批准|审批/.test(nowText)) { gone = true; break; }
      }
      const clickedRealControl = Boolean(submittedBy || targetType === 'submit' || missingSubmitAfterChoice || /^(BUTTON|LABEL)$/i.test(target.tag || '') || /button|radio|option/.test(target.role || ''));
      if (!gone && !changed && !clickedRealControl) return { ok: false, reason: '已经点击，但 Codex 审批卡片没有变化，未确认提交成功；请在电脑端确认该卡片是否仍在', action: requestedAction, clickedText: target.text, clickedType: targetType, submittedBy, hadTextInput: Boolean(input), submittedText: Boolean(requestedText && input), usedDenyFallbackText, requestedThreadId, activeThreadId: activeThread.activeThreadId };
      return { ok: true, action: requestedAction, clickedText: target.text, clickedType: targetType, submittedBy, missingSubmitAfterChoice, promptGone: gone, promptChanged: changed, promptUnchangedAfterSubmit: !gone && !changed, requestedThreadId, activeThreadId: activeThread.activeThreadId, hadTextInput: Boolean(input), submittedText: Boolean(requestedText && input), usedDenyFallbackText };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || 'Codex 审批操作失败');
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { ...result, selected };
  });
}

async function cdpReadCodexProjectOrder(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && codexProjectOrderCache.projects.length && now - codexProjectOrderCache.at <= CODEX_PROJECT_ORDER_CACHE_MS) {
    return { ok: true, available: true, projects: codexProjectOrderCache.projects, cached: true, updatedAt: new Date(codexProjectOrderCache.at).toISOString() };
  }
  const projects = await withCodexCdp(async client => {
    const result = await cdpEvaluate(client, `(() => {
      const visible = ${cdpVisibleHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const cleanLabel = value => normalize(value)
        .replace(/^在\\s+(.+?)\\s+中开始新对话.*$/, '$1')
        .replace(/\\s+的项目操作$/, '')
        .replace(/^展开项目\\s+/, '')
        .replace(/^收起项目\\s+/, '')
        .replace(/^项目\\s+/, '')
        .trim();
      const isNoiseLabel = label => !label
        || label.length > 80
        || /^(对话|置顶|本地|来源|项目|设置|添加新项目|环境信息|选择环境|对话操作|次要操作)$/.test(label)
        || /操作$/.test(label)
        || /^正在运行\\s/.test(label)
        || /^已(?:编辑|探索|运行)\\s/.test(label)
        || /\\d+\\s*(?:次搜索|个列表|条命令)/.test(label);
      const seen = new Set();
      const rows = [...document.querySelectorAll('[data-app-action-sidebar-project-row],[data-app-action-sidebar-project-label],[data-app-action-sidebar-project-path],[aria-expanded][role="button"],button[aria-expanded]')]
        .filter(el => visible(el))
        .map(el => {
          const rect = el.getBoundingClientRect();
          const explicit = el.hasAttribute('data-app-action-sidebar-project-row')
            || el.hasAttribute('data-app-action-sidebar-project-label')
            || el.hasAttribute('data-app-action-sidebar-project-path');
          const rawText = normalize(el.innerText || el.textContent);
          const label = cleanLabel(
            el.getAttribute('data-app-action-sidebar-project-label')
            || el.getAttribute('aria-label')
            || rawText
          );
          const projectPath = normalize(
            el.getAttribute('data-app-action-sidebar-project-path')
            || el.getAttribute('data-project-path')
            || el.dataset?.appActionSidebarProjectPath
            || ''
          );
          return { label, projectPath, top: rect.top, left: rect.left, rawText: rawText.slice(0, 160), explicit };
        })
        .filter(item => (item.projectPath || !isNoiseLabel(item.label)) && (item.explicit || item.rawText || item.projectPath))
        .sort((a, b) => a.top - b.top || a.left - b.left);
      const projects = [];
      for (const item of rows) {
        const key = item.projectPath || item.label;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        projects.push({
          index: projects.length,
          label: item.label,
          projectPath: item.projectPath,
          rawText: item.rawText,
        });
      }
      return projects;
    })()`);
    return Array.isArray(result) ? result : [];
  });
  codexProjectOrderCache = { at: Date.now(), projects };
  return { ok: true, available: true, projects, cached: false, updatedAt: new Date(codexProjectOrderCache.at).toISOString() };
}

async function handleCodexProjectOrder(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const force = url.searchParams.get('force') === '1';
    const result = await cdpReadCodexProjectOrder({ force });
    return json(res, 200, result);
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 200, { ok: false, available: false, ...explained, projects: [], message: '暂时无法读取 Codex 项目顺序' });
  }
}

function jsLiteral(value) {
  return JSON.stringify(String(value || ''));
}

function cdpVisibleHelperSource() {
  return `el => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }`;
}

function cdpDomClickHelperSource() {
  return `el => {
    if (!el) return;
    const resetHorizontalLayoutScroll = () => {
      const candidates = [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll('*')];
      for (const node of candidates) {
        try {
          if (!node || !node.scrollLeft) continue;
          const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
          const className = String(node.className || '');
          const isShell = /app-shell|main-content|overflow-hidden|isolate/.test(className)
            || rect.width >= Math.min(520, window.innerWidth * 0.45)
            || node === document.scrollingElement
            || node === document.documentElement
            || node === document.body;
          if (isShell) node.scrollLeft = 0;
        } catch {}
      }
    };
    resetHorizontalLayoutScroll();
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    try { el.focus?.({ preventScroll: true }); } catch {}
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2)),
      clientY: rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2)),
    };
    const pointer = type => new PointerEvent(type, {
      ...base,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: type === 'pointerdown' ? 1 : 0,
    });
    const mouse = type => new MouseEvent(type, {
      ...base,
      buttons: type === 'mousedown' ? 1 : 0,
    });
    try { el.click?.(); } catch {}
    for (const event of [
      pointer('pointerover'),
      pointer('pointerenter'),
      mouse('mouseover'),
      mouse('mouseenter'),
      pointer('pointermove'),
      mouse('mousemove'),
      pointer('pointerdown'),
      mouse('mousedown'),
      pointer('pointerup'),
      mouse('mouseup'),
      mouse('click'),
    ]) {
      el.dispatchEvent(event);
    }
    resetHorizontalLayoutScroll();
    window.requestAnimationFrame(resetHorizontalLayoutScroll);
    setTimeout(resetHorizontalLayoutScroll, 0);
  }`;
}

function codexThreadTitleForCdp(threadId) {
  if (!isCodexThreadId(threadId)) return '';
  const thread = listCodexThreads(240).find(item => item.id === threadId);
  if (thread) return thread.name || thread.title || thread.preview || '';
  const remote = remoteThreadMetaCache.get(threadId);
  return remote ? (remote.name || '') : '';
}

async function cdpClickThread(client, threadId = '', options = {}) {
  if (!isCodexThreadId(threadId)) return { ok: true, skipped: true };
  const title = String(options.title || codexThreadTitleForCdp(threadId) || '').trim();
  const file = findCodexSessionFileByThreadId(threadId);
  const metaCwd = file ? readSessionMeta(file).cwd || '' : '';
  const project = classifyThreadProject(validLocalDirectory(metaCwd) || '');
  const remoteMeta = remoteThreadMetaCache.get(threadId) || null;
  const projectLabel = project.isProjectThread ? project.projectName : remoteMeta?.projectName || '';
  const result = await cdpEvaluate(client, `(async () => {
    const threadId = ${jsLiteral(threadId)};
    const wanted = ${jsLiteral(title)};
    const projectLabel = ${jsLiteral(projectLabel)};
    const visible = ${cdpVisibleHelperSource()};
    const domClick = ${cdpDomClickHelperSource()};
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const threadAttrMatches = el => {
      const value = String(el.getAttribute('data-app-action-sidebar-thread-id') || '');
      return value === threadId || value === 'local:' + threadId || value.endsWith(':' + threadId);
    };
    const activeMatches = el => Boolean(
      el && threadAttrMatches(el) && (
        el.getAttribute('data-app-action-sidebar-thread-active') === 'true' ||
        el.getAttribute('aria-current') === 'page' ||
        el.getAttribute('aria-selected') === 'true'
      )
    );
    const allThreadRows = () => [...document.querySelectorAll('[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]')]
      .filter(el => el.getAttribute('role') === 'button' || el.hasAttribute('data-app-action-sidebar-thread-row'));
    const exactRow = () => allThreadRows().find(threadAttrMatches) || null;
    const titleRow = () => {
      if (!wanted) return null;
      return [...document.querySelectorAll('[role="button"],[data-app-action-sidebar-thread-row],button,.group')]
        .filter(el => {
          if (!visible(el)) return false;
          const text = normalize(el.innerText);
          if (!text || !text.includes(wanted)) return false;
          const rect = el.getBoundingClientRect();
          if (rect.x > 340 || rect.width < 120 || rect.height < 20 || rect.height > 96) return false;
          if (/新对话|搜索|插件|自动化|置顶|项目|对话|展开显示|环境信息|来源|提交或推送|创建拉取请求/.test(text)) return false;
          return true;
        })[0] || null;
    };
    const ensureProjectExpanded = async () => {
      if (!projectLabel || exactRow()) return false;
      const projectRows = [...document.querySelectorAll('[data-app-action-sidebar-project-row],[role="button"]')]
        .filter(visible)
        .filter(el => {
          const label = el.getAttribute('data-app-action-sidebar-project-label') || el.getAttribute('aria-label') || normalize(el.innerText);
          return label === projectLabel;
        });
      const projectRow = projectRows[0] || null;
      if (!projectRow) return false;
      if (projectRow.getAttribute('data-app-action-sidebar-project-collapsed') === 'true' || projectRow.getAttribute('aria-expanded') === 'false') {
        domClick(projectRow);
        await sleep(280);
      }
      return true;
    };

    let row = null;
    const findDeadline = Date.now() + 2400;
    while (!row && Date.now() < findDeadline) {
      row = exactRow();
      if (!row) {
        await ensureProjectExpanded();
        row = exactRow();
      }
      if (!row) row = titleRow();
      if (!row) await sleep(120);
    }
    if (!row) {
      const knownRows = allThreadRows().map(el => ({
        id: el.getAttribute('data-app-action-sidebar-thread-id') || '',
        active: el.getAttribute('data-app-action-sidebar-thread-active') || '',
        text: normalize(el.innerText).slice(0, 80),
      })).slice(0, 30);
      return { ok: false, reason: '没有在 Codex DOM 中找到目标线程行', threadId, wanted, projectLabel, knownRows };
    }

    const beforeActive = activeMatches(row);
    const beforeActiveId = allThreadRows().find(el => el.getAttribute('data-app-action-sidebar-thread-active') === 'true')?.getAttribute('data-app-action-sidebar-thread-id') || '';
    if (!beforeActive) domClick(row);

    let activeRow = beforeActive ? row : null;
    const deadline = Date.now() + 2400;
    while (!activeRow && Date.now() < deadline) {
      await sleep(120);
      activeRow = allThreadRows().find(activeMatches) || null;
    }
    if (!activeRow) {
      const afterActiveId = allThreadRows().find(el => el.getAttribute('data-app-action-sidebar-thread-active') === 'true')?.getAttribute('data-app-action-sidebar-thread-id') || '';
      return {
        ok: false,
        reason: 'CDP 已点击目标线程，但 Codex 没有确认切换成功，已中止发送',
        threadId,
        wanted,
        clickedText: normalize(row.innerText).slice(0, 160),
        beforeActiveId,
        afterActiveId,
      };
    }

    const rect = activeRow.getBoundingClientRect();
    return {
      ok: true,
      threadId,
      title: wanted || activeRow.getAttribute('data-app-action-sidebar-thread-title') || '',
      projectLabel,
      alreadyActive: beforeActive,
      activeId: activeRow.getAttribute('data-app-action-sidebar-thread-id') || '',
      clickedText: normalize(activeRow.innerText).slice(0, 160),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  })()`);
  if (!result || !result.ok) throw new Error(result?.reason || `CDP 切线程失败：${threadId}`);
  lastCodexThreadActivation = { threadId, at: Date.now() };
  const settleMs = options.settleMs ?? (result.alreadyActive ? CODEX_CDP_ACTIVE_THREAD_SETTLE_MS : CODEX_CDP_THREAD_SETTLE_MS);
  await delay(settleMs);
  return result;
}

async function cdpFocusComposer(client, options = {}) {
  const result = await cdpEvaluate(client, `(async () => {
    const visible = ${cdpVisibleHelperSource()};
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let editor = null;
    const deadline = Date.now() + 2200;
    while (!editor && Date.now() < deadline) {
      editor = [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea,input')]
        .find(visible) || null;
      if (!editor) await sleep(100);
    }
    if (!editor) return { ok: false, reason: '找不到 Codex 输入框' };
    editor.focus();
    ${options.clear ? `
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    ` : ''}
    return {
      ok: true,
      activeTag: document.activeElement && document.activeElement.tagName,
      activeClass: document.activeElement ? String(document.activeElement.className || '') : '',
      waitedMs: Math.max(0, 2200 - (deadline - Date.now())),
      text: (editor.innerText || editor.value || '').slice(0, 200),
    };
  })()`);
  if (!result || !result.ok) throw new Error(result?.reason || 'CDP 聚焦 Codex 输入框失败。');
  return result;
}

async function cdpInsertText(client, text) {
  await client.call('Input.insertText', { text: String(text || '') });
  await delay(80);
  const result = await cdpEvaluate(client, `(() => {
    const visible = ${cdpVisibleHelperSource()};
    const editor = [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea,input')]
      .find(visible);
    return {
      ok: Boolean(editor),
      text: editor ? (editor.innerText || editor.value || '').slice(0, 500) : '',
      html: editor ? (editor.innerHTML || '').slice(0, 500) : '',
    };
  })()`);
  if (!result || !result.ok) throw new Error('CDP 插入文字后找不到输入框。');
  return result;
}

function attachmentDisplayName(attachment = {}) {
  return String(attachment.name || path.basename(attachment.filePath || '') || 'attachment');
}

function cdpAttachmentSnapshotExpression(attachments = []) {
  return `(() => {
    const visible = ${cdpVisibleHelperSource()};
    const names = ${JSON.stringify(attachments.map(attachmentDisplayName))};
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
    const normalizeKey = text => normalize(text).toLowerCase();
    const editor = [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea,input')].find(visible);
    const root = editor && (editor.closest('form') || editor.closest('[data-testid]') || editor.parentElement);
    const candidates = [...document.querySelectorAll('button,[role="button"],a,div,span,img,svg,[aria-label],[data-testid]')]
      .filter(el => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (root) {
          const rootRect = root.getBoundingClientRect();
          if (rect.bottom < rootRect.top - 260 || rect.top > rootRect.bottom + 220) return false;
        }
        return true;
      })
      .map(el => ({
        tag: el.tagName,
        text: normalize(el.innerText || el.getAttribute('aria-label') || el.title || el.alt || '').slice(0, 220),
        aria: el.getAttribute('aria-label') || '',
        title: el.title || '',
        alt: el.alt || '',
        src: el.tagName === 'IMG' ? (el.currentSrc || el.src || '').slice(0, 80) : '',
        cls: String(el.className || '').slice(0, 120),
      }));
    const haystack = candidates.map(item => [item.text, item.aria, item.title, item.alt, item.src, item.cls].join(' ')).join('\\n');
    const haystackKey = normalizeKey(haystack);
    const matchedNames = names.filter(name => name && haystackKey.includes(normalizeKey(name)));
    const likely = candidates.filter(item => /attach|attachment|file|image|upload|preview|remove|删除|移除|附件|文件|图片|照片/i.test([item.text, item.aria, item.title, item.alt, item.src, item.cls].join(' ')));
    return {
      matchedNames,
      likelyCount: likely.length,
      imageCount: candidates.filter(item => item.tag === 'IMG').length,
      sample: likely.slice(0, 20),
      editorText: editor ? normalize(editor.innerText || editor.value || '').slice(0, 200) : '',
    };
  })()`;
}

async function cdpAttachmentSnapshot(client, attachments = []) {
  return cdpEvaluate(client, cdpAttachmentSnapshotExpression(attachments));
}

function cdpAttachmentSnapshotScore(snapshot = {}, attachments = []) {
  const matched = Array.isArray(snapshot.matchedNames) ? snapshot.matchedNames.length : 0;
  const likely = Number(snapshot.likelyCount || 0);
  const images = Number(snapshot.imageCount || 0);
  return matched * 100 + likely * 3 + images;
}

function cdpAttachmentSnapshotIncreased(before = {}, after = {}, attachments = []) {
  const matched = Array.isArray(after?.matchedNames) ? after.matchedNames.length : 0;
  if (matched >= Math.min(attachments.length, 1)) return true;
  if (Number(after?.imageCount || 0) > Number(before?.imageCount || 0)) return true;
  if (Number(after?.likelyCount || 0) > Number(before?.likelyCount || 0)) return true;
  return cdpAttachmentSnapshotScore(after, attachments) > cdpAttachmentSnapshotScore(before, attachments) + 2;
}

async function cdpWaitForAttachmentIncrease(client, before, attachments = [], timeoutMs = 3600) {
  const start = Date.now();
  const beforeScore = cdpAttachmentSnapshotScore(before, attachments);
  let last = null;
  while (Date.now() - start < timeoutMs) {
    await delay(180);
    last = await cdpAttachmentSnapshot(client, attachments);
    const score = cdpAttachmentSnapshotScore(last, attachments);
    if (cdpAttachmentSnapshotIncreased(before, last, attachments)) return { ok: true, snapshot: last, score, beforeScore };
  }
  return { ok: false, snapshot: last, score: cdpAttachmentSnapshotScore(last || {}, attachments), beforeScore };
}

function mimeForCodexFileInjection(attachment = {}) {
  const mime = String(attachment && attachment.mime || '').toLowerCase();
  // Codex Desktop applies a stricter image-input pipeline to File objects with
  // image/* MIME (currently surfacing a 5MB image limit). Codex Mini already
  // enforces its own user-facing limits before this point, so image uploads are
  // intentionally handed to Codex as ordinary local file attachments while
  // preserving the original filename/path for attachment references.
  if (mime.startsWith('image/')) return 'application/octet-stream';
  return mime || 'application/octet-stream';
}

async function cdpInjectAttachmentsByDropOrPaste(client, attachments = [], mode = 'drop') {
  const payloads = attachments.map(attachment => {
    const filePath = attachment.filePath || '';
    return {
      name: attachmentDisplayName(attachment),
      mime: mimeForCodexFileInjection(attachment),
      sourceMime: attachment.mime || '',
      filePath,
      dataBase64: attachment.dataBase64 || fs.readFileSync(filePath).toString('base64'),
    };
  });
  return cdpEvaluate(client, `(async () => {
    const payloads = ${JSON.stringify(payloads)};
    const mode = ${JSON.stringify(mode)};
    const visible = ${cdpVisibleHelperSource()};
    const editor = [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea,input')].find(visible);
    if (!editor) return { ok: false, reason: '找不到 Codex 输入框' };
    editor.focus();
    const dataTransfer = new DataTransfer();
    const files = payloads.map(payload => {
      const binary = atob(payload.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], payload.name, { type: payload.mime || 'application/octet-stream' });
      // Codex Desktop treats non-image drops/pastes as local file references.
      // Electron's native File objects expose a real path; synthetic browser File
      // objects do not, so provide the same shape for Codex's composer parser.
      for (const key of ['path', 'fsPath', 'localPath', 'webkitRelativePath']) {
        try { Object.defineProperty(file, key, { value: payload.filePath || payload.name, configurable: true }); } catch {}
      }
      dataTransfer.items.add(file);
      return file;
    });
    const composerRoot = editor.closest('form') || editor.closest('[data-testid]') || editor;
    const portal = document.querySelector('[data-above-composer-portal],#above-composer-portal,[data-above-composer-queue-portal],#above-composer-queue-portal');
    const targets = [...new Set([portal, composerRoot, editor, document.body, document.documentElement, window].filter(Boolean))];
    const fileNames = files.map(file => file.name);
    const sizes = files.map(file => file.size);
    const editorTag = editor.tagName;
    const targetTag = (portal || composerRoot).tagName || 'WINDOW';
    const dispatchWithData = (eventTarget, event) => {
      try { Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true }); } catch {}
      try { Object.defineProperty(event, 'clipboardData', { value: dataTransfer, configurable: true }); } catch {}
      return eventTarget.dispatchEvent(event);
    };
    if (mode === 'paste') {
      const dispatches = [];
      for (const target of targets) {
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
        try {
          const item = { tag: target.tagName || 'WINDOW' };
          item.accepted = dispatchWithData(target, event);
          item.defaultPrevented = event.defaultPrevented;
          dispatches.push(item);
          if (event.defaultPrevented) break;
        } catch (error) {
          dispatches.push({ tag: target.tagName || 'WINDOW', error: String(error && error.message || error) });
        }
      }
      return { ok: true, mode, count: fileNames.length, fileNames, sizes, targetTag: editorTag, dispatches, defaultPrevented: dispatches.some(item => item.defaultPrevented) };
    }
    const dispatches = [];
    for (const target of targets) {
      for (const type of ['dragenter', 'dragover']) {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
        try { dispatches.push({ type, tag: target.tagName || 'WINDOW', accepted: dispatchWithData(target, event), defaultPrevented: event.defaultPrevented }); } catch (error) { dispatches.push({ type, tag: target.tagName || 'WINDOW', error: String(error && error.message || error) }); }
      }
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer });
      try { dispatches.push({ type: 'drop', tag: target.tagName || 'WINDOW', accepted: dispatchWithData(target, drop), defaultPrevented: drop.defaultPrevented }); } catch (error) { dispatches.push({ type: 'drop', tag: target.tagName || 'WINDOW', error: String(error && error.message || error) }); }
      if (drop.defaultPrevented) break;
    }
    return { ok: true, mode, count: fileNames.length, fileNames, sizes, targetTag, dispatches, defaultPrevented: dispatches.some(item => item.defaultPrevented) };
  })()`);
}

async function cdpInjectAttachmentsByNativeDrag(client, attachments = []) {
  const filePaths = attachments.map(item => item.filePath).filter(Boolean);
  if (!filePaths.length) return { ok: false, reason: '没有可拖拽的本机文件路径' };
  const target = await cdpEvaluate(client, `(() => {
    const visible = ${cdpVisibleHelperSource()};
    const editor = [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea,input')].find(visible);
    if (!editor) return null;
    const root = editor.closest('form') || editor.closest('[data-testid]') || editor;
    const rect = root.getBoundingClientRect();
    const fallback = editor.getBoundingClientRect();
    const use = rect.width > 0 && rect.height > 0 ? rect : fallback;
    return { x: Math.round(use.left + use.width / 2), y: Math.round(use.top + use.height / 2), tag: root.tagName || editor.tagName };
  })()`);
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return { ok: false, reason: '找不到可拖拽的 Codex 输入区域' };
  const items = attachments.map(item => ({
    mimeType: item.mime || 'application/octet-stream',
    data: attachmentDisplayName(item),
    title: attachmentDisplayName(item),
    baseURL: '',
  }));
  const data = { items, files: filePaths, dragOperationsMask: 1 };
  const common = { x: target.x, y: target.y, data };
  await client.call('Input.dispatchDragEvent', { type: 'dragEnter', ...common });
  await delay(120);
  await client.call('Input.dispatchDragEvent', { type: 'dragOver', ...common });
  await delay(120);
  await client.call('Input.dispatchDragEvent', { type: 'drop', ...common });
  return { ok: true, method: 'native-drag', count: filePaths.length, filePaths, target };
}

async function cdpInjectAttachmentsBySyntheticEvents(client, attachments = []) {
  if (!attachments.length) return { ok: true, skipped: true };
  const attempts = [];
  for (const mode of ['drop', 'paste']) {
    const before = await cdpAttachmentSnapshot(client, attachments);
    const injected = [];
    injected.push(await cdpInjectAttachmentsByDropOrPaste(client, attachments, mode));
    const waited = await cdpWaitForAttachmentIncrease(client, before, attachments);
    attempts.push({ mode, injected, waited });
    if (waited.ok) return { ok: true, method: `synthetic-${mode}`, attempts, snapshot: waited.snapshot };
  }
  return { ok: false, attempts };
}

async function cdpAttachFilesToComposer(client, attachments = []) {
  if (!attachments.length) return { ok: true, skipped: true };
  await cdpFocusComposer(client, { clear: false });
  const hasImageAttachment = attachments.some(item => attachmentKindFromMime(item.mime) === 'image');
  const beforeNative = await cdpAttachmentSnapshot(client, attachments);
  const native = await cdpInjectAttachmentsByNativeDrag(client, attachments).catch(error => ({ ok: false, error: String(error && error.message || error) }));
  if (native.ok) {
    const waited = await cdpWaitForAttachmentIncrease(client, beforeNative, attachments);
    if (waited.ok) return { ok: true, method: 'native-drag', native, snapshot: waited.snapshot };
    native.waited = waited;
  }
  // Image attachments must not fall back to JS synthetic File/DataTransfer: that
  // path is not equivalent to a real file drag and can trigger Codex's 5MB image
  // branch even when the official app accepts the same file via native drag.
  if (hasImageAttachment) {
    const error = new Error('图片没有被 Codex 接受为原生文件拖拽，已停止发送；不会再回退到会触发 5MB 的合成图片事件。');
    error.status = 400;
    error.code = 'CDP_NATIVE_IMAGE_DRAG_FAILED';
    error.details = { native };
    throw error;
  }
  const synthetic = await cdpInjectAttachmentsBySyntheticEvents(client, attachments);
  if (synthetic.ok) return { ...synthetic, nativeAttempt: native };
  const error = new Error('Codex 没有接受 CDP 直塞附件，已停止发送；不会再点击加号或打开文件选择器。');
  error.status = 400;
  error.code = 'CDP_ATTACHMENTS_FAILED';
  error.details = { native, synthetic };
  throw error;
}

async function cdpClickComposerSend(client) {
  const result = await cdpEvaluate(client, `(async () => {
    const visible = ${cdpVisibleHelperSource()};
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
    const findSendButton = () => {
      const editor = [...document.querySelectorAll('.ProseMirror,[contenteditable="true"],textarea,input')]
        .find(visible);
      const root = editor && (editor.closest('form') || editor.closest('.relative') || editor.parentElement);
      const buttons = root ? [...root.querySelectorAll('button,[role="button"]')].filter(button => {
        const rect = button.getBoundingClientRect();
        return visible(button) && rect.width <= 52 && rect.height <= 52;
      }) : [];
      const enabledButtons = buttons.filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
      const button = enabledButtons.at(-1) || null;
      return {
        button,
        rootFound: Boolean(root),
        buttonCount: buttons.length,
        disabledCount: buttons.length - enabledButtons.length,
        editorText: editor ? normalize(editor.innerText || editor.value || '').slice(0, 120) : '',
      };
    };
    let last = null;
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      last = findSendButton();
      if (last.button) break;
      await sleep(90);
    }
    if (!last || !last.button) {
      return {
        ok: false,
        reason: '找不到可用发送按钮',
        rootFound: Boolean(last && last.rootFound),
        buttonCount: last ? last.buttonCount : 0,
        disabledCount: last ? last.disabledCount : 0,
        editorText: last ? last.editorText : '',
      };
    }
    const sendButton = last.button;
    const rect = sendButton.getBoundingClientRect();
    sendButton.click();
    return {
      ok: true,
      aria: sendButton.getAttribute('aria-label') || '',
      waitedMs: Math.max(0, 1800 - (deadline - Date.now())),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  })()`);
  if (!result || !result.ok) throw new Error(result?.reason || 'CDP 点击发送按钮失败。');
  await delay(CODEX_COMMAND_SETTLE_MS);
  return result;
}

async function cdpClickQueuedGuidanceButton(client, text = '') {
  const result = await cdpEvaluate(client, `(async () => {
    const wantedRaw = ${jsLiteral(text)};
    const wanted = String(wantedRaw || '').replace(/\\s+/g, ' ').trim();
    const wantedKey = wanted.toLowerCase();
    const wantedShort = wantedKey.slice(0, 120);
    const visible = ${cdpVisibleHelperSource()};
    const domClick = ${cdpDomClickHelperSource()};
    const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const isGuideText = value => /引导|guide/i.test(String(value || ''));
    const buttonText = button => normalize([
      button.innerText,
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
      button.getAttribute('data-testid'),
    ].filter(Boolean).join(' '));
    const portalSelector = [
      '[data-above-composer-queue-portal]',
      '#above-composer-queue-portal',
      '[data-above-composer-portal]',
      '#above-composer-portal',
      '[data-testid*="queue" i]',
      '[class*="queue" i]',
    ].join(',');
    const inQueueArea = el => {
      if (!el) return false;
      if (el.closest?.(portalSelector)) return true;
      const rect = el.getBoundingClientRect();
      return rect.top > window.innerHeight * 0.35;
    };
    const textMatches = value => {
      if (!wantedShort) return false;
      const key = normalize(value).toLowerCase();
      return Boolean(key && (key.includes(wantedShort) || wantedShort.includes(key.slice(0, Math.min(key.length, 80)))));
    };
    const findRoot = button => {
      let best = button;
      let node = button;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const text = normalize(node.innerText || node.textContent);
        if (!text) continue;
        if (textMatches(text) || /队列|已排队|queued|引导|guide/i.test(text) || node.matches?.(portalSelector)) {
          best = node;
        }
      }
      return best;
    };
    const collectCandidates = () => {
      const buttons = [...document.querySelectorAll('button,[role="button"]')]
        .filter(visible)
        .filter(button => isGuideText(buttonText(button)))
        .map(button => {
          const root = findRoot(button);
          const rootText = normalize(root?.innerText || root?.textContent || buttonText(button));
          const rect = button.getBoundingClientRect();
          const rootRect = root?.getBoundingClientRect?.() || rect;
          const queueArea = inQueueArea(button) || inQueueArea(root);
          const matched = textMatches(rootText);
          let score = 0;
          if (queueArea) score += 120;
          if (matched) score += 200;
          if (/^\\s*(引导|guide)\\s*$/i.test(buttonText(button))) score += 40;
          score += Math.max(0, Math.min(80, rect.top / Math.max(1, window.innerHeight) * 80));
          return {
            button,
            root,
            rootText,
            text: buttonText(button),
            queueArea,
            matched,
            score,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            rootRect: { x: rootRect.x, y: rootRect.y, w: rootRect.width, h: rootRect.height },
          };
        })
        .filter(item => item.queueArea || item.matched);
      return buttons.sort((a, b) => b.score - a.score || b.rect.y - a.rect.y);
    };

    let candidates = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      candidates = collectCandidates();
      if (candidates.some(item => item.matched) || candidates.length === 1) break;
      await sleep(120);
    }

    if (!candidates.length) {
      const samples = [...document.querySelectorAll('button,[role="button"]')]
        .filter(visible)
        .map(button => buttonText(button))
        .filter(Boolean)
        .slice(-30);
      return { ok: false, reason: '没有找到队列消息上的引导按钮', wanted: wanted.slice(0, 160), samples };
    }

    const matched = candidates.filter(item => item.matched);
    if (!matched.length && candidates.length > 1) {
      return {
        ok: false,
        reason: '找到多个引导按钮，但无法确认哪一个属于刚发送的队列消息，已避免点错',
        wanted: wanted.slice(0, 160),
        candidates: candidates.slice(0, 6).map(item => ({ text: item.text, rootText: item.rootText.slice(0, 220), rect: item.rect })),
      };
    }

    const target = matched[0] || candidates[0];
    domClick(target.button);
    await sleep(320);
    return {
      ok: true,
      method: 'queued-guidance-button',
      textMatched: Boolean(target.matched),
      buttonText: target.text,
      rootText: target.rootText.slice(0, 260),
      rect: target.rect,
    };
  })()`);
  return result && typeof result === 'object'
    ? result
    : { ok: false, reason: '队列引导按钮点击结果异常' };
}

async function cdpSubmitComposerByEnter(client) {
  await client.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers: 0,
  });
  await client.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers: 0,
  });
  await delay(CODEX_COMMAND_SETTLE_MS);
  return { ok: true, method: 'enter' };
}

async function cdpSendTextToCodex(text, threadId = '', options = {}) {
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  return withCodexCdp(async client => {
    let selected = { ok: true, skipped: true };
    if (threadId) {
      const active = await cdpReadActiveThreadFast(client).catch(error => ({ ok: false, error: String(error && error.message || error) }));
      if (active.ok && normalizeCodexDomThreadId(active.activeThreadId) === normalizeCodexDomThreadId(threadId)) {
        lastCodexThreadActivation = { threadId, at: Date.now() };
        selected = {
          ok: true,
          method: 'cdp-active-thread-fast-path',
          threadId,
          alreadyActive: true,
          fastPath: true,
          activeId: active.rawActiveThreadId || active.activeThreadId,
          activeThreadText: active.activeThreadText || '',
        };
        await delay(options.settleMs ?? CODEX_CDP_ACTIVE_THREAD_SETTLE_MS);
      } else {
        selected = await cdpClickThread(client, threadId, { settleMs: options.settleMs });
      }
    }
    await cdpFocusComposer(client, { clear: true });
    const attached = attachments.length ? await cdpAttachFilesToComposer(client, attachments) : { ok: true, skipped: true };
    if (text) await cdpInsertText(client, text);
    const sent = attachments.length ? await cdpSubmitComposerByEnter(client) : await cdpClickComposerSend(client);
    const guidance = options.guidance === true
      ? await cdpClickQueuedGuidanceButton(client, text)
      : { ok: true, skipped: true };
    return { ok: true, method: 'cdp', selected, attached, sent, guidance };
  });
}

async function cdpActivateNewThread(target = {}) {
  return withCodexCdp(async client => {
    let selected = { ok: true, skipped: true };
    if (isCodexThreadId(target.anchorThreadId)) {
      selected = await cdpClickThread(client, target.anchorThreadId);
    }
    const projectName = target.scope === 'project' ? classifyThreadProject(target.cwd).projectName : '';
    const result = await cdpEvaluate(client, `(() => {
      const projectName = ${jsLiteral(projectName)};
      const visible = ${cdpVisibleHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
      let button = null;
      if (projectName) {
        button = buttons.find(item => (item.getAttribute('aria-label') || '').includes('在 ' + projectName + ' 中开始新对话'));
      }
      button = button || buttons.find(item => normalize(item.innerText).startsWith('新对话'));
      if (!button) return { ok: false, reason: '找不到新对话按钮', projectName };
      const rect = button.getBoundingClientRect();
      button.click();
      return { ok: true, projectName, text: normalize(button.innerText), aria: button.getAttribute('aria-label') || '', rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || 'CDP 新建线程失败。');
    await delay(CODEX_CDP_THREAD_SETTLE_MS + 180);
    lastCodexThreadActivation = { threadId: '', at: 0 };
    return { ...result, selected };
  });
}

async function cdpStopCodexResponse(threadId = '') {
  return withCodexCdp(async client => {
    const selected = threadId ? await cdpClickThread(client, threadId, { settleMs: 180 }) : { ok: true, skipped: true };
    const result = await cdpEvaluate(client, `(() => {
      const visible = ${cdpVisibleHelperSource()};
      const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
      const stopButton = buttons.find(button => /停止|stop/i.test([button.getAttribute('aria-label'), button.getAttribute('title'), button.innerText].join(' ')));
      if (!stopButton) return { ok: false, reason: '找不到停止按钮' };
      const rect = stopButton.getBoundingClientRect();
      stopButton.click();
      return { ok: true, aria: stopButton.getAttribute('aria-label') || '', text: (stopButton.innerText || '').trim(), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || 'CDP 停止回复失败。');
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { ...result, selected };
  });
}

async function cdpSwitchComposerModel(threadId = '', targetModel = '') {
  const target = typeof targetModel === 'string' ? { displayName: targetModel } : { ...(targetModel || {}) };
  const targetDisplayName = String(target.displayName || target.label || target.id || '').trim();
  return withCodexCdp(async client => {
    const selected = threadId ? await cdpClickThread(client, threadId, { settleMs: 180 }) : { ok: true, skipped: true };
    const result = await cdpEvaluate(client, `(async () => {
      const targetModel = ${JSON.stringify(target)};
      const targetDisplayName = String(targetModel.displayName || targetModel.label || targetModel.id || '').trim();
      const visible = ${cdpVisibleHelperSource()};
      const domClick = ${cdpDomClickHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const resetHorizontalLayoutScroll = () => {
        for (const node of [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll('*')]) {
          try {
            if (!node || !node.scrollLeft) continue;
            const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : { width: window.innerWidth };
            const className = String(node.className || '');
            if (/app-shell|main-content|overflow-hidden|isolate/.test(className) || rect.width >= Math.min(520, window.innerWidth * 0.45)) node.scrollLeft = 0;
          } catch {}
        }
      };
      const modelTextPattern = /GPT|5\\.\\d|CX_|LR_|mimo|deepseek|中转|模型/i;
      const speedTextPattern = /速度|speed|fast|slow|quick|快速|慢速|均衡|balanced/i;
      const reasoningLabels = ['极低', '低', '中', '高', '超高'];
      const reasoningFromFooterText = text => {
        const parts = normalize(text).split(' ').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        return reasoningLabels.includes(last) ? last : '';
      };
      const modelTextFromFooterText = text => {
        const parts = normalize(text).split(' ').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        return reasoningLabels.includes(last) ? parts.slice(0, -1).join(' ') : parts.join(' ');
      };
      const comparableModelText = text => normalize(text)
        .replace(/[（(]中转[）)]/g, '')
        .replace(/[\s_-]+/g, '')
        .toLowerCase();
      const targetAliases = Array.from(new Set([
        targetDisplayName,
        targetModel.label,
        targetModel.id,
        String(targetDisplayName || '').replace(/^GPT-?(\d)/i, 'GPT $1'),
        String(targetDisplayName || '').replace(/^GPT\s+(\d)/i, 'GPT-$1'),
      ].map(value => normalize(value)).filter(Boolean)));
      const matchesTargetModelText = text => {
        const raw = normalize(text);
        if (!raw) return false;
        const modelText = modelTextFromFooterText(raw);
        const compact = comparableModelText(modelText);
        const versionText = comparableModelText(targetModel.version || '');
        const relayPattern = /中转|LR_|CX_|mimo|deepseek|aimami_relay/i;
        const strongAliases = targetAliases.filter(alias => !/^v?\d+(?:\.\d+)?(?:\s*pro)?$/i.test(alias));
        const strongAliasMatches = pattern => strongAliases
          .filter(alias => pattern.test(alias))
          .some(alias => raw.includes(alias) || modelText.includes(alias) || comparableModelText(alias) === compact);
        if (targetModel.source === 'official') {
          if (relayPattern.test(raw)) return false;
          if (versionText && (compact === versionText || compact.includes(versionText) || compact.includes('gpt' + versionText))) return true;
          return strongAliasMatches(/gpt/i);
        }
        if (targetModel.source === 'relay') {
          if (relayPattern.test(raw) && versionText && compact.includes(versionText)) return true;
          if (!/gpt/i.test(modelText) && versionText && (compact === versionText || compact.includes(versionText))) return true;
          return strongAliasMatches(relayPattern);
        }
        return targetAliases.some(alias => raw.includes(alias) || modelText.includes(alias) || comparableModelText(alias) === compact);
      };
      const hasOpenMenu = () => [...document.querySelectorAll('[role="menu"]')].filter(visible).some(menu => menu.getAttribute('data-state') === 'open' || normalize(menu.innerText));
      const hasModelTargetItem = () => [...document.querySelectorAll('[role="menuitem"]')]
        .filter(visible)
        .some(item => normalize(item.innerText) === targetDisplayName);
      const getTrigger = () => [...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
        .filter(visible)
        .map(button => ({ button, rect: button.getBoundingClientRect(), text: normalize(button.innerText) }))
        .filter(item => item.rect.x > 300 && item.rect.y > window.innerHeight * 0.45)
        .sort((a, b) => b.rect.y - a.rect.y || b.rect.x - a.rect.x)[0];

      resetHorizontalLayoutScroll();
      let trigger = getTrigger();
      if (!trigger) return { ok: false, reason: '找不到模型/推理菜单按钮' };
      const reasoningBefore = reasoningFromFooterText(trigger.text);

      if (!hasModelTargetItem()) {
        if (hasOpenMenu()) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
          document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: 1, clientY: 1 }));
          document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: 1, clientY: 1 }));
          document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: 1, clientY: 1 }));
          document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: 1, clientY: 1 }));
          await sleep(140);
          resetHorizontalLayoutScroll();
          trigger = getTrigger() || trigger;
        }
        domClick(trigger.button);
        await sleep(280);
      }

      const submenuEntries = [...document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')]
        .filter(visible)
        .map(item => ({ item, text: normalize(item.innerText), rect: item.getBoundingClientRect() }))
        .filter(entry => entry.text && !speedTextPattern.test(entry.text));
      let submenuTrigger = submenuEntries
        .filter(entry => modelTextPattern.test(entry.text))
        .sort((a, b) => b.rect.y - a.rect.y || b.rect.x - a.rect.x)[0]?.item || null;
      if (!submenuTrigger && submenuEntries.length === 1) {
        submenuTrigger = submenuEntries[0].item;
      }
      if (!submenuTrigger) {
        return {
          ok: false,
          reason: '找不到模型子菜单入口',
          targetDisplayName,
          menuText: [...document.querySelectorAll('[role="menu"]')].map(item => normalize(item.innerText)).join(' | ').slice(0, 800),
          menuItems: [...document.querySelectorAll('[role="menuitem"]')].filter(visible).map(item => normalize(item.innerText)).filter(Boolean).slice(0, 40),
        };
      }

      let target = null;
      const findTarget = () => {
        const modelItems = [...document.querySelectorAll('[role="menuitem"]')]
          .filter(visible)
          .map(item => ({ item, text: normalize(item.innerText), selected: item.getAttribute('data-model-selected') === 'true', popup: item.getAttribute('aria-haspopup') || '' }))
          .filter(entry => entry.text && !entry.popup && !reasoningLabels.includes(entry.text));
        return modelItems.find(entry => entry.text === targetDisplayName)
          || modelItems.find(entry => targetAliases.includes(entry.text))
          || modelItems.find(entry => targetDisplayName && entry.text.includes(targetDisplayName))
          || modelItems.find(entry => targetAliases.some(alias => alias && entry.text.length >= 3 && alias.length >= 3 && (entry.text.includes(alias) || alias.includes(entry.text))))
          || modelItems.find(entry => matchesTargetModelText(entry.text))
          || null;
      };

      target = findTarget();
      if (!target) {
        domClick(submenuTrigger);
        const deadline = Date.now() + 1800;
        while (!target && Date.now() < deadline) {
          await sleep(120);
          target = findTarget();
        }
      }
      if (!target) {
        return {
          ok: false,
          reason: '找不到目标模型菜单项',
          targetDisplayName,
          submenuText: normalize(submenuTrigger.innerText),
          items: [...document.querySelectorAll('[role="menuitem"]')].filter(visible).map(item => normalize(item.innerText)).filter(Boolean).slice(0, 60),
        };
      }

      domClick(target.item);
      let footerText = '';
      let afterText = '';
      const deadlineAfterClick = Date.now() + 2200;
      while (Date.now() < deadlineAfterClick) {
        await sleep(140);
        resetHorizontalLayoutScroll();
        trigger = getTrigger() || trigger;
        footerText = normalize([...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
          .filter(visible)
          .map(item => item.innerText)
          .join(' '));
        afterText = trigger ? normalize(trigger.button.innerText) : footerText;
        if (matchesTargetModelText(footerText) || matchesTargetModelText(afterText)) break;
      }
      if (!matchesTargetModelText(footerText) && !matchesTargetModelText(afterText)) {
        return {
          ok: false,
          reason: '已点击目标模型，但 Codex 页脚没有确认切换成功',
          targetDisplayName,
          targetModel,
          targetAliases,
          clickedText: target.text,
          footerText,
          afterText,
          submenuText: normalize(submenuTrigger.innerText),
        };
      }
      let restoredReasoning = null;
      const reasoningAfterModelClick = reasoningFromFooterText(afterText || footerText);
      if (reasoningBefore && reasoningAfterModelClick && reasoningAfterModelClick !== reasoningBefore) {
        trigger = getTrigger() || trigger;
        domClick(trigger.button);
        await sleep(260);
        const reasoningTarget = [...document.querySelectorAll('[role="menuitem"]')]
          .filter(visible)
          .map(item => ({ item, text: normalize(item.innerText) }))
          .find(entry => entry.text === reasoningBefore);
        if (reasoningTarget) {
          domClick(reasoningTarget.item);
          const reasoningDeadline = Date.now() + 1800;
          while (Date.now() < reasoningDeadline) {
            await sleep(140);
            resetHorizontalLayoutScroll();
            trigger = getTrigger() || trigger;
            footerText = normalize([...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
              .filter(visible)
              .map(item => item.innerText)
              .join(' '));
            afterText = trigger ? normalize(trigger.button.innerText) : footerText;
            if ((matchesTargetModelText(footerText) || matchesTargetModelText(afterText)) && reasoningFromFooterText(afterText || footerText) === reasoningBefore) break;
          }
          restoredReasoning = { from: reasoningAfterModelClick, to: reasoningBefore, clickedText: reasoningTarget.text };
        } else {
          restoredReasoning = { from: reasoningAfterModelClick, to: reasoningBefore, reason: '找不到原推理档位菜单项' };
        }
      }
      return { ok: true, targetDisplayName, targetModel, actualModelDisplayName: modelTextFromFooterText(afterText || footerText), clickedText: target.text, alreadySelected: target.selected, footerText, afterText, restoredReasoning, submenuText: normalize(submenuTrigger.innerText) };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || `CDP 模型切换失败：${targetDisplayName}`);
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { ...result, selected };
  });
}

async function cdpSwitchComposerReasoning(threadId = '', targetDisplayName = '') {
  return withCodexCdp(async client => {
    const selected = threadId ? await cdpClickThread(client, threadId, { settleMs: 180 }) : { ok: true, skipped: true };
    const result = await cdpEvaluate(client, `(async () => {
      const targetDisplayName = ${jsLiteral(targetDisplayName)};
      const visible = ${cdpVisibleHelperSource()};
      const domClick = ${cdpDomClickHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const reasoningFromFooterText = text => {
        const parts = normalize(text).split(' ').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        return ['极低', '低', '中', '高', '超高'].includes(last) ? last : '';
      };
      const trigger = [...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
        .filter(visible)
        .map(button => ({ button, rect: button.getBoundingClientRect(), text: normalize(button.innerText) }))
        .filter(item => item.rect.x > 300 && item.rect.y > window.innerHeight * 0.55)
        .sort((a, b) => b.rect.y - a.rect.y || b.rect.x - a.rect.x)[0];
      if (!trigger) return { ok: false, reason: '找不到模型/推理菜单按钮' };

      domClick(trigger.button);
      await sleep(260);

      const reasoningItems = [...document.querySelectorAll('[role="menuitem"]')]
        .filter(visible)
        .map(item => ({ item, text: normalize(item.innerText), selected: item.getAttribute('data-reasoning-selected') === 'true' }))
        .filter(entry => ['低', '中', '高', '超高'].includes(entry.text));
      const target = reasoningItems.find(entry => entry.text === targetDisplayName);
      if (!target) return { ok: false, reason: '找不到目标推理模式菜单项', targetDisplayName, items: reasoningItems.map(entry => entry.text) };
      domClick(target.item);
      let triggerAfter = null;
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        await sleep(140);
        triggerAfter = [...document.querySelectorAll('button[data-codex-intelligence-trigger]')]
          .filter(visible)
          .map(button => ({ text: normalize(button.innerText), effort: button.getAttribute('data-selected-reasoning-effort') }))
          .find(item => reasoningFromFooterText(item.text) === targetDisplayName || item.effort);
        if (triggerAfter && reasoningFromFooterText(triggerAfter.text) === targetDisplayName) break;
      }
      if (!triggerAfter || reasoningFromFooterText(triggerAfter.text) !== targetDisplayName) {
        return { ok: false, reason: '已点击目标推理模式，但 Codex 页脚没有确认切换成功', targetDisplayName, clickedText: target.text, triggerText: triggerAfter?.text || '', selectedReasoningEffort: triggerAfter?.effort || '' };
      }
      return { ok: true, targetDisplayName, clickedText: target.text, alreadySelected: target.selected, triggerText: triggerAfter?.text || '', selectedReasoningEffort: triggerAfter?.effort || '' };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || `CDP 推理模式切换失败：${targetDisplayName}`);
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { ...result, selected };
  });
}

async function cdpRunThreadAction(threadId, command, options = {}) {
  return withCodexCdp(async client => {
    const selected = await cdpClickThread(client, threadId, { settleMs: 180 });
    const actionLabel = command === 'archive'
      ? '归档对话'
      : command === 'pin'
        ? (options.pinned === false ? '取消置顶对话' : '置顶对话')
        : command === 'rename'
          ? '重命名对话'
          : '';
    const result = await cdpEvaluate(client, `(async () => {
      const command = ${jsLiteral(command)};
      const actionLabel = ${jsLiteral(actionLabel)};
      const newName = ${jsLiteral(options.name || '')};
      const visible = ${cdpVisibleHelperSource()};
      const domClick = ${cdpDomClickHelperSource()};
      const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const menuButton = [...document.querySelectorAll('button[aria-label="对话操作"]')]
        .filter(visible)
        .map(button => ({ button, rect: button.getBoundingClientRect() }))
        .filter(item => item.rect.x > 300 && item.rect.y < 80)
        .sort((a, b) => a.rect.x - b.rect.x)[0]?.button;
      if (!menuButton) return { ok: false, reason: '找不到顶部“对话操作”按钮' };

      const findActionItem = () => {
        const items = [...document.querySelectorAll('[role="menuitem"]')].filter(visible);
        let item = items.find(entry => normalize(entry.innerText).startsWith(actionLabel));
        if (!item && command === 'pin' && actionLabel === '取消置顶对话') {
          item = items.find(entry => /^取消置顶/.test(normalize(entry.innerText)));
        }
        if (!item && command === 'pin' && actionLabel === '置顶对话') {
          item = items.find(entry => /^置顶/.test(normalize(entry.innerText)));
        }
        return { item, items };
      };

      let { item: actionItem, items: menuItems } = findActionItem();
      if (!actionItem) {
        domClick(menuButton);
        await sleep(220);
        ({ item: actionItem, items: menuItems } = findActionItem());
      }
      if (!actionItem) {
        return { ok: false, reason: '找不到' + actionLabel + '菜单项', items: menuItems.map(item => normalize(item.innerText)).filter(Boolean).slice(0, 30) };
      }
      const rect = actionItem.getBoundingClientRect();
      domClick(actionItem);
      await sleep(260);

      if (command === 'rename') {
        const input = [...document.querySelectorAll('input[aria-label="对话标题"],input,textarea')]
          .filter(visible)
          .find(item => item.closest('[role="dialog"]') || item.getAttribute('aria-label') === '对话标题');
        if (!input) return { ok: false, reason: '找不到重命名对话标题输入框' };
        input.focus();
        const valueSetter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
        if (valueSetter) valueSetter.call(input, newName);
        else input.value = newName;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: newName, inputType: 'insertText' }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(80);
        const saveButton = [...document.querySelectorAll('button')]
          .filter(visible)
          .find(button => normalize(button.innerText) === '保存' && (button.closest('[role="dialog"]') || button.type === 'submit'));
        if (!saveButton) return { ok: false, reason: '找不到重命名保存按钮' };
        domClick(saveButton);
        await sleep(360);
        return { ok: true, command, text: normalize(actionItem.innerText), name: newName, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
      }
      return { ok: true, command, actionLabel, text: normalize(actionItem.innerText), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
    })()`);
    if (!result || !result.ok) throw new Error(result?.reason || `CDP 线程操作失败：${command}`);
    await delay(CODEX_COMMAND_SETTLE_MS);
    return { ...result, selected };
  });
}

async function focusTarget(target, threadId = '', options = {}) {
  if (target !== 'codex') {
    const error = new Error('当前版本已移除旧 macOS 自动化，只支持通过 CDP DOM 控制 Codex。');
    error.status = 400;
    error.code = 'UNSUPPORTED_TARGET';
    throw error;
  }
  if (threadId) {
    await withCodexCdp(client => cdpClickThread(client, threadId, { settleMs: 120 }));
  }
  if (!options.skipComposerClick) {
    await withCodexCdp(client => cdpFocusComposer(client));
  }
}

async function activateCodexThread(threadId = '', options = {}) {
  if (!isCodexThreadId(threadId)) return;
  if (options.allowCached && hasFreshCodexThreadActivation(threadId)) return;
  await withCodexCdp(client => cdpClickThread(client, threadId));
}

async function activateNewCodexThread(cwd = '', anchorThreadId = '') {
  await cdpActivateNewThread({ scope: 'project', cwd, anchorThreadId });
}

async function activateNewProjectlessCodexThread(anchorThreadId = '') {
  await cdpActivateNewThread({ scope: 'conversation', anchorThreadId });
}

function validLocalDirectory(value) {
  const normalized = value ? path.normalize(value) : '';
  if (!normalized || !path.isAbsolute(normalized)) return '';
  try {
    return fs.statSync(normalized).isDirectory() ? normalized : '';
  } catch {
    return '';
  }
}

function normalizeNewThreadScope(payload = {}) {
  const raw = typeof payload.scope === 'string' ? payload.scope.trim().toLowerCase() : '';
  if (raw === 'conversation' || raw === 'project') return raw;
  if (payload.isProjectThread === false) return 'conversation';
  if (payload.isProjectThread === true) return 'project';
  return '';
}

function projectCwdOrEmpty(value) {
  const cwd = validLocalDirectory(value);
  if (!cwd) return '';
  return classifyThreadProject(cwd).isProjectThread ? cwd : '';
}

function resolveNewThreadTarget(payload = {}) {
  const scope = normalizeNewThreadScope(payload);
  const projectPath = projectCwdOrEmpty(typeof payload.projectPath === 'string' ? payload.projectPath : '');
  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';

  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }

  if (scope === 'conversation') {
    return { scope: 'conversation', cwd: '', anchorThreadId: threadId };
  }

  if (scope === 'project' && projectPath) {
    return { scope: 'project', cwd: projectPath, anchorThreadId: threadId };
  }

  if (threadId) {
    const file = findCodexSessionFileByThreadId(threadId);
    const metaCwd = file ? readSessionMeta(file).cwd || '' : '';
    const metaProject = classifyThreadProject(validLocalDirectory(metaCwd) || '');
    if (metaProject.isProjectThread) {
      return { scope: 'project', cwd: metaProject.projectPath, anchorThreadId: threadId };
    }
    return { scope: 'conversation', cwd: '', anchorThreadId: threadId };
  }

  if (projectPath) return { scope: 'project', cwd: projectPath, anchorThreadId: '' };
  return { scope: 'conversation', cwd: '', anchorThreadId: '' };
}

async function handleNewCodexThread(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  try {
    const target = resolveNewThreadTarget(payload);
    const project = classifyThreadProject(target.cwd);
    if (project.isProjectThread) {
      await activateNewCodexThread(target.cwd, target.anchorThreadId);
    } else {
      await activateNewProjectlessCodexThread(target.anchorThreadId);
    }
    return json(res, 200, {
      ok: true,
      pending: true,
      cwd: project.isProjectThread ? target.cwd : '',
      projectName: project.projectName,
      projectPath: project.projectPath,
      projectKey: project.projectKey,
      scope: project.isProjectThread ? 'project' : 'conversation',
      message: project.isProjectThread
        ? `已在 Codex 打开“${project.projectName}”的新线程。`
        : '已在 Codex 打开一个新的对话线程。',
    });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '新建线程失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

function sanitizeFileName(name, fallback = 'attachment') {
  const base = path.basename(String(name || fallback)).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100);
  return base || fallback;
}

function extensionForMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/heic') return '.heic';
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'text/plain') return '.txt';
  if (mime === 'text/markdown') return '.md';
  if (mime === 'text/csv') return '.csv';
  if (mime === 'application/zip') return '.zip';
  return '.bin';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

const IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const VIDEO_OR_FILE_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const CODEX_STATUS_TAIL_BYTES = Math.max(CODEX_SESSION_TAIL_BYTES, Math.ceil(IMAGE_ATTACHMENT_BYTES * 4 / 3) + 4 * 1024 * 1024);
function attachmentKindFromMime(mime = '', name = '') {
  const value = String(mime || '').toLowerCase();
  const fileName = String(name || '').toLowerCase();
  if (fileName.endsWith('.psd') || fileName.endsWith('.psb')) return 'file';
  if (value.includes('photoshop')) return 'file';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  return 'file';
}

function attachmentKindLabel(kind = 'file') {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  return '文件';
}

function decodeAttachment(attachment, index, requestDir = UPLOAD_DIR) {
  const dataUrl = String(attachment && attachment.dataUrl || '');
  const match = dataUrl.match(/^data:([^,]*),(.*)$/s);
  if (!match) throw new Error('附件数据格式不正确。');
  const header = String(match[1] || '');
  if (!/(^|;)base64(;|$)/i.test(header)) throw new Error('附件数据格式不正确。');
  const dataMime = header.split(';')[0] || '';
  const mime = String(attachment && attachment.type || dataMime || 'application/octet-stream').toLowerCase();
  const buffer = Buffer.from(String(match[2] || '').replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('附件数据为空。');
  if (MAX_ATTACHMENT_BYTES > 0 && buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`单个附件太大，请控制在 ${formatBytes(MAX_ATTACHMENT_BYTES)} 以内。`);
  const kind = attachmentKindFromMime(mime, attachment.name || '');
  const kindLimit = kind === 'image' ? IMAGE_ATTACHMENT_BYTES : VIDEO_OR_FILE_ATTACHMENT_BYTES;
  if (buffer.length > kindLimit) throw new Error(`单个${attachmentKindLabel(kind)}太大，请控制在 ${formatBytes(kindLimit)} 以内。`);
  fs.mkdirSync(requestDir, { recursive: true });
  const ext = path.extname(attachment.name || '') || extensionForMime(mime);
  const fallbackName = `attachment-${index}${ext}`;
  let fileName = sanitizeFileName(attachment.name || fallbackName, fallbackName);
  if (!path.extname(fileName) && ext) fileName += ext;
  const filePath = path.join(requestDir, `${String(index + 1).padStart(2, '0')}-${fileName}`);
  fs.writeFileSync(filePath, buffer);
  return { filePath, mime, name: attachment.name || fileName, size: buffer.length, kind, dataBase64: buffer.toString('base64') };
}

function decodeAttachments(input, requestId = '') {
  if (!Array.isArray(input)) return [];
  if (MAX_ATTACHMENTS > 0 && input.length > MAX_ATTACHMENTS) throw new Error(`附件最多一次发送 ${MAX_ATTACHMENTS} 个。`);
  const safeRequestId = sanitizeFileName(requestId || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, 'upload');
  const requestDir = path.join(UPLOAD_DIR, safeRequestId);
  return input.map((attachment, index) => decodeAttachment(attachment, index, requestDir));
}

async function pasteAndEnter(text, target = 'frontmost', attachments = [], threadId = '', options = {}) {
  if (target !== 'codex') {
    const error = new Error('当前版本已移除旧 macOS 自动化，只支持通过 CDP DOM 控制 Codex。');
    error.status = 400;
    error.code = 'UNSUPPORTED_TARGET';
    throw error;
  }
  return cdpSendTextToCodex(text, options.skipComposerClick ? '' : threadId, {
    settleMs: undefined,
    attachments,
    guidance: options.guidance === true,
  });
}

function modelSwitchTargetForCurrent(current = {}, requestedTarget = '') {
  const explicit = String(requestedTarget || '').trim();
  if (COMMON_MODEL_TARGETS[explicit]) return COMMON_MODEL_TARGETS[explicit];
  const catalogTarget = findModelOption(explicit);
  if (catalogTarget) return catalogTarget;
  if (current.source === 'official' && current.version === '5.4') return COMMON_MODEL_TARGETS['relay-5.4'];
  if (current.source === 'official' && current.version === '5.5') return COMMON_MODEL_TARGETS['relay-5.5'];
  if (current.source === 'relay' && current.version === '5.4') return COMMON_MODEL_TARGETS['relay-5.5'];
  if (current.source === 'relay' && current.version === '5.5') return COMMON_MODEL_TARGETS['relay-5.4'];
  return COMMON_MODEL_TARGETS['relay-5.5'];
}

async function switchCodexGuiModel(threadId = '', targetKey = '') {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  const file = threadId ? findCodexSessionFileByThreadId(threadId) : findLatestCodexSessionFile();
  const current = file ? currentModelFromItems(readJsonlTailObjects(file, CODEX_SESSION_TAIL_BYTES)) : modelInfoFromId('');
  const target = modelSwitchTargetForCurrent(current, targetKey);

  const switchResult = await cdpSwitchComposerModel(threadId, target);

  return {
    ok: true,
    threadId,
    currentModel: current,
    targetModel: { ...target, available: true, updatedAt: new Date().toISOString(), actualDisplayName: switchResult.actualModelDisplayName || '' },
    switchResult,
    message: `已切换到 ${target.displayName}`,
  };
}

function reasoningModeTargetForCurrent(current = {}, requestedTarget = '') {
  const explicit = String(requestedTarget || '').trim();
  if (REASONING_MODE_TARGETS[explicit]) return REASONING_MODE_TARGETS[explicit];
  const order = ['low', 'medium', 'high', 'xhigh'];
  const currentIndex = order.indexOf(current.key);
  const nextKey = order[(currentIndex + 1 + order.length) % order.length] || 'medium';
  return REASONING_MODE_TARGETS[nextKey] || REASONING_MODE_TARGETS.medium;
}

async function switchCodexReasoningMode(threadId = '', targetKey = '') {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  const file = threadId ? findCodexSessionFileByThreadId(threadId) : findLatestCodexSessionFile();
  const current = file ? currentReasoningModeFromItems(readJsonlTailObjects(file, CODEX_SESSION_TAIL_BYTES)) : reasoningModeFromValue('');
  const target = reasoningModeTargetForCurrent(current, targetKey);

  await cdpSwitchComposerReasoning(threadId, target.displayName);

  return {
    ok: true,
    threadId,
    currentReasoningMode: current,
    targetReasoningMode: { ...target, available: true, updatedAt: new Date().toISOString() },
    message: `已切换推理模式为 ${target.displayName}`,
  };
}

async function switchCodexPermissionMode(threadId = '', targetKey = '') {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }
  const target = PERMISSION_MODE_TARGETS[String(targetKey || '').trim()];
  if (!target) {
    const error = new Error('权限模式不正确。');
    error.status = 400;
    error.code = 'BAD_PERMISSION_MODE';
    throw error;
  }
  const switchResult = await cdpSwitchPermissionMode(threadId, target.key);
  const updatedAt = new Date().toISOString();
  return {
    ok: true,
    threadId,
    targetPermissionMode: { ...target, available: true, displayText: switchResult.afterText || target.label, updatedAt },
    switchResult,
    message: `已切换权限为 ${target.label}`,
  };
}

async function stopCodexResponse(threadId = '') {
  await cdpStopCodexResponse(threadId);
}

async function runCodexThreadCommand(threadId, command, options = {}) {
  if (threadId && !isCodexThreadId(threadId)) {
    const error = new Error('线程 ID 不正确。');
    error.status = 400;
    error.code = 'BAD_THREAD_ID';
    throw error;
  }

  if (command === 'archive') {
    await cdpRunThreadAction(threadId, 'archive');
    return { message: '已归档当前 Codex 线程。' };
  }

  if (command === 'pin') {
    await cdpRunThreadAction(threadId, 'pin', { pinned: options.pinned });
    return { message: options.pinned ? '已置顶当前 Codex 线程。' : '已取消置顶当前 Codex 线程。' };
  }

  if (command === 'rename') {
    const name = String(options.name || '').replace(/\s+/g, ' ').trim();
    if (!name) {
      const error = new Error('新名称不能为空。');
      error.status = 400;
      error.code = 'EMPTY_THREAD_NAME';
      throw error;
    }
    if (name.length > 120) {
      const error = new Error('新名称太长，请控制在 120 个字符以内。');
      error.status = 400;
      error.code = 'THREAD_NAME_TOO_LONG';
      throw error;
    }
    await cdpRunThreadAction(threadId, 'rename', { name });
    return { message: '已重命名当前 Codex 线程。', name };
  }

  const error = new Error('不支持的线程操作。');
  error.status = 400;
  error.code = 'BAD_THREAD_ACTION';
  throw error;
}

async function handleThreadAction(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const action = String(payload.action || '').trim();
  if (!isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    const state = readCodexMiniState();
    let result;
    if (action === 'archive') {
      result = await runCodexThreadCommand(threadId, 'archive');
      state.archivedThreadIds = setThreadSetMembership(state.archivedThreadIds, threadId, true);
      state.pinnedThreadIds = setThreadSetMembership(state.pinnedThreadIds, threadId, false);
    } else if (action === 'pin' || action === 'unpin') {
      const pinned = action === 'pin';
      result = await runCodexThreadCommand(threadId, 'pin', { pinned });
      state.pinnedThreadIds = setThreadSetMembership(state.pinnedThreadIds, threadId, pinned);
    } else if (action === 'rename') {
      result = await runCodexThreadCommand(threadId, 'rename', { name: payload.name });
      state.titleOverrides = state.titleOverrides || {};
      state.titleOverrides[threadId] = { name: result.name, renamedAt: new Date().toISOString() };
    } else {
      return json(res, 400, { ok: false, code: 'BAD_THREAD_ACTION', message: '不支持的线程操作。' });
    }
    writeCodexMiniState(state);
    const nextThreadId = action === 'archive' ? (listCodexThreads(120)[0]?.id || '') : threadId;
    return json(res, 200, { ok: true, action, threadId, nextThreadId, ...result });
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '线程操作失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleStopCodex(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  if (threadId && !isCodexThreadId(threadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  try {
    await stopCodexResponse(threadId);
    return json(res, 200, { ok: true, threadId, message: '已向 Codex 发送终止指令。' });
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained });
  }
}

async function handleModelSwitch(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const target = typeof payload.target === 'string' ? payload.target : '';
  try {
    const result = await switchCodexGuiModel(threadId, target);
    return json(res, 200, result);
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '切换模型失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '没能通过 CDP DOM 切换 Codex 模型。请确认线程守护 App 正在运行。' });
  }
}

async function handleReasoningMode(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const target = typeof payload.target === 'string' ? payload.target : '';
  try {
    const result = await switchCodexReasoningMode(threadId, target);
    return json(res, 200, result);
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '切换推理模式失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '没能通过 CDP DOM 切换 Codex 推理模式。请确认线程守护 App 正在运行。' });
  }
}

async function handleApprovalMode(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const target = typeof payload.target === 'string' ? payload.target : '';
  try {
    const result = await switchCodexPermissionMode(threadId, target);
    return json(res, 200, result);
  } catch (error) {
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '切换权限模式失败。' });
    }
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '没能通过 CDP DOM 切换 Codex 权限模式。请确认线程守护 App 正在运行。' });
  }
}

async function handleApprovalPrompt(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const threadId = url.searchParams.get('thread') || '';
    if (threadId && !isCodexThreadId(threadId)) {
      return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
    }
    const result = await cdpReadShared(`approval-prompt:${threadId}`, 900, () => cdpReadApprovalPrompt(threadId));
    return json(res, 200, result);
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: '读取 Codex 审批弹窗失败。' });
  }
}

async function handleApprovalPromptAction(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  const action = typeof payload.action === 'string' ? payload.action : '';
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (threadId && !isCodexThreadId(threadId)) return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  if (!['allow', 'allowAlways', 'deny', 'submit'].includes(action)) return json(res, 400, { ok: false, code: 'BAD_APPROVAL_ACTION', message: '审批操作不正确。' });

  try {
    const result = await cdpActOnApprovalPrompt(threadId, action, text);
    return json(res, 200, { ok: true, ...result, message: action === 'deny' ? '已拒绝 Codex 审批' : '已提交 Codex 审批' });
  } catch (error) {
    const explained = explainTargetError(error, 'codex');
    return json(res, 500, { ok: false, ...explained, message: error.message || '操作 Codex 审批弹窗失败。' });
  }
}

async function handleSend(req, res) {
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。请使用启动服务时打印出来的完整手机链接。' });
  }

  let payload;
  try {
    const body = await readBody(req);
    payload = JSON.parse(body || '{}');
  } catch (error) {
    return json(res, error.status || 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  const applyQueuedGuidance = payload.applyQueuedGuidance === true || payload.mode === 'queued-guidance';
  const target = payload.target === 'codex' || applyQueuedGuidance ? 'codex' : 'frontmost';
  const selectedThreadId = typeof payload.threadId === 'string' ? payload.threadId : '';
  // The Codex CDP worker is an independent window. Never trust a previous sync cache
  // for sends: always click the selected thread immediately before inserting.
  const assumeThreadSynced = false;
  const expectNewThread = payload.expectNewThread === true && target === 'codex' && !selectedThreadId;
  const directPasteWithoutClick = payload.directPasteWithoutClick === true && expectNewThread;
  const previousThreadId = isCodexThreadId(payload.previousThreadId) ? payload.previousThreadId : '';
  const expectedNewThreadCwd = validLocalDirectory(typeof payload.expectedCwd === 'string' ? payload.expectedCwd : '');
  const clientRequestId = normalizeClientRequestId(payload.clientRequestId);
  const guidanceMode = !applyQueuedGuidance && (payload.guidance === true || payload.mode === 'guidance');
  cleanupRecentSendRequests();
  if (clientRequestId) {
    const existing = recentSendRequests.get(clientRequestId);
    if (existing?.result) return json(res, 200, { ...existing.result, duplicate: true });
    if (existing?.watch) {
      return json(res, 200, {
        ok: true,
        duplicate: true,
        message: '这条发送请求已经被接收，正在继续等待 Codex 回复。',
        target,
        sentAt: existing.sentAt,
        watch: existing.watch,
      });
    }
  }
  let attachments = [];
  try {
    attachments = decodeAttachments(payload.attachments, clientRequestId);
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_ATTACHMENT', message: error.message || '附件不正确。' });
  }
  if (!text.trim() && !attachments.length) {
    return json(res, 400, { ok: false, code: 'EMPTY_MESSAGE', message: '请输入文字或添加附件。' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json(res, 413, { ok: false, code: 'TEXT_TOO_LONG', message: `文字太长了，请控制在 ${MAX_TEXT_LENGTH} 字以内。` });
  }
  if (applyQueuedGuidance && !text.trim()) {
    return json(res, 400, { ok: false, code: 'EMPTY_GUIDANCE', message: '要引导的队列消息不能为空。' });
  }
  if (applyQueuedGuidance && attachments.length) {
    return json(res, 400, { ok: false, code: 'GUIDANCE_ATTACHMENT_UNSUPPORTED', message: '队列引导只支持文字消息，带附件的队列消息请等当前回复完成后发送。' });
  }
  if (applyQueuedGuidance && selectedThreadId && !isCodexThreadId(selectedThreadId)) {
    return json(res, 400, { ok: false, code: 'BAD_THREAD_ID', message: '线程 ID 不正确。' });
  }

  if (applyQueuedGuidance) {
    try {
      const watchSince = new Date(Date.now() - 750).toISOString();
      const watchFile = selectedThreadId ? findCodexSessionFileByThreadId(selectedThreadId) : findLatestCodexSessionFile();
      const watch = {
        since: watchSince,
        threadId: selectedThreadId,
        sessionFile: watchFile ? path.basename(watchFile) : '',
        guidance: true,
        queuedGuidance: true,
      };
      if (clientRequestId) {
        recentSendRequests.set(clientRequestId, {
          createdAt: Date.now(),
          sentAt: new Date().toISOString(),
          watch,
        });
      }
      const sendResult = await cdpApplyQueuedGuidanceToCodex(text, selectedThreadId);
      if (!sendResult.guidance?.ok) {
        const error = new Error(sendResult.guidance?.reason || '没有成功点击队列消息上的引导按钮。');
        error.status = 409;
        error.code = 'GUIDANCE_NOT_APPLIED';
        throw error;
      }
      const result = {
        ok: true,
        message: '已把队列消息作为引导应用到当前回复。',
        target,
        guidance: true,
        queuedGuidance: true,
        guidanceApplied: true,
        guidanceResult: sendResult.guidance,
        sentAt: new Date().toISOString(),
        watch,
      };
      if (clientRequestId) {
        recentSendRequests.set(clientRequestId, {
          createdAt: Date.now(),
          sentAt: result.sentAt,
          watch,
          result,
        });
      }
      return json(res, 200, result);
    } catch (error) {
      if (clientRequestId) recentSendRequests.delete(clientRequestId);
      if (error && error.status) {
        return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '发送引导失败。' });
      }
      const explained = explainTargetError(error, target);
      return json(res, 500, { ok: false, ...explained });
    }
  }

  try {
    const watchSince = new Date(Date.now() - 750).toISOString();
    const watchSinceMs = Date.parse(watchSince) || Date.now();
    const watchFile = expectNewThread ? null : selectedThreadId ? findCodexSessionFileByThreadId(selectedThreadId) : findLatestCodexSessionFile();
    let watch = target === 'codex' ? {
      since: watchSince,
      threadId: selectedThreadId,
      sessionFile: watchFile ? path.basename(watchFile) : '',
      expectNewThread,
      excludeThreadId: expectNewThread ? previousThreadId : '',
      cwd: expectNewThread ? expectedNewThreadCwd : '',
      guidance: guidanceMode,
    } : null;
    if (clientRequestId) {
      recentSendRequests.set(clientRequestId, {
        createdAt: Date.now(),
        sentAt: new Date().toISOString(),
        watch,
      });
    }
    const sendResult = await pasteAndEnter(text, target, attachments, selectedThreadId, { assumeThreadSynced, skipComposerClick: directPasteWithoutClick, guidance: guidanceMode });
    if (guidanceMode && !sendResult.guidance?.ok) {
      const error = new Error(sendResult.guidance?.reason || '消息已进入 Codex 队列，但没有成功点击队列消息上的引导按钮。');
      error.status = 409;
      error.code = 'GUIDANCE_NOT_APPLIED';
      throw error;
    }
    if (expectNewThread && watch) {
      const newSessionFile = await waitForCodexSessionFileForNewSend({
        sinceMs: watchSinceMs,
        text,
        cwd: expectedNewThreadCwd,
        excludeThreadId: previousThreadId,
      });
      if (newSessionFile) {
        watch = {
          ...watch,
          threadId: threadIdFromSessionFile(newSessionFile),
          sessionFile: path.basename(newSessionFile),
          expectNewThread: false,
          excludeThreadId: '',
        };
      }
    }
    const result = {
      ok: true,
      message: '已通过 CDP DOM 发送到 Codex。',
      target,
      guidance: guidanceMode,
      guidanceApplied: guidanceMode ? Boolean(sendResult.guidance?.ok) : false,
      guidanceResult: guidanceMode ? sendResult.guidance : undefined,
      sentAt: new Date().toISOString(),
      attachments: attachments.map(item => ({ name: item.name, size: item.size, type: item.mime })),
      watch,
    };
    if (clientRequestId) {
      recentSendRequests.set(clientRequestId, {
        createdAt: Date.now(),
        sentAt: result.sentAt,
        watch,
        result,
      });
    }
    return json(res, 200, result);
  } catch (error) {
    if (clientRequestId) recentSendRequests.delete(clientRequestId);
    if (error && error.status) {
      return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '发送失败。' });
    }
    const explained = explainTargetError(error, target);
    return json(res, 500, { ok: false, ...explained });
  }
}

// 手机网页首屏按哪种主题渲染：优先用手机自己写的 codexMiniTheme cookie，
// 全局 appearanceSettings 会被电脑端/手机端互相覆盖（light/dark 来回翻），不能作为手机端首屏的依据。
function requestPrefersLightTheme(req) {
  const cookie = String((req.headers && req.headers.cookie) || '');
  const match = /(?:^|;\s*)codexMiniTheme=(light|dark)(?:\s*;|\s*$)/.exec(cookie);
  if (match) return match[1] === 'light';
  return currentAppearanceSettings().theme === 'light';
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    // 浅色外观时在服务端直接写对首屏 meta：theme-color 影响 Safari 顶部，
    // apple-mobile-web-app-status-bar-style 只在主屏幕 Web App 启动时读取，JS 运行时改不了
    if ((ext === '.html' || ext === '.webmanifest') && requestPrefersLightTheme(req)) {
      data = Buffer.from(
        data.toString('utf8')
          // 主屏幕 Web App 启动首帧若是深色，iOS 会把状态栏取色锁死，之后 JS 再切浅色也不跟。
          // 直接在 <html> 写上 theme-light，让首帧即浅色，状态栏才会取到浅色。
          .replace('<html lang="zh-CN">', '<html lang="zh-CN" class="theme-light">')
          .replace('<meta name="theme-color" content="#000000" />', '<meta name="theme-color" content="#f7f7fa" />')
          .replace('<meta name="apple-mobile-web-app-status-bar-style" content="black" />', '<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
          .replace('"background_color": "#0d0d0d"', '"background_color": "#f2f2f7"')
          .replace('"theme_color": "#0d0d0d"', '"theme_color": "#f7f7fa"'),
        'utf8'
      );
    }
    const headers = {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'content-length': data.length,
    };
    if (ext === '.html' && url.searchParams.get('token') === TOKEN) {
      headers['set-cookie'] = `codexMiniToken=${encodeURIComponent(TOKEN)}; Path=/; SameSite=Lax; Max-Age=31536000`;
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function getLanApiBases() {
  const nets = os.networkInterfaces();
  const bases = new Set();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) bases.add(`http://${net.address}:${PORT}`);
    }
  }
  return [...bases];
}

function handleClientConfig(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  const entitlement = BETA_MODE ? currentCodexMiniEntitlement() : { active: !LOCAL_ONLY_MODE };
  const betaRelayBases = BETA_MODE && entitlement.active ? [betaRelayBaseForDevice(entitlement.deviceId)] : [];
  const platformInfo = currentPlatformInfo();
  return json(res, 200, {
    ok: true,
    service: 'codex-mini',
    appName: APP_NAME,
    platform: platformInfo.platform,
    platformLabel: platformInfo.platformLabel,
    osRelease: platformInfo.osRelease,
    betaMode: BETA_MODE,
    localOnly: LOCAL_ONLY_MODE && !betaRelayBases.length,
    localApiBases: getLanApiBases(),
    relayApiBases: betaRelayBases.length ? betaRelayBases : (LOCAL_ONLY_MODE ? [] : RELAY_BASES),
    betaRelayUnlocked: Boolean(betaRelayBases.length),
    license: BETA_MODE ? { active: entitlement.active, reason: entitlement.reason || '', plan: entitlement.plan || '', expiresAt: entitlement.expiresAt || '', deviceId: entitlement.deviceId || getCodexMiniDeviceId(), purchaseURLs: codexMiniPurchaseURLs() } : null,
    modelOptions: readModelCatalogOptions(),
    appearanceSettings: currentAppearanceSettings(),
  });
}

async function handleAppearanceSettings(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, settings: currentAppearanceSettings() });
  }
  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }
  const state = readCodexMiniState();
  state.appearanceSettings = normalizeAppearanceSettings({ ...state.appearanceSettings, ...(payload.settings || payload) });
  writeCodexMiniState(state);
  return json(res, 200, { ok: true, settings: state.appearanceSettings, message: '设置已保存' });
}

function assistantFileReferencesForThread(threadId) {
  const file = findCodexSessionFileByThreadId(threadId);
  if (!file) return new Set();
  const refs = new Set();
  const toolNamesByCallId = new Map();
  for (const line of readTailLinesWithLimit(file, CODEX_HISTORY_TAIL_BYTES)) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload || {};
    if (item.type === 'response_item' && payload.type === 'function_call' && payload.call_id) {
      toolNamesByCallId.set(payload.call_id, payload.name || '');
      continue;
    }
    if (item.type === 'response_item' && payload.type === 'function_call_output' && payload.call_id) {
      const generated = generatedImageAttachmentsFromToolOutput(payload, toolNamesByCallId.get(payload.call_id) || '', threadId);
      for (const attachment of generated) {
        const filePath = normalizeLocalFileReference(new URLSearchParams(String(attachment.downloadPath || '').split('?')[1] || '').get('path') || '');
        if (filePath) refs.add(filePath);
      }
      continue;
    }
    if (item.type === 'event_msg') {
      const generated = generatedImageAttachmentsFromEvent(payload, threadId);
      for (const attachment of generated) {
        const filePath = normalizeLocalFileReference(new URLSearchParams(String(attachment.downloadPath || '').split('?')[1] || '').get('path') || '');
        if (filePath) refs.add(filePath);
      }
      if (generated.length) continue;
    }
    let text = '';
    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      text = sanitizeAssistantHistoryText(extractMessageText(payload.content));
    } else if (item.type === 'event_msg' && payload.type === 'task_complete') {
      text = sanitizeAssistantHistoryText(payload.last_agent_message || '');
    }
    if (!text) continue;
    for (const filePath of extractLocalFileReferencesFromText(text)) refs.add(filePath);
  }
  return refs;
}

function referencedFileMatches(requestedPath, refs) {
  const normalized = normalizeLocalFileReference(requestedPath);
  if (!normalized || !refs.has(normalized)) return false;
  try {
    const realRequested = fs.realpathSync(normalized);
    for (const ref of refs) {
      try { if (fs.realpathSync(ref) === realRequested) return true; } catch {}
    }
  } catch {}
  return refs.has(normalized);
}

function responseAttachmentInfoFromRequest(url) {
  const threadId = url.searchParams.get('thread') || '';
  const requestedPath = normalizeLocalFileReference(url.searchParams.get('path') || '');
  if (!isCodexThreadId(threadId)) { const error = new Error('线程 ID 不正确。'); error.status = 400; error.code = 'BAD_THREAD_ID'; throw error; }
  if (!requestedPath) { const error = new Error('文件路径不正确。'); error.status = 400; error.code = 'BAD_FILE_PATH'; throw error; }
  if (!referencedFileMatches(requestedPath, assistantFileReferencesForThread(threadId))) { const error = new Error('这个文件没有出现在当前 Codex 回复里，不能下载。'); error.status = 403; error.code = 'FILE_NOT_IN_THREAD'; throw error; }
  let stat;
  try { stat = fs.statSync(requestedPath); } catch { const error = new Error('Mac 上没有找到这个文件。'); error.status = 404; error.code = 'FILE_NOT_FOUND'; throw error; }
  if (!stat.isFile()) { const error = new Error('这不是一个可下载文件。'); error.status = 400; error.code = 'NOT_A_FILE'; throw error; }
  const name = path.basename(requestedPath);
  const mime = mimeForFilePath(requestedPath);
  const kind = attachmentKindFromMime(mime, name);
  const limit = responseAttachmentLimitFor(kind);
  if (stat.size > limit) { const error = new Error(`${attachmentKindLabel(kind)}太大，请控制在 ${formatBytes(limit)} 以内。`); error.status = 413; error.code = 'FILE_TOO_LARGE'; throw error; }
  return { threadId, requestedPath, stat, name, mime, kind, limit };
}

function handleCodexFile(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const { requestedPath, stat, name, mime, kind } = responseAttachmentInfoFromRequest(url);
    const inline = url.searchParams.get('inline') === '1' && kind === 'image';
    res.writeHead(200, {
      ...corsHeaders(),
      'content-type': mime,
      'content-length': stat.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': contentDispositionValue(inline, name),
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(requestedPath).on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }).pipe(res);
  } catch (error) {
    if (error && error.status) return json(res, error.status, { ok: false, code: error.code || 'BAD_REQUEST', message: error.message || '读取附件失败。' });
    return json(res, 500, { ok: false, code: 'FILE_DOWNLOAD_FAILED', message: '读取附件失败。', detail: String(error && error.message || error) });
  }
}

function handleHealth(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  scheduleCodexMiniTitleStatusRefresh();
  return json(res, 200, {
    ok: true,
    service: 'codex-mini',
    host: os.hostname(),
    now: new Date().toISOString(),
  });
}

const KEEP_AWAKE_TOGGLE_GIF = Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

function handleKeepAwakeToggle(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(401, { ...corsHeaders(), 'content-type': 'image/gif', 'cache-control': 'no-store', 'content-length': KEEP_AWAKE_TOGGLE_GIF.length });
    res.end(KEEP_AWAKE_TOGGLE_GIF);
    return;
  }
  if (BETA_MODE) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const enabled = url.searchParams.get('enabled') === '1' || url.searchParams.get('enabled') === 'true';
      enabled ? startKeepAwake() : stopKeepAwake();
      scheduleCodexMiniTitleStatusRefresh({ force: true });
    } catch {}
  }
  res.writeHead(200, { ...corsHeaders(), 'content-type': 'image/gif', 'cache-control': 'no-store', 'content-length': KEEP_AWAKE_TOGGLE_GIF.length });
  res.end(KEEP_AWAKE_TOGGLE_GIF);
}

async function handleKeepAwake(req, res) {
  if (!isAuthorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '访问令牌不正确。' });
  if (!BETA_MODE) return json(res, 404, { ok: false, code: 'NOT_AVAILABLE', message: '当前版本不支持保持亮屏。' });

  if (req.method === 'GET') {
    return json(res, 200, { ok: true, ...keepAwakeStatus() });
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch (error) {
    return json(res, 400, { ok: false, code: 'BAD_REQUEST', message: error.message || '请求格式不正确。' });
  }

  try {
    const enabled = payload.enabled === true;
    const status = enabled ? startKeepAwake() : stopKeepAwake();
    scheduleCodexMiniTitleStatusRefresh({ force: true });
    return json(res, 200, {
      ok: true,
      ...status,
      message: status.enabled ? '已开启保持亮屏，Mac 不会自动休眠，也会持续阻止显示器睡眠和屏幕保护' : '已关闭保持亮屏',
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      code: error.code || 'KEEP_AWAKE_FAILED',
      message: error.message || '切换保持亮屏失败。',
    });
  }
}

function getLanUrls() {
  const nets = os.networkInterfaces();
  const urls = new Set([`http://localhost:${PORT}/?token=${TOKEN}`]);
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.add(`http://${net.address}:${PORT}/?token=${TOKEN}`);
      }
    }
  }
  return [...urls];
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  // 所有变更类操作都是 POST：先失效只读 CDP 微缓存，确保操作后的下一轮轮询读到最新 GUI 状态
  if (req.method === 'POST') invalidateCdpReadMicroCache();
  if (req.method === 'GET' && req.url.startsWith('/codex/health')) return handleHealth(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/config')) return handleClientConfig(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && req.url.startsWith('/codex/appearance-settings')) return handleAppearanceSettings(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex-mini/license')) return handleCodexMiniLicenseStatus(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex-mini/trial')) return handleCodexMiniTrial(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex-mini/activate')) return handleCodexMiniLicenseActivate(req, res);
  if (req.method === 'POST' && req.url.startsWith('/send')) return handleSend(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/threads')) return handleThreads(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/history')) return handleThreadHistory(req, res);
  if ((req.method === 'GET' || req.method === 'HEAD') && req.url.startsWith('/codex/file')) return handleCodexFile(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/project-order')) return handleCodexProjectOrder(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/gui-status')) return handleCodexGuiStatus(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/approval-prompt')) return handleApprovalPrompt(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/status')) return handleCodexStatus(req, res);
  if (req.method === 'GET' && req.url.startsWith('/codex/keep-awake-toggle')) return handleKeepAwakeToggle(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && req.url.startsWith('/codex/keep-awake')) return handleKeepAwake(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/select')) return handleSelectThread(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/new-thread')) return handleNewCodexThread(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/thread-action')) return handleThreadAction(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/model-switch')) return handleModelSwitch(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/reasoning-mode')) return handleReasoningMode(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/approval-mode')) return handleApprovalMode(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/approval-prompt-action')) return handleApprovalPromptAction(req, res);
  if (req.method === 'POST' && req.url.startsWith('/codex/stop')) return handleStopCodex(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  startUploadCacheCleanup();
  ensureKeepAwakeDesired();
  startBetaTunnelSoon();
  startCodexMiniTitleStatusWatcher();
  startTaskCompletionNotificationWatcher();
  const urls = getLanUrls();
  console.log('\nCodex mini is running.');
  console.log('Keep this terminal open, put your Mac cursor where you want text, then open one of these URLs on your phone:');
  for (const url of urls) console.log(`  ${url}`);
  console.log('\nTip: phone and Mac must be on the same Wi‑Fi. Press Ctrl+C to stop.\n');
});

process.on('exit', cleanupKeepAwake);
process.on('SIGINT', () => {
  cleanupKeepAwake();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupKeepAwake();
  process.exit(143);
});
