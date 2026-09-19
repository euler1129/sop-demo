/* 版本管理：JSON 快照 + 节点级 diff（新增 / 删除 / 修改 / 未变） */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var diff = (SOP.diff = {});

  var FIELDS = [
    { k: 'stage', t: '业务环节' }, { k: 'role', t: '操作角色' }, { k: 'input', t: '输入' },
    { k: 'output', t: '输出' }, { k: 'system', t: '涉及系统' }, { k: 'status', t: '主状态' },
    { k: 'desc', t: '操作说明' }, { k: 'exception', t: '异常' }, { k: 'fee', t: '费用' }
  ];

  function keyOf(n) { return (n.stage || '') + '||' + (n.name || ''); }
  function val(n, k) { return String(n[k] == null ? '' : n[k]).trim(); }

  diff.compare = function (a, b) {
    var ma = {}, mb = {};
    (a.nodes || []).forEach(function (n) { ma[keyOf(n)] = n; });
    (b.nodes || []).forEach(function (n) { mb[keyOf(n)] = n; });

    var added = [], removed = [], changed = [], same = 0;
    Object.keys(mb).forEach(function (k) {
      if (!ma[k]) { added.push(mb[k]); return; }
      var na = ma[k], nb = mb[k], ch = [];
      FIELDS.forEach(function (f) {
        if (val(na, f.k) !== val(nb, f.k)) ch.push({ field: f.t, from: val(na, f.k), to: val(nb, f.k) });
      });
      if ((na.variants || []).length !== (nb.variants || []).length) {
        ch.push({ field: '情况分支数', from: String((na.variants || []).length), to: String((nb.variants || []).length) });
      }
      if (ch.length) changed.push({ node: nb, changes: ch }); else same++;
    });
    Object.keys(ma).forEach(function (k) { if (!mb[k]) removed.push(ma[k]); });

    return { added: added, removed: removed, changed: changed, same: same };
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  diff.toHTML = function (result, va, vb) {
    var h = [];
    h.push('<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;font-size:13px">');
    h.push('<span class="tag">' + esc(va) + '</span><span style="color:#93A4BD">→</span><span class="tag">' + esc(vb) + '</span>');
    h.push('<span class="chip" style="margin-left:auto">新增 ' + result.added.length + '</span>');
    h.push('<span class="chip">删除 ' + result.removed.length + '</span>');
    h.push('<span class="chip err">修改 ' + result.changed.length + '</span>');
    h.push('<span class="chip">未变 ' + result.same + '</span>');
    h.push('</div>');

    function block(title, arr, cls, render) {
      if (!arr.length) return '';
      var s = '<div class="prop-group"><div class="prop-group-title">' + title + '（' + arr.length + '）</div>';
      arr.forEach(function (x) { s += render(x); });
      return s + '</div>';
    }

    h.push(block('新增节点', result.added, 'add', function (n) {
      return '<div class="kv-block"><div class="kb-title"><span class="idx">+</span>' + esc(n.stage) + ' / ' + esc(n.name) + '</div>' +
        '<div class="kb-text">角色：' + esc(n.role || '未指定') + '　系统：' + esc(n.system || '未标注') + '</div></div>';
    }));
    h.push(block('删除节点', result.removed, 'del', function (n) {
      return '<div class="kv-block"><div class="kb-title"><span class="idx">-</span>' + esc(n.stage) + ' / ' + esc(n.name) + '</div>' +
        '<div class="kb-text">角色：' + esc(n.role || '未指定') + '</div></div>';
    }));
    h.push(block('修改节点', result.changed, 'mod', function (c) {
      var rows = c.changes.map(function (ch) {
        return '<div style="margin:4px 0;font-size:12px;line-height:1.6">' +
          '<span class="chip" style="margin-right:6px">' + esc(ch.field) + '</span>' +
          '<span style="color:#fca5a5;text-decoration:line-through">' + esc(ch.from || '空') + '</span>' +
          ' <span style="color:#93A4BD">→</span> ' +
          '<span style="color:#6ee7b7">' + esc(ch.to || '空') + '</span></div>';
      }).join('');
      return '<div class="kv-block"><div class="kb-title"><span class="idx">~</span>' + esc(c.node.stage) + ' / ' + esc(c.node.name) + '</div>' + rows + '</div>';
    }));
    if (!result.added.length && !result.removed.length && !result.changed.length) {
      h.push('<div class="prop-group" style="color:#93A4BD">两个版本内容一致。</div>');
    }
    return h.join('');
  };
})();
