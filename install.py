# -*- coding: utf-8 -*-
"""dsh-status-color 安装器（仅标准库）。

用法：
  python install.py install     # 安装：拷贝进 profile + 注册 bundle 行 + 生成配置文件
  python install.py uninstall   # 卸载：移除 bundle 行与 node_modules 副本
  python install.py status      # 查看安装状态

原理：DSH 的插件体系（cordis）从 ~/.dsh/profiles/desktop/ 工作区加载插件包。
本脚本把本目录复制为该工作区的 node_modules/dsh-status-color，再在 profile 的
cordis.patch.yml 里插入一段带标记的 bundle 行（幂等，可反复执行）。运行中的
DSH 通过 HMR 监听 cordis.patch.yml，通常无需重启即生效；否则重启 DSH。

同时会把 config.example.json 复制为 ~/.dsh/dsh-status-color/config.json
（已存在则不动），颜色/阈值改它即可，保存后约 refreshMs 内自动生效。

迁移：如果装过旧版 dsh-tok-color，install 会自动移除它的注册行与副本，
避免两个插件重复上色。
"""
import argparse
import shutil
import sys
from os.path import expanduser
from pathlib import Path

PKG_NAME = "dsh-status-color"
ROW_ID = "status-color"
BEGIN = "# DSH-STATUS-COLOR-BEGIN"
END = "# DSH-STATUS-COLOR-END"
ROW_BLOCK = (
    f"{BEGIN}\n"
    "- insert:\n"
    f"    - id: {ROW_ID}\n"
    f"      name: '{PKG_NAME}'\n"
    f"{END}\n"
)

# 旧版 dsh-tok-color 的标记与目录名（迁移清理用）
OLD_BEGIN = "# DSH-TOK-COLOR-BEGIN"
OLD_END = "# DSH-TOK-COLOR-END"
OLD_PKG_NAME = "dsh-tok-color"

SRC = Path(__file__).resolve().parent
IGNORED = shutil.ignore_patterns("__pycache__", "*.pyc", ".git", ".gitignore", "screenshots")


def dsh_home():
    import os

    env = (os.environ.get("DSH_HOME") or "").strip()
    if not env:
        return Path.home() / ".dsh"
    if env == "~":
        return Path.home()
    if env.startswith("~/") or env.startswith("~\\"):
        return Path.home() / env[2:]
    return Path(expanduser(env))


def profile_dir(explicit=None):
    if explicit:
        return Path(expanduser(explicit))
    return dsh_home() / "profiles" / "desktop"


def data_dir():
    return dsh_home() / PKG_NAME


def installed_copy(profile):
    return profile / "node_modules" / PKG_NAME


def patch_path(profile):
    return profile / "cordis.patch.yml"


def read_patch(profile):
    p = patch_path(profile)
    return p.read_text(encoding="utf-8") if p.exists() else ""


def block_present(text, begin, name):
    if begin not in text:
        return False
    return name in text.split(begin, 1)[1].split(end_marker(begin), 1)[0]


def end_marker(begin):
    return {"# DSH-STATUS-COLOR-BEGIN": END, "# DSH-TOK-COLOR-BEGIN": OLD_END}[begin]


def remove_block(text, begin, end):
    if begin not in text:
        return text, False
    head, rest = text.split(begin, 1)
    if end not in rest:
        return head + rest, True
    tail = rest.split(end, 1)[1]
    return head.rstrip("\n") + ("\n" + tail.lstrip("\n") if tail.strip() else ""), True


def scaffold_config():
    target = data_dir() / "config.json"
    if target.exists():
        return False, target
    target.parent.mkdir(parents=True, exist_ok=True)
    example = SRC / "config.example.json"
    shutil.copyfile(example, target)
    return True, target


def migrate_old_plugin(profile):
    """移除旧版 dsh-tok-color 的注册行与 node_modules 副本。"""
    changed = []
    p = patch_path(profile)
    text = read_patch(profile)
    new_text, removed = remove_block(text, OLD_BEGIN, OLD_END)
    if removed:
        p.write_text(new_text, encoding="utf-8")
        changed.append(f"已移除旧版注册行（{p}）")
    old_copy = profile / "node_modules" / OLD_PKG_NAME
    if old_copy.exists():
        shutil.rmtree(old_copy)
        changed.append(f"已删除旧版副本（{old_copy}）")
    return changed


def cmd_install(profile):
    if not profile.exists():
        print(f"[x] profile 目录不存在：{profile}")
        return 2
    dest = installed_copy(profile)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SRC, dest, ignore=IGNORED)
    print(f"[+] 已复制插件到 {dest}")

    for note in migrate_old_plugin(profile):
        print(f"[~] 迁移：{note}")

    created, cfg = scaffold_config()
    print(f"[+] 配置文件：{cfg}（{'新生成' if created else '已存在，保持不动'}）")

    p = patch_path(profile)
    text = read_patch(profile)
    if block_present(text, BEGIN, PKG_NAME):
        print(f"[=] {p} 已有注册行，跳过")
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        prefix = "\n" if text.strip() else ""
        p.write_text(text + prefix + ROW_BLOCK, encoding="utf-8")
        print(f"[+] 已在 {p} 注册 bundle 行（{BEGIN} … {END} 之间）")
    print("[✓] 完成。DSH 运行中通常经 HMR 即时生效；未生效则重启 DSH。")
    return 0


def cmd_uninstall(profile):
    changed = False
    p = patch_path(profile)
    text = read_patch(profile)
    new_text, removed = remove_block(text, BEGIN, END)
    if removed:
        p.write_text(new_text, encoding="utf-8")
        print(f"[-] 已从 {p} 移除注册行")
        changed = True
    dest = installed_copy(profile)
    if dest.exists():
        shutil.rmtree(dest)
        print(f"[-] 已删除 {dest}")
        changed = True
    if not changed:
        print("[=] 未发现已安装内容")
    print(f"[i] 个人配置保留在 {data_dir()}（含 config.json），如不需要可手动删除。")
    print("[✓] 卸载完成。若 DSH 正在运行，重启 DSH 后彻底生效。")
    return 0


def cmd_status(profile):
    dest = installed_copy(profile)
    text = read_patch(profile)
    cfg = data_dir() / "config.json"
    old_row = block_present(read_patch(profile), OLD_BEGIN, OLD_PKG_NAME)
    old_copy = (profile / "node_modules" / OLD_PKG_NAME).exists()
    print(f"profile: {profile}")
    print(f"node_modules 副本: {'有' if dest.exists() else '无'} ({dest})")
    print(f"cordis.patch.yml 注册行: {'有' if block_present(text, BEGIN, PKG_NAME) else '无'} ({patch_path(profile)})")
    print(f"配置文件: {'有' if cfg.exists() else '无（install 时生成，或手动复制 config.example.json）'} ({cfg})")
    if old_row or old_copy:
        print(f"[!] 检测到旧版 {OLD_PKG_NAME} 残留（注册行{'有' if old_row else '无'} / 副本{'有' if old_copy else '无'}），执行 install 自动迁移清理")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="dsh-status-color installer")
    ap.add_argument("command", choices=["install", "uninstall", "status"])
    ap.add_argument("--profile", help="profile 目录（默认 ~/.dsh/profiles/desktop，尊重 DSH_HOME）")
    args = ap.parse_args(argv)
    profile = profile_dir(args.profile)
    return {"install": cmd_install, "uninstall": cmd_uninstall, "status": cmd_status}[args.command](profile)


if __name__ == "__main__":
    sys.exit(main())
