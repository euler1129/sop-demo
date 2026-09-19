# -*- coding: utf-8 -*-
"""
把 raw.json 组装为可交付的单文件演示页面。

做的事：
  1. 按脱敏映射表生成 real / safe 两套样例（safe 用于对外演示与公网发布）
  2. 写入 <repo>/js/samples/samples-data.js（内联 JS 对象 —— 禁止 fetch 本地 JSON）
  3. 写入 <repo>/js/samples/desensitize-map.js（让页面运行时与预解析共用同一份映射）
  4. 调用 <repo>/tools/build_single_file.py 内联打包，产出 dist 单文件 HTML

用法：
  python build_delivery.py raw.json --repo <sop-demo 工程路径> [--no-desensitize]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))


URL_RE = re.compile(r'https?://[^\s\]\）】]+')


def desensitize(obj, mapping):
    """脱敏：先屏蔽外链（链接里常带真实域名/系统名），再按映射表替换"""
    if isinstance(obj, str):
        s = URL_RE.sub('[链接已脱敏]', obj)
        for a, b in mapping:
            s = s.replace(a, b)
        return s
    if isinstance(obj, list):
        return [desensitize(x, mapping) for x in obj]
    if isinstance(obj, dict):
        return {k: desensitize(v, mapping) for k, v in obj.items()}
    return obj


def main():
    ap = argparse.ArgumentParser(description='raw.json → 单文件交付物')
    ap.add_argument('samples', help='extract_sop.py 产出的 raw.json')
    ap.add_argument('--repo', required=True, help='sop-demo 工程路径')
    ap.add_argument('--map', default=os.path.join(HERE, '..', 'references', 'desensitize-map.json'))
    ap.add_argument('--no-desensitize', action='store_true')
    args = ap.parse_args()

    with open(args.samples, 'r', encoding='utf-8') as f:
        pack = json.load(f)

    items = pack.get('items') or []
    if not items:
        print('!! raw.json 里没有任何样例项，先跑 extract_sop.py')
        return 1

    with open(args.map, 'r', encoding='utf-8') as f:
        mapping = [(a, b) for a, b in json.load(f)['mask']]

    # 先脱敏再比较：能提前发现真实客户名/系统名漏进交付物
    diff = []
    for it in items:
        s = json.dumps(it, ensure_ascii=False)
        t = json.dumps(desensitize(it, mapping), ensure_ascii=False)
        if s != t:
            diff.append(it['id'])
    if diff:
        print('   脱敏生效的样例项：%s' % ', '.join(diff))
    else:
        print('   警告：脱敏映射未命中任何内容，请检查 references/desensitize-map.json 是否需要按本客户替换')

    # 与 tools/pregen_samples.py 保持同一契约：real 给内部演示，safe 给对外发布
    safe = desensitize(pack, mapping)
    out_dir = os.path.join(args.repo, 'js', 'samples')
    os.makedirs(out_dir, exist_ok=True)

    def write(name, obj):
        with open(os.path.join(out_dir, name), 'w', encoding='utf-8') as f:
            f.write('/* 自动生成，请勿手改 —— 由 skill/sop-flow-assets/scripts/build_delivery.py 生成 */\n')
            f.write('window.SOP_SAMPLES = ' + json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + ';\n')
        print('   写出 js/samples/%s' % name)

    write('samples-data.js', pack)
    write('samples-data-safe.js', safe)

    with open(os.path.join(out_dir, 'desensitize-map.js'), 'w', encoding='utf-8') as f:
        f.write('/* 自动生成，请勿手改 —— 来自 references/desensitize-map.json */\n')
        f.write('window.SOP_MASK = ' + json.dumps(mapping, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('   写出 js/samples/desensitize-map.js')

    # 内联打包（单文件自包含 HTML，双击即开）
    builder = os.path.join(args.repo, 'tools', 'build_single_file.py')
    print('== 打包单文件版')
    r = subprocess.run([sys.executable, builder], cwd=args.repo)
    if r.returncode != 0:
        print('!! 打包失败')
        return r.returncode

    out = os.path.join(args.repo, 'dist', 'SOP流程资产平台.html')
    print('\n== 交付物就绪')
    print('   单文件版（发客户 / 微信邮件）：%s' % out)
    print('   本地分享链接（file://）：%s' % urllib.parse.urljoin('file:', urllib.parse.quote(out.replace('\\', '/'))))
    print('   下一步：node tools/smoke_test.js 回归，再用浏览器确认四个视图与一键成文')


if __name__ == '__main__':
    sys.exit(main())
