# -*- coding: utf-8 -*-
"""
离线预解析脚本（开发期使用，不参与运行时）

作用：
  1. 解析源 Excel（A-集输港业务流程环节方案V3.1.xlsx）→ 原始行数组（保留换行与缩进）
  2. 解析源 Visio（客户A海运流程-20260226.vsdx）→ 最小形状表（id/父级/文本/绝对坐标）+ 连线表
  3. 按脱敏映射表生成 real / safe 两套样例，输出 js/samples/samples-data.js

设计要点：
  - 本脚本只做「抽取」，不做「归一化」。归一化统一在前端 normalize() 中完成，
    保证「内置样例」与「用户现场导入的真实文件」走完全相同的代码路径。
"""
import os
import re
import sys
import json
import zipfile
import html

import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_DIR = os.path.dirname(ROOT)          # e:/零工/中国本集团
OUT_DIR = os.path.join(ROOT, 'js', 'samples')
os.makedirs(OUT_DIR, exist_ok=True)

XLSX_SRC = os.path.join(SRC_DIR, 'A-集输港业务流程环节方案V3.1.xlsx')
VSDX_SRC = os.path.join(SRC_DIR, '客户A海运流程-20260226.vsdx')

VNS = '{http://schemas.microsoft.com/office/visio/2012/main}'


def tname(el):
    return el.tag.split('}')[-1]


# --------------------------------------------------------------------------
# 1. Excel -> rows
# --------------------------------------------------------------------------
def parse_xlsx():
    import openpyxl
    wb = openpyxl.load_workbook(XLSX_SRC, data_only=True)
    result = []
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
        # 去掉尾部全空行
        while rows and not any(x.strip() for x in rows[-1]):
            rows.pop()
        result.append({'sheet': ws.title, 'rows': rows})
        print('  [xlsx] %s: %d rows x %d cols' % (ws.title, len(rows), len(rows[0]) if rows else 0))
    return result


# --------------------------------------------------------------------------
# 2. Visio -> shapes + connects
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
            s = ''.join(parts)
            s = html.unescape(s)
            s = re.sub(r'\n{2,}', '\n', s).strip()
            return s
    return ''


def cells_of(shape_el):
    d = {}
    for ch in shape_el:
        if tname(ch) == 'Cell':
            d[ch.get('N')] = ch.get('V') or '0'
    return d


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


