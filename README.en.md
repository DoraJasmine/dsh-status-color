# dsh-status-color

A DeepSeek Harness (DSH) plugin (cordis bundle) that **colorizes the status pills under the composer**:

- **tok/s generation speed** (📊 activity pill): green when fast, red when slow;
- **cache-hit rate** (🗄 usage pill, "缓存命中 X%" / "Cache hit X%"): green when high.

Thresholds, colors, bold weight, per-metric switches and the config refresh interval are **all configurable** via a single JSON file — changes apply within ~5 seconds, no restart needed.

Default bands are borrowed from [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar). 中文文档见 [README.md](README.md).

## Default bands

| Metric | Band | Color |
|---|---|---|
| tok/s | ≥ 70 | `#3ecf8e` |
| | 40 – 70 | `#f5b944` |
| | < 40 | `#ff6b57` |
| Cache hit | ≥ 80% | `#3ecf8e` |
| | 50 – 80% | `#f5b944` |
| | < 50% | `#ff6b57` |

## Install

Requires DSH desktop ≥ 0.2.x and Python 3.8+ (stdlib only).

```powershell
python install.py install     # install
python install.py status      # status
python install.py uninstall   # uninstall
```

`install` copies the package into `~/.dsh/profiles/desktop/node_modules/dsh-status-color`,
registers a marked bundle row in `~/.dsh/profiles/desktop/cordis.patch.yml`
(`# DSH-STATUS-COLOR-BEGIN … END`), and scaffolds `~/.dsh/dsh-status-color/config.json`
(from `config.example.json`, never overwrites). The running DSH picks the row up via
HMR; restart DSH if nothing changes. It also migrates away the legacy `dsh-tok-color`
plugin automatically.

## Configuration

Edit `~/.dsh/dsh-status-color/config.json` (honors `DSH_HOME`):

```jsonc
{
  "version": 1,
  "refreshMs": 5000,                 // config poll interval (1000–60000)
  "speed": {
    "enabled": true,
    "bands": [                       // sorted by min desc; first value >= min wins
      { "min": 70, "color": "#3ecf8e", "bold": true },
      { "min": 40, "color": "#f5b944", "bold": true }
    ],
    "fallback": { "color": "#ff6b57", "bold": true }
  },
  "cacheHit": {
    "enabled": true,
    "bands": [
      { "min": 80, "color": "#3ecf8e", "bold": true },
      { "min": 50, "color": "#f5b944", "bold": true }
    ],
    "fallback": { "color": "#ff6b57", "bold": true }
  }
}
```

- `bold`: `true` → weight 600, `false` → off, numbers/strings → any CSS font-weight.
- Colors accept any CSS color format.
- Disabling a metric un-wraps and restores its text.
- Malformed fields fall back to built-in defaults per field.

## How it works

- **Host half** (`lib/index.js`): registers `POST /_dsh/dsh-status-color/getConfig`
  on the optional `webServer` service (auth via the host's `connection.requestRejection`
  boundary) and serves the raw config file.
- **Client half** (`lib/client.js`): a `MutationObserver` watches the
  `[data-composer-stat]` pills, matches `tok/s` and `缓存命中 X% / Cache hit X%`
  text nodes, and wraps them **in place** into a colored `<span>` while keeping the
  React-owned text node — streaming updates keep working. Disabled metrics are
  unwrapped; stale wrappers are cleaned up.

## Known limits

- Relies on the `data-composer-stat` DOM markers and the built-in zh/en wording
  ("缓存命中" / "Cache hit"). If a future DSH version changes them, the plugin
  silently no-ops; adjust the two regexes at the top of `lib/client.js`.
- The token-total reading (`4.2M tok`) is left untouched.

## License

MIT — see [LICENSE](LICENSE).
