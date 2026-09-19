/* AI 三件套
   1) 自然语言建模     2) 文档智能解析     3) 合规与优化诊断
   离线优先：默认走本地规则引擎；在线大模型仅在配置后作为增强，且 UI 真实标注模式 */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var ai = (SOP.ai = SOP.ai || {});
  var model = SOP.model;

  /* ============ 1. 自然语言 → 流程 ============ */
  var NL_PROMPT = '你是流程建模专家。把下面的业务描述转成严格的 JSON，不要任何解释文字。\n' +
    'JSON 结构：{"name":"流程名","stages":[{"name":"环节"}],"nodes":[{"stage":"环节","name":"操作节点","role":"操作角色","input":"输入","output":"输出","system":"涉及系统","status":"主状态","desc":"说明"}]}\n' +
    '要求：环节按业务推进顺序；每个节点必须归属某个环节；角色写具体岗位；系统写业务系统名称；字段缺失填空字符串。\n\n业务描述：\n';

  function offlineNL(text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    lines.forEach(function (raw) {
      var l = String(raw).trim();
      if (!l) return;
      l = l.replace(/^[-*·]\s*/, '');
      // 显式环节标题
      if (/^(环节|阶段)\s*[:：]/.test(l)) { out.push(l.replace(/^(环节|阶段)\s*[:：]/, '环节：')); return; }
      // 串行：A → B → C
      if (l.indexOf('→') >= 0 || l.indexOf('->') >= 0) {
        l.split(/(?:→|->)/).forEach(function (seg) {
          var t = String(seg).trim();
          if (!t) return;
          var m = t.match(/^(.{1,10})[:：]\s*(.+)$/);
          out.push(m ? '- [' + m[1] + ']' + m[2] : '- ' + t);
        });
        return;
      }
      var m2 = l.match(/^(.{1,10})[:：]\s*(.+)$/);
      out.push(m2 ? '- [' + m2[1] + ']' + m2[2] : '- ' + l);
    });
    return out;
  }

  ai.nl2flow = function (text, name) {
    if (ai.isOnline && ai.isOnline()) {
      return ai.chat([{ role: 'user', content: NL_PROMPT + String(text).slice(0, 6000) }])
        .then(function (t) {
          var j = ai.extractJSON(t);
          var stages = (j.stages || []).map(function (s, i) { return { id: 'st_' + i, name: s.name || ('环节' + (i + 1)), desc: '', order: i }; });
          var stageId = {};
          stages.forEach(function (s) { stageId[s.name] = s.id; });
          var nodes = (j.nodes || []).map(function (n, i) {
            return {
              id: 'n_' + i, seq: String(i + 1), stage: n.stage || '', stageId: stageId[n.stage] || '',
              name: n.name || ('节点' + (i + 1)), desc: n.desc || '', stageDesc: '',
              role: n.role || '未指定角色', roles: [n.role || '未指定角色'],
              input: n.input || '', output: n.output || '', system: n.system || '', status: n.status || '',
              variants: [], exception: '', fee: '', note: ''
            };
          });
          var edges = [];
          for (var i = 0; i + 1 < nodes.length; i++) edges.push({ id: 'e_' + i, from: nodes[i].id, to: nodes[i + 1].id, label: '', type: 'seq' });
          if (!stages.length) stages = [{ id: 'st_0', name: '流程主体', desc: '', order: 0 }];
          nodes.forEach(function (n) { if (!n.stageId) n.stageId = stages[0].id; });
          return model.finalize({
            stages: stages, nodes: nodes, laneNames: nodes.map(function (n) { return n.role; }), edges: edges,
            sourceKind: 'text', sourceLabel: 'AI 自然语言建模（在线）'
          }, { name: j.name || name || '自然语言生成的流程', space: 'AI 建模' });
        })
        .catch(function (e) {
          SOP.util.toast('在线建模失败，已降级为离线解析：' + (e.message || e), 'warn', 3200);
          return offlineBuild(text, name);
        });
    }
    return Promise.resolve(offlineBuild(text, name));
  };

  function offlineBuild(text, name) {
    return model.normalize({ lines: offlineNL(text), label: '自然语言（离线解析）' }, { name: name || '自然语言流程', space: 'AI 建模' });
  }

  /* ============ 2. 文档智能解析 ============ */
  ai.pickParser = function (fileName) {
    var list = [SOP.parsers.xlsx, SOP.parsers.vsdx, SOP.parsers.docx, SOP.parsers.pdf];
    for (var i = 0; i < list.length; i++) {
      if (list[i].accept.test(fileName)) return list[i];
    }
    return null;
  };

  ai.parseFile = function (file) {
    var p = ai.pickParser(file.name);
    if (!p) return Promise.reject(new Error('暂不支持的文件类型：' + file.name + '（支持 Excel / Visio / Word / PDF）'));
    return p.parse(file);
  };

  /* ============ 3. 合规与优化诊断 ============ */
  var DIAG_PROMPT = '你是流程治理专家。基于下面的流程资产 JSON，补充 3~6 条中文优化建议，' +
    '只输出 JSON 数组：[{"severity":"high|mid|low","title":"标题","text":"建议内容","stage":"相关环节（可空）"}]，不要解释文字。\n\n';

  ai.diagnose = function (asset) {
    var base = ai.rules.diagnose(asset);
    if (!ai.isOnline()) return Promise.resolve(base);
    var payload = {
      name: asset.name,
      stages: asset.stages.map(function (s) { return s.name; }),
      nodes: asset.nodes.slice(0, 40).map(function (n) {
        return { stage: n.stage, name: n.name, role: n.role, input: n.input, output: n.output, system: n.system, status: n.status };
      })
    };
    return ai.chat([{ role: 'user', content: DIAG_PROMPT + JSON.stringify(payload) }])
      .then(function (t) {
        var arr = ai.extractJSON(t);
        if (!Array.isArray(arr)) return base;
        arr.forEach(function (x, i) {
          var sev = (x.severity === 'high' || x.severity === 'mid') ? x.severity : 'low';
          var nodeId = '';
          if (x.stage) {
            var hit = asset.nodes.filter(function (n) { return n.stage === x.stage; })[0];
            if (hit) nodeId = hit.id;
          }
          base.items.push({ id: 'ai_' + i, severity: sev, title: '[AI] ' + (x.title || '优化建议'), text: x.text || '', nodeId: nodeId, fromAI: true });
          base.summary[sev]++;
        });
        base.engine = 'online';
        return base;
      })
      .catch(function () { return base; });
  };
})();
