# -*- coding: utf-8 -*-
"""
脱敏泄漏检查器（对外发布前的最后一道闸）

对抽取产物（raw.json）或源 xlsx/vsdx 跑一遍脱敏映射，再扫残留真实信息。
分两级，避免「全是误报」导致这道闸被跳过：

  HARD  命中已知实体词典（船公司 / 知名企业 / 口岸码头 / 手机号邮箱）→ exit 1，必须处理
  SOFT  启发式挑出的疑似专名候选 → 只打印，供人工挑真实主体补进映射表

换客户时的标准动作：
  1. python check_desensitize.py <源文件>...          看 HARD/SOFT 输出
  2. 把 SOFT 里确认是真实主体的词按「长词在前」补进 references/desensitize-map.json
  3. 重跑本脚本 → HARD 应为 0；再跑 build_delivery.py 重新生成样例与交付物

用法：
  python check_desensitize.py raw.json [--map references/desensitize-map.json]
  python check_desensitize.py raw.json --dump    只列高频中文片段，供人工快速扫一遍
"""
import argparse
import collections
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from extract_sop import parse_xlsx, parse_vsdx  # noqa: E402

# ---- HARD：已知实体词典（命中即视为泄漏） ----------------------------------
KNOWN = {
    '船公司': ['船公司A', '达飞', '地中海航运', '中远海', '长荣', '赫伯罗特', '阳明', '以星',
               'MSK', 'CMA', 'COSCO', 'EVERGREEN', 'ONE', 'MSC', 'HMM'],
    '知名企业': ['客户A', '腾讯', '中兴', '比亚迪', '大疆', '富士康', '联想', '小米',
                 '美的', '格力', '海尔', '宁德时代'],
    '口岸码头': ['口岸C', '赤湾', '盐田', '口岸B', '园区A', '口岸D', '南沙', '妈湾', '铜鼓', '海关'],
}
RX_CONTACT = re.compile(r'1[3-9]\d{9}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')

# ---- SOFT：启发式候选 ------------------------------------------------------
RX_ENTITY = [
    ('客户/主体', re.compile(r'[一-龥A-Za-z]{2,12}(?:公司|集团|国际|物流|船务|货运|海运|报关|供应链|仓储)')),
    ('码头口岸', re.compile(r'[一-龥]{2,6}(?:码头|海关)|[一-龥]{2,4}(?:港|湾)(?![口])')),
    ('系统平台', re.compile(r'[一-龥A-Za-z]{2,10}(?:系统|平台|客户端|作业网|协同网)|[A-Za-z]{2,}(?:EDI|ERP|TMS|WMS)')),
    ('园区地名', re.compile(r'[一-龥]{2,4}(?:园区|保税区|工业区|开发区)')),
]

# 通名后缀：剥掉后剩下的才是「专名」
TAILS = ('集装箱码头', '码头', '海关', '公司', '集团', '国际', '物流', '船务', '货运', '海运',
         '报关', '供应链', '仓储', '系统', '平台', '客户端', '作业网', '协同网',
         '保税区', '工业区', '开发区', '园区', '港', '湾', 'EDI', 'ERP', 'TMS', 'WMS')

# 通用业务词：候选词里含这些，说明只是泛指（「通知船公司」「还重码头」），不是真实主体
GENERIC = {
    '客户', '系统', '平台', '园区', '海关', '供应商', '承运方', '运输', '派车', '派单', '派工',
    '订舱', '提单', '内网', '外网', '相关', '当前', '不同', '抓取', '查询', '支付', '创建',
    '上传', '核对', '使用', '通知', '收到', '接收', '申请', '依据', '根据', '再到', '直接',
    '核实', '产生', '空柜', '重柜', '大船', '车辆', '司机', '订单', '客服', '调度', '作业',
    '费用', '信息', '单据', '进度', '明细', '状态', '邮件', '网站', '窗口', '线上', '线下',
    '内部', '外部', '指定', '备用', '概念', '无纸化', '打单', '换单', '整柜', '提交', '缮制',
    '审核', '涉及', '并将', '返回', '执行', '离开', '前往', '更新', '选择', '操作', '点击',
    '录入', '保存', '确认', '完结', '放行', '后续', '更换', '对接', '申报', '开出', '记录',
    '制定', '提供', '反馈', '发起', '请求', '离场', '离仓', '撤单', '改派', '作废', '取消',
    '上柜', '存重', '间内', '应商',
}

# 前缀尾部的通用修饰词，剥掉后再判断
DESCRIPTOR = ('相关', '指定', '内部', '线上', '线下', '网站', '窗口', '费用', '信息', '单据',
              '进度', '明细', '状态', '同步', '自动', '当前', '不同', '正式', '草稿')

