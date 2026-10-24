# dsh-status-color

给 DeepSeek Harness（DSH）输入框下方**状态条上色**的 DSH 插件（cordis bundle）：

- **tok/s 生成速度**（📊 activity pill）：速度越快越绿，慢了变红；
- **缓存命中率**（🗄 usage pill，「缓存命中 X%」）：命中率越高越绿。

阈值、颜色、加粗、开关、刷新间隔**全部可配置**，改一个 JSON 文件即可，保存后约 5 秒内自动生效，无需重启 DSH。

## 效果

![输入框下方状态条上色效果](screenshots/composer-pills.png)

上图为输入框下方的状态条：`89 tok/s` 命中 ≥70 档显示为绿色；缓存命中率同理分档上色。

| 指标 | 分档（默认） | 颜色 |
|---|---|---|
| tok/s 速度 | ≥ 70 | 绿 `#3ecf8e` |
| | 40 – 70 | 黄 `#f5b944` |
| | < 40 | 红 `#ff6b57` |
| 缓存命中率 | ≥ 80% | 绿 `#3ecf8e` |
| | 50 – 80% | 黄 `#f5b944` |
| | < 50% | 红 `#ff6b57` |

所有数字加粗显示（可关）。

## 安装

前提：DSH（DeepSeek Harness）桌面版 ≥ 0.2.x，Python 3.8+（仅标准库，无需 pip 装包）。

```powershell
# 在仓库目录执行
python install.py install     # 安装
python install.py status      # 查看状态
python install.py uninstall   # 卸载
```

`install` 做三件事：

1. 把插件复制到 `~/.dsh/profiles/desktop/node_modules/dsh-status-color`；
2. 在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾注册一段带标记的 bundle 行（`# DSH-STATUS-COLOR-BEGIN … # DSH-STATUS-COLOR-END`）；
3. 把 `config.example.json` 复制为 `~/.dsh/dsh-status-color/config.json`（已存在则不动）。

运行中的 DSH 通过 HMR 监听 `cordis.patch.yml`，通常即时生效；若没生效，**重启一次 DSH**。之后到设置里确认输入框下方统计条已经带颜色。

> **从旧版 dsh-tok-color 迁移**：`install` 会自动移除旧版 `dsh-tok-color` 的注册行与
> node_modules 副本，避免重复上色；旧版源码目录 `~/.dsh/dsh-tok-color/` 不会被删除，
> 不需要可自行清理。

> **注意**：本插件是手动安装进 profile 工作区的（未写入 profile 的 package.json 依赖）。
> 如果将来通过插件市场 / 插件管理器执行 pnpm 安装导致 `node_modules` 被整理，
> 重新跑一次 `python install.py install` 即可恢复。

## 配置

配置文件：`~/.dsh/dsh-status-color/config.json`（尊重 `DSH_HOME` 环境变量）。

```jsonc
{
  "version": 1,
  "refreshMs": 5000,              // 客户端读取配置的轮询间隔（1000–60000ms）
  "speed": {                      // tok/s 速度读数（activity pill）
    "enabled": true,              // false = 不上色（并还原已上色部分）
    "bands": [                    // 按 min 从大到小匹配，取第一个 value >= min 的档
      { "min": 70, "color": "#3ecf8e", "bold": true },
      { "min": 40, "color": "#f5b944", "bold": true }
    ],
    "fallback": { "color": "#ff6b57", "bold": true }   // 所有档都不满足时
  },
  "cacheHit": {                   // 缓存命中率（usage pill）
    "enabled": true,
    "bands": [
      { "min": 80, "color": "#3ecf8e", "bold": true },
      { "min": 50, "color": "#f5b944", "bold": true }
    ],
    "fallback": { "color": "#ff6b57", "bold": true }
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `refreshMs` | number | 配置热更新轮询间隔，范围 1000–60000，默认 5000 |
| `<指标>.enabled` | boolean | `false` 关闭该指标上色（自动还原） |
| `<指标>.bands` | array | 分档列表；`min` 阈值（含）、`color` 颜色（任意 CSS 颜色格式）、`bold` 加粗（`true`=600 / `false` / 数字字重 / 任意 CSS font-weight 字符串）。按 `min` 降序匹配，**取第一个满足 `value >= min` 的档** |
| `<指标>.fallback` | object | 没有命中任何档时的兜底样式 |

**生效方式**：客户端每隔 `refreshMs` 向宿主拉一次配置，保存文件后最多约 5 秒（默认）自动重涂，不用重启 DSH、不用刷新页面。文件缺失或个别字段写错时，对应字段回退内置默认值，不会炸。

**改分档只想要两档/一档？** 直接删掉 `bands` 里的元素即可，列表长度不限。想要某个指标单色显示，就只留一档 + 一个 fallback。

## 工作原理

- **宿主半边**（`lib/index.js`，cordis 插件）：通过可选的 `webServer` 服务注册
  `POST /_dsh/dsh-status-color/getConfig` 路由，把 `config.json` 原文（含 `fileFound`/`error` 状态）
  返回给客户端。认证走宿主统一的 `connection.requestRejection` 边界。
- **客户端半边**（`lib/client.js`，浏览器端 cordis 模块）：
  1. `MutationObserver` 监听 `[data-composer-stat]` 统计条内的文本变化；
  2. 命中 `tok/s`（速度）或 `缓存命中 X% / Cache hit X%`（缓存命中率）的文本节点，解析数值、按配置分档；
  3. 把该文本节点**原位**包进 `<span class="dsh-status-color-seg">`——保留 React 持有的文本节点引用，
     之后的流式更新、重渲染不会冲突；已包裹的只更新颜色；
  4. 指标被关闭时自动拆掉包裹还原；节点被 React 卸载后清理遗留空壳。
- 宿主端不做任何渲染；客户端找不到统计条时静默待机，失败不影响宿主。

## 兼容性与已知限制

- 依赖内置统计条的 `data-composer-stat` DOM 标记与「缓存命中 / Cache hit」文案（zh/en 内置语言）。
  未来 DSH 版本若改动，插件会静默无效果（不会报错），改 `lib/client.js` 顶部两个正则即可。
- 只处理速度与缓存命中率两个读数；本轮 token 用量（`4.2M tok`）保持原样。
- 手动安装的插件不参与 pnpm 依赖管理，见上文「注意」。

## 开发

无构建步骤：`lib/*.js` 即源码。目录结构：

```
dsh-status-color/
├── package.json          # dsh.client 声明（platform: web）+ exports
├── cordis.patch.yml      # 自注册 bundle 行（id: status-color）
├── config.example.json   # 配置模板（install 时复制为 config.json）
├── install.py            # 安装 / 卸载 / 状态
├── lib/
│   ├── index.js          # 宿主半边：配置 RPC
│   └── client.js         # 客户端半边：MutationObserver 上色
├── README.md
├── CHANGELOG.md
└── LICENSE
```

改完代码后重跑 `python install.py install`（会覆盖 node_modules 副本），刷新或重启 DSH 生效。
调试入口：浏览器控制台里 `window.__DSH_STATUS_COLOR__.config` 看当前生效配置，
`window.__DSH_STATUS_COLOR__.refreshConfig()` 手动拉取。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
