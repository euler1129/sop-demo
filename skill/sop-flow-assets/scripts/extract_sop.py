# -*- coding: utf-8 -*-
"""
通用 SOP 源文件抽取器（确定性脚本）

把客户的 Excel(.xlsx) / Visio(.vsdx) 抽取为「未归一化的来源数据」raw.json，
供前端 SOP.model.normalize() 统一归一化。

设计红线：
  - 本脚本只做「抽取」，绝不做「归一化」。归一化必须与页面内导入走同一个函数，
    否则一定会出现「内置样例能跑、现场真实文件跑挂」的双代码路径问题。
  - 抽取过程不修改原文：换行、缩进、合并单元格留白一律原样保留，交由归一化层处理。

用法：
  python extract_sop.py <文件或目录>... -o raw.json [--space 资产空间] [--id-prefix p]
"""
import argparse
import html
import json
import os
import re
import sys
import zipfile

import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')

VNS = '{http://schemas.microsoft.com/office/visio/2012/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def tname(el):
    return el.tag.split('}')[-1]


# --------------------------------------------------------------------------
# Excel → rows
# --------------------------------------------------------------------------
def parse_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(values_only=True):
            cells = []
            for c in r:
                if c is None:
                    cells.append('')
                elif isinstance(c, float) and c.is_integer():
                    cells.append(str(int(c)))
                else:
                    cells.append(str(c))
            rows.append(cells)
        # 去掉尾部全空行（尾部空行会让前端误判为数据行）
        while rows and not any(x.strip() for x in rows[-1]):
            rows.pop()
        if not rows:
            continue
        width = max(len(r) for r in rows)
        sheets.append({'sheet': ws.title, 'rows': [r + [''] * (width - len(r)) for r in rows]})
        print('  [xlsx] %-16s %3d rows x %2d cols' % (ws.title, len(rows), width))
    return sheets


# --------------------------------------------------------------------------
# Visio → shapes + connects
# --------------------------------------------------------------------------
def text_of(shape_el):
    """取 Shape 自身的 <Text>（不含子 Shape 的文本）"""
    for ch in shape_el:
        if tname(ch) == 'Text':
            parts = []
            for p in ch.iter():
                if tname(p) == 'pp':
                    parts.append('\n')
                elif p.text:
                    parts.append(p.text)
                if tname(p) != 'Text' and p.tail:
                    parts.append(p.tail)
            return re.sub(r'\n{2,}', '\n', html.unescape(''.join(parts))).strip()
    return ''


def cells_of(shape_el):
    return {ch.get('N'): ch.get('V') or '0' for ch in shape_el if tname(ch) == 'Cell'}


def prop_of(shape_el, name):
    """取自定义属性值：Section[Property] → Row[N=name] → Cell[N=Value]"""
    for sec in shape_el:
        if tname(sec) != 'Section' or sec.get('N') != 'Property':
            continue
        for row in sec:
            if tname(row) != 'Row' or row.get('N') != name:
                continue
            for c in row:
                if tname(c) == 'Cell' and c.get('N') == 'Value':
                    return c.get('V') or ''
    return ''


def num(v):
    try:
        return float(v)
    except Exception:
        return 0.0