# 映射表里的代称不应再被当成泄漏
SAFE_WORDS = ('客户A', '客户B', '系统A', '系统B', '系统C', '系统D', '系统E', '船公司A', '园区A',
              '口岸A', '口岸B', '口岸C', '口岸D', '华南公司', '本集团', '仓储作业组', '流程资产', '资产')


def proper_part(tok):
    """剥掉通名后缀与通用修饰词，取真正的专名部分"""
    core = tok
    for t in sorted(TAILS, key=len, reverse=True):
        if core.endswith(t) and len(core) > len(t):
            core = core[:-len(t)]
            break
    else:
        return core
    changed = True
    while changed:
        changed = False
        for d in DESCRIPTOR:
            if core.endswith(d) and len(core) > len(d):
                core = core[:-len(d)]
                changed = True
    return core


def is_candidate(tok):
    if len(tok) < 2 or any(w in tok for w in SAFE_WORDS):
        return False
    core = proper_part(tok)
    if len(core) < 2:
        return False
    if core in GENERIC or any(g in core for g in GENERIC):
        return False
    return True


def walk_text(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for x in obj:
            yield from walk_text(x)
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from walk_text(v)


def load_texts(paths):
    texts = []
    for f in paths:
        ext = os.path.splitext(f)[1].lower()
        if ext == '.xlsx':
            for sheet in parse_xlsx(f):
                for row in sheet['rows']:
                    texts.extend(c for c in row if c)
        elif ext == '.vsdx':
            for page in parse_vsdx(f):
                for s in page['shapes']:
                    texts.append(s['txt'] or '')
                    texts.append(s['fn'] or '')
        elif ext == '.json':
            with open(f, 'r', encoding='utf-8') as fp:
                texts.extend(walk_text(json.load(fp)))
    return texts


def mask(text, mapping):
    for a, b in mapping:
        text = text.replace(a, b)
    return text


def main():
    ap = argparse.ArgumentParser(description='脱敏泄漏检查')
    ap.add_argument('inputs', nargs='+', help='raw.json 或源 .xlsx/.vsdx')
    ap.add_argument('--map', default=os.path.join(HERE, '..', 'references', 'desensitize-map.json'))
    ap.add_argument('--dump', action='store_true', help='只列高频中文片段，供人工快速扫一遍')
    args = ap.parse_args()

    with open(args.map, 'r', encoding='utf-8') as f:
        mapping = [(a, b) for a, b in json.load(f)['mask']]

    texts = load_texts(args.inputs)
    masked = [mask(t, mapping) for t in texts]
    print('   已脱敏 %d 段文本' % len(masked))

    if args.dump:
        cnt = collections.Counter()
        for t in masked:
            for seg in re.findall(r'[一-龥]{2,6}', t):
                cnt[seg] += 1
        print('== 出现次数 >= 5 的中文片段（人工从中挑真实主体补进映射表）')
        for seg, n in cnt.most_common():
            if n >= 5:
                print('  %4d  %s' % (n, seg))
        return 0

    # HARD
    hard = collections.defaultdict(list)
    for t in masked:
        for cat, names in KNOWN.items():
            for n in names:
                if n in t:
                    hard['%s：%s' % (cat, n)].append(t[:60])
        for m in RX_CONTACT.finditer(t):
            hard['联系方式：%s' % m.group(0)].append(t[:60])

    # SOFT
    soft = collections.defaultdict(list)
    for t in masked:
        for cat, rx in RX_ENTITY:
            for m in rx.finditer(t):
                if is_candidate(m.group(0)):
                    soft[m.group(0)].append('[%s] %s' % (cat, t[:50]))

    rc = 0
    if hard:
        rc = 1
        print('\n!! HARD 命中已知真实实体（必须处理）：')
        for k, ctx in sorted(hard.items(), key=lambda kv: -len(kv[1])):
            print('  %-20s x%-3d  例：%s' % (k, len(ctx), ctx[0]))
    else:
        print('\nOK 未命中已知真实实体（船公司 / 知名企业 / 口岸码头 / 联系方式）')

    print('\n-- SOFT 疑似专名候选 %d 个（人工确认后把真实主体补进映射表）：' % len(soft))
    for k, ctx in sorted(soft.items(), key=lambda kv: -len(kv[1])):
        print('  %-16s x%-3d  %s' % (k, len(ctx), ctx[0]))
    return rc


if __name__ == '__main__':
    sys.exit(main())
