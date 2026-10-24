# Changelog

## 0.1.0 (2026-10-24)

首个版本。

- 输入框下方状态条 tok/s 速度读数上色（默认 ≥70 绿 / 40–70 黄 / <40 红，借鉴 zcode-token-usage-statusbar）。
- 缓存命中率读数上色（默认 ≥80% 绿 / 50–80% 黄 / <50% 红）。
- 配置文件 `~/.dsh/dsh-status-color/config.json`：阈值、颜色、加粗、指标开关、轮询间隔全部可自定义，约 `refreshMs` 内热生效。
- `install.py`：安装 / 卸载 / 状态查询；自动从旧版 `dsh-tok-color` 迁移。
- 关闭的指标自动还原文本；异常静默降级，不影响宿主。