def num(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default


def parse_vsdx():
    z = zipfile.ZipFile(VSDX_SRC)
    # Page ID -> 文件名 的映射在 pages.xml.rels 中，必须由 r:id 解析，不能假设 ID 与文件名一致
    rels = {}
    rel_root = ET.fromstring(z.read('visio/pages/_rels/pages.xml.rels').decode('utf-8'))
    for rel in rel_root:
        rels[rel.get('Id')] = rel.get('Target')

    pages_root = ET.fromstring(z.read('visio/pages/pages.xml').decode('utf-8'))
    plan = []
    for pg in pages_root:
        if tname(pg) != 'Page':
            continue
        # 关系 id 在 <Page> 的子元素 <Rel r:id="rIdN"/> 上，不在 Page 属性上
        target = None
        for sub in pg:
            if tname(sub) == 'Rel':
                rid = sub.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                if rid and rid in rels:
                    target = rels[rid]
                    break
        plan.append((pg.get('Name') or pg.get('NameU') or '未命名', target))
    print('  [vsdx] pages:', plan)

    pages = []
    for pname, target in plan:
        if not target:
            continue
        raw = z.read('visio/pages/' + target).decode('utf-8')
        root = ET.fromstring(raw)

        shapes = []
        connects = []

        def build(sh, parent_id):
            """阶段一：建树，坐标保留为相对父级的局部值"""
            cells = cells_of(sh)
            item = {
                'id': sh.get('ID'),
                'p': parent_id,
                'n': sh.get('NameU') or '',
                't': sh.get('Type') or '',
                'lx': num(cells.get('PinX')),
                'ly': num(cells.get('PinY')),
                'w': num(cells.get('Width')),
                'h': num(cells.get('Height')),
                'txt': text_of(sh),
                'fn': prop_of(sh, 'Function'),
                'kids': [],
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
                            connects.append({
                                'f': c.get('FromSheet'),
                                'fc': c.get('FromCell'),
                                't': c.get('ToSheet'),
                            })
            return item

        def fix_height(item):
            """阶段二：自底向上补算 Group 缺失的 Height（Visio 常不写该单元格）"""
            for k in item['kids']:
                fix_height(k)
            if not item['h'] and item['kids']:
                tops = [k['ly'] + k['h'] / 2.0 for k in item['kids']]
                bots = [k['ly'] - k['h'] / 2.0 for k in item['kids']]
                hh = max(tops) - min(bots)
                if hh > 0:
                    item['h'] = hh

        def flatten(item, ox, oy):
            """阶段三：自顶向下折算绝对坐标"""
            ax = ox + item['lx']
            ay = oy + item['ly']
            shapes.append({
                'id': item['id'],
                'p': item['p'],
                'n': item['n'],
                't': item['t'],
                'x': round(ax, 4),
                'y': round(ay, 4),
                'w': round(item['w'], 4),
                'h': round(item['h'], 4),
                'txt': item['txt'],
                'fn': item['fn'],
            })
            nxt_ox = ax - item['w'] / 2.0
            nxt_oy = ay - item['h'] / 2.0
            for k in item['kids']:
                flatten(k, nxt_ox, nxt_oy)

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

        pages.append({'name': pname, 'shapes': shapes, 'connects': connects})
        print('  [vsdx] %s(%s): %d shapes, %d connects'
              % (target, pname, len(shapes), len(connects)))
    return pages


# --------------------------------------------------------------------------
# 3. 脱敏
# --------------------------------------------------------------------------
def load_mask():
    """从 tools/desensitize-map.json 读取映射（顺序敏感：长的先替换）"""
    with open(os.path.join(HERE, 'desensitize-map.json'), 'r', encoding='utf-8') as f:
        raw = json.load(f)
    return [(a, b) for a, b in raw['mask']]


DESENSITIZE = load_mask()
URL_RE = re.compile(r'https?://[^\s\]\）】]+')


def desensitize(obj):
    if isinstance(obj, str):
        s = obj
        s = URL_RE.sub('[链接已脱敏]', s)
        for a, b in DESENSITIZE:
            s = s.replace(a, b)
        return s
    if isinstance(obj, list):
        return [desensitize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: desensitize(v) for k, v in obj.items()}
    return obj


# --------------------------------------------------------------------------
# 4. 输出
# --------------------------------------------------------------------------
def emit(pack):
    js = []
    js.append('/* 自动生成，请勿手改 —— 由 tools/pregen_samples.py 生成 */')
    js.append('window.SOP_SAMPLES = ' + json.dumps(pack, ensure_ascii=False, separators=(',', ':')) + ';')
    return '\n'.join(js)


def main():
    print('== 预解析开始 ==')
    sheets = parse_xlsx()
    pages = parse_vsdx()

    pack_real = {
        'version': '1.0',
        'items': [
            {'id': 'jigang', 'kind': 'xlsx', 'name': '集港业务流程',
             'space': '集疏运中心', 'desc': '集港（出口重柜入港）标准作业流程', 'source': sheets[0]},
            {'id': 'shugang', 'kind': 'xlsx', 'name': '疏港业务流程',
             'space': '集疏运中心', 'desc': '疏港（进口重柜疏运）标准作业流程',
             'source': sheets[1] if len(sheets) > 1 else sheets[0]},
        ] + [
            {'id': 'hw%d' % (i + 1), 'kind': 'vsdx', 'name': p['name'],
             'space': '海运事业部', 'desc': '客户A海运流程（Visio 多页泳道图）', 'source': p}
            for i, p in enumerate(pages)
        ],
    }
    pack_safe = desensitize(pack_real)

    with open(os.path.join(OUT_DIR, 'samples-data.js'), 'w', encoding='utf-8') as f:
        f.write(emit(pack_real))
    with open(os.path.join(OUT_DIR, 'samples-data-safe.js'), 'w', encoding='utf-8') as f:
        f.write(emit(pack_safe))

    # 脱敏表同时下发到运行时，保证「开关脱敏」与预生成样例用的是同一份映射
    with open(os.path.join(OUT_DIR, 'desensitize-map.js'), 'w', encoding='utf-8') as f:
        f.write('/* 自动生成，请勿手改 —— 来自 tools/desensitize-map.json */\n')
        f.write('window.SOP_MASK = ' + json.dumps(DESENSITIZE, ensure_ascii=False, separators=(',', ':')) + ';\n')

    for n in ('samples-data.js', 'samples-data-safe.js', 'desensitize-map.js'):
        p = os.path.join(OUT_DIR, n)
        print('  写出 %s (%.1f KB)' % (n, os.path.getsize(p) / 1024.0))
    print('== 完成 ==')


if __name__ == '__main__':
    main()
