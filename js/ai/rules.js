/* 离线规则引擎（默认路径，也是信创内网可直接部署的卖点）
   对流程资产做 SOP 完备性诊断，输出问题清单（含严重度与定位） */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var ai = (SOP.ai = SOP.ai || {});
  var rules = (ai.rules = {});

  function v(s) { return String(s == null ? '' : s).trim(); }

  rules.diagnose = function (asset) {
    var items = [];
    var nodes = asset.nodes || [];
    var push = function (sev, title, text, nodeId) {
      items.push({ id: 'd_' + items.length, severity: sev, title: title, text: text, nodeId: nodeId || '' });
    };

    // 1. 缺失操作角色
    nodes.forEach(function (n) {
      if (!v(n.role) || n.role === '未指定角色') {
        push('high', '缺失操作角色', '节点「' + n.name + '」未标注操作角色，无法确定泳道归属与责任主体。', n.id);
      }
    });

    // 2. 缺失输入 / 输出
    nodes.forEach(function (n) {
      if (!v(n.input)) push('mid', '缺失输入', '节点「' + n.name + '」未定义输入物（单证/数据），下游无法校验数据来源。', n.id);
      if (!v(n.output)) push('mid', '缺失输出', '节点「' + n.name + '」未定义输出物，无法与下游节点形成数据契约。', n.id);
    });

    // 3. 缺失涉及系统（跨系统未标注）
    nodes.forEach(function (n) {
      if (!v(n.system)) push('high', '跨系统未标注', '节点「' + n.name + '」未标注承载系统，无法自动生成引擎任务类型与系统集成点。', n.id);
    });

    // 4. 环节说明缺失
    (asset.stages || []).forEach(function (st) {
      if (!v(st.desc)) push('low', '环节说明缺失', '环节「' + st.name + '」缺少环节说明，不利于新人理解与培训。', '');
    });

    // 5. 异常已描述但缺少回退路径
    nodes.forEach(function (n) {
      if (n.hasException) {
        var txt = (n.variants || []).map(function (x) { return x.exception; }).filter(Boolean).join('') || n.exception || '';
        if (!/处理|通知|重新|关闭|转|退回|人工/.test(txt)) {
          push('high', '异常无回退路径', '节点「' + n.name + '」描述了异常，但未说明处理动作与回退路径，发布到引擎后会出现悬挂分支。', n.id);
        }
      }
    });

    // 6. 输出 → 下一节点输入 不匹配
    for (var i = 0; i + 1 < nodes.length; i++) {
      var a = nodes[i], b = nodes[i + 1];
      if (!v(a.output) || !v(b.input)) continue;
      var o = a.output.split(/[、,，\/]/).map(function (x) { return x.trim(); });
      var inp = b.input.split(/[、,，\/]/).map(function (x) { return x.trim(); });
      var hit = o.some(function (x) { return inp.some(function (y) { return y && x && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0); }); });
      if (!hit) {
        push('mid', '数据契约断链', '「' + a.name + '」输出（' + a.output + '）与「' + b.name + '」输入（' + b.input + '）不匹配，存在数据断链风险。', b.id);
      }
    }

    // 7. 主状态断链
    var missStatus = nodes.filter(function (n) { return !v(n.status); });
    if (missStatus.length > nodes.length * 0.3) {
      push('mid', '主状态大面积缺失', '共 ' + missStatus.length + ' 个节点未定义主状态，流程引擎无法驱动状态机与进度回写。', missStatus[0] ? missStatus[0].id : '');
    }

    // 8. 费用节点未说明承担方
    nodes.forEach(function (n) {
      if (n.hasFee) {
        var t = (n.variants || []).map(function (x) { return x.fee; }).filter(Boolean).join('') || n.fee || '';
        if (!/支付|收取|承担|结算/.test(t)) {
          push('low', '费用承担方未明确', '节点「' + n.name + '」产生费用但未说明承担方，结算环节易产生争议。', n.id);
        }
      }
    });

    // 9. 多情况但未形成分支
    nodes.forEach(function (n) {
      if ((n.variants || []).length > 1 && !n.hasException) {
        push('low', '分支未建模', '节点「' + n.name + '」存在 ' + n.variants.length + ' 种情况，建议在引擎中建模为网关分支而非串行。', n.id);
      }
    });

    // 10. 孤立节点
    var deg = {};
    nodes.forEach(function (n) { deg[n.id] = 0; });
    (asset.edges || []).forEach(function (e) { if (deg[e.from] != null) deg[e.from]++; if (deg[e.to] != null) deg[e.to]++; });
    nodes.forEach(function (n) {
      if (nodes.length > 1 && !deg[n.id]) push('mid', '孤立节点', '节点「' + n.name + '」没有任何连线，可能是遗漏环节或多余节点。', n.id);
    });

    // 11. 泳道负载失衡
    (asset.lanes || []).forEach(function (l) {
      var c = nodes.filter(function (n) { return n.laneId === l.id; }).length;
      if (nodes.length >= 8 && c === 1) {
        push('low', '泳道负载过低', '角色「' + l.name + '」仅承担 1 个节点，需确认是否为必要岗位或可合并。', '');
      }
    });

    var summary = { high: 0, mid: 0, low: 0 };
    items.forEach(function (it) { summary[it.severity]++; });
    return { items: items, summary: summary, engine: 'offline' };
  };
})();
