/* BPMN 2.0：由 ProcessAsset 生成标准 XML（可被第三方引擎识别），
   并可反向解析外部 .bpmn 文件回资产（双向证明标准合规）。
   视图为自绘 SVG（与泳道图风格统一，且无需字体等外链资源）。 */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var render = (SOP.render = SOP.render || {});
  var bpmn = (SOP.bpmn = {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sid(s) { return String(s || 'x').replace(/[^A-Za-z0-9_]/g, '_'); }

  /** 拓扑排序，保证生成的 BPMN 顺序与流程推进一致 */
  function topoOrder(asset) {
    var indeg = {}, adj = {}, byId = {};
    asset.nodes.forEach(function (n) { indeg[n.id] = 0; adj[n.id] = []; byId[n.id] = n; });
    asset.edges.forEach(function (e) {
      if (!byId[e.from] || !byId[e.to]) return;
      adj[e.from].push(e.to); indeg[e.to]++;
    });
    var q = asset.nodes.filter(function (n) { return indeg[n.id] === 0; }).map(function (n) { return n.id; });
    var out = [], seen = {};
    while (q.length) {
      var id = q.shift();
      if (seen[id]) continue;
      seen[id] = 1; out.push(byId[id]);
      adj[id].forEach(function (t) { indeg[t]--; if (indeg[t] === 0) q.push(t); });
    }
    asset.nodes.forEach(function (n) { if (!seen[n.id]) out.push(n); });
    return out;
  }
  bpmn.topoOrder = topoOrder;

  /** 生成流程元素与流转（内存中），供 XML 与视图共用 */
  function buildModel(asset) {
    var els = [], flows = [], seq = 0;
    var laneIndex = {};
    asset.lanes.forEach(function (l, i) { laneIndex[l.id] = i; });

    function add(type, name, nodeId, extra) {
      var el = {
        id: (type === 'task' ? 'Activity_' : type === 'gateway' ? 'Gateway_' : 'Event_') + (++seq),
        type: type, name: name || '', nodeId: nodeId || '', incoming: [], outgoing: []
      };
      if (extra) Object.keys(extra).forEach(function (k) { el[k] = extra[k]; });
      els.push(el);
      return el;
    }
    function connect(a, b, label) {
      var f = { id: 'Flow_' + (++seq), from: a.id, to: b.id, label: label || '' };
      flows.push(f);
      a.outgoing.push(f.id); b.incoming.push(f.id);
      return f;
    }

    var order = topoOrder(asset);
    var start = add('event', '开始', '', { eventType: 'start', lane: 0 });
    var prev = start;

    order.forEach(function (n) {
      var li = laneIndex[n.laneId] || 0;
      var variants = (n.variants || []).filter(function (v) { return v && (v.text || v.role || v.status); });
      if (variants.length > 1) {
        var fork = add('gateway', '', n.id, { gwType: 'parallel', dir: 'fork', lane: li });
        connect(prev, fork);
        var join = add('gateway', '', n.id, { gwType: 'parallel', dir: 'join', lane: li });
        variants.forEach(function (v, k) {
          var t = add('task', n.name + '（' + v.label + '）', n.id, { lane: li, node: n, variant: v });
          connect(fork, t, v.label);
          connect(t, join);
        });
        prev = join;
      } else if (n.hasException) {
        // 有异常分支：判定网关 → 正常任务 / 异常任务 → 汇聚网关
        var g1 = add('gateway', '', n.id, { gwType: 'exclusive', dir: 'fork', lane: li });
        connect(prev, g1);
        var main = add('task', n.name, n.id, { lane: li, node: n, variant: variants[0] || null });
        connect(g1, main, '正常');
        var exTask = add('task', (n.name || '节点') + '异常', n.id, { lane: li, node: n, isException: true });
        connect(g1, exTask, '异常');
        var g2 = add('gateway', '', n.id, { gwType: 'exclusive', dir: 'join', lane: li });
        connect(main, g2);
        connect(exTask, g2);
        prev = g2;
      } else {
        var t2 = add('task', n.name, n.id, { lane: li, node: n, variant: variants[0] || null });
        connect(prev, t2);
        prev = t2;
      }
    });

    var end = add('event', '结束', '', { eventType: 'end', lane: laneIndex[order.length ? order[order.length - 1].laneId : 0] || 0 });
    connect(prev, end);
    return { elements: els, flows: flows, lanes: asset.lanes };
  }
  bpmn.buildModel = buildModel;

  /** 生成标准 BPMN 2.0 XML（含 DI，可直接被第三方工具打开） */
  bpmn.toXML = function (asset) {
    var m = buildModel(asset);
    var seq = 0;
    // 简单水平布局（用于 DI）
    var x = 120, laneY = {};
    asset.lanes.forEach(function (l, i) { laneY[i] = 120 + i * 190; });
    var bounds = {};
    m.elements.forEach(function (el) {
      var li = el.lane || 0;
      var y = (laneY[li] || 120) + 50;
      var w = el.type === 'event' ? 36 : el.type === 'gateway' ? 50 : 116;
      var h = el.type === 'event' ? 36 : el.type === 'gateway' ? 50 : 80;
      bounds[el.id] = { x: x, y: y, w: w, h: h };
      x += w + 60;
    });

    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_' + sid(asset.id) + '" targetNamespace="http://bpmn.io/schema/bpmn">');
    out.push('  <bpmn:process id="Process_' + sid(asset.id) + '" name="' + esc(asset.name) + '" isExecutable="true">');

    // 泳道（BPMN 标准 laneSet）
    var laneRefs = {};
    m.elements.forEach(function (el) {
      if (!el.id) return;
      (laneRefs[el.lane || 0] = laneRefs[el.lane || 0] || []).push(el.id);
    });
    out.push('    <bpmn:laneSet id="LaneSet_1">');
    asset.lanes.forEach(function (l, i) {
      out.push('      <bpmn:lane id="' + sid(l.id) + '" name="' + esc(l.name) + '">');
      (laneRefs[i] || []).forEach(function (r) { out.push('        <bpmn:flowNodeRef>' + r + '</bpmn:flowNodeRef>'); });
      out.push('      </bpmn:lane>');
    });
    out.push('    </bpmn:laneSet>');

    m.elements.forEach(function (el) {
      var inc = el.incoming.map(function (f) { return '<bpmn:incoming>' + f + '</bpmn:incoming>'; }).join('');
      var outg = el.outgoing.map(function (f) { return '<bpmn:outgoing>' + f + '</bpmn:outgoing>'; }).join('');
      if (el.type === 'event') {
        out.push('    <bpmn:' + (el.eventType === 'start' ? 'startEvent' : 'endEvent') + ' id="' + el.id + '" name="' + esc(el.name) + '">' + inc + outg + '</bpmn:' + (el.eventType === 'start' ? 'startEvent' : 'endEvent') + '>');
      } else if (el.type === 'gateway') {
        var tag = el.gwType === 'parallel' ? 'parallelGateway' : 'exclusiveGateway';
        out.push('    <bpmn:' + tag + ' id="' + el.id + '" name="' + esc(el.name) + '" gatewayDirection="' + (el.dir === 'fork' ? 'Diverging' : 'Converging') + '">' + inc + outg + '</bpmn:' + tag + '>');
      } else {
        out.push('    <bpmn:task id="' + el.id + '" name="' + esc(el.name) + '">' + inc + outg + '</bpmn:task>');
      }
    });
    m.flows.forEach(function (f) {
      out.push('    <bpmn:sequenceFlow id="' + f.id + '"' + (f.label ? ' name="' + esc(f.label) + '"' : '') + ' sourceRef="' + f.from + '" targetRef="' + f.to + '"/>');
    });
    out.push('  </bpmn:process>');

    // DI
    out.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1">');
    out.push('    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_' + sid(asset.id) + '">');
    asset.lanes.forEach(function (l, i) {
      out.push('      <bpmndi:BPMNShape id="' + sid(l.id) + '_di" bpmnElement="' + sid(l.id) + '" isHorizontal="true">');
      out.push('        <dc:Bounds x="120" y="' + (laneY[i] || 120) + '" width="' + Math.max(600, x) + '" height="190"/>');
      out.push('      </bpmndi:BPMNShape>');
    });
    m.elements.forEach(function (el) {
      var b = bounds[el.id];
      out.push('      <bpmndi:BPMNShape id="' + el.id + '_di" bpmnElement="' + el.id + '">');
      out.push('        <dc:Bounds x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '"/>');
      out.push('      </bpmndi:BPMNShape>');
    });
    m.flows.forEach(function (f) {
      var a = bounds[f.from], b = bounds[f.to];
      if (!a || !b) return;
      var mx = Math.max(a.x + a.w, b.x) + 30;
      out.push('      <bpmndi:BPMNEdge id="' + f.id + '_di" bpmnElement="' + f.id + '">');
      out.push('        <di:waypoint x="' + (a.x + a.w) + '" y="' + (a.y + a.h / 2) + '"/>');
      out.push('        <di:waypoint x="' + mx + '" y="' + (a.y + a.h / 2) + '"/>');
      out.push('        <di:waypoint x="' + mx + '" y="' + (b.y + b.h / 2) + '"/>');
      out.push('        <di:waypoint x="' + b.x + '" y="' + (b.y + b.h / 2) + '"/>');
      out.push('      </bpmndi:BPMNEdge>');
    });
    out.push('    </bpmndi:BPMNPlane>');
    out.push('  </bpmndi:BPMNDiagram>');
    out.push('</bpmn:definitions>');
    return out.join('\n');
  };

  /** 解析外部 BPMN 2.0 XML → ProcessAsset（用于验证标准双向兼容） */
  bpmn.fromXML = function (xmlText, name) {
    var dp = new DOMParser();
    var doc = dp.parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失败');
    var root = doc.documentElement;
    if (root.localName !== 'definitions') throw new Error('不是 BPMN 2.0 definitions 根节点');

    function all(tag) {
      var list = doc.getElementsByTagName('*'), out = [];
      for (var i = 0; i < list.length; i++) if (list[i].localName === tag) out.push(list[i]);
      return out;
    }
    var proc = all('process')[0] || root;

    var laneOf = {};
    all('lane').forEach(function (l) {
      var nm = l.getAttribute('name') || l.getAttribute('id');
      var refs = [];
      for (var i = 0; i < l.children.length; i++) {
        if (l.children[i].localName === 'flowNodeRef') refs.push((l.children[i].textContent || '').trim());
      }
      refs.forEach(function (r) { laneOf[r] = nm; });
    });

    var nodes = [], byId = {}, n = 0;
    ['task', 'serviceTask', 'userTask', 'manualTask', 'scriptTask', 'sendTask', 'receiveTask', 'subProcess', 'callActivity'].forEach(function (tag) {
      all(tag).forEach(function (el) {
        if (el.closest && proc && el.closest('process') !== proc && doc.getElementsByTagName('process').length > 1) return;
        var id = el.getAttribute('id');
        if (byId[id]) return;
        var nm = el.getAttribute('name') || tag;
        var node = {
          id: 'n_' + n, seq: String(n + 1), stage: '流程主体', stageId: 'st_0',
          name: nm, desc: '', stageDesc: '', role: laneOf[id] || '未指定角色', roles: [laneOf[id] || '未指定角色'],
          input: '', output: '', system: '', status: '', variants: [], exception: '', fee: '', note: '', bpmnId: id
        };
        byId[id] = node; nodes.push(node); n++;
      });
    });

    var edges = [];
    all('sequenceFlow').forEach(function (f) {
      var s = f.getAttribute('sourceRef'), t = f.getAttribute('targetRef');
      if (byId[s] && byId[t]) {
        edges.push({ id: 'e_' + edges.length, from: byId[s].id, to: byId[t].id, label: f.getAttribute('name') || '', type: 'flow' });
      }
    });
    if (!nodes.length) throw new Error('BPMN 中未找到任务节点');

    var partial = {
      stages: [{ id: 'st_0', name: '流程主体', desc: '', order: 0 }],
      nodes: nodes, laneNames: nodes.map(function (x) { return x.role; }), edges: edges,
      sourceKind: 'bpmn', sourceLabel: (name || 'BPMN 2.0') + ' 文件'
    };
    return SOP.model.finalize(partial, { name: name || '导入的 BPMN 流程', space: 'BPMN 导入' });
  };

  /* ================= 自绘 BPMN 视图 ================= */
  var EV_R = 18, GW = 26, TASK_W = 132, TASK_H = 62, GAP = 46, LANE_H = 150, LEFT = 60;

  function wrap(text, maxChars, maxLines) {
    var t = String(text || '').replace(/\s+/g, ' ').trim() || '(未命名)';
    var lines = [], cur = '';
    for (var i = 0; i < t.length; i++) {
      cur += t[i];
      if (cur.length >= maxChars) { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  }

  render.bpmn = function (asset, host, opts) {
    var m = buildModel(asset);
    var laneRows = {};
    asset.lanes.forEach(function (l, i) { laneRows[i] = i; });

    // 布局
    var x = LEFT + 40;
    var pos = {};
    m.elements.forEach(function (el) {
      var w = el.type === 'event' ? EV_R * 2 : el.type === 'gateway' ? GW * 2 : TASK_W;
      var h = el.type === 'event' ? EV_R * 2 : el.type === 'gateway' ? GW * 2 : TASK_H;
      var ly = 40 + (el.lane || 0) * LANE_H;
      pos[el.id] = { x: x, y: ly + (LANE_H - h) / 2, w: w, h: h, cx: x + w / 2, cy: ly + LANE_H / 2 };
      x += w + GAP;
    });
    var W = x + 60;
    var H = 40 + asset.lanes.length * LANE_H + 40;

    var s = [];
    s.push('<svg class="diagram-svg" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">');
    s.push('<defs><marker id="barw" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><path d="M0,0 L10,3.5 L0,7 z" fill="#7b8aa0"/></marker>');
    s.push('<linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fbfcfe"/><stop offset="100%" stop-color="#f1f4f9"/></linearGradient></defs>');
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#bg2)"/>');

    asset.lanes.forEach(function (l, i) {
      var y = 40 + i * LANE_H;
      s.push('<rect x="' + LEFT + '" y="' + y + '" width="' + (W - LEFT - 20) + '" height="' + LANE_H + '" fill="' + (i % 2 ? '#e9eff8' : '#f4f7fc') + '" stroke="#ccd7e6"/>');
      s.push('<rect x="10" y="' + y + '" width="' + (LEFT - 10) + '" height="' + LANE_H + '" fill="' + (i % 2 ? '#dbe6f6' : '#e8eefa') + '" stroke="#ccd7e6"/>');
      var t = wrap(l.name, 5, 4);
      t.forEach(function (ln, k) {
        s.push('<text x="' + (10 + (LEFT - 10) / 2) + '" y="' + (y + LANE_H / 2 - (t.length - 1) * 8 + k * 16) + '" font-size="12" fill="#0A3D91" text-anchor="middle" font-weight="600">' + esc(ln) + '</text>');
      });
    });

    m.flows.forEach(function (f) {
      var a = pos[f.from], b = pos[f.to];
      if (!a || !b) return;
      var mx = Math.max(a.x + a.w, b.x) + (GAP / 2 - 4);
      var d = 'M' + (a.x + a.w) + ',' + a.cy + ' L' + mx + ',' + a.cy + ' L' + mx + ',' + b.cy + ' L' + (b.x - 3) + ',' + b.cy;
      s.push('<path class="flow-line" d="' + d + '" marker-end="url(#barw)"/>');
      if (f.label) s.push('<text x="' + (mx + 4) + '" y="' + ((a.cy + b.cy) / 2 - 5) + '" font-size="10" fill="#6B7280">' + esc(f.label) + '</text>');
    });

    m.elements.forEach(function (el, i) {
      var p = pos[el.id];
      s.push('<g class="nd node-grow" data-id="' + el.id + '" style="animation-delay:' + (i * 35) + 'ms">');
      if (el.type === 'event') {
        s.push('<circle class="nd-box" cx="' + p.cx + '" cy="' + p.cy + '" r="' + EV_R + '" fill="#fff" stroke="' +
          (el.eventType === 'start' ? '#00B578' : '#F5222D') + '" stroke-width="2.4"/>');
        if (el.eventType === 'end') s.push('<circle cx="' + p.cx + '" cy="' + p.cy + '" r="' + (EV_R - 6) + '" fill="none" stroke="#F5222D" stroke-width="2"/>');
      } else if (el.type === 'gateway') {
        var d2 = 'M' + p.cx + ',' + (p.cy - GW) + ' L' + (p.cx + GW) + ',' + p.cy + ' L' + p.cx + ',' + (p.cy + GW) + ' L' + (p.cx - GW) + ',' + p.cy + ' Z';
        s.push('<path class="nd-box" d="' + d2 + '" fill="#fff" stroke="#FAAD14" stroke-width="2"/>');
        if (el.gwType === 'parallel') {
          s.push('<path d="M' + (p.cx - 11) + ',' + p.cy + ' L' + (p.cx + 11) + ',' + p.cy + ' M' + p.cx + ',' + (p.cy - 11) + ' L' + p.cx + ',' + (p.cy + 11) + '" stroke="#FAAD14" stroke-width="3"/>');
        } else {
          s.push('<path d="M' + (p.cx - 9) + ',' + (p.cy - 9) + ' L' + (p.cx + 9) + ',' + (p.cy + 9) + ' M' + (p.cx + 9) + ',' + (p.cy - 9) + ' L' + (p.cx - 9) + ',' + (p.cy + 9) + '" stroke="#FAAD14" stroke-width="2.6"/>');
        }
      } else {
        var col = el.isException ? '#F5222D' : SOP.model.systemColor(el.node ? el.node.system : '');
        s.push('<rect class="nd-box" x="' + p.x + '" y="' + p.y + '" width="' + TASK_W + '" height="' + TASK_H + '" rx="9" fill="#fff" stroke="' +
          (el.isException ? '#F5222D' : '#c9d4e4') + '" stroke-width="' + (el.isException ? 1.8 : 1.1) + '"' + (el.isException ? ' stroke-dasharray="5 3"' : '') + '/>');
        s.push('<rect x="' + p.x + '" y="' + p.y + '" width="4" height="' + TASK_H + '" rx="2" fill="' + col + '"/>');
        var lines = wrap(el.name, 9, 2);
        lines.forEach(function (ln, k) {
          s.push('<text x="' + (p.x + 12) + '" y="' + (p.y + 26 + k * 17) + '" font-size="12" font-weight="500" fill="#1F2937">' + esc(ln) + '</text>');
        });
        s.push('<text x="' + (p.x + 12) + '" y="' + (p.y + TASK_H - 9) + '" font-size="10" fill="#6B7280">' + esc(el.node ? el.node.role : '') + '</text>');
      }
      s.push('</g>');
    });
    s.push('</svg>');
    host.innerHTML = s.join('');
    return { svg: host.querySelector('svg'), model: m };
  };
})();
