// dsh-status-color — host half（宿主进程侧，cordis 插件）。
//
// 职责：把生效配置提供给 web 客户端（lib/client.js 负责全部上色工作）。
// 配置有两个来源，行配置（DSH 设置页，优先）覆盖 config.json（兜底）：
//   1. 设置页：导出 schemastery 的 Config（每个可配置字段都 volatile——设置表单
//      只渲染 volatile 字段，参照 dsh-context / git-graph），宿主为插件行自动生成
//      设置表单；用户在 插件 卡片里改阈值/颜色，volatile 引用实时生效（.get()/
//      .volatile() 读到最近提交值），结构性行变更时 apply 携新配置重入。
//   2. 文件兜底：~/.dsh/dsh-status-color/config.json（web 端 / 未在设置页配置时可用）。
// RPC：webServer HTTP 路由（POST /_dsh/dsh-status-color/getConfig，JSON 进出，
// 宿主认证边界与 dsh-bottom-info-bar 等社区插件一致）。webServer 是可选服务，
// 缺席（旧版本 / 无 GUI）时静默跳过，客户端退回内置默认配置。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-status-color";
export const inject = [];
export const reusable = true;

const PKG = "dsh-status-color";
const ROUTE_PREFIX = "/_dsh/" + PKG;
const BODY_LIMIT = 64 * 1024;

// ── 设置页 schema：导出 Config，宿主为插件行自动生成设置表单 ────────
// 关键：设置表单只渲染 volatile 字段（参照 dsh-context 的 k() 包装与
// git-graph 的全 volatile 字段）。扁平结构保证每个字段都是固定路径，
// 可以全部 volatile；RPC 侧再把扁平键映射回客户端的嵌套结构。
// 中文/英文字段标签经 Schema.prototype.i18n 提供。
const field = (schema, zh, en) => schema.i18n({ zh, en }).volatile();

export const Config = z.object({
  refreshMs: field(z.number().min(1000).max(60000).default(5000), "配置刷新间隔（毫秒）", "Config refresh interval (ms)"),
  speedEnabled: field(z.boolean().default(true), "速度上色开关", "Colorize tok/s speed"),
  speedFastMin: field(z.number().min(0).default(70), "速度·快速档阈值（含，绿色）", "Speed fast threshold (green)"),
  speedFastColor: field(z.string().default("#3ecf8e"), "速度·快速档颜色", "Speed fast color"),
  speedSlowMin: field(z.number().min(0).default(40), "速度·慢速档阈值（含，黄色）", "Speed slow threshold (amber)"),
  speedSlowColor: field(z.string().default("#f5b944"), "速度·慢速档颜色", "Speed slow color"),
  speedRedColor: field(z.string().default("#ff6b57"), "速度·低于所有档颜色", "Speed fallback color"),
  speedBold: field(z.boolean().default(true), "速度数字加粗", "Bold speed digits"),
  cacheHitEnabled: field(z.boolean().default(true), "缓存命中率上色开关", "Colorize cache-hit rate"),
  cacheHitHighMin: field(z.number().min(0).default(80), "命中率·高档阈值（含，绿色）", "Cache-hit high threshold (green)"),
  cacheHitHighColor: field(z.string().default("#3ecf8e"), "命中率·高档颜色", "Cache-hit high color"),
  cacheHitMidMin: field(z.number().min(0).default(50), "命中率·中档阈值（含，黄色）", "Cache-hit mid threshold (amber)"),
  cacheHitMidColor: field(z.string().default("#f5b944"), "命中率·中档颜色", "Cache-hit mid color"),
  cacheHitRedColor: field(z.string().default("#ff6b57"), "命中率·低于所有档颜色", "Cache-hit fallback color"),
  cacheHitBold: field(z.boolean().default(true), "命中率数字加粗", "Bold cache-hit digits")
});

// ── 配置读取 ─────────────────────────────────────────────────────

/** 与 @deepseek-ai/dsh-home-paths 一致的 home 解析：显式环境变量 DSH_HOME 优先，默认 ~/.dsh。 */
function dshHome() {
  const env = (process.env.DSH_HOME || "").trim();
  if (!env) return join(homedir(), ".dsh");
  if (env === "~") return homedir();
  if (env.startsWith("~/") || env.startsWith("~\\")) return join(homedir(), env.slice(2));
  return resolvePath(env);
}

function configPath() {
  return join(dshHome(), PKG, "config.json");
}

/** 递归解引用：volatile 配置值是带 .get()/.volatile() 方法的 live 引用，普通值原样返回。 */
function readLive(value) {
  if (value && typeof value === "object" && typeof value.get === "function") {
    return readLive(value.get());
  }
  if (value && typeof value === "object" && typeof value.volatile === "function") {
    return readLive(value.volatile());
  }
  if (Array.isArray(value)) return value.map(readLive);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, member] of Object.entries(value)) out[key] = readLive(member);
    return out;
  }
  return value;
}

