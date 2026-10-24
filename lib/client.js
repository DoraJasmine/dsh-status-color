window.__ModuleLoader__.load({ id: "dsh-status-color", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-status-color — client half（web 客户端）。
// 给输入框下方统计条（composer stats pills）上色：
//   ① 速度读数（tok/s，activity pill）
//   ② 缓存命中率（缓存命中 X% / Cache hit X%，usage pill）
// 阈值、颜色、加粗、开关、刷新间隔全部由配置驱动：
//   配置文件 ~/.dsh/dsh-status-color/config.json（由宿主半边 RPC 提供），
//   客户端按 refreshMs 轮询热更新，无需重启 DSH。
// 配色分档默认值借鉴 ByteRax/zcode-token-usage-statusbar。
// 实现：MutationObserver 监听 [data-composer-stat] 内的文本，把命中读数的
// 文本节点原位包进 <span class="dsh-status-color-seg">（保留 React 持有的
// 节点引用，后续更新不冲突），按配置上色；关闭的指标自动还原。
// 找不到统计条时静默待机，绝不触碰聊天正文，失败不影响宿主。
'use strict';

const PKG = 'dsh-status-color';
const RPC_BASE = '/_dsh/' + PKG;
const SEGMENT_CLASS = 'dsh-status-color-seg';
const PILL_SELECTOR = '[data-composer-stat]';
const SPEED_RX = /([0-9]+(?:[.,][0-9]+)?)\s*tok\/s/;
const CACHE_RX = /(?:缓存命中|cache hit)\s*([0-9]+(?:[.,][0-9]+)?)\s*%/i;
const FETCH_TIMEOUT_MS = 8000;
const REFRESH_MIN_MS = 1000;
const REFRESH_MAX_MS = 60000;

// ── 默认配置（config.json 缺省/字段缺失时生效）────────────────
const DEFAULT_CONFIG = {
  version: 1,
  refreshMs: 5000,
  speed: {
    enabled: true,
    bands: [
      { min: 70, color: '#3ecf8e', bold: true },
      { min: 40, color: '#f5b944', bold: true }
    ],
    fallback: { color: '#ff6b57', bold: true }
  },
  cacheHit: {
    enabled: true,
    bands: [
      { min: 80, color: '#3ecf8e', bold: true },
      { min: 50, color: '#f5b944', bold: true }
    ],
    fallback: { color: '#ff6b57', bold: true }
  }
};
// ───────────────────────────────────────────────────────────────

function toBoldWeight(bold) {
  if (bold === true) return '600';
  if (typeof bold === 'number') return String(bold);
  if (typeof bold === 'string' && bold) return bold;
  return '';
}

function normalizeMetric(incoming, name) {
  const base = DEFAULT_CONFIG[name];
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  const bands = Array.isArray(src.bands)
    ? src.bands
      .filter((b) => b && typeof b === 'object' && typeof b.min === 'number' && typeof b.color === 'string' && b.color)
      .map((b) => ({ min: b.min, color: b.color, bold: b.bold }))
      .sort((a, b) => b.min - a.min)
    : base.bands;
  const fallback = src.fallback && typeof src.fallback === 'object' && typeof src.fallback.color === 'string' && src.fallback.color
    ? { color: src.fallback.color, bold: src.fallback.bold }
    : base.fallback;
  return { enabled: src.enabled !== false, bands, fallback };
}

function normalizeConfig(incoming) {
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  let refreshMs = typeof src.refreshMs === 'number' ? src.refreshMs : DEFAULT_CONFIG.refreshMs;
  refreshMs = Math.min(REFRESH_MAX_MS, Math.max(REFRESH_MIN_MS, refreshMs));
  return {
    version: 1,
    refreshMs,
    speed: normalizeMetric(src.speed, 'speed'),
    cacheHit: normalizeMetric(src.cacheHit, 'cacheHit')
  };
}

let config = normalizeConfig(null);

function resolveStyle(metric, value) {
  const conf = config[metric];
  if (!conf || conf.enabled === false) return null;
  for (const band of conf.bands) if (value >= band.min) return band;
  return conf.fallback;
}

function matchMetric(text) {
  let m = SPEED_RX.exec(text);
  if (m) return { metric: 'speed', value: parseFloat(m[1].replace(',', '.')) };
  m = CACHE_RX.exec(text);
  if (m) return { metric: 'cacheHit', value: parseFloat(m[1].replace(',', '.')) };
  return null;
}

function applyStyle(el, style) {
  el.style.color = style.color;
  el.style.fontWeight = toBoldWeight(style.bold);
}

function unwrapNode(node) {
  const parent = node.parentElement;
  if (parent && parent.classList && parent.classList.contains(SEGMENT_CLASS)) {
    parent.replaceWith(node); // 还原文本节点，React 引用不变
  }
}

function colorizeRoot(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && (SPEED_RX.test(n.nodeValue) || CACHE_RX.test(n.nodeValue))) nodes.push(n);
  }
  for (const node of nodes) {
    const hit = matchMetric(node.nodeValue);
    if (!hit) continue;
    const conf = config[hit.metric];
    if (!conf || conf.enabled === false) { unwrapNode(node); continue; }
    const style = resolveStyle(hit.metric, hit.value);
    if (!style) continue;
    const parent = node.parentElement;
    if (parent && parent.classList && parent.classList.contains(SEGMENT_CLASS)) {
      applyStyle(parent, style); // 已是本插件的包裹层：仅更新颜色
      continue;
    }
    if (!node.parentNode) continue;
    // 把同一个文本节点原位包进 span：React 持有的引用不变，后续更新仍生效。
    const span = document.createElement('span');
    span.className = SEGMENT_CLASS;
    applyStyle(span, style);
    node.parentNode.insertBefore(span, node);
    span.appendChild(node);
  }
  // React 卸载读数后清理遗留空壳。
  const shells = root.querySelectorAll(':scope ' + '.' + SEGMENT_CLASS);
  for (const el of shells) if (!el.firstChild) el.remove();
}

