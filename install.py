# -*- coding: utf-8 -*-
"""dsh-status-color 安装器（仅标准库）。

用法：
  python install.py install     # 安装：bundles 激活 + 生成配置文件 + 清理旧式注册行
  python install.py uninstall   # 卸载：移出 bundles、清理注册行与 node_modules 副本
  python install.py status      # 查看安装状态

原理：DSH 的插件体系（cordis）从 ~/.dsh/profiles/desktop/ 工作区加载插件。
本脚本把本目录复制为该工作区的 node_modules/dsh-status-color，并把插件加入
package.json 的 dsh.profile.bundles——插件页的开关因此直接生效（关 = 从
bundles 移除并热重载，开 = 追加并热重载）。插件包自带的 cordis.patch.yml
（dsh.bundle.patch）会在 bundle 启用时自动注册 bundle 行，无需手写。

旧版迁移：如果存在旧式的 marker 注册行（# DSH-STATUS-COLOR-BEGIN … END）
或旧插件 dsh-tok-color 的残留，install 会自动清理，避免重复加载。
"""
import argparse
import json
import os
import shutil
import sys
from os.path import expanduser
from pathlib import Path

PKG_NAME = "dsh-status-color"
ROW_ID = "status-color"
BEGIN = "# DSH-STATUS-COLOR-BEGIN"
END = "# DSH-STATUS-COLOR-END"

# 旧版 dsh-tok-color 的标记与目录名（迁移清理用）
OLD_BEGIN = "# DSH-TOK-COLOR-BEGIN"
OLD_END = "# DSH-TOK-COLOR-END"
OLD_PKG_NAME = "dsh-tok-color"

SRC = Path(__file__).resolve().parent
IGNORED = shutil.ignore_patterns("__pycache__", "*.pyc", ".git", ".gitignore", "screenshots")


def dsh_home():
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


def is_link(path):
    """symlink 或 Windows junction（pnpm add link: 的产物）都不算普通目录。"""
    return os.path.islink(path) or os.path.isjunction(path)


def patch_path(profile):
    return profile / "cordis.patch.yml"


def read_patch(profile):
    p = patch_path(profile)
    return p.read_text(encoding="utf-8") if p.exists() else ""


def block_present(text, begin, name):
    if begin not in text:
        return False
    end = {"# DSH-STATUS-COLOR-BEGIN": END, "# DSH-TOK-COLOR-BEGIN": OLD_END}[begin]
    return name in text.split(begin, 1)[1].split(end, 1)[0]


def remove_block(text, begin, end):
    if begin not in text:
        return text, False
    head, rest = text.split(begin, 1)
    if end not in rest:
        return head + rest, True
    tail = rest.split(end, 1)[1]
    return head.rstrip("\n") + ("\n" + tail.lstrip("\n") if tail.strip() else ""), True


def bundle_list(profile):
    pj = profile / "package.json"
    if not pj.exists():
        return None, None
    data = json.loads(pj.read_text(encoding="utf-8"))
    bundles = data.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
    return data, bundles


def set_bundle_enabled(profile, enable):
    """把本插件加入/移出 profile 的 dsh.profile.bundles。返回是否发生了修改。"""
    data, bundles = bundle_list(profile)
    if bundles is None:
        return False
    present = PKG_NAME in bundles
    if enable and not present:
        bundles.append(PKG_NAME)
    elif not enable and present:
        bundles.remove(PKG_NAME)
    else:
        return False
    pj = profile / "package.json"
    pj.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def scaffold_config():
    target = data_dir() / "config.json"
    if target.exists():
        return False, target
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC / "config.example.json", target)
    return True, target


def migrate_old_plugin(profile):
    """移除旧版 dsh-tok-color 与旧式手动注册行。"""
    changed = []
    p = patch_path(profile)
    text = read_patch(profile)
    for begin, end, name in ((OLD_BEGIN, OLD_END, OLD_PKG_NAME), (BEGIN, END, PKG_NAME)):
        new_text, removed = remove_block(text, begin, end)
        if removed:
            text = new_text
            label = "旧版注册行" if name == OLD_PKG_NAME else "旧式手动注册行"
            changed.append(f"已移除{label}（{p}）")
    if text != read_patch(profile):
        p.write_text(text, encoding="utf-8")
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
    if os.path.lexists(dest):
        if is_link(dest):
            print(f"[=] 检测到 link: 安装（{dest} → {os.path.realpath(dest)}），跳过复制，源码目录即生效")
        else:
            shutil.rmtree(dest)
            shutil.copytree(SRC, dest, ignore=IGNORED)
            print(f"[+] 已复制插件到 {dest}")
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(SRC, dest, ignore=IGNORED)
        print(f"[+] 已复制插件到 {dest}")

    for note in migrate_old_plugin(profile):
        print(f"[~] 迁移：{note}")

    added = set_bundle_enabled(profile, True)
    if added:
        print("[+] 已加入 dsh.profile.bundles（插件页开关从此直接生效）")
    else:
        print("[=] dsh.profile.bundles 已包含本插件")

    created, cfg = scaffold_config()
    print(f"[+] 配置文件：{cfg}（{'新生成' if created else '已存在，保持不动'}）")
    print("[✓] 完成。重启 DSH 后生效；此后插件页的开关实时生效。")
    return 0


def cmd_uninstall(profile):
    changed = False
    try:
        if set_bundle_enabled(profile, False):
            print("[-] 已从 dsh.profile.bundles 移除")
            changed = True
    except Exception as err:
        print(f"[!] bundles 清理失败（可手动从 package.json 移除 {PKG_NAME}）：{err}")

    p = patch_path(profile)
    text = read_patch(profile)
    new_text, removed = remove_block(text, BEGIN, END)
    if removed:
        p.write_text(new_text, encoding="utf-8")
        print(f"[-] 已移除旧式注册行（{p}）")
        changed = True

    dest = installed_copy(profile)
    if os.path.lexists(dest):
        if is_link(dest):
            os.rmdir(dest)  # 只移除链接本身，源码目录不受影响
            print(f"[-] 已移除 link: {dest}（源码目录不受影响）")
        else:
            shutil.rmtree(dest)
            print(f"[-] 已删除 {dest}")
        changed = True

    if not changed:
        print("[=] 未发现已安装内容")
    print(f"[i] 个人配置保留在 {data_dir()}（含 config.json），如不需要可手动删除。")
    print("[✓] 卸载完成。重启 DSH 后彻底生效。")
    return 0


def cmd_status(profile):
    dest = installed_copy(profile)
    text = read_patch(profile)
    cfg = data_dir() / "config.json"
    _, bundles = bundle_list(profile)
    in_bundles = bool(bundles) and PKG_NAME in bundles if bundles else False
    print(f"profile: {profile}")
    print(f"node_modules 副本: {'有' if os.path.lexists(dest) else '无'} ({dest})")
    print(f"dsh.profile.bundles 激活: {'有' if in_bundles else '无'}（推荐方式，插件开关直接生效）")
    print(f"旧式手动注册行: {'有（建议重跑 install 清理）' if block_present(text, BEGIN, PKG_NAME) else '无'}")
    print(f"配置文件: {'有' if cfg.exists() else '无（install 时生成，或手动复制 config.example.json）'} ({cfg})")
    old_row = block_present(text, OLD_BEGIN, OLD_PKG_NAME)
    old_copy = (profile / "node_modules" / OLD_PKG_NAME).exists()
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
