/* 泳道流程图：自绘 SVG + 自研分层布局
   布局规则：列 = 业务环节（流程推进方向），行 = 角色泳道；
   同一格内多个节点纵向堆叠。零第三方依赖。 */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var render = (SOP.render = SOP.render || {});

  var LANE_W = 152;        // 左侧角色泳道宽度
  var STAGE_H = 40;        // 顶部环节条高度
  var COL_W = 208;         // 环节列宽
  var CELL_PAD = 12;
  var NODE_H_BASE = 46;
  var LINE_H = 17;
  var M = { top: 16, right: 24, bottom: 40, left: 16 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function wrap(text, maxChars, maxLines) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return ['(未命名)'];
    var lines = [], cur = '';
    for (var i = 0; i < t.length; i++) {
      cur += t[i];
      if (cur.length >= maxChars) { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines && t.length > maxLines * maxChars) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + '…';
    }
    return lines;
  }

  /** 计算布局（供渲染与导出共用） */
  function layout(asset) {
    var stages = asset.stages.length ? asset.stages : [{ id: 'st_0', name: '流程主体' }];
    var lanes = asset.lanes;
    var colX = [], x = M.left + LANE_W;
    var colW = [];
    stages.forEach(function (s, i) {
      colW[i] = COL_W;
      colX[i] = x;
      x += COL_W;
    });

    // 每格内的节点
    var cell = {};
    asset.nodes.forEach(function (n) {
      var si = 0;
      stages.forEach(function (s, i) { if (s.id === n.stageId || s.name === n.stage) si = i; });
      var li = 0;
      lanes.forEach(function (l, i) { if (l.id === n.laneId || l.name === n.role) li = i; });
      var k = si + '#' + li;
      (cell[k] = cell[k] || []).push(n);
    });

    var laneH = lanes.map(function (l, li) {
      var maxN = 0;
      for (var si = 0; si < stages.length; si++) {
        var arr = cell[si + '#' + li] || [];
        maxN = Math.max(maxN, arr.length);
      }
      return Math.max(1, maxN) * (NODE_H_BASE + CELL_PAD * 2) + CELL_PAD;
    });

    var laneY = [], y = M.top + STAGE_H;
    laneH.forEach(function (h, i) { laneY[i] = y; y += h; });

    var pos = {};
    for (var si = 0; si < stages.length; si++) {
      for (var li = 0; li < lanes.length; li++) {
        var arr = cell[si + '#' + li] || [];
        arr.forEach(function (n, k) {
          var nh = NODE_H_BASE + (wrap(n.name, 13, 2).length - 1) * LINE_H;
          pos[n.id] = {
            x: colX[si] + CELL_PAD,
            y: laneY[li] + CELL_PAD + k * (NODE_H_BASE + CELL_PAD * 2),
            w: COL_W - CELL_PAD * 2,
            h: nh,
            si: si, li: li
          };
        });
      }
    }

    var W = M.left + LANE_W + stages.length * COL_W + M.right;
    var H = M.top + STAGE_H + laneH.reduce(function (a, b) { return a + b; }, 0) + M.bottom;
    return { stages: stages, lanes: lanes, colX: colX, colW: colW, laneY: laneY, laneH: laneH, pos: pos, W: W, H: H };
  }
  render.swimlaneLayout = layout;

  /** 渲染到容器 */
  render.swimlane = function (asset, host, opts) {
    opts = opts || {};
    var L = layout(asset);
    var sysColor = SOP.model.systemColor;
    var s = [];
    var growDelay = 0;

    s.push('<svg class="diagram-svg" id="sl-svg" xmlns="http://www.w3.org/2000/svg" width="' + L.W + '" height="' + L.H + '" viewBox="0 0 ' + L.W + ' ' + L.H + '">');
    s.push('<defs>');
    s.push('<marker id="arw" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 z" fill="#8a98ad"/></marker>');
    s.push('<marker id="arwh" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 z" fill="#1668DC"/></marker>');
    s.push('<linearGradient id="stageGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0A3D91"/><stop offset="100%" stop-color="#1668DC"/></linearGradient>');
    s.push('<filter id="ndShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#0A3D91" flood-opacity="0.16"/></filter>');
    s.push('</defs>');

    // 泳道背景条
    L.lanes.forEach(function (lane, li) {
      s.push('<rect x="' + (M.left + LANE_W) + '" y="' + L.laneY[li] + '" width="' + (L.W - M.left - LANE_W - M.right) + '" height="' + L.laneH[li] +
        '" fill="' + (li % 2 ? '#eef2f8' : '#f7f9fc') + '" stroke="#dde3ec" stroke-width="1"/>');
      s.push('<rect x="' + M.left + '" y="' + L.laneY[li] + '" width="' + LANE_W + '" height="' + L.laneH[li] +
        '" fill="' + (li % 2 ? '#dce6f5' : '#e8eefa') + '" stroke="#cfdaea" stroke-width="1" rx="4"/>');
      var ln = wrap(lane.name, 9, 2);
      var ty = L.laneY[li] + L.laneH[li] / 2 - (ln.length - 1) * 8;
      ln.forEach(function (t, k) {
        s.push('<text class="lane-head" x="' + (M.left + 14) + '" y="' + (ty + k * 17) +
          '" font-size="12.5" fill="#0A3D91">' + esc(t) + '</text>');
      });
    });

    // 环节条
    L.stages.forEach(function (st, si) {
      s.push('<rect x="' + L.colX[si] + '" y="' + M.top + '" width="' + (L.colW[si] - 4) + '" height="' + (STAGE_H - 6) +
        '" fill="url(#stageGrad)" rx="6"/>');
      var t = wrap(st.name, 10, 1);
      s.push('<text class="stage-head" x="' + (L.colX[si] + L.colW[si] / 2 - 2) + '" y="' + (M.top + 23) +
        '" font-size="13" fill="#fff" text-anchor="middle">' + esc(t[0]) + '</text>');
      s.push('<rect x="' + L.colX[si] + '" y="' + (M.top + STAGE_H - 6) + '" width="' + (L.colW[si] - 4) + '" height="' +
        (L.H - M.top - STAGE_H - M.bottom + 6) + '" fill="rgba(10,61,145,.03)" stroke="#e6ebf3" stroke-width="1" stroke-dasharray="3 3"/>');
    });

    // 连线（先画线，节点覆盖其上）
    var edgeGroup = [];
    asset.edges.forEach(function (e) {
      var a = L.pos[e.from], b = L.pos[e.to];
      if (!a || !b) return;
      var d, midX;
      if (a.si === b.si) {
        // 同列：下方绕行
        var yb = Math.max(a.y + a.h, b.y + b.h) + 10;
        d = 'M' + (a.x + a.w / 2) + ',' + (a.y + a.h) + ' L' + (a.x + a.w / 2) + ',' + yb +
          ' L' + (b.x + b.w / 2) + ',' + yb + ' L' + (b.x + b.w / 2) + ',' + (b.y + b.h);
      } else if (b.si > a.si) {
        midX = (a.x + a.w + b.x) / 2;
        d = 'M' + (a.x + a.w) + ',' + (a.y + a.h / 2) + ' L' + midX + ',' + (a.y + a.h / 2) +
          ' L' + midX + ',' + (b.y + b.h / 2) + ' L' + (b.x - 2) + ',' + (b.y + b.h / 2);
      } else {
        var yb2 = Math.max(a.y + a.h, b.y + b.h) + 16 + (a.li + b.li) * 2;
        d = 'M' + (a.x + a.w / 2) + ',' + (a.y + a.h) + ' L' + (a.x + a.w / 2) + ',' + yb2 +
          ' L' + (b.x + b.w / 2) + ',' + yb2 + ' L' + (b.x + b.w / 2) + ',' + (b.y + b.h);
      }
      edgeGroup.push('<path class="flow-line" data-from="' + e.from + '" data-to="' + e.to + '" d="' + d + '" marker-end="url(#arw)"/>');
    });
    s.push('<g id="sl-edges">' + edgeGroup.join('') + '</g>');

    // 节点
    asset.nodes.forEach(function (n) {
      var p = L.pos[n.id];
      if (!p) return;
      var col = sysColor(n.system);
      var lines = wrap(n.name, 13, 2);
      var h = NODE_H_BASE + (lines.length - 1) * LINE_H;
      var isMulti = (n.variants || []).length > 1;
      var delay = (growDelay++) * (opts.animate === false ? 0 : 45);
      s.push('<g class="nd node-grow" data-id="' + n.id + '" style="animation-delay:' + delay + 'ms">');
      s.push('<rect class="nd-box" x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + h + '" rx="8" fill="#fff" stroke="' +
        (n.hasException ? '#F5222D' : '#d3dbe8') + '" stroke-width="' + (n.hasException ? 1.6 : 1.1) +
        '" filter="url(#ndShadow)"' + (n.hasException ? ' stroke-dasharray="5 3"' : '') + '/>');
      s.push('<rect x="' + p.x + '" y="' + p.y + '" width="4" height="' + h + '" rx="2" fill="' + col + '"/>');
      lines.forEach(function (ln, i) {
        s.push('<text x="' + (p.x + 12) + '" y="' + (p.y + 22 + i * LINE_H) + '" font-size="12.5" font-weight="500" fill="#1F2937">' + esc(ln) + '</text>');
      });
      // 徽标
      var bx = p.x + p.w - 8, by = p.y + h - 8;
      var badges = [];
      if (n.hasException) badges.push('<circle cx="' + (bx - 8) + '" cy="' + (by - 6) + '" r="7" fill="#F5222D"/><text x="' + (bx - 8) + '" y="' + (by - 2.5) + '" font-size="10" fill="#fff" text-anchor="middle">!</text>');
      if (n.hasFee) badges.push('<rect x="' + (bx - (n.hasException ? 34 : 16)) + '" y="' + (by - 14) + '" width="16" height="14" rx="3" fill="#FAAD14"/><text x="' + (bx - (n.hasException ? 34 : 16) + 8) + '" y="' + (by - 3.5) + '" font-size="10" fill="#fff" text-anchor="middle">¥</text>');
      if (isMulti) badges.push('<text x="' + (p.x + p.w - 8) + '" y="' + (p.y + 14) + '" font-size="10" fill="#1668DC" text-anchor="end">' + n.variants.length + ' 种情况</text>');
      s.push(badges.join(''));
      // 系统标签
      var sys = SOP.model.splitList(n.system)[0];
      s.push('<text x="' + (p.x + 12) + '" y="' + (p.y + h - 8) + '" font-size="10" fill="' + col + '">' + esc(sys || '系统未标注') + '</text>');
      s.push('</g>');
    });

    s.push('</svg>');
    host.innerHTML = s.join('');

    var svg = host.querySelector('svg');
    // 交互：点击选中 + 连线高亮
    svg.addEventListener('mouseover', function (ev) {
      var g = ev.target.closest ? ev.target.closest('.nd') : null;
      if (!g) return;
      var id = g.getAttribute('data-id');
      svg.querySelectorAll('.flow-line').forEach(function (p) {
        if (p.getAttribute('data-from') === id || p.getAttribute('data-to') === id) {
          p.classList.add('hot'); p.setAttribute('marker-end', 'url(#arwh)');
        }
      });
    });
    svg.addEventListener('mouseout', function () {
      svg.querySelectorAll('.flow-line.hot').forEach(function (p) {
        p.classList.remove('hot'); p.setAttribute('marker-end', 'url(#arw)');
      });
    });

    return {
      svg: svg,
      layout: L,
      select: function (id) {
        svg.querySelectorAll('.nd').forEach(function (g) { g.classList.toggle('selected', g.getAttribute('data-id') === id); });
      },
      focus: function (id) {
        var p = L.pos[id];
        if (!p) return;
        svg.querySelectorAll('.nd').forEach(function (g) {
          var box = g.querySelector('.nd-box');
          if (!box) return;
          if (g.getAttribute('data-id') === id) {
            box.classList.add('pulse-hl');
            setTimeout(function () { box.classList.remove('pulse-hl'); }, 2600);
          }
        });
        var hostEl = host.parentElement || host;
        hostEl.scrollTo({ left: Math.max(0, p.x - 260), top: Math.max(0, p.y - 200), behavior: 'smooth' });
      }
    };
  };
})();
