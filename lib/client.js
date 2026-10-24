window.__ModuleLoader__.load({ id: "dsh-status-color", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-status-color — client half（web 客户端）。
// 两件事：
//   ① 给输入框下方统计条（composer stats pills）上色：
//      tok/s 速度（activity pill）与缓存命中率（usage pill），阈值/颜色/加粗可配。
//   ② 向插件管理器的 plugins.row.config 槽位注册配置表单（key = "包名#行id"，
//      参照 dsh-context 的槽位挂载方式），表单数据走本插件自己的
//      getConfig / setConfig RPC，落盘到 ~/.dsh/dsh-status-color/config.json。
// 配色分档默认值：速度 ≥70 绿 / ≥40 黄 / 其余红；命中率 ≥80% 绿 / ≥50% 黄 / 其余红。
// 实现：MutationObserver 监听 [data-composer-stat] 内的文本，把含读数的文本节点
// 原位包进 <span class="dsh-status-color-seg">（保留 React 持有的节点引用，后续
// 更新不冲突），按配置上色；关闭的指标自动还原；找不到统计条时静默待机。
'use strict';

const React = require('react');

const PKG = 'dsh-status-color';
const ROW_KEY = 'dsh-status-color#status-color';
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

// ════════════════════════════════════════════════════════════════
// ① 状态条上色
// ════════════════════════════════════════════════════════════════

let pillConfig = normalizeConfig(null);

function resolveStyle(metric, value) {
  const conf = pillConfig[metric];
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
    const conf = pillConfig[hit.metric];
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

function rpc(method, body) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(RPC_BASE + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: ctrl.signal
  }).then((res) => {
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

// ── 配置热更新：轮询宿主 RPC，refreshMs 可配 ────────────────────
let fetching = false;
let pollTimer = null;

async function refreshPillConfig() {
  if (fetching) return;
  fetching = true;
  try {
    const body = await rpc('getConfig');
    if (body && body.config && typeof body.config === 'object') {
      const next = normalizeConfig(body.config);
      const changed = JSON.stringify(next) !== JSON.stringify(pillConfig);
      pillConfig = next;
      scheduleColorize(); // 立即按新配置重涂（含还原已关闭指标）
      if (changed) restartPoll(); // refreshMs 变了才重建定时器
    }
  } catch (err) {
    // 宿主路由不可达（DSH 版本较旧 / webServer 缺席）：沿用当前配置。
  } finally {
    fetching = false;
  }
}

function restartPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshPillConfig, pillConfig.refreshMs);
}

// ════════════════════════════════════════════════════════════════
// ② 插件卡片配置表单（plugins.row.config 槽位）
// ════════════════════════════════════════════════════════════════

const FORM_CSS = [
  '.dshsc-card{display:flex;flex-direction:column;gap:10px;max-width:560px;font-size:13px;color:var(--dsw-alias-label-primary,inherit)}',
  '.dshsc-group{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;padding:10px 12px;margin:0;display:flex;flex-direction:column;gap:8px}',
  '.dshsc-group>legend{font-weight:600;padding:0 4px}',
  '.dshsc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.dshsc-row .dshsc-label{min-width:9em;color:var(--dsw-alias-label-secondary,inherit)}',
  '.dshsc-note{color:var(--dsw-alias-label-tertiary,inherit);margin:0}',
  '.dshsc-status{color:var(--dsw-alias-label-tertiary,inherit)}',
  '.dshsc-color{width:2.2em;height:1.6em;padding:0;border:none;background:none;vertical-align:middle}',
  '.dshsc-text{flex:1;min-width:9em}',
  '.dshsc-num{width:6em}'
].join('\n');

function injectFormCss() {
  if (typeof document === 'undefined' || document.getElementById('dsh-status-color-form-css')) return;
  const tag = document.createElement('style');
  tag.id = 'dsh-status-color-form-css';
  tag.textContent = FORM_CSS;
  document.head.appendChild(tag);
}

function el(type, props) {
  const children = Array.prototype.slice.call(arguments, 2).flat();
  return React.createElement(type, props || {}, ...children.filter((c) => c !== null && c !== undefined));
}

function ColorField(label, value, onChange) {
  const hex = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/i.test(value) ? value : '#7f7f7f';
  return el('div', { className: 'dshsc-row' },
    el('span', { className: 'dshsc-label' }, label),
    el('input', { type: 'color', className: 'dshsc-color', value: hex, onChange: (e) => onChange(e.target.value) }),
    el('input', {
      type: 'text', className: 'dshsc-text', value: value ?? '', placeholder: '#3ecf8e / red',
      onChange: (e) => onChange(e.target.value)
    })
  );
}

function NumberField(label, value, onChange, props) {
  return el('div', { className: 'dshsc-row' },
    el('span', { className: 'dshsc-label' }, label),
    el('input', { type: 'number', className: 'dshsc-num', value: value ?? 0, min: 0, ...(props || {}), onChange: (e) => onChange(Number(e.target.value)) })
  );
}

function BoolField(label, value, onChange) {
  return el('label', { className: 'dshsc-row' },
    el('input', { type: 'checkbox', checked: value !== false, onChange: (e) => onChange(e.target.checked) }),
    el('span', { className: 'dshsc-label' }, label)
  );
}

function MetricGroup(title, conf, onChange) {
  const bands = Array.isArray(conf.bands) && conf.bands.length > 0 ? conf.bands : DEFAULT_CONFIG.speed.bands;
  const fallback = conf.fallback || DEFAULT_CONFIG.speed.fallback;
  const bold = bands[0] ? bands[0].bold !== false : true;
  const patchBand = (index, patch) => {
    onChange({ ...conf, bands: bands.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
  };
  const setBold = (next) => {
    onChange({
      ...conf,
      bands: bands.map((b) => ({ ...b, bold: next })),
      fallback: { ...fallback, bold: next }
    });
  };
  return el('fieldset', { className: 'dshsc-group' },
    el('legend', null, title),
    BoolField('上色开关', conf.enabled !== false, (v) => onChange({ ...conf, enabled: v })),
    NumberField('高档阈值（绿色，含）', bands[0] ? bands[0].min : 0, (v) => patchBand(0, { min: v })),
    ColorField('高档颜色', bands[0] ? bands[0].color : '#3ecf8e', (v) => patchBand(0, { color: v })),
    NumberField('中档阈值（黄色，含）', bands[1] ? bands[1].min : 0, (v) => patchBand(1, { min: v })),
    ColorField('中档颜色', bands[1] ? bands[1].color : '#f5b944', (v) => patchBand(1, { color: v })),
    ColorField('兜底颜色（低于所有档）', fallback.color, (v) => onChange({ ...conf, fallback: { ...fallback, color: v } })),
    BoolField('数字加粗', bold, setBold)
  );
}

function ConfigCard() {
  const [config, setConfigState] = React.useState(null);
  const [status, setStatus] = React.useState('loading');
  const saveTimer = React.useRef(null);

  const load = React.useCallback(async () => {
    try {
      const body = await rpc('getConfig');
      if (body && body.config) {
        setConfigState(normalizeConfig(body.config));
        setStatus('ready');
      } else {
        setStatus('error');
      }
    } catch (err) {
      setStatus('error');
    }
  }, []);

  React.useEffect(() => {
    load();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [load]);

  const update = (next) => {
    setConfigState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await rpc('setConfig', { config: next });
        await load();
      } catch (err) {
        setStatus('error');
      }
    }, 400);
  };

  if (status === 'loading' && !config) {
    return el('p', { className: 'dshsc-note' }, '正在读取配置…');
  }
  if (!config) {
    return el('p', { className: 'dshsc-note' },
      '配置读取失败：宿主路由不可达。可编辑 ~/.dsh/dsh-status-color/config.json，或重启 DSH 后重试。');
  }
  return el('div', { className: 'dshsc-card' },
    el('p', { className: 'dshsc-note' }, '修改自动保存（写入 config.json），状态条约 5 秒内生效。'),
    MetricGroup('tok/s 生成速度', config.speed, (next) => update({ ...config, speed: next })),
    MetricGroup('缓存命中率', config.cacheHit, (next) => update({ ...config, cacheHit: next })),
    NumberField('配置刷新间隔 refreshMs（1000–60000 毫秒）', config.refreshMs, (v) => update({ ...config, refreshMs: Math.min(60000, Math.max(1000, v)) })),
    el('p', { className: 'dshsc-status' }, status === 'error' ? '上次保存失败，请重试或检查 DSH 日志。' : '')
  );
}

function registerRowConfigSlot(ctx) {
  if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return;
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: ROW_KEY,
    locale: PKG,
    inject: () => ({})
  }, () => React.createElement(ConfigCard)));
}

module.exports = {
  inject: ['slots'],
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
    refreshPillConfig();
    restartPoll();

    // 插件卡片上的配置表单（plugins.row.config 槽位，key = 包名#行id）。
    try {
      injectFormCss();
      registerRowConfigSlot(ctx);
    } catch (err) {
      // 槽位不可用（旧版本宿主）时静默跳过，上色功能不受影响。
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPillConfig();
    };
    document.addEventListener('visibilitychange', onVisible);

    // 调试入口：控制台里可看当前配置 / 手动刷新。
    window.__DSH_STATUS_COLOR__ = {
      refreshConfig: refreshPillConfig,
      get config() {
        return pillConfig;
      }
    };

    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
        document.removeEventListener('visibilitychange', onVisible);
        delete window.__DSH_STATUS_COLOR__;
        window.__DSH_STATUS_COLOR_ACTIVE__ = false;
      }, 'dsh-status-color');
    }
  }
};

return module.exports;
} });
