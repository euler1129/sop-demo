/* 应用主控：状态管理 / 视图路由 / 交互绑定 / 导入导出 */
(function () {
  var SOP = window.SOP;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    asset: null,
    samples: [],
    view: 'swimlane',
    zoom: 1,
    selected: null,
    handles: {},
    diag: null,
    desens: false
  };

  /* ---------------- 脱敏（对外演示 / 公网发布用） ----------------
     映射表由 tools/desensitize-map.json 生成到 window.SOP_MASK，
     与预解析脚本共用同一份，避免两处维护不一致。 */
  /* 唯一真源是 tools/desensitize-map.json（生成到 window.SOP_MASK）。
     下面这份只是极端情况下的兜底（desensitize-map.js 缺失时），
     改映射表后务必同步这里——顺序敏感，长词在前。 */
  var MASK = window.SOP_MASK || [];
  var URL_RE = /https?:\/\/[^\s\]\）】]+/g;

  function maskText(s) {
    if (!s) return s;
    var t = String(s).replace(URL_RE, '[链接已脱敏]');
    for (var i = 0; i < MASK.length; i++) t = t.split(MASK[i][0]).join(MASK[i][1]);
    return t;
  }

  function applyMask(asset) {
    if (!state.desens) return asset;
    var a = SOP.model.clone(asset);
    ['name', 'space', 'desc'].forEach(function (k) { a[k] = maskText(a[k]); });
    a.stages.forEach(function (s) { s.name = maskText(s.name); s.desc = maskText(s.desc); });
    a.lanes.forEach(function (l) { l.name = maskText(l.name); });
    a.nodes.forEach(function (n) {
      ['stage', 'name', 'desc', 'stageDesc', 'role', 'input', 'output', 'system', 'status', 'exception', 'fee', 'note'].forEach(function (k) {
        n[k] = maskText(n[k]);
      });
      n.roles = (n.roles || []).map(maskText);
      (n.variants || []).forEach(function (v) {
        ['label', 'role', 'input', 'output', 'system', 'status', 'text', 'exception', 'fee'].forEach(function (k) { v[k] = maskText(v[k]); });
      });
    });
    a.systems = a.systems.map(maskText);
    return a;
  }

  /* ---------------- 通用 UI ---------------- */
  function openModal(id) { $(id).classList.add('show'); }
  function closeModal(id) { $(id).classList.remove('show'); }
  document.addEventListener('click', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-close')) {
      var m = e.target.closest('.modal-mask');
      if (m) m.classList.remove('show');
    }
  });
  document.querySelectorAll('.modal-mask').forEach(function (mk) {
    mk.addEventListener('click', function (e) { if (e.target === mk) mk.classList.remove('show'); });
  });

  /* 展示层兜底：开脱敏时，凡是直接取自样例元数据的文案都要过一遍，
     否则「流程名 / 样例卡 / 状态栏」会漏出真实主体（applyMask 只管资产内部字段） */
  function m(s) { return state.desens ? maskText(s) : s; }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br/>'); }

  /* ---------------- 样例 ---------------- */
  function renderSampleList() {
    var host = $('sample-list');
    var items = state.samples || [];
    host.innerHTML = items.map(function (it, i) {
      return '<div class="sample-card" data-sample="' + it.id + '">' +
        '<div class="sample-name">' + esc(m(it.name)) + '</div>' +
        '<div class="sample-desc">' + esc(m(it.desc || '')) + '</div>' +
        '<div class="sample-meta"><span class="tag src-' + it.kind + '">' + it.kind.toUpperCase() + '</span>' +
        '<span class="tag">' + esc(m(it.space || '')) + '</span></div>' +
        '</div>';
    }).join('');
    host.querySelectorAll('.sample-card').forEach(function (c) {
      c.addEventListener('click', function () { loadSample(c.getAttribute('data-sample')); });
    });
  }

  function loadSample(id) {
    var it = (state.samples || []).filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var t0 = performance.now();
    var asset = SOP.model.normalize(it.source, {
      id: id, name: it.name, space: it.space || '内置样例', desc: it.desc || ''
    });
    if (!asset) { SOP.util.toast('样例解析失败', 'err'); return; }
    asset.parseMs = Math.round(performance.now() - t0);
    asset.stats.parseMs = asset.parseMs;
    asset.versions = [SOP.model.snapshot(asset, asset.version)];
    setAsset(asset);
    document.querySelectorAll('.sample-card').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-sample') === id);
    });
    SOP.util.toast('已加载：' + it.name + '（' + asset.stats.nodeCount + ' 节点 / ' + asset.stats.laneCount + ' 泳道）');
  }

  /* ---------------- 资产装载与渲染 ---------------- */
  function setAsset(asset) {
    state.asset = asset;
    state.selected = null;
    $('empty-state').style.display = 'none';
    renderAll();
    runDiagnose();
  }

  function currentAsset() { return applyMask(state.asset); }

  function renderAll() {
    if (!state.asset) return;
    var a = currentAsset();
    $('sb-nodes').textContent = a.stats.nodeCount;
    $('sb-edges').textContent = a.stats.edgeCount;
    $('sb-stages').textContent = a.stats.stageCount;
    $('sb-lanes').textContent = a.stats.laneCount;
    $('sb-ms').textContent = a.stats.parseMs || 0;
    $('sb-source').textContent = m(a.sourceLabel || a.sourceKind || '—');
    $('ver-chip').textContent = a.version + ' ' + ({ draft: '草稿', review: '待审核', published: '已发布' }[a.status] || '');
    $('ver-chip').className = 'status-chip status-' + (a.status || 'draft');

    renderTree(a);
    renderView(a);
    renderProps(a, state.selected);
  }

  function renderTree(a) {
    var host = $('asset-tree');
    var h = [];
    h.push('<div class="tree-node"><span class="tw">▾</span><span class="tname">' + esc(a.space) + '</span></div>');
    h.push('<div class="tree-children">');
    h.push('<div class="tree-node active"><span class="tw">▸</span><span class="tname">' + esc(a.name) + '</span>' +
      '<span class="tree-badge">' + a.nodes.length + '</span></div>');
    h.push('<div class="tree-children">');
    a.stages.forEach(function (st) {
      var ns = a.nodes.filter(function (n) { return n.stageId === st.id; });
      h.push('<div class="tree-node"><span class="tw">·</span><span class="tname">' + esc(st.name) + '</span>' +
        '<span class="tree-badge">' + ns.length + '</span></div>');
      h.push('<div class="tree-children">');
      ns.forEach(function (n) {
        h.push('<div class="tree-node" data-node="' + n.id + '"><span class="tw">◦</span><span class="tname">' + esc(n.name) + '</span></div>');
      });
      h.push('</div>');
    });
    h.push('</div></div>');
    host.innerHTML = h.join('');
    host.querySelectorAll('[data-node]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectNode(el.getAttribute('data-node'));
      });
    });
  }

  function paneOf(view) {
    return { swimlane: 'pane-swimlane', bpmn: 'pane-bpmn', vc: 'pane-vc', table: 'pane-table' }[view];
  }

  function renderView(a) {
    document.querySelectorAll('.view-pane').forEach(function (p) { if (p.id !== 'print-root') p.classList.remove('active'); });
    var pane = $(paneOf(state.view));
    pane.classList.add('active');
    pane.style.zoom = state.zoom;

    if (state.view === 'swimlane') {
      state.handles.swimlane = SOP.render.swimlane(a, pane, {});
      bindNodeClick(pane, function (id) { return id; });
    } else if (state.view === 'bpmn') {
      state.handles.bpmn = SOP.render.bpmn(a, pane, {});
      var m = state.handles.bpmn.model;
      var map = {};
      m.elements.forEach(function (el) { if (el.nodeId) map[el.id] = el.nodeId; });
      bindNodeClick(pane, function (id) { return map[id] || ''; });
    } else if (state.view === 'vc') {
      SOP.render.valueChain(a, pane);
    } else {
      SOP.render.assetTable(a, pane, { onSelect: selectNode });
    }
    if (state.selected) highlightSelection();
    updatePannable();
  }

  /* ---------------- 画布浏览：缩放 / 拖拽平移 ----------------
     此前只有三个缩放按钮，且「适应窗口」只是把 zoom 设回 1；
     大图（BPMN 可宽到 5700px）只能靠看不见的滚动条，实际没法看。 */
  function canvasBody() { return $('canvas-body'); }

  function updatePannable() {
    var body = canvasBody();
    if (!body) return;
    body.classList.toggle('pannable',
      body.scrollWidth > body.clientWidth + 1 || body.scrollHeight > body.clientHeight + 1);
  }

  // 缩放后把原来视口中心的那一点留在中心，避免每次缩放都跳回左上角
  function setZoom(z) {
    var body = canvasBody();
    var prevW = body.scrollWidth || 1, prevH = body.scrollHeight || 1;
    var cx = (body.scrollLeft + body.clientWidth / 2) / prevW;
    var cy = (body.scrollTop + body.clientHeight / 2) / prevH;
    state.zoom = Math.max(0.4, Math.min(2, Math.round(z * 100) / 100));
    renderView(currentAsset());
    body.scrollLeft = cx * body.scrollWidth - body.clientWidth / 2;
    body.scrollTop = cy * body.scrollHeight - body.clientHeight / 2;
  }

  // 适应窗口：按内容真实尺寸算缩放比，整张图一次看全
  function zoomFit() {
    var body = canvasBody();
    setZoom(1);
    var z = Math.min(body.clientWidth / (body.scrollWidth || 1), body.clientHeight / (body.scrollHeight || 1));
    setZoom(z * 0.98);
    body.scrollLeft = 0;
    body.scrollTop = 0;
  }

  function enableCanvasPan() {
    var body = canvasBody();
    if (!body) return;
    var dragging = false, sx = 0, sy = 0, sl = 0, st = 0, moved = 0;

    body.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = true; moved = 0;
      sx = e.clientX; sy = e.clientY;
      sl = body.scrollLeft; st = body.scrollTop;
      body.classList.add('panning');
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved <= 3) return;                    // 3px 内算点击，避免"轻抖一下"就位移
      body.scrollLeft = sl - dx;
      body.scrollTop = st - dy;
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      body.classList.remove('panning');
    });
    // 拖完紧跟的那次 click 要吞掉，否则平移结束会顺手选中一个节点
    body.addEventListener('click', function (e) {
      if (moved > 3) { e.stopPropagation(); e.preventDefault(); moved = 0; }
    }, true);

    // Ctrl/⌘ + 滚轮 = 缩放；Alt + 滚轮 = 横向平移（纵向平移用原生滚轮）
    body.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
      } else if (e.altKey) {
        e.preventDefault();
        body.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    window.addEventListener('resize', updatePannable);
  }

  function bindNodeClick(pane, mapper) {
    pane.querySelectorAll('.nd').forEach(function (g) {
      g.addEventListener('click', function () {
        var id = mapper(g.getAttribute('data-id'));
        if (id) selectNode(id);
      });
    });
  }

  function highlightSelection() {
    if (state.view === 'swimlane' && state.handles.swimlane) state.handles.swimlane.select(state.selected);
    else if (state.view === 'bpmn' && state.handles.bpmn) {
      state.handles.bpmn.svg.querySelectorAll('.nd').forEach(function (g) { g.classList.remove('selected'); });
    }
  }

  function selectNode(id) {
    state.selected = id;
    var a = currentAsset();
    renderProps(a, id);
    highlightSelection();
  }

  /* ---------------- 右侧：属性 ---------------- */
  function renderProps(a, id) {
    var host = $('pane-prop');
    if (!id) {
      var missing = a.nodes.filter(function (n) {
        return !String(n.input).trim() || !String(n.output).trim() || !String(n.system).trim();
      }).length;
      host.innerHTML =
        '<div class="prop-group"><div class="prop-group-title">流程概览</div>' +
        '<div class="prop-row"><span class="prop-k">流程名称</span><span class="prop-v">' + esc(m(a.name)) + '</span></div>' +
        '<div class="prop-row"><span class="prop-k">所属空间</span><span class="prop-v">' + esc(m(a.space)) + '</span></div>' +
        '<div class="prop-row"><span class="prop-k">数据来源</span><span class="prop-v">' + esc(m(a.sourceLabel)) + '</span></div>' +
        '<div class="prop-row"><span class="prop-k">环节</span><span class="prop-v">' + a.stages.map(function (s) { return esc(s.name); }).join(' → ') + '</span></div>' +
        '<div class="prop-row"><span class="prop-k">角色泳道</span><span class="prop-v">' + a.lanes.map(function (l) { return esc(l.name); }).join('、') + '</span></div>' +
        '<div class="prop-row"><span class="prop-k">涉及系统</span><span class="prop-v">' +
        (a.systems.length ? a.systems.map(function (s) { return '<span class="chip sys">' + esc(s) + '</span>'; }).join(' ') : '<span class="prop-v empty">未标注</span>') + '</span></div>' +
        '<div class="prop-row"><span class="prop-k">字段完整度</span><span class="prop-v">' +
        (a.nodes.length ? Math.round((1 - missing / a.nodes.length) * 100) : 0) + '%（' + missing + ' 个节点存在缺失字段）</span></div>' +
        '</div><div class="prop-group" style="color:#93A4BD;font-size:12px;line-height:1.8">点击图中任一节点查看节点级元数据；切换到「AI 诊断」查看完备性问题清单。</div>';
      return;
    }
    var n = a.nodes.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    var h = [];
    h.push('<div class="prop-group"><div class="prop-group-title">节点属性</div>');
    h.push('<div class="prop-row"><span class="prop-k">业务环节</span><span class="prop-v">' + esc(n.stage) + '</span></div>');
    h.push('<div class="prop-row"><span class="prop-k">操作节点</span><span class="prop-v"><b>' + esc(n.name) + '</b></span></div>');
    h.push('<div class="prop-row"><span class="prop-k">操作角色</span><span class="prop-v">' + (String(n.role).trim() ? esc(n.role) : '<span class="prop-v empty">未指定</span>') + '</span></div>');
    h.push('<div class="prop-row"><span class="prop-k">输入</span><span class="prop-v">' + (String(n.input).trim() ? esc(n.input) : '<span class="prop-v empty">缺失</span>') + '</span></div>');
    h.push('<div class="prop-row"><span class="prop-k">输出</span><span class="prop-v">' + (String(n.output).trim() ? esc(n.output) : '<span class="prop-v empty">缺失</span>') + '</span></div>');
    h.push('<div class="prop-row"><span class="prop-k">涉及系统</span><span class="prop-v">' +
      (SOP.model.splitList(n.system).length ? SOP.model.splitList(n.system).map(function (s) { return '<span class="chip sys">' + esc(s) + '</span>'; }).join(' ') : '<span class="prop-v empty">未标注</span>') + '</span></div>');
    h.push('<div class="prop-row"><span class="prop-k">主状态</span><span class="prop-v">' + (String(n.status).trim() ? esc(n.status) : '<span class="prop-v empty">缺失</span>') + '</span></div>');
    if (n.note) h.push('<div class="prop-row"><span class="prop-k">图元附注</span><span class="prop-v">' + esc(n.note) + '</span></div>');
    h.push('</div>');

    if ((n.variants || []).length) {
      h.push('<div class="prop-group"><div class="prop-group-title">业务操作说明（' + n.variants.length + ' 种情况）</div>');
      n.variants.forEach(function (v, i) {
        h.push('<div class="kv-block"><div class="kb-title"><span class="idx">' + esc(v.label || ('情况' + (i + 1))) + '</span>' + esc(v.role || '角色未指定') + '</div>');
        if (v.text) h.push('<div class="kb-text">' + nl2br(v.text) + '</div>');
        if (v.exception) h.push('<div class="kb-text" style="color:#fca5a5">异常：' + nl2br(v.exception) + '</div>');
        if (v.fee) h.push('<div class="kb-text" style="color:#fcd34d">费用：' + nl2br(v.fee) + '</div>');
        h.push('</div>');
      });
      h.push('</div>');
    } else if (n.desc) {
      h.push('<div class="prop-group"><div class="prop-group-title">业务操作说明</div><div class="kv-block"><div class="kb-text">' + nl2br(n.desc) + '</div></div></div>');
    }
    if (n.hasException && !(n.variants || []).length) {
      h.push('<div class="prop-group"><div class="prop-group-title">异常与回退</div><div class="kv-block"><div class="kb-text">' + nl2br(n.exception) + '</div></div></div>');
    }
    host.innerHTML = h.join('');
  }

  /* ---------------- 右侧：诊断 ---------------- */
  function runDiagnose() {
    if (!state.asset) return;
    var a = currentAsset();
    SOP.ai.diagnose(a).then(function (res) {
      state.diag = res;
      var host = $('pane-diag');
      var h = [];
      h.push('<div class="diag-summary">' +
        '<div class="ds"><b style="color:#fca5a5">' + res.summary.high + '</b><span style="color:#93A4BD;font-size:11px">严重</span></div>' +
        '<div class="ds"><b style="color:#fcd34d">' + res.summary.mid + '</b><span style="color:#93A4BD;font-size:11px">中等</span></div>' +
        '<div class="ds"><b style="color:#93c5fd">' + res.summary.low + '</b><span style="color:#93A4BD;font-size:11px">提示</span></div>' +
        '</div>');
      h.push('<div style="padding:10px 14px 4px;font-size:11px;color:#93A4BD">诊断引擎：' +
        (res.engine === 'online' ? '在线大模型 + 本地规则' : '本地规则引擎（离线，可内网部署）') + '</div>');
      h.push('<div style="padding:8px 14px 14px">');
      var rank = { high: 0, mid: 1, low: 2 };
      res.items.slice().sort(function (x, y) { return rank[x.severity] - rank[y.severity]; }).forEach(function (it, i) {
        var cls = it.severity === 'high' ? 'sev-high' : it.severity === 'mid' ? 'sev-mid' : 'sev-low';
        var label = it.severity === 'high' ? '严重' : it.severity === 'mid' ? '中等' : '提示';
        h.push('<div class="diag-item" data-node="' + (it.nodeId || '') + '" style="animation-delay:' + Math.min(i * 40, 600) + 'ms">' +
          '<div class="diag-head"><span class="sev ' + cls + '">' + label + '</span><span class="diag-title">' + esc(it.title) + '</span></div>' +
          '<div class="diag-text">' + esc(it.text) + '</div></div>');
      });
      if (!res.items.length) h.push('<div style="color:#6ee7b7;font-size:13px;padding:8px 0">未发现明显问题，该流程可进入审核发布流程。</div>');
      h.push('</div>');
      host.innerHTML = h.join('');
      host.querySelectorAll('.diag-item').forEach(function (el) {
        el.addEventListener('click', function () {
          var nid = el.getAttribute('data-node');
          if (!nid) { SOP.util.toast('该问题为流程级，不定位到具体节点', 'warn'); return; }
          if (state.view !== 'swimlane') switchView('swimlane');
          selectNode(nid);
          if (state.handles.swimlane) state.handles.swimlane.focus(nid);
        });
      });
    });
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(v) {
    state.view = v;
    document.querySelectorAll('.vtab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === v); });
    if (!state.asset) return;
    renderView(currentAsset());
    canvasBody().scrollLeft = 0;                 // 换视图回到左上角，避免停在上一张图的偏移上
    canvasBody().scrollTop = 0;
  }

  /* ---------------- 导入 ---------------- */
  function handleFile(file) {
    var name = file.name;
    SOP.util.toast('正在解析 ' + name + ' …');
    var p;
    if (/\.(bpmn|xml)$/i.test(name)) {
      p = new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function (e) {
          try { res(SOP.bpmn.fromXML(e.target.result, name)); } catch (err) { rej(err); }
        };
        fr.onerror = function () { rej(new Error('读取失败')); };
        fr.readAsText(file, 'utf-8');
      }).then(function (asset) { return { asset: asset }; });
    } else {
      p = SOP.ai.parseFile(file).then(function (parsed) {
        var asset = null;
        if (parsed.kind === 'xlsx') {
          // 多工作表时取行数最多的一张
          var s = parsed.sheets.slice().sort(function (a, b) { return b.rows.length - a.rows.length; })[0];
          asset = SOP.model.normalize(s, { name: s.sheet, space: '导入资产', desc: '来自 ' + name });
          parsed.allSheets = parsed.sheets;
        } else if (parsed.kind === 'vsdx') {
          asset = SOP.model.normalize(parsed.pages[0], { name: parsed.pages[0].name, space: '导入资产', desc: '来自 ' + name });
          parsed.allPages = parsed.pages;
        } else {
          asset = SOP.model.normalize(parsed, { name: name.replace(/\.[^.]+$/, ''), space: '导入资产', desc: '来自 ' + name });
        }
        if (!asset) throw new Error('解析结果为空');
        return { asset: asset, parsed: parsed };
      });
    }
    p.then(function (r) {
      r.asset.versions = [SOP.model.snapshot(r.asset, r.asset.version)];
      setAsset(r.asset);
      closeModal('modal-import');
      var extra = '';
      if (r.parsed && r.parsed.allPages && r.parsed.allPages.length > 1) {
        extra = '（该文件共 ' + r.parsed.allPages.length + ' 页，当前显示第 1 页，可在左侧切换）';
        state.extraPages = r.parsed.allPages;
        renderPageSwitch();
      }
      SOP.util.toast('导入成功：' + r.asset.stats.nodeCount + ' 节点 / ' + r.asset.stats.laneCount + ' 泳道' + extra);
    }).catch(function (e) {
      SOP.util.toast('导入失败：' + (e.message || e), 'err', 4200);
    });
  }

  function renderPageSwitch() {
    var host = $('sample-list');
    if (!state.extraPages || state.extraPages.length < 2) return;
    var el = document.createElement('div');
    el.className = 'section-label';
    el.style.marginTop = '10px';
    el.textContent = '该 Visio 的其他页';
    host.appendChild(el);
    state.extraPages.forEach(function (pg, i) {
      var c = document.createElement('div');
      c.className = 'sample-card';
      c.innerHTML = '<div class="sample-name">' + esc(m(pg.name)) + '</div><div class="sample-desc">第 ' + (i + 1) + ' 页</div>';
      c.addEventListener('click', function () {
        var a = SOP.model.normalize(pg, { name: pg.name, space: '导入资产', desc: '来自 Visio' });
        a.versions = [SOP.model.snapshot(a, a.version)];
        setAsset(a);
      });
      host.appendChild(c);
    });
  }

  /* ---------------- 导出 ---------------- */
  function currentSvg() {
    var pane = $(paneOf(state.view));
    return pane.querySelector('svg');
  }

  function exportSvg() {
    var svg = currentSvg();
    if (!svg) { SOP.util.toast('当前视图没有图形可导出', 'warn'); return; }
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var txt = new XMLSerializer().serializeToString(clone);
    SOP.util.downloadText('<?xml version="1.0" encoding="UTF-8"?>\n' + txt, (currentAsset().name || '流程') + '.svg', 'image/svg+xml;charset=utf-8');
    SOP.util.toast('已导出 SVG');
  }

  function exportPng() {
    var svg = currentSvg();
    if (!svg) { SOP.util.toast('当前视图没有图形可导出', 'warn'); return; }
    SOP.util.svgToPngBlob(svg, 2).then(function (b) {
      SOP.util.downloadBlob(b, (currentAsset().name || '流程') + '.png');
      SOP.util.toast('已导出 PNG（2 倍图）');
    }).catch(function (e) { SOP.util.toast('PNG 导出失败：' + e.message, 'err'); });
  }

  function exportBpmn() {
    if (!state.asset) return;
    var xml = SOP.bpmn.toXML(currentAsset());
    SOP.util.downloadText(xml, (currentAsset().name || '流程') + '.bpmn', 'application/xml;charset=utf-8');
    SOP.util.toast('已导出 BPMN 2.0 XML（含 DI，可被第三方引擎/工具打开）');
  }

  /* ---------------- 版本 ---------------- */
  function openVersion() {
    if (!state.asset) { SOP.util.toast('请先加载或导入流程', 'warn'); return; }
    var vs = state.asset.versions || [];
    var opts = vs.map(function (v, i) {
      return '<option value="' + i + '">' + esc(v.version) + ' · ' + esc(v.status || '') + ' · ' + (v.createdAt || '').slice(0, 10) + '</option>';
    }).join('');
    $('ver-a').innerHTML = opts;
    $('ver-b').innerHTML = opts;
    if (vs.length > 1) { $('ver-a').value = '0'; $('ver-b').value = String(vs.length - 1); }
    $('ver-result').innerHTML = '<div style="color:#93A4BD;font-size:12px">选择两个版本后自动对比；或点击右下「保存当前为新版本」。</div>';
    openModal('modal-version');
    diffNow();
  }

  function diffNow() {
    var vs = (state.asset && state.asset.versions) || [];
    var i = +$('ver-a').value, j = +$('ver-b').value;
    if (vs.length < 2 || isNaN(i) || isNaN(j)) return;
    var r = SOP.diff.compare(vs[i].snapshot, vs[j].snapshot);
    $('ver-result').innerHTML = SOP.diff.toHTML(r, vs[i].version, vs[j].version);
  }

  function snapshotNow() {
    if (!state.asset) return;
    state.asset.version = SOP.model.nextVersion(state.asset.version);
    state.asset.versions = state.asset.versions || [];
    state.asset.versions.push(SOP.model.snapshot(state.asset, state.asset.version));
    renderAll();
    SOP.util.toast('已保存版本 ' + state.asset.version);
    openVersion();
  }

  /* ---------------- SOP 文档 ---------------- */
  function openDoc() {
    if (!state.asset) { SOP.util.toast('请先加载或导入流程', 'warn'); return; }
    var a = currentAsset();
    $('doc-preview').innerHTML = SOP.report.toHTML(a);
    $('doc-tag').textContent = a.stats.nodeCount + ' 节点 · ' + a.stats.stageCount + ' 环节 · 由流程图自动生成';
    $('doc-progress').style.display = 'none';
    openModal('modal-doc');
  }

  /* ---------------- 设置 ---------------- */
  function syncMode() {
    var on = SOP.ai.isOnline();
    var pill = $('mode-pill');
    pill.className = 'mode-pill ' + (on ? 'online' : 'offline');
    $('mode-text').textContent = on ? ('在线大模型 · ' + SOP.ai.config.model) : '离线规则引擎';
    $('sb-mode').textContent = location.protocol === 'file:' ? '单文件（离线）' : (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '本地服务' : '在线站点');
  }

  function openSettings() {
    $('cfg-enable').checked = !!SOP.ai.config.enabled;
    $('cfg-base').value = SOP.ai.config.baseURL || '';
    $('cfg-key').value = SOP.ai.config.apiKey || '';
    $('cfg-model').value = SOP.ai.config.model || 'gpt-4o-mini';
    $('cfg-desens').checked = !!state.desens;
    if (!MASK.length) { var row = $('cfg-desens').closest('.field'); if (row) row.style.display = 'none'; }
    openModal('modal-settings');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    document.querySelectorAll('.vtab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.getAttribute('data-view')); });
    });
    document.querySelectorAll('.tabs-mini .tm').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tabs-mini .tm').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var isProp = t.getAttribute('data-tab') === 'prop';
        $('pane-prop').style.display = isProp ? '' : 'none';
        $('pane-diag').style.display = isProp ? 'none' : '';
      });
    });

    $('btn-import').addEventListener('click', function () { openModal('modal-import'); });
    $('btn-empty-import').addEventListener('click', function () { openModal('modal-import'); });
    $('btn-empty-sample').addEventListener('click', function () { loadSample((state.samples[0] || {}).id); });
    $('btn-nl').addEventListener('click', function () { openModal('modal-nl'); });
    $('btn-doc').addEventListener('click', openDoc);
    $('btn-version').addEventListener('click', openVersion);
    $('btn-settings').addEventListener('click', openSettings);
    $('mode-pill').addEventListener('click', openSettings);
    $('btn-publish').addEventListener('click', function () {
      if (!state.asset) return;
      var a = state.asset;
      a.status = a.status === 'draft' ? 'review' : (a.status === 'review' ? 'published' : 'draft');
      SOP.util.toast('状态已切换为：' + ({ draft: '草稿', review: '待审核', published: '已发布' }[a.status]));
      renderAll();
    });

    $('btn-zoom-in').addEventListener('click', function () { setZoom(state.zoom + 0.1); });
    $('btn-zoom-out').addEventListener('click', function () { setZoom(state.zoom - 0.1); });
    $('btn-zoom-fit').addEventListener('click', zoomFit);
    $('btn-export-svg').addEventListener('click', exportSvg);
    $('btn-export-png').addEventListener('click', exportPng);
    $('btn-export-bpmn').addEventListener('click', exportBpmn);

    // 文件选择
    var fi = $('file-input');
    $('drop-zone').addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () { if (fi.files[0]) handleFile(fi.files[0]); fi.value = ''; });

    // 拖拽
    var body = $('canvas-body');
    ['dragenter', 'dragover'].forEach(function (ev) {
      body.addEventListener(ev, function (e) { e.preventDefault(); $('drop-hint').classList.add('show'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      body.addEventListener(ev, function (e) { e.preventDefault(); $('drop-hint').classList.remove('show'); });
    });
    body.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    // 自然语言
    $('nl-go').addEventListener('click', function () {
      var txt = $('nl-text').value;
      if (!txt.trim()) { SOP.util.toast('请先输入流程描述', 'warn'); return; }
      SOP.ai.nl2flow(txt, '自然语言流程').then(function (asset) {
        if (!asset) { SOP.util.toast('未能生成流程', 'err'); return; }
        asset.versions = [SOP.model.snapshot(asset, asset.version)];
        setAsset(asset);
        closeModal('modal-nl');
        SOP.util.toast('已生成：' + asset.stats.nodeCount + ' 节点');
      });
    });

    // 文档
    $('doc-print').addEventListener('click', function () { SOP.report.printDoc(currentAsset()); });
    $('doc-export').addEventListener('click', function () {
      var p = $('doc-progress');
      p.style.display = '';
      var bar = p.querySelector('i');
      bar.style.width = '20%';
      setTimeout(function () {
        bar.style.width = '60%';
        SOP.report.downloadDocx(currentAsset()).then(function () {
          bar.style.width = '100%';
          SOP.util.toast('已导出 Word 文档（.docx）');
          setTimeout(function () { p.style.display = 'none'; }, 700);
        }).catch(function (e) {
          p.style.display = 'none';
          SOP.util.toast('docx 导出失败：' + (e.message || e), 'err');
        });
      }, 120);
    });

    // 版本
    $('ver-snapshot').addEventListener('click', snapshotNow);
    $('ver-a').addEventListener('change', diffNow);
    $('ver-b').addEventListener('change', diffNow);

    // 设置
    $('cfg-save').addEventListener('click', function () {
      SOP.ai.saveConfig({
        enabled: $('cfg-enable').checked,
        baseURL: $('cfg-base').value.trim(),
        apiKey: $('cfg-key').value.trim(),
        model: $('cfg-model').value.trim() || 'gpt-4o-mini'
      });
      var d = $('cfg-desens').checked;
      if (d !== state.desens) {
        state.desens = d;
        renderSampleList();                      // 样例卡文案也要跟着换
        if (state.asset) { renderAll(); runDiagnose(); }
      }
      syncMode();
      closeModal('modal-settings');
      SOP.util.toast('设置已保存');
      if (state.asset) runDiagnose();
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    SOP.ai.loadConfig();
    state.samples = (window.SOP_SAMPLES && window.SOP_SAMPLES.items) || [];
    renderSampleList();
    bind();
    enableCanvasPan();
    syncMode();
    if (state.samples.length) loadSample(state.samples[0].id);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