def parse_vsdx(path):
    z = zipfile.ZipFile(path)
    names = set(z.namelist())

    # 关键：Page 与页面 XML 文件名的映射在 pages.xml.rels，必须由 r:id 解析。
    # 绝不能假设「Page ID == pageN.xml」——真实文件里 ID 常是 0/5/8，文件名却是 page1/2/3。
    rels = {}
    rel_path = 'visio/pages/_rels/pages.xml.rels'
    if rel_path in names:
        for rel in ET.fromstring(z.read(rel_path).decode('utf-8')):
            rels[rel.get('Id')] = rel.get('Target')

    pages_root = ET.fromstring(z.read('visio/pages/pages.xml').decode('utf-8'))
    plan = []
    for pg in pages_root:
        if tname(pg) != 'Page':
            continue
        target = None
        for sub in pg:                       # 关系 id 在 <Page> 的子元素 <Rel r:id="..."/> 上
            if tname(sub) == 'Rel':
                rid = sub.get(RNS + 'id')
                if rid and rid in rels:
                    target = rels[rid]
                    break
        plan.append((pg.get('Name') or pg.get('NameU') or '未命名', target))
    print('  [vsdx] pages: %s' % [(n, t) for n, t in plan])

    pages = []
    for pname, target in plan:
        if not target or ('visio/pages/' + target) not in names:
            print('  [vsdx] !! 跳过（找不到页面文件）: %s -> %s' % (pname, target))
            continue
        root = ET.fromstring(z.read('visio/pages/' + target).decode('utf-8'))
        shapes, connects = [], []

        def build(sh, parent_id):
            """阶段一：建树，坐标保持相对父级的局部值，并抽取 Function（业务环节）属性"""
            cells = cells_of(sh)
            item = {
                'id': sh.get('ID'), 'p': parent_id,
                'n': sh.get('NameU') or '', 't': sh.get('Type') or '',
                'lx': num(cells.get('PinX')), 'ly': num(cells.get('PinY')),
                'w': num(cells.get('Width')), 'h': num(cells.get('Height')),
                'txt': text_of(sh), 'fn': prop_of(sh, 'Function'), 'kids': [],
            }
            for sub in sh:
                tn = tname(sub)
                if tn == 'Shapes':
                    for ks in sub:
                        if tname(ks) == 'Shape':
                            item['kids'].append(build(ks, item['id']))
                elif tn == 'Connects':
                    for c in sub:
                        if tname(c) == 'Connect':
                            connects.append({'f': c.get('FromSheet'), 'fc': c.get('FromCell'), 't': c.get('ToSheet')})
            return item

        def fix_height(item):
            """阶段二：自底向上补算 Group 缺失的 Height——Visio 的 Group 常不写 Height 单元格，
            缺了它所有 Group 的 h 都是 0，会被前端误判为「不是节点」而丢失整批泳道/环节。"""
            for k in item['kids']:
                fix_height(k)
            if not item['h'] and item['kids']:
                tops = [k['ly'] + k['h'] / 2.0 for k in item['kids']]
                bots = [k['ly'] - k['h'] / 2.0 for k in item['kids']]
                if max(tops) - min(bots) > 0:
                    item['h'] = max(tops) - min(bots)

        def flatten(item, ox, oy):
            """阶段三：自顶向下折算绝对坐标（Visio 子形状坐标相对父级，Y 轴向上）"""
            ax, ay = ox + item['lx'], oy + item['ly']
            shapes.append({
                'id': item['id'], 'p': item['p'], 'n': item['n'], 't': item['t'],
                'x': round(ax, 4), 'y': round(ay, 4),
                'w': round(item['w'], 4), 'h': round(item['h'], 4),
                'txt': item['txt'], 'fn': item['fn'],
            })
            for k in item['kids']:
                flatten(k, ax - item['w'] / 2.0, ay - item['h'] / 2.0)

        tree = []
        for ch in root:
            if tname(ch) == 'Shapes':
                for sh in ch:
                    if tname(sh) == 'Shape':
                        tree.append(build(sh, ''))
            elif tname(ch) == 'Connects':
                for c in ch:
                    if tname(c) == 'Connect':
                        connects.append({'f': c.get('FromSheet'), 'fc': c.get('FromCell'), 't': c.get('ToSheet')})
        for t in tree:
            fix_height(t)
            flatten(t, 0.0, 0.0)

        with_fn = len([s for s in shapes if s['fn']])
        print('  [vsdx] %-22s %4d shapes, %3d connects, %d 个带 Function 属性'
              % (pname[:22], len(shapes), len(connects), with_fn))
        if not with_fn:
            print('        提示：本页没有 Function 属性，业务环节将回退为按坐标分列推断')
        pages.append({'name': pname, 'shapes': shapes, 'connects': connects})
    return pages


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def collect(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _dirs, names in os.walk(p):
                for n in sorted(names):
                    files.append(os.path.join(root, n))
        else:
            files.append(p)
    return files


def main():
    ap = argparse.ArgumentParser(description='SOP 源文件 → raw.json')
    ap.add_argument('inputs', nargs='+', help='源文件或目录（.xlsx/.vsdx）')
    ap.add_argument('-o', '--out', default='raw.json')
    ap.add_argument('--space', default='待归类', help='资产空间名')
    ap.add_argument('--id-prefix', default='s')
    args = ap.parse_args()

    items = []
    skipped = []
    for f in collect(args.inputs):
        ext = os.path.splitext(f)[1].lower()
        base = os.path.splitext(os.path.basename(f))[0]
        print('== %s' % os.path.basename(f))
        try:
            if ext == '.xlsx':
                for i, sheet in enumerate(parse_xlsx(f)):
                    items.append({
                        'id': '%s%d' % (args.id_prefix, len(items) + 1), 'kind': 'xlsx',
                        'name': sheet['sheet'] if sheet['sheet'] != 'Sheet1' else base,
                        'space': args.space, 'desc': '%s（Excel 环节方案表）' % base,
                        'source': sheet,
                    })
            elif ext == '.vsdx':
                for page in parse_vsdx(f):
                    items.append({
                        'id': '%s%d' % (args.id_prefix, len(items) + 1), 'kind': 'vsdx',
                        'name': page['name'], 'space': args.space,
                        'desc': '%s（Visio 泳道图）' % base, 'source': page,
                    })
            else:
                skipped.append(ext or f)
        except Exception as e:
            print('  !! 解析失败: %s: %s' % (type(e).__name__, e))
            skipped.append(f)

    pack = {'version': '1.0', 'items': items}
    with open(args.out, 'w', encoding='utf-8') as fp:
        json.dump(pack, fp, ensure_ascii=False, indent=1)
    print('\n== 抽取完成：%d 个样例项 → %s (%.1f KB)' % (len(items), args.out, os.path.getsize(args.out) / 1024.0))
    if skipped:
        print('   以下输入未由本脚本处理（Word/PDF/文本请在页面内用 AI 解析或自然语言建模）：')
        for s in dict.fromkeys(skipped):
            print('     - %s' % s)
    print('   下一步：在页面内归一化，或运行 scripts/build_delivery.py 组装交付物。')


if __name__ == '__main__':
    main()
