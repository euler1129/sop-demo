# -*- coding: utf-8 -*-
"""
公开发布前清理（把仓库从「内部真名版」转成「可公开的脱敏版」）

做三件事：
  1. 删除「按定义只能以真名形态存在」的文件（真名样例、脱敏映射表、真名单文件产物）；
  2. 对剩余所有文本文件做全文脱敏（真实主体名 -> 代称）；
  3. 修补入口，使脱敏开关在映射表缺失时自动隐藏（否则点了没反应，容易被误判为坏了）。

为什么必须整仓全文脱敏，而不是只换样例数据：
  源码里散落着写死的文案（工具栏 placeholder、模型默认数据、脚本里的词典），
  只换数据会留下几十处真实主体名，公开即泄漏。

用法：
  python tools/publish_clean.py            # 预演，只打印将要改什么
  python tools/publish_clean.py --apply    # 真正落盘

注意：本脚本必须在 tools/desensitize-map.json 被删除之前执行（它要读这张表）。
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MAP_PATH = os.path.join(HERE, 'desensitize-map.json')

TEXT_EXT = {'.html', '.js', '.md', '.py', '.json', '.css', '.txt', '.bat', '.sh', '.yml'}

# 真名形态独有的产物 / 映射表：公开仓库里一个都不留
DELETE = [
    'dist/index.html',
    'dist/SOP流程资产平台.html',
    'dist/sop-flow-assets.zip',
    'js/samples/samples-data.js',
    'js/samples/desensitize-map.js',
    'tools/desensitize-map.json',
    'skill/sop-flow-assets/references/desensitize-map.json',
]

FALLBACK_RE = re.compile(
    r'var MASK = \(window\.SOP_MASK && window\.SOP_MASK\.length\) \? window\.SOP_MASK : \[.*?\];',
    re.S)


def tracked_files():
    out = subprocess.run(['git', '-c', 'core.quotepath=false', 'ls-files', '-z'],
                         cwd=ROOT, capture_output=True)
    return [p for p in out.stdout.decode('utf-8').split('\0') if p]


def load_mask():
    with open(MAP_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)['mask']


def mask_text(s, mask):
    for a, b in mask:
        s = s.replace(a, b)
    return s


def patch_index(s):
    """入口改指向脱敏样例，并去掉映射表脚本（映射表本身含真名，不能进公开仓库）"""
    s = s.replace('<script src="js/samples/samples-data.js"></script>',
                  '<script src="js/samples/samples-data-safe.js"></script>')
    s = s.replace('<script src="js/samples/desensitize-map.js"></script>\n', '')
    return s


def patch_app(s):
    """映射表缺失时 MASK 为空数组，此时把「脱敏」开关整行藏掉，避免点了没反应"""
    s = FALLBACK_RE.sub('var MASK = window.SOP_MASK || [];', s)
    old = "    $('cfg-desens').checked = !!state.desens;\n"
    new = old + ("    if (!MASK.length) { var row = $('cfg-desens').closest('.field');"
                 " if (row) row.style.display = 'none'; }\n")
    if old in s and "closest('.field')" not in s:
        s = s.replace(old, new, 1)
    return s


def main():
    ap = argparse.ArgumentParser(description='公开发布前的整仓脱敏清理')
    ap.add_argument('--apply', action='store_true', help='真正写入（默认只预演）')
    args = ap.parse_args()

    mask = load_mask()
    files = tracked_files()
    deleted, patched, masked = [], [], []

    for rel in files:
        path = os.path.join(ROOT, rel)
        if rel in DELETE:
            deleted.append(rel)
            if args.apply and os.path.exists(path):
                os.remove(path)
            continue
        if os.path.splitext(rel)[1].lower() not in TEXT_EXT or not os.path.exists(path):
            continue
        with open(path, 'r', encoding='utf-8') as f:
            src = f.read()
        out = src
        if rel in ('index.html',):
            out = patch_index(out)
        if rel in ('js/app.js',):
            out = patch_app(out)
        out = mask_text(out, mask)
        if out != src:
            (patched if rel in ('index.html', 'js/app.js') else masked).append(rel)
            if args.apply:
                with open(path, 'w', encoding='utf-8', newline='') as f:
                    f.write(out)

    # 空目录（如 dist/safe 之外的残留）交给 git 自己忽略，不额外处理

    print('== 删除 %d 个真名形态文件 ==' % len(deleted))
    for r in deleted:
        print('   - ' + r)
    print('== 修补入口 %d 个 ==' % len(patched))
    for r in patched:
        print('   * ' + r)
    print('== 全文脱敏 %d 个文件 ==' % len(masked))
    for r in masked[:40]:
        print('   ~ ' + r)
    if len(masked) > 40:
        print('   ... 其余 %d 个省略' % (len(masked) - 40))

    # 落盘后自检：真名必须归零
    if args.apply:
        tokens = [a for a, _b in mask]
        bad = []
        for rel in tracked_files():
            path = os.path.join(ROOT, rel)
            if not os.path.exists(path) or os.path.splitext(rel)[1].lower() not in TEXT_EXT:
                continue
            with open(path, 'r', encoding='utf-8') as f:
                t = f.read()
            hit = [x for x in tokens if x in t]
            if hit:
                bad.append('%s -> %s' % (rel, '、'.join(hit[:5])))
        print('\n== 自检 ==')
        if bad:
            print('!! 仍有真实主体残留：')
            for b in bad:
                print('   ' + b)
            return 1
        print('ok 全仓 %d 个真实主体名命中数 = 0' % len(tokens))
    else:
        print('\n（预演模式，未写入；加 --apply 生效）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
