# Changelog

## 0.3.3 (2026-10-24)

- 诊断能力：宿主半边把 apply / 路由注册 / 每次 RPC 写入 `~/.dsh/dsh-status-color/host.log`（超 256KB 自动轮转）；客户端 apply 与首次上色异常经 `clientLog` RPC 上报到同一份日志——重启后看日志即可判断「客户端模块没加载」还是「加载了但上色异常」。

## 0.3.2 (2026-10-24)

- 修复停用后重新启用颜色不恢复：去掉 `window` 防重入守卫（HMR「先建新、后拆旧」的顺序会让新实例被守卫拦截、旧实例随后卸载，结果谁都不干活），改为接管式运行态——新 apply 先回收上一实例的 observer/轮询/槽位再初始化自己；真实卸载只在实例仍持有页面状态时还原染色，被接管则幂等跳过。

## 0.3.1 (2026-10-24)

- 修复停用插件后颜色残留：dispose 时把页面上所有已染色的文本包裹层原位还原（之前只断开了监听，已染色的 DOM 会一直带着颜色）。
- 槽位注册补上 dispose（经 ctx.effect 管理），启停/重载干净利落。

## 0.3.0 (2026-10-24)

- 配置表单直接嵌进插件卡片：客户端向插件管理器的 `plugins.row.config` 槽位注册表单组件（`key = 包名#行id`，槽位挂载方式参照 dsh-context），卡片出现「配置」区。
- 表单支持取色器 + 文本双输入的颜色、阈值/加粗/开关/刷新间隔编辑，改动防抖自动保存（新增 `setConfig` RPC，写回 `config.json`），状态条约 5 秒内生效。
- 说明：插件卡片的配置区由槽位贡献驱动（账本即槽位 key 集合），仅导出 schemastery Config 不会生成表单；Config 导出保留作兼容。

## 0.2.1 (2026-10-24)

- 修复插件卡片不显示配置表单的问题：设置表单只渲染 volatile 字段（dsh-context/git-graph 同款机制），Config 改为扁平全 volatile 结构并经 Schema.prototype.i18n 提供中英字段标签。
- 配置 RPC 把扁平的行配置键映射回客户端嵌套结构；config.json 兜底不变。
- README 按 dsh-bottom-info-bar / dsh-context 的模板重写：安装改为 DSH 插件页「添加插件」（npm 包名或 GitHub 地址）为主。

## 0.2.0 (2026-10-24)

- 新增 DSH 设置页配置：导出 schemastery Config schema，宿主自动生成表单——阈值/颜色/加粗可改、分档可增删、指标可开关、refreshMs 可调；修改后约 5 秒内自动生效。
- 配置来源合并：设置页行配置优先，config.json 兜底；颜色宽容校验（色号/CSS 颜色名），坏字段回退默认值。
- 宿主端声明 `@deepseek-ai/schemastery` 依赖（对齐 git-graph 等官方系插件的做法），link: 与 npm 安装形态都能解析。
- README：安装说明改为 GitHub / npm 官方方式；新增 web 端支持说明与 GLM-5.3-Flash 开发署名。

## 0.1.1 (2026-10-24)

- 新增官方形态安装方式：`pnpm add link:<目录>` 注册为 profile 依赖，会出现在 DSH 插件设置中；`install.py` 检测到 link: 安装时自动跳过复制、卸载时只移除链接。
- README 换为速度 / 缓存命中率两张实拍效果图，移除英文版。

## 0.1.0 (2026-10-24)

首个版本。

- 输入框下方状态条 tok/s 速度读数上色（默认 ≥70 绿 / 40–70 黄 / <40 红，借鉴 zcode-token-usage-statusbar）。
- 缓存命中率读数上色（默认 ≥80% 绿 / 50–80% 黄 / <50% 红）。
- 配置文件 `~/.dsh/dsh-status-color/config.json`：阈值、颜色、加粗、指标开关、轮询间隔全部可自定义，约 `refreshMs` 内热生效。
- `install.py`：安装 / 卸载 / 状态查询；自动从旧版 `dsh-tok-color` 迁移。
- 关闭的指标自动还原文本；异常静默降级，不影响宿主。
