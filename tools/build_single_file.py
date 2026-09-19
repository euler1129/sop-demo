# -*- coding: utf-8 -*-
"""
单文件打包器（开发期使用）

把 index.html 依赖的 css / js / vendor / 内置样例全部内联，
产出一个自包含 HTML：双击即开、微信邮件直发、断网可用。

为什么必须内联：
  - 销售机器不能假设装了 Python / Node / Java，起不了本地服务；
  - file:// 协议下 fetch('samples/*.json') 会被 CORS 拦死，ES Module 的 import 同样失败；
  - 现场网络不可控，任何 CDN 外链都可能让页面白屏。
因此：样例数据内联为 JS 对象、脚本用经典 <script>、依赖全部本地化。
"""
import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIST = os.path.join(ROOT, 'dist')
SAMPLE_REL = 'js/samples/samples-data.js'
SAMPLE_SAFE_REL = 'js/samples/samples-data-safe.js'

SCRIPT_RE = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>', re.I)
CSS_RE = re.compile(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>', re.I)


def read(rel):
    with open(os.path.join(ROOT, rel), 'r', encoding='utf-8') as f:
        return f.read()


def safe_js(code):
    """避免脚本内容里的 </script 提前闭合标签"""
    return code.replace('</script', r'<\/script')


MAP_PATH = os.path.join(HERE, 'desensitize-map.json')

# 内联后仍要把这两处抹掉：desensitize-map.js 的 window.SOP_MASK 与 app.js 的兜底数组，
# 它们「按定义」必然含真实主体名，整份 HTML 脱敏之后必须置空，否则公网产物依旧泄漏。
SOP_MASK_RE = re.compile(r'window\.SOP_MASK\s*=\s*\[.*?\]\s*;', re.S)
FALLBACK_RE = re.compile(
    r'var MASK = \(window\.SOP_MASK && window\.SOP_MASK\.length\) \? window\.SOP_MASK : \[.*?\];',
    re.S)


def load_mask():
    """脱敏表左列即真实主体清单；文件缺失（已清理的公开仓库）时返回空表"""
    if not os.path.exists(MAP_PATH):
        return []
    with open(MAP_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)['mask']


def real_tokens():
    return [a for a, _b in load_mask()]


def main():
    ap = argparse.ArgumentParser(description='打包自包含单文件 HTML')
    ap.add_argument('--safe', action='store_true',
                    help='改用脱敏样例打包（对外发布 / 公网 Pages 用），产物里不含任何真实主体名')
    args = ap.parse_args()

    out_name = 'SOP流程资产平台-脱敏版.html' if args.safe else 'SOP流程资产平台.html'
    html = read('index.html')
    safe_code = ''

    css_files = CSS_RE.findall(html)
    for rel in css_files:
        css = read(rel)
        html = html.replace('<link rel="stylesheet" href="%s">' % rel,
                            '<style>\n/* %s */\n%s\n</style>' % (rel, css), 1)
        print('  + css  %-32s %6.1f KB' % (rel, len(css) / 1024.0))

    js_files = SCRIPT_RE.findall(html)
    for rel in js_files:
        use = SAMPLE_SAFE_REL if (args.safe and rel == SAMPLE_REL) else rel
        if not os.path.exists(os.path.join(ROOT, use)):
            use = SAMPLE_SAFE_REL          # 真名样例已从仓库移除时退回脱敏样例
        code = read(use)
        if use == SAMPLE_SAFE_REL:
            safe_code = code
        html = html.replace('<script src="%s"></script>' % rel,
                            '<script>\n/* %s */\n%s\n</script>' % (use, safe_js(code)), 1)
        print('  + js   %-32s %6.1f KB' % (use, len(code) / 1024.0))

    # 兜底检查：不得残留任何外链资源
    left = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
    if left:
        print('  !! 检测到外链（离线不可用）：', left)
    else:
        print('  ok 无 CDN / 外链依赖')

    # 脱敏版发布前的漏网检查：真实主体名一个都不许出现在**整份 HTML** 里
    # （旧实现只看样例数据，漏掉了内嵌的映射表和 JS 里写死的文案，公网产物照样泄漏）
    if args.safe:
        mask = load_mask()
        for a, b in mask:
            html = html.replace(a, b)
        html = SOP_MASK_RE.sub('window.SOP_MASK = [];', html)
        html = FALLBACK_RE.sub('var MASK = window.SOP_MASK || [];', html)
        print('  ok 整份 HTML 已按 %d 条映射全文脱敏，内嵌映射表已置空' % len(mask))

        leak = [t for t in real_tokens() if t in html]
        if leak:
            print('  !! 脱敏产物仍含真实主体：%s' % '、'.join(leak))
            return 1
        print('  ok 全文核验通过：0 处真实主体残留')

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, out_name)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('  => %s (%.1f KB)' % (out, os.path.getsize(out) / 1024.0))

    # 再输出 ASCII 名 index.html：GitHub Pages 只能把 /dist/ 当目录入口，中文文件名发链接还要转义
    for idx in [os.path.join(DIST, 'index.html'), os.path.join(DIST, 'safe', 'index.html')]:
        os.makedirs(os.path.dirname(idx), exist_ok=True)
        with open(idx, 'w', encoding='utf-8') as f:
            f.write(html)
        print('  => %s (%.1f KB)' % (idx, os.path.getsize(idx) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
