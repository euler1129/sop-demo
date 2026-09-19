/* 资产表格视图：节点级元数据，可直接在表格中补全缺失字段（流程资产治理的入口） */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var render = (SOP.render = SOP.render || {});

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cell(v) {
    var t = String(v == null ? '' : v).trim();
    return t ? esc(t) : '<span class="cell-missing">缺失</span>';
  }

  render.assetTable = function (asset, host, opts) {
    opts = opts || {};
    var cols = [
      { k: 'seq', t: '序号', w: 46 },
      { k: 'stage', t: '业务环节', w: 92 },
      { k: 'name', t: '操作节点', w: 150 },
      { k: 'role', t: '操作角色', w: 110 },
      { k: 'input', t: '输入', w: 130 },
      { k: 'output', t: '输出', w: 130 },
      { k: 'system', t: '涉及系统', w: 100 },
      { k: 'status', t: '主状态', w: 88 },
      { k: 'desc', t: '业务操作说明', w: 260 },
      { k: 'exception', t: '异常与回退', w: 190 },
      { k: 'fee', t: '费用', w: 150 }
    ];

    var h = [];
    h.push('<div class="table-view">');
    h.push('<table><thead><tr>');
    cols.forEach(function (c) { h.push('<th style="min-width:' + c.w + 'px">' + c.t + '</th>'); });
    h.push('</tr></thead><tbody>');
    asset.nodes.forEach(function (n) {
      var missing = [];
      ['role', 'input', 'output', 'system', 'status', 'desc'].forEach(function (k) {
        if (!String(n[k] || '').trim()) missing.push(k);
      });
      h.push('<tr data-id="' + n.id + '" class="' + (missing.length ? 'miss' : '') + '">');
      cols.forEach(function (c) {
        if (c.k === 'desc') {
          var v = (n.variants || []).length
            ? n.variants.map(function (v2) { return '【' + v2.label + '】' + (v2.text || ''); }).join('\n')
            : n.desc;
          h.push('<td>' + cell(v) + '</td>');
        } else {
          h.push('<td>' + cell(n[c.k]) + '</td>');
        }
      });
      h.push('</tr>');
    });
    h.push('</tbody></table></div>');
    host.innerHTML = h.join('');

    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        host.querySelectorAll('tbody tr').forEach(function (x) { x.classList.remove('sel'); });
        tr.classList.add('sel');
        if (opts.onSelect) opts.onSelect(tr.getAttribute('data-id'));
      });
    });
    return {};
  };
})();
