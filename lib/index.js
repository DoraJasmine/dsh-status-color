// dsh-status-color — host half（宿主进程侧，cordis 插件）。
//
// 职责只有一件事：把 ~/.dsh/dsh-status-color/config.json 提供给 web 客户端。
// 上色全部发生在浏览器端（lib/client.js）；宿主端不做任何 DOM / 渲染工作。
//
// RPC：webServer HTTP 路由（POST /_dsh/dsh-status-color/getConfig，JSON 进出，
// 宿主认证边界与 dsh-bottom-info-bar 等社区插件一致）。webServer 是可选服务，
// 缺席（旧版本 / 无 GUI）时静默跳过，客户端退回内置默认配置。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

export const name = "dsh-status-color";
export const inject = [];
export const reusable = true;

const PKG = "dsh-status-color";
const ROUTE_PREFIX = "/_dsh/" + PKG;
const BODY_LIMIT = 64 * 1024;

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

/**
 * 读取配置文件原文，交给客户端做归一化（客户端内建逐字段回退，坏字段不会炸）。
 * 文件不存在时返回空对象（客户端全用默认值），坏 JSON 时附带 error 便于排查。
 */
function readConfigPayload() {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      config: parsed && typeof parsed === "object" ? parsed : {},
      fileFound: true,
      path: configPath()
    };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { config: {}, fileFound: false, path: configPath() };
    }
    return { config: {}, fileFound: true, path: configPath(), error: String((err && err.message) || err) };
  }
}

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

export function apply(ctx) {
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
            respond(res, 200, readConfigPayload());
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
