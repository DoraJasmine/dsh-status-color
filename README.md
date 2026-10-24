# dsh-status-color

给 DeepSeek Harness（DSH）输入框下方**状态条上色**的 DSH 插件（cordis bundle）：

- **tok/s 生成速度**（📊 activity pill）：速度越快越绿，慢了变红；
- **缓存命中率**（🗄 usage pill，「缓存命中 X%」）：命中率越高越绿。

阈值、颜色、加粗、开关、刷新间隔**全部可配置**：可以直接在 DSH 的插件设置里改（自动生成表单），也可以改配置文件；保存后约 5 秒内自动生效，无需重启 DSH。

> 本插件由 GLM-5.3-Flash（Z.ai）编写：需求提出、验收与调校由人完成。

## 效果

**tok/s 生成速度**（173 tok/s，命中 ≥70 档显示为绿色）：

![tok/s 速度上色](screenshots/speed-pill.png)

**缓存命中率**（91%，命中 ≥80% 档显示为绿色）：

![缓存命中率上色](screenshots/cache-hit-pill.png)

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

前提：DSH（DeepSeek Harness）桌面版 ≥ 0.2.x。以下命令都在 profile 工作区
`~/.dsh/profiles/desktop` 里执行；系统没有 pnpm 时，可用 DSH 自带的一份（见文末小贴士）。

### 从 GitHub 安装

```powershell
cd ~/.dsh/profiles/desktop
pnpm add github:DoraJasmine/dsh-status-color
```

然后在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾加入激活行：

```yaml
- insert:
    - id: status-color
      name: 'dsh-status-color'
```

重启 DSH（或等待 HMR 热加载）即可生效。

### 从 npm 安装（发布后可用）

```powershell
cd ~/.dsh/profiles/desktop
pnpm add dsh-status-color
```

激活行同上。

### 本地开发（检出源码）

```powershell
git clone https://github.com/DoraJasmine/dsh-status-color.git
cd ~/.dsh/profiles/desktop
pnpm add link:<clone 目录>
```

以 `link:` 软链安装后源码目录即生效，改完代码无需重装。卸载一律
`pnpm remove dsh-status-color` 并删除 cordis.patch.yml 里的激活行。

> **小贴士**：DSH 自带 node + pnpm，可代替系统安装：
> `<DSH 安装目录>\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`
> `<DSH 安装目录>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`
> （桌面 profile 由 Electron 应用独占管理，`dsh plugin` CLI 不能操作 `--profile desktop`，所以用 pnpm 直接管理。）

## 在 DSH 设置中配置（推荐）

插件安装后在 DSH 的 **设置 → 插件** 中有一张配置卡片（由插件导出的 Config schema 自动生成）：

- **速度 / 缓存命中率** 各自独立配置：
  - `enabled`：开关，关闭后自动还原为无色；
  - `bands`：分档列表，可增删档位；每档 `min` 阈值（含）、`color` 颜色、`bold` 加粗；
  - `fallback`：所有档都不命中时的兜底样式。
- `refreshMs`：配置热更新轮询间隔（1000–60000ms，默认 5000）。

**颜色**填任意 CSS 颜色：`#3ecf8e`、`#f5b944`、`red`、`orange`、`rgb(255,107,87)` 都可以；
写错时该字段回退内置默认色。修改保存后，客户端在 `refreshMs`（默认 5 秒）内自动应用，无需重启 DSH。

## 配置文件（兜底）

也可以用文件配置：`~/.dsh/dsh-status-color/config.json`（尊重 `DSH_HOME` 环境变量）。
**在设置页里配置过的项以设置页（行配置）为准**，文件只对未在设置页配置的部分生效。

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

`bold`：`true` = 字重 600，`false` = 不加粗，数字/字符串 = 任意 CSS font-weight。
文件缺失或个别字段写错时，对应字段回退内置默认值，不会炸。仓库里的
`config.example.json` 是模板，首次以 pnpm 方式安装后可手动复制为 `config.json`。

## 工作原理

- **宿主半边**（`lib/index.js`，cordis 插件）：导出 schemastery 的 `Config` schema 供 DSH
  自动生成设置页；并通过可选的 `webServer` 服务注册 `POST /_dsh/dsh-status-color/getConfig`
  路由，把「行配置（设置页，优先）+ config.json（兜底）」合并后的生效配置返回给客户端。
  认证走宿主统一的 `connection.requestRejection` 边界。
- **客户端半边**（`lib/client.js`，浏览器端 cordis 模块）：
  1. `MutationObserver` 监听 `[data-composer-stat]` 统计条内的文本变化；
  2. 命中 `tok/s`（速度）或 `缓存命中 X% / Cache hit X%`（缓存命中率）的文本节点，解析数值、按配置分档；
  3. 把该文本节点**原位**包进 `<span class="dsh-status-color-seg">`——保留 React 持有的文本节点引用，
     之后的流式更新、重渲染不会冲突；已包裹的只更新颜色；
  4. 指标被关闭时自动拆掉包裹还原；节点被 React 卸载后清理遗留空壳。
- 宿主端不做任何渲染；客户端找不到统计条时静默待机，失败不影响宿主。

## web 端支持

**支持。** 插件的客户端声明就是 web 平台（`dsh.client.platform: "web"`），桌面端内嵌界面与
浏览器访问的 DSH web 端共用同一套 client 模块体系；配置 RPC 走宿主 webServer，两端都能用。
要在 web 端启用：在 web profile（`~/.dsh/profiles/web`，结构与 desktop 相同、互相独立）里按
上面同样的方式安装并加入激活行即可。

## 兼容性与已知限制

- 依赖内置统计条的 `data-composer-stat` DOM 标记与「缓存命中 / Cache hit」文案（zh/en 内置语言）。
  未来 DSH 版本若改动，插件会静默无效果（不会报错），改 `lib/client.js` 顶部两个正则即可。
- 只处理速度与缓存命中率两个读数；本轮 token 用量（`4.3M tok`）保持原样。

## 开发说明

- 本插件由 **GLM-5.3-Flash**（Z.ai）编写：需求提出、验收与调校由人完成。
- 无构建步骤：`lib/*.js` 即源码。目录结构：

```
dsh-status-color/
├── package.json          # dsh.client 声明（platform: web）+ exports + 依赖
├── cordis.patch.yml      # 自注册 bundle 行（id: status-color）
├── config.example.json   # 配置模板
├── install.py            # 手动安装辅助脚本（不想用 pnpm 时的替代，功能等同）
├── lib/
│   ├── index.js          # 宿主半边：Config schema + 配置 RPC
│   └── client.js         # 客户端半边：MutationObserver 上色
├── screenshots/          # 效果图
├── README.md
├── CHANGELOG.md
└── LICENSE
```

改完代码后，`link:` 安装的无需任何操作，刷新或重启 DSH 生效；调试入口：浏览器控制台里
`window.__DSH_STATUS_COLOR__.config` 看当前生效配置，`window.__DSH_STATUS_COLOR__.refreshConfig()`
手动拉取。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