function colorizeAll() {
  const pills = document.querySelectorAll(PILL_SELECTOR);
  for (const pill of pills) colorizeRoot(pill);
}

let scheduled = false;
function scheduleColorize() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    try {
      colorizeAll();
    } catch (err) {
      // 上色失败不影响宿主：静默一次，等下一次 DOM 变更再试。
    }
  });
}

// ── 配置热更新：轮询宿主 RPC，refreshMs 可配 ────────────────────
let fetching = false;
let timer = null;

async function refreshConfig() {
  if (fetching) return;
  fetching = true;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(RPC_BASE + '/getConfig', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const body = await res.json();
      if (body && body.config && typeof body.config === 'object') {
        const next = normalizeConfig(body.config);
        const changed = JSON.stringify(next) !== JSON.stringify(config);
        config = next;
        scheduleColorize(); // 立即按新配置重涂（含还原已关闭指标）
        if (changed) restartTimer(); // refreshMs 变了才重建定时器
      }
    }
  } catch (err) {
    // 宿主路由不可达（DSH 版本较旧 / webServer 缺席）：沿用当前配置。
  } finally {
    fetching = false;
  }
}

function restartTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(refreshConfig, config.refreshMs);
}

module.exports = {
  inject: [],
  async apply(ctx) {
    // HMR 或重复 materialize 时的防重入。
    if (window.__DSH_STATUS_COLOR_ACTIVE__) return;
    window.__DSH_STATUS_COLOR_ACTIVE__ = true;

    const observer = new MutationObserver(scheduleColorize);
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
    scheduleColorize();
    refreshConfig();
    restartTimer();

    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshConfig();
    };
    document.addEventListener('visibilitychange', onVisible);

    // 调试入口：控制台里可看当前配置 / 手动刷新。
    window.__DSH_STATUS_COLOR__ = {
      refreshConfig,
      get config() {
        return config;
      }
    };

    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        observer.disconnect();
        if (timer) clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        delete window.__DSH_STATUS_COLOR__;
        window.__DSH_STATUS_COLOR_ACTIVE__ = false;
      }, 'dsh-status-color');
    }
  }
};

return module.exports;
} });
