// dsh-status-color — host half（宿主进程侧，cordis 插件）。
//
// 职责：把生效配置提供给 web 客户端（lib/client.js 负责全部上色工作）。
// 配置有两个来源，行配置（DSH 设置页，优先）覆盖 config.json（兜底）：
//   1. 设置页：导出 schemastery 的 Config，宿主为插件行自动生成设置页；
//      用户在 设置 → 插件 里改阈值/颜色，值写进 profile 行配置；行配置变更
//      会重载插件行（apply 携新配置重入），无需重启 DSH。
//   2. 文件兜底：~/.dsh/dsh-status-color/config.json（web 端 / 未在设置页配置时可用）。
// RPC：webServer HTTP 路由（POST /_dsh/dsh-status-color/getConfig，JSON 进出，
// 宿主认证边界与 dsh-bottom-info-bar 等社区插件一致）。webServer 是可选服务，
// 缺席（旧版本 / 无 GUI）时静默跳过，客户端退回内置默认配置。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-status-color";
export const inject = [];
export const reusable = true;

const PKG = "dsh-status-color";
const ROUTE_PREFIX = "/_dsh/" + PKG;
const BODY_LIMIT = 64 * 1024;

// ── 设置页 schema：导出 Config，宿主为插件行自动生成设置页 ──────────
// 结构与 config.json / 客户端 normalizeConfig 完全同构：
//   { refreshMs, speed: { enabled, bands: [{min,color,bold}], fallback }, cacheHit: {...} }
const StyleSchema = (colorDefault) =>
  z.object({
    // CSS 颜色：#RRGGBB / #RGB / 常见颜色名（red、orange…）均可
    color: z.string().default(colorDefault),
    bold: z.boolean().default(true)
  });

const BandSchema = (minDefault, colorDefault) =>
  z.object({
    min: z.number().min(0).default(minDefault),
    color: z.string().default(colorDefault),
    bold: z.boolean().default(true)
  });

const MetricSchema = (bands, fallbackColor) =>
  z.object({
    enabled: z.boolean().default(true),
    // 按 min 从大到小匹配，取第一个 value >= min 的档；bands 顺序无关
    bands: z
      .array(BandSchema(bands[0][0], bands[0][1]))
      .default(bands.map(([min, color]) => ({ min, color, bold: true }))),
    fallback: StyleSchema(fallbackColor)
  });

export const Config = z.object({
  refreshMs: z.number().min(1000).max(60000).default(5000),
  speed: MetricSchema(
    [
      [70, "#3ecf8e"],
      [40, "#f5b944"]
    ],
    "#ff6b57"
  ),
  cacheHit: MetricSchema(
    [
      [80, "#3ecf8e"],
      [50, "#f5b944"]
    ],
    "#ff6b57"
  )
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

/** 递归解引用：volatile 字段是带 .get() 的 live 引用，普通值原样返回。 */
function readLive(value) {
  if (value && typeof value === "object" && typeof value.get === "function") {
    return readLive(value.get());
  }
  if (Array.isArray(value)) return value.map(readLive);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, member] of Object.entries(value)) out[key] = readLive(member);
    return out;
  }
  return value;
}

/** 从行配置投影出客户端认识的字段（丢弃宿主注入的内部键与非法项）。 */
function projectRowConfig(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  if (typeof row.refreshMs === "number") out.refreshMs = row.refreshMs;
  const pickMetric = (metric) => {
    if (!metric || typeof metric !== "object") return undefined;
    const picked = {};
    if (typeof metric.enabled === "boolean") picked.enabled = metric.enabled;
    if (Array.isArray(metric.bands)) {
      const bands = metric.bands.filter(
        (band) => band && typeof band === "object" && typeof band.min === "number" && typeof band.color === "string" && band.color
      );
      if (bands.length > 0) picked.bands = bands.map((band) => ({ min: band.min, color: band.color, bold: band.bold }));
    }
    if (metric.fallback && typeof metric.fallback === "object" && typeof metric.fallback.color === "string" && metric.fallback.color) {
      picked.fallback = { color: metric.fallback.color, bold: metric.fallback.bold };
    }
    return Object.keys(picked).length > 0 ? picked : undefined;
  };
  const speed = pickMetric(row.speed);
  if (speed) out.speed = speed;
  const cacheHit = pickMetric(row.cacheHit);
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
            if (method !== "getConfig") {
              respond(res, 404, { error: "unknown method: " + method });
              return;
            }
            if (req.method !== "POST") {
              respond(res, 405, { error: "POST required" });
              return;
            }
            await drain(req);
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
