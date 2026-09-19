/* 价值链图 / 过程链图：环节级横向链路，用于向管理层讲"端到端" */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var render = (SOP.render = SOP.render || {});

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function wrap(t, n) {
    t = String(t || '');
    var out = [], cur = '';
    for (var i = 0; i < t.length; i++) { cur += t[i]; if (cur.length >= n) { out.push(cur); cur = ''; } }
    if (cur) out.push(cur);
    return out.slice(0, 2);
  }

  render.valueChain = function (asset, host) {
    var stages = asset.stages.length ? asset.stages : [{ id: 'st_0', name: '流程主体' }];
    var CW = 236, CH = 132, GAP = 58, TOP = 92, LEFTX = 40;
    var W = LEFTX + stages.length * (CW + GAP) + 40;
    var H = TOP + CH + 150;
    var s = [];

    s.push('<svg class="diagram-svg" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">');
    s.push('<defs><marker id="vcw" markerWidth="12" markerHeight="9" refX="11" refY="4.5" orient="auto"><path d="M0,0 L12,4.5 L0,9 z" fill="#1668DC"/></marker>');
    s.push('<linearGradient id="vcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0A3D91"/><stop offset="100%" stop-color="#1668DC"/></linearGradient></defs>');

    s.push('<text x="' + LEFTX + '" y="34" font-size="17" font-weight="600" fill="#0A3D91">' + esc(asset.name) + '　价值链视图</text>');
    s.push('<text x="' + LEFTX + '" y="58" font-size="12" fill="#6B7280">共 ' + asset.stats.stageCount + ' 个业务环节 · ' +
      asset.stats.nodeCount + ' 个操作节点 · ' + asset.stats.laneCount + ' 个角色泳道</text>');

    stages.forEach(function (st, i) {
      var x = LEFTX + i * (CW + GAP);
      var ns = asset.nodes.filter(function (n) { return n.stageId === st.id || n.stage === st.name; });
      var roles = [];
      ns.forEach(function (n) { if (roles.indexOf(n.role) < 0) roles.push(n.role); });
      var sys = [];
      ns.forEach(function (n) { SOP.model.splitList(n.system).forEach(function (x2) { if (sys.indexOf(x2) < 0) sys.push(x2); }); });
      var feeCount = ns.filter(function (n) { return n.hasFee; }).length;
      var excCount = ns.filter(function (n) { return n.hasException; }).length;

      s.push('<g class="nd node-grow" data-stage="' + st.id + '" style="animation-delay:' + (i * 60) + 'ms">');
      s.push('<rect x="' + x + '" y="' + TOP + '" width="' + CW + '" height="' + CH + '" rx="12" fill="#fff" stroke="#c9d4e4" stroke-width="1.2"/>');
      s.push('<rect x="' + x + '" y="' + TOP + '" width="' + CW + '" height="34" rx="12" fill="url(#vcg)"/>');
      s.push('<rect x="' + x + '" y="' + (TOP + 22) + '" width="' + CW + '" height="12" fill="url(#vcg)"/>');
      var t = wrap(st.name, 12);
      s.push('<text x="' + (x + 14) + '" y="' + (TOP + 22) + '" font-size="13" font-weight="600" fill="#fff">' + esc(t[0]) + '</text>');
      s.push('<text x="' + (x + CW - 12) + '" y="' + (TOP + 22) + '" font-size="11" fill="#dbeafe" text-anchor="end">' + (i + 1) + '/' + stages.length + '</text>');

      s.push('<text x="' + (x + 14) + '" y="' + (TOP + 56) + '" font-size="11.5" fill="#374151">节点 <tspan font-weight="600" fill="#0A3D91">' + ns.length + '</tspan> 个</text>');
      s.push('<text x="' + (x + 14) + '" y="' + (TOP + 74) + '" font-size="11.5" fill="#374151">角色 <tspan font-weight="600" fill="#0A3D91">' + roles.length + '</tspan> 个</text>');
      s.push('<text x="' + (x + 14) + '" y="' + (TOP + 92) + '" font-size="11" fill="#6B7280">' + esc(wrap(roles.join('、'), 15)[0] || '—') + '</text>');
      s.push('<text x="' + (x + 14) + '" y="' + (TOP + 112) + '" font-size="11" fill="' + (sys.length ? '#00A3C4' : '#F5222D') + '">' + esc(wrap(sys.join('、'), 15)[0] || '系统未标注') + '</text>');
      if (excCount) s.push('<text x="' + (x + CW - 12) + '" y="' + (TOP + 92) + '" font-size="10.5" fill="#F5222D" text-anchor="end">异常 ' + excCount + '</text>');
      if (feeCount) s.push('<text x="' + (x + CW - 12) + '" y="' + (TOP + 112) + '" font-size="10.5" fill="#FAAD14" text-anchor="end">计费 ' + feeCount + '</text>');
      s.push('</g>');

      if (i + 1 < stages.length) {
        s.push('<path d="M' + (x + CW) + ',' + (TOP + CH / 2) + ' L' + (x + CW + GAP - 4) + ',' + (TOP + CH / 2) +
          '" stroke="#1668DC" stroke-width="2" fill="none" marker-end="url(#vcw)"/>');
      }
    });

    // 底部：主链路角色参与热力
    var y2 = TOP + CH + 44;
    s.push('<text x="' + LEFTX + '" y="' + (y2 - 12) + '" font-size="13" font-weight="600" fill="#0A3D91">角色参与分布</text>');
    asset.lanes.forEach(function (l, i) {
      var cnt = asset.nodes.filter(function (n) { return n.laneId === l.id; }).length;
      var w = Math.max(40, cnt * 26);
      s.push('<text x="' + LEFTX + '" y="' + (y2 + 18 + i * 24) + '" font-size="11.5" fill="#374151">' + esc(l.name) + '</text>');
      s.push('<rect x="' + (LEFTX + 130) + '" y="' + (y2 + 7 + i * 24) + '" width="' + w + '" height="14" rx="4" fill="#1668DC" opacity="0.75"/>');
      s.push('<text x="' + (LEFTX + 130 + w + 8) + '" y="' + (y2 + 18 + i * 24) + '" font-size="11" fill="#6B7280">' + cnt + ' 个节点</text>');
    });
    s.push('</svg>');
    host.innerHTML = s.join('');
    return { svg: host.querySelector('svg') };
  };
})();
