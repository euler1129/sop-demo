/* ============================================================
   统一流程资产模型 ProcessAsset
   ------------------------------------------------------------
   所有来源（内置样例 / 用户导入的 Excel、Visio、Word、PDF / 自然语言）
   都必须先归一化成同一份 ProcessAsset，再由渲染器出图、报告器出文档、
   版本模块做 diff。新增来源只需加一个解析器，不动核心。
   ============================================================ */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var model = (SOP.model = {});

  var _seq = 0;
  model.uid = function (p) {
    _seq += 1;
    return (p || 'id') + '_' + _seq.toString(36) + Math.random().toString(36).slice(2, 6);
  };

  /* ---------- 小工具 ---------- */
  function clean(s) {
    return (s == null ? '' : String(s)).replace(/　/g, ' ').trim();
  }
  model.clean = clean;

  // 角色单元格常见写法："客户（E单），华南公司签约客户" → 取主角色 "客户"
  model.primaryRole = function (s) {
    var t = clean(s);
    if (!t) return '未指定角色';
    var seg = t.split(/[\n，,、；;（(]/)[0].trim();
    return seg || '未指定角色';
  };

  // 系统可能多个："系统C（内网作业） / 系统B（外网协同）"
  model.splitList = function (s) {
    var t = clean(s);
    if (!t) return [];
    return t.split(/[、,，\/;；]/).map(function (x) { return x.trim(); }).filter(function (x) { return x && x !== '-' && x !== '无'; });
  };

  /* ---------- 业务操作说明结构化拆分 ----------
     单元格里混着：情况N / 正常 / 异常 / 产生费用 / 缩进续行
     必须按行首标记切分，不能整段塞进说明。
  */
  model.splitOps = function (text) {
    var out = { desc: [], branches: [], exception: [], fee: [] };
    var lines = (text || '').split(/\r?\n/);
    var cur = 'desc';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/^[\s|｜\/\-—*·•]+/, '').trim();
      if (!l) continue;
      if (/^情况\s*\d+/.test(l)) {
        cur = 'branch';
        out.branches.push({ label: l.match(/^情况\s*\d+/)[0], text: l.replace(/^情况\s*\d+\s*[:：]?/, '').trim() });
        continue;
      }
      if (/^正常\s*[:：]/.test(l)) {
        cur = 'branch';
        out.branches.push({ label: '正常', text: l.replace(/^正常\s*[:：]?/, '').trim() });
        continue;
      }
      if (/^异常/.test(l)) {
        cur = 'exception';
        out.exception.push(l.replace(/^异常\s*[:：]?/, '').trim());
        continue;
      }
      if (/^产生费用/.test(l)) {
        cur = 'fee';
        out.fee.push(l.replace(/^产生费用\s*[:：]?/, '').trim());
        continue;
      }
      // 续行：归入上一个已开启的块
      if (cur === 'branch' && out.branches.length) {
        out.branches[out.branches.length - 1].text += '\n' + l;
      } else if (cur === 'exception' && out.exception.length) {
        out.exception[out.exception.length - 1] += '\n' + l;
      } else if (cur === 'fee' && out.fee.length) {
        out.fee[out.fee.length - 1] += '\n' + l;
      } else {
        out.desc.push(l);
      }
    }
    out.descText = out.desc.join('\n');
    out.exceptionText = out.exception.join('\n');
    out.feeText = out.fee.join('\n');
    return out;
  };

  /* ================= Excel → 局部资产 ================= */
  var COL_MAP = {
    '序号': 'seq', '业务环节': 'stage', '操作节点': 'name', '业务环节说明': 'stageDesc',
    '业务操作说明': 'ops', '操作角色': 'role', '输入': 'input', '输出': 'output',
    '涉及系统': 'system', '主状态': 'status'
  };
  var COL_ORDER = ['seq', 'stage', 'name', 'stageDesc', 'ops', 'role', 'input', 'output', 'system', 'status'];

  model.fromExcelSheet = function (sheet) {
    var rows = (sheet.rows || []).map(function (r) { return r.map(function (c) { return c == null ? '' : String(c); }); });
    if (rows.length < 2) return null;

    var head = rows[0].map(function (s) { return clean(s).replace(/\s/g, ''); });
    var idx = {};
    head.forEach(function (h, i) { if (COL_MAP[h]) idx[COL_MAP[h]] = i; });
    COL_ORDER.forEach(function (k, i) { if (idx[k] == null) idx[k] = i; });

    var groups = [];           // 每个 操作节点 一组
    var gmap = {};
    var stageOrder = [];
    var stageDesc = {};
    // 合并单元格在 openpyxl 中读出为空，需向下填充
    var lastSeq = '', lastStage = '', lastName = '';

    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var cell = function (k) { return clean(r[idx[k]]); };
      var seq = cell('seq'), st = cell('stage'), nm = cell('name');
      if (seq) lastSeq = seq;
      if (st) lastStage = st;
      if (nm) lastName = nm;
      var ops = clean(r[idx['ops']]);
      var role = cell('role');
      if (!lastName && !ops) continue;

      if (stageOrder.indexOf(lastStage) < 0) stageOrder.push(lastStage);
      if (!stageDesc[lastStage]) stageDesc[lastStage] = cell('stageDesc');

      var key = lastSeq + '|' + lastStage + '|' + lastName;
      if (!gmap[key]) {
        gmap[key] = {
          seq: lastSeq, stage: lastStage, name: lastName,
          stageDesc: stageDesc[lastStage], variants: []
        };
        groups.push(gmap[key]);
      }
      var opsx = model.splitOps(ops);
      var m = ops.match(/^情况\s*\d+/);
      gmap[key].variants.push({
        label: m ? m[0] : ('情况' + (gmap[key].variants.length + 1)),
        role: role ? role : (gmap[key].variants.length ? gmap[key].variants[gmap[key].variants.length - 1].role : ''),
        input: cell('input'),
        output: cell('output'),
        system: cell('system'),
        status: cell('status'),
        text: opsx.descText,
        exception: opsx.exceptionText,
        fee: opsx.feeText
      });
    }

    var stages = stageOrder.filter(function (s) { return s; }).map(function (s, i) {
      return { id: 'st_' + i, name: s, desc: stageDesc[s] || '', order: i };
    });
    var stageIdOf = {};
    stages.forEach(function (s) { stageIdOf[s.name] = s.id; });

    var nodes = groups.map(function (g, i) {
      var v0 = g.variants[0] || {};
      var role = model.primaryRole(v0.role);
      var exceptions = g.variants.map(function (v) { return v.exception; }).filter(Boolean);
      var fees = g.variants.map(function (v) { return v.fee; }).filter(Boolean);
      return {
        id: 'n_' + i,
        seq: g.seq,
        stage: g.stage,
        stageId: stageIdOf[g.stage] || '',
        name: g.name,
        desc: g.variants.map(function (v) { return v.text; }).filter(Boolean).join('\n'),
        stageDesc: g.stageDesc,
        role: role,
        roles: g.variants.map(function (v) { return model.primaryRole(v.role); }).filter(function (x, k, a) { return a.indexOf(x) === k; }),
        input: v0.input, output: v0.output,
        system: v0.system, status: v0.status,
        variants: g.variants,
        exception: exceptions.join('\n'),
        fee: fees.join('\n'),
        note: ''
      };
    });

    var lanes = [];
    nodes.forEach(function (n) {
      if (lanes.indexOf(n.role) < 0) lanes.push(n.role);
    });

    var edges = [];
    for (var k = 0; k + 1 < nodes.length; k++) {
      edges.push({ id: 'e_' + k, from: nodes[k].id, to: nodes[k + 1].id, label: '', type: 'seq' });
    }

    return { stages: stages, nodes: nodes, laneNames: lanes, edges: edges, sourceKind: 'xlsx', sourceLabel: (sheet.sheet || 'Excel') + ' 工作表' };
  };

  /* ================= Visio → 局部资产 ================= */
  // 结构性容器：本身不是流程节点，其后代也不参与节点识别
  var VS_CONTAINER = /Container|List|Background|Legend|^Title/i;

  model.fromVisioPage = function (page) {
    var shapes = page.shapes || [];
    var connects = page.connects || [];
    if (!shapes.length) return null;

    var byId = {}, childrenOf = {};
    shapes.forEach(function (s) { byId[s.id] = s; });
    shapes.forEach(function (s) {
      var p = s.p || '';
      (childrenOf[p] = childrenOf[p] || []).push(s);
    });

    // 连接器：出现在 Connect 的 FromSheet 上
    var connIds = {};
    connects.forEach(function (c) { if (c.f) connIds[c.f] = 1; });

    var skip = {};                                             // 结构性形状及其后代
    function markSkip(id) {
      skip[id] = 1;
      (childrenOf[id] || []).forEach(function (c) { markSkip(c.id); });
    }
    shapes.forEach(function (s) { if (VS_CONTAINER.test(s.n || '')) markSkip(s.id); });
    Object.keys(connIds).forEach(function (id) { markSkip(id); });

    var cand = shapes.filter(function (s) { return s.w > 0 && s.h > 0 && !skip[s.id]; });
    var maxW = 0, maxH = 0;
    cand.forEach(function (s) { maxW = Math.max(maxW, s.w); maxH = Math.max(maxH, s.h); });

    // 竖列（业务环节）：高且窄；横条（角色泳道）：宽且扁
    var cols = cand.filter(function (s) { return s.h >= maxH * 0.5 && s.h / Math.max(s.w, 1e-6) >= 1.8 && (childrenOf[s.id] || []).length; });
    var bands = cand.filter(function (s) { return s.w >= maxW * 0.5 && s.w / Math.max(s.h, 1e-6) >= 1.8 && (childrenOf[s.id] || []).length; });

    cols.sort(function (a, b) { return a.x - b.x; });          // 左→右 = 环节顺序
    bands.sort(function (a, b) { return b.y - a.y; });         // 上→下 = 角色顺序
    cols.forEach(function (s) { markSkip(s.id); });
    bands.forEach(function (s) { markSkip(s.id); });

    function descendantText(id) {
      var kids = childrenOf[id] || [];
      for (var i = 0; i < kids.length; i++) {
        if (clean(kids[i].txt)) return clean(kids[i].txt).split('\n')[0];
        var d = descendantText(kids[i].id);
        if (d) return d;
      }
      return '';
    }
    function textDeep(id) {
      if (clean(byId[id] && byId[id].txt)) return true;
      var kids = childrenOf[id] || [];
      for (var i = 0; i < kids.length; i++) if (textDeep(kids[i].id)) return true;
      return false;
    }
    function ancestorIsNode(id) {
      var cur = byId[id];
      while (cur) {
        cur = cur.p ? byId[cur.p] : null;
        if (!cur) break;
        if (!skip[cur.id] && textDeep(cur.id)) return true;    // 已由上层代表，避免重复计数
      }
      return false;
    }

    // 节点：非结构性、自身或后代带文本、且没有更上层的同款祖先（Group + 子形状只算一个）
    var nodeShapes = shapes.filter(function (s) {
      if (skip[s.id]) return false;
      if (!textDeep(s.id)) return false;
      return !ancestorIsNode(s.id);
    });

    function repPoint(s) {
      if (s.w > 0 && s.h > 0) return { x: s.x, y: s.y };
      var kids = (childrenOf[s.id] || []).filter(function (c) { return c.w > 0 && c.h > 0; });
      if (!kids.length) return { x: s.x, y: s.y };
      var sx = 0, sy = 0;
      kids.forEach(function (c) { sx += c.x; sy += c.y; });
      return { x: sx / kids.length, y: sy / kids.length };
    }

    var pts = {};
    nodeShapes.forEach(function (s) { pts[s.id] = repPoint(s); });

    /* 环节（列）：优先用形状自带的 Function 属性（Visio 泳道的列标题，最可靠），
       按节点 x 排序；属性缺失时回退到几何列。 */
    var fnX = {}, fnNames = [];
    nodeShapes.forEach(function (s) {
      var f = clean(s.fn);
      if (!f) return;
      if (fnX[f] == null) { fnX[f] = pts[s.id].x; fnNames.push(f); }
      else fnX[f] = Math.min(fnX[f], pts[s.id].x);
    });
    fnNames.sort(function (a, b) { return fnX[a] - fnX[b]; });

    var stageNames, colRanges;
    if (fnNames.length >= 3) {
      stageNames = fnNames.slice();
      colRanges = [];
    } else {
      stageNames = cols.map(function (c) { return descendantText(c.id) || ''; });
      colRanges = cols.map(function (c) { return { x0: c.x - c.w / 2, x1: c.x + c.w / 2 }; });
      if (stageNames.filter(Boolean).length < 2 && fnNames.length) { stageNames = fnNames.slice(); colRanges = []; }
    }
    stageNames = stageNames.map(function (n, i) { return n || ('环节' + (i + 1)); });
    var stages = stageNames.map(function (n, i) {
      return { id: 'st_' + i, name: n, desc: '', order: i, x0: colRanges[i] ? colRanges[i].x0 : 0, x1: colRanges[i] ? colRanges[i].x1 : 0 };
    });
    var stageIndexByName = {};
    stages.forEach(function (s, i) { stageIndexByName[s.name] = i; });

    function stageIndexAt(x) {
      for (var i = 0; i < stages.length; i++) {
        if (stages[i].x0 && x >= stages[i].x0 && x <= stages[i].x1) return i;
      }
      var best = 0, bd = Infinity;
      for (var j = 0; j < stages.length; j++) {
        var d = Math.abs(x - (stages[j].x0 + stages[j].x1) / 2);
        if (d < bd) { bd = d; best = j; }
      }
      return best;
    }

    var laneNames = bands.map(function (b) { return descendantText(b.id) || '未命名角色'; })
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    function laneAt(y) {
      if (!bands.length) return '未指定角色';
      for (var i = 0; i < bands.length; i++) {
        var b = bands[i];
        if (y <= b.y + b.h / 2 + 1e-6 && y >= b.y - b.h / 2 - 1e-6) return laneNames[i] || '未命名角色';
      }
      var bi = 0, bd = Infinity;
      for (var k = 0; k < bands.length; k++) {
        var d = Math.abs(y - bands[k].y);
        if (d < bd) { bd = d; bi = k; }
      }
      return laneNames[bi] || '未命名角色';
    }

    // 按「环节列 → 纵向位置」排序，保证顺序与图上阅读顺序一致
    nodeShapes.sort(function (a, b) {
      var pa = pts[a.id], pb = pts[b.id];
      var sa = clean(a.fn) ? (stageIndexByName[clean(a.fn)] != null ? stageIndexByName[clean(a.fn)] : stageIndexAt(pa.x)) : stageIndexAt(pa.x);
      var sb = clean(b.fn) ? (stageIndexByName[clean(b.fn)] != null ? stageIndexByName[clean(b.fn)] : stageIndexAt(pb.x)) : stageIndexAt(pb.x);
      if (sa !== sb) return sa - sb;
      return pb.y - pa.y;
    });

    var idOf = {};                                             // Visio 形状 ID → 资产节点 ID（连线还原用）

    /* 「分开的事件」由多个子形状组成：一个写动作、一个写承载系统。
       识别顺序：系统名通常带 系统/平台/邮件/EDI/API 等字样，长度短。 */
    var SYS_HINT = /系统|平台|邮件|EDI|API|网站|内网|外网|APP|小程序|ERP|TMS|WMS|ISCP|SCSi|门户|船公司|口岸|客户端|客户端|系统A|系统B|系统C/;
    function pickNameSystem(own, texts, i) {
      if (own) {
        var last = texts.length ? texts[texts.length - 1] : '';
        return { name: own, system: (SYS_HINT.test(last) && last.length <= 16) ? last : '' };
      }
      var t0 = texts[0] || ('节点' + (i + 1));
      if (texts.length >= 2 && t0.length <= 14 && SYS_HINT.test(t0)) {
        return { name: texts[1], system: t0 };
      }
      var l2 = texts.length > 1 ? texts[texts.length - 1] : '';
      return { name: t0, system: (SYS_HINT.test(l2) && l2.length <= 16) ? l2 : '' };
    }

    var nodes = [];
    nodeShapes.forEach(function (s, i) {
      var kids = (childrenOf[s.id] || []);
      var own = clean(s.txt);
      var texts = kids.map(function (c) { return clean(c.txt); }).filter(Boolean);
      var nm = pickNameSystem(own, texts, i);
      // 与环节同名的纯标题形状（泳道列头）不算节点
      if (!clean(s.fn) && stageIndexByName[nm.name] != null && !nm.system) return;
      var p = pts[s.id];
      var fn = clean(s.fn);
      var si = fn && stageIndexByName[fn] != null ? stageIndexByName[fn] : stageIndexAt(p.x);
      var role = laneAt(p.y);
      nodes.push({
        id: 'n_' + nodes.length,
        seq: String(nodes.length + 1),
        stage: stages[si] ? stages[si].name : '未分类',
        stageId: stages[si] ? stages[si].id : 'st_0',
        name: nm.name.split('\n')[0],
        desc: '',
        stageDesc: '',
        role: role,
        roles: [role],
        input: '', output: '', system: nm.system, status: '',
        variants: [],
        exception: '', fee: '',
        note: own ? texts.join(' / ') : texts.slice(1).join(' / '),
        x: p.x, y: p.y
      });
      idOf[s.id] = 'n_' + (nodes.length - 1);
    });

    // 连线：BeginX 指向源，EndX 指向目标；端点可能落在子节点上，需向上回溯到节点
    function ancestorNode(id) {
      var cur = byId[id];
      while (cur) {
        if (idOf[cur.id]) return idOf[cur.id];
        cur = cur.p ? byId[cur.p] : null;
      }
      return null;
    }
    var edges = [], seen = {};
    connects.forEach(function (c) {
      if (!c.f || !c.t) return;
      var conn = byId[c.f];
      if (!conn) return;
      if (!seen[c.f]) seen[c.f] = { label: clean(conn.txt) };
      if (c.fc === 'BeginX') seen[c.f].from = ancestorNode(c.t);
      if (c.fc === 'EndX') seen[c.f].to = ancestorNode(c.t);
    });
    Object.keys(seen).forEach(function (k) {
      var e = seen[k];
      if (e.from && e.to && e.from !== e.to) {
        edges.push({ id: 'e_' + edges.length, from: e.from, to: e.to, label: e.label || '', type: 'flow' });
      }
    });

    return {
      stages: stages, nodes: nodes, laneNames: laneNames.length ? laneNames : ['未指定角色'],
      edges: edges, sourceKind: 'vsdx', sourceLabel: (page.name || 'Visio') + ' 页'
    };
  };

  /* ================= 文本（Word/PDF/自然语言）→ 局部资产 ================= */
  model.fromParagraphs = function (lines, label) {
    var stages = [], nodes = [], edges = [], laneNames = [];
    var curStage = null, curStageDesc = '';
    var n = 0;
    lines.forEach(function (raw) {
      var l = clean(raw);
      if (!l) return;
      // 形如 1. xxx / 一、xxx / 环节：xxx 视为环节
      var mh = l.match(/^(?:[一二三四五六七八九十]+、|\d+[.、)]\s*|环节[:：])\s*(.{2,20})$/);
      if (mh) {
        curStage = { id: 'st_' + stages.length, name: mh[1], desc: '', order: stages.length };
        stages.push(curStage);
        curStageDesc = '';
        return;
      }
      // 形如 "- 角色：动作" 或 "角色 - 动作"
      var mn = l.match(/^[-*·]\s*(?:\[([^\]]+)\])?\s*(.{2,40})$/);
      var role = '未指定角色', name = l;
      if (mn) {
        role = mn[1] ? clean(mn[1]) : '未指定角色';
        name = clean(mn[2]);
      }
      if (!curStage) {
        curStage = { id: 'st_' + stages.length, name: '流程主体', desc: '', order: stages.length };
        stages.push(curStage);
      }
      nodes.push({
        id: 'n_' + n, seq: String(n + 1), stage: curStage.name, stageId: curStage.id,
        name: name, desc: '', stageDesc: curStageDesc, role: role, roles: [role],
        input: '', output: '', system: '', status: '', variants: [], exception: '', fee: '', note: ''
      });
      if (laneNames.indexOf(role) < 0) laneNames.push(role);
      n++;
    });
    for (var k = 0; k + 1 < nodes.length; k++) {
      edges.push({ id: 'e_' + k, from: nodes[k].id, to: nodes[k + 1].id, label: '', type: 'seq' });
    }
    return { stages: stages, nodes: nodes, laneNames: laneNames.length ? laneNames : ['未指定角色'], edges: edges, sourceKind: 'text', sourceLabel: label || '文本解析' };
  };

  /* ================= 归一化收口 ================= */
  var SYS_PALETTE = [
    '#1668DC', '#00A3C4', '#0A3D91', '#00B578', '#7A5AF8',
    '#FA8C16', '#13A8A8', '#5B8FF9', '#D46B08', '#2F54EB'
  ];

  model.systemColor = function (sys) {
    var t = clean(sys) || '未标注';
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return SYS_PALETTE[h % SYS_PALETTE.length];
  };

  model.finalize = function (partial, meta) {
    meta = meta || {};
    var p = partial || { stages: [], nodes: [], laneNames: [], edges: [] };
    var lanes = (p.laneNames || []).filter(function (x, i, a) { return x && a.indexOf(x) === i; })
      .map(function (nm, i) { return { id: 'ln_' + i, name: nm, order: i }; });
    if (!lanes.length) lanes = [{ id: 'ln_0', name: '未指定角色', order: 0 }];
    var laneIdOf = {};
    lanes.forEach(function (l) { laneIdOf[l.name] = l.id; });

    var nodeMap = {};
    p.nodes.forEach(function (n) {
      if (!n.stageId) {
        var st = (p.stages || []).filter(function (s) { return s.name === n.stage; })[0];
        n.stageId = st ? st.id : '';
      }
      n.laneId = laneIdOf[n.role] || lanes[0].id;
      n.hasException = !!clean(n.exception);
      n.hasFee = !!clean(n.fee);
      n.variantCount = (n.variants || []).length;
      nodeMap[n.id] = n;
    });

    var edges = (p.edges || []).filter(function (e) { return nodeMap[e.from] && nodeMap[e.to]; });

    var systems = [];
    p.nodes.forEach(function (n) {
      model.splitList(n.system).forEach(function (s) { if (systems.indexOf(s) < 0) systems.push(s); });
    });

    var asset = {
      id: meta.id || model.uid('asset'),
      name: meta.name || '未命名流程',
      space: meta.space || '默认资产空间',
      desc: meta.desc || '',
      sourceKind: p.sourceKind || 'unknown',
      sourceLabel: p.sourceLabel || '',
      stages: p.stages || [],
      lanes: lanes,
      nodes: p.nodes || [],
      edges: edges,
      systems: systems,
      stats: {
        nodeCount: (p.nodes || []).length,
        edgeCount: edges.length,
        laneCount: lanes.length,
        stageCount: (p.stages || []).length,
        parseMs: meta.parseMs || 0
      },
      createdAt: new Date().toISOString(),
      version: meta.version || 'V1.0',
      status: meta.status || 'draft',
      versions: []
    };
    return asset;
  };

  /** 统一入口：raw 可以是 Excel sheet / Visio page / 文本行 / 已成型资产 */
  model.normalize = function (raw, meta) {
    var t0 = (performance && performance.now) ? performance.now() : Date.now();
    var partial = null;
    if (!raw) return null;
    if (raw.lanes && raw.nodes) return raw;                       // 已是资产
    if (raw.rows) partial = model.fromExcelSheet(raw);            // Excel sheet
    else if (raw.shapes) partial = model.fromVisioPage(raw);      // Visio page
    else if (raw.lines) partial = model.fromParagraphs(raw.lines, raw.label);
    else if (Array.isArray(raw)) partial = model.fromParagraphs(raw, (meta || {}).name);
    if (!partial) return null;
    var t1 = (performance && performance.now) ? performance.now() : Date.now();
    meta = meta || {};
    meta.parseMs = Math.round(t1 - t0);
    return model.finalize(partial, meta);
  };

  model.clone = function (a) { return JSON.parse(JSON.stringify(a)); };

  /* ---------- 版本 ---------- */
  model.snapshot = function (asset, label) {
    var s = model.clone(asset);
    return {
      version: label || asset.version,
      status: asset.status,
      createdAt: new Date().toISOString(),
      snapshot: s
    };
  };

  model.nextVersion = function (v) {
    var m = String(v || 'V1.0').match(/^V?(\d+)\.(\d+)$/);
    if (!m) return 'V1.1';
    return 'V' + m[1] + '.' + (parseInt(m[2], 10) + 1);
  };
})();
