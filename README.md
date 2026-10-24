# 状态条上色（dsh-status-color）

[![License: MIT](https://img.shields.io/github/license/DoraJasmine/dsh-status-color)](https://github.com/DoraJasmine/dsh-status-color/blob/main/LICENSE)

DeepSeek Harness 插件：给输入框下方状态条上色——**tok/s 生成速度**与**缓存命中率**，快慢高低一眼可见，阈值与颜色随你调。

![tok/s 速度上色](screenshots/speed-pill.png)

![缓存命中率上色](screenshots/cache-hit-pill.png)

> 本插件由 GLM-5.3-Flash（Z.ai）编写：需求提出、验收与调校由人完成。

## 它做什么

给状态条上两个指标分别套一档三色的交通灯逻辑：

- **tok/s 生成速度**：默认 ≥70 绿、40–70 黄、<40 红；
- **缓存命中率**：默认 ≥80% 绿、50–80% 黄、<50% 红。

数字默认加粗（可关）。所有阈值、颜色、开关都能在 DSH 插件页的配置卡片里改，改完约 5 秒自动生效，不用重启。

## 安装

最推荐：打开 DSH 的插件页 → **添加插件**，在「包名或地址」里填仓库地址（npm 发布后可直接填包名 `dsh-status-color`），DSH 会自己下载，不用敲命令：

```
https://github.com/DoraJasmine/dsh-status-color
```

然后**重启 DSH**（插件在宿主启动时组合，只刷新页面不够）。桌面客户端请使用**插件 → 添加插件**；它的配置由客户端管理，不能通过命令行安装。

web 端用命令行装同一个包：

```bash
dsh plugin --profile web add https://github.com/DoraJasmine/dsh-status-color
```

本地开发想跑工作目录里的代码（软链，改代码即时生效）：

```bash
cd ~/.dsh/profiles/desktop
pnpm add link:D:/dsh-status-color
```

> 系统没有 pnpm 可用 DSH 自带的一份：`<DSH 安装目录>\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`
> `<DSH 安装目录>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`。

## 设置

配置表单直接嵌在插件页的插件卡片里（**插件 → status-color**，往下滚动即可看到），一共三组，改动自动保存（写入 `config.json`），状态条约 5 秒内生效：

- **速度**：上色开关；快速档阈值与颜色（默认 ≥70 绿）；慢速档阈值与颜色（默认 ≥40 黄）；低于所有档的兜底颜色（默认红）；数字加粗。
- **缓存命中率**：上色开关；高档阈值与颜色（默认 ≥80% 绿）；中档阈值与颜色（默认 ≥50% 黄）；兜底颜色（默认红）；数字加粗。
- **通用**：`refreshMs` 配置刷新间隔（1000–60000 毫秒，默认 5000）。

颜色支持两种输入：**取色器**（色号）+ 文本框（任意 CSS 颜色，`#3ecf8e`、`red`、`rgb(255,107,87)` 都可以），写错时该字段回退内置默认色。

配置表单写的就是这个文件（模板见仓库 `config.example.json`，支持任意档位数，可手动编辑后等下一轮刷新生效）。

## web 端

支持。插件的客户端声明就是 web 平台，桌面端内嵌界面与浏览器访问的 DSH web 端共用同一套插件体系；在 web profile（`~/.dsh/profiles/web`）里按上面的命令行方式安装即可，配置 RPC 走宿主 webServer，两端都能用。

## 卸载

插件页 → **卸载**；或命令行 `pnpm remove dsh-status-color` 并删除 `cordis.patch.yml` 里的激活行。个人配置保留在 `~/.dsh/dsh-status-color/`，不需要可手动删除。

## 工作原理

宿主半边导出 schemastery 的 `Config`（生成设置表单）并通过 webServer 提供配置 RPC；客户端半边用 MutationObserver 监听状态条，把命中 `tok/s` 或「缓存命中 X%」的文本节点原位包进带色 `<span>`——保留 React 持有的节点引用，流式更新不冲突；指标关闭时自动还原，找不到统计条时静默待机，不碰聊天正文。

## 开发

- 本插件由 **GLM-5.3-Flash**（Z.ai）编写：需求提出、验收与调校由人完成。
- 无构建步骤：`lib/*.js` 即源码。`lib/index.js` 宿主半边（Config schema + 配置 RPC），`lib/client.js` 客户端半边（上色）。
- 调试：浏览器控制台 `window.__DSH_STATUS_COLOR__.config` 看当前生效配置，`.refreshConfig()` 手动拉取。
- 仓库里的 `install.py` 是手动安装辅助脚本（复制进 node_modules + 注册激活行），不想用 pnpm 时的替代。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