/** 把扁平的行配置键映射回客户端认识的嵌套结构（丢弃未知键与非法项）。 */
function projectRowConfig(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  if (typeof row.refreshMs === "number") out.refreshMs = row.refreshMs;
  const pickMetric = (prefix) => {
    const picked = {};
    if (typeof row[`${prefix}Enabled`] === "boolean") picked.enabled = row[`${prefix}Enabled`];
    const bold = typeof row[`${prefix}Bold`] === "boolean" ? row[`${prefix}Bold`] : undefined;
    const bands = [];
    const fastMin = row[`${prefix}FastMin`] ?? row[`${prefix}HighMin`];
    const fastColor = row[`${prefix}FastColor`] ?? row[`${prefix}HighColor`];
    if (typeof fastMin === "number" && typeof fastColor === "string" && fastColor) {
      bands.push({ min: fastMin, color: fastColor, ...(bold !== undefined ? { bold } : {}) });
    }
    const slowMin = row[`${prefix}SlowMin`] ?? row[`${prefix}MidMin`];
    const slowColor = row[`${prefix}SlowColor`] ?? row[`${prefix}MidColor`];
    if (typeof slowMin === "number" && typeof slowColor === "string" && slowColor) {
      bands.push({ min: slowMin, color: slowColor, ...(bold !== undefined ? { bold } : {}) });
    }
    if (bands.length > 0) picked.bands = bands;
    const redColor = row[`${prefix}RedColor`];
    if (typeof redColor === "string" && redColor) {
      picked.fallback = { color: redColor, ...(bold !== undefined ? { bold } : {}) };
    }
    return Object.keys(picked).length > 0 ? picked : undefined;
  };
  const speed = pickMetric("speed");
  if (speed) out.speed = speed;
  const cacheHit = pickMetric("cacheHit");
  if (cacheHit) out.cacheHit = cacheHit;
  return out;
}

/** 读 config.json 原文（客户端做归一化，坏字段回退默认值）。 */
function readFileConfig() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      config: parsed && typeof parsed === "object" ? parsed : {},
      fileFound: true
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return { config: {}, fileFound: false };
    return { config: {}, fileFound: true, error: String((err && err.message) || err) };
  }
}

/** 把客户端提交的完整配置写回 config.json（目录不存在则创建）。返回 null 或错误信息。 */
function writeConfigFile(incoming) {
  try {
    mkdirSync(join(dshHome(), PKG), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(incoming, null, 2) + "\n", "utf8");
    return null;
  } catch (err) {
    return String((err && err.message) || err);
  }
}

function mergeConfig(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
    ) {
      out[key] = mergeConfig(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// ── RPC 路由 ─────────────────────────────────────────────────────

function drain(req, limit = BODY_LIMIT) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

let liveRowConfig = null;

export function apply(ctx, config) {
  // 设置页提交后：volatile 引用原地更新，或行重载后 apply 携新配置重入。
  liveRowConfig = config ? readLive(config) : null;

  ctx.inject(["connection", "webServer"], function (webCtx) {
    webCtx.effect(function () {
      const dispose = webCtx.webServer.register({
        kind: "prefix",
        path: ROUTE_PREFIX,
        handler: async function (req, res) {
          try {
            const rejection = webCtx.connection.requestRejection(req);
            if (rejection !== undefined) {
              respond(res, rejection, { error: rejection === 401 ? "authentication required" : "request rejected" });
              return;
            }
            const path = new URL(req.url || "/", "http://localhost").pathname;
            if (!path.startsWith(ROUTE_PREFIX + "/")) {
              respond(res, 404, { error: "not found" });
              return;
            }
            const method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1));
            if (method !== "getConfig" && method !== "setConfig") {
              respond(res, 404, { error: "unknown method: " + method });
              return;
            }
            if (req.method !== "POST") {
              respond(res, 405, { error: "POST required" });
              return;
            }
            const raw = await drain(req);
            if (method === "setConfig") {
              // 配置卡片提交的完整配置：轻度校验后写回 config.json。
              let incoming = null;
              try {
                const parsed = JSON.parse(raw || "{}");
                if (parsed && typeof parsed.config === "object" && parsed.config) incoming = parsed.config;
              } catch (err) {
                incoming = null;
              }
              if (!incoming) {
                respond(res, 400, { error: "config object required" });
                return;
              }
              const writeError = writeConfigFile(incoming);
              if (writeError) {
                respond(res, 500, { error: writeError });
                return;
              }
              respond(res, 200, { ok: true });
              return;
            }
            const file = readFileConfig();
            const row = projectRowConfig(liveRowConfig);
            respond(res, 200, {
              // 行配置（设置页）优先，文件兜底；两处都没配时客户端用内置默认
              config: mergeConfig(file.config, row),
              rowConfigured: Object.keys(row).length > 0,
              fileFound: file.fileFound,
              path: configPath(),
              ...(file.error ? { error: file.error } : {})
            });
          } catch (err) {
            if (res.headersSent) {
              res.destroy(err);
              return;
            }
            respond(res, 500, { error: "internal error" });
          }
        }
      });
      return function () {
        dispose();
      };
    });
  });
}
