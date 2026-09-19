/* SOP 文档一键生成：HTML 预览 + .docx 导出 + 打印 PDF
   文档结构对齐线下 SOP：封面 / 版本记录 / 环节总览 / 节点明细 / 异常与费用 / 系统清单
   docx 由最小 WordprocessingML + JSZip(STORE) 生成，不引入第三方库 */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var report = (SOP.report = {});

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function dash(v) { var t = String(v == null ? '' : v).trim(); return t ? t : '—'; }
  function nowStr() {
    var d = new Date(), p = function (x) { return x < 10 ? '0' + x : '' + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------------- 数据准备 ---------------- */
  function buildDoc(asset) {
    var sections = [];
    sections.push({ type: 'cover', title: asset.name, sub: asset.space + ' · ' + asset.version, date: nowStr() });
    sections.push({
      type: 'table', title: '一、文档信息与版本记录',
      head: ['项目', '内容'],
      rows: [
        ['流程名称', asset.name],
        ['所属空间', asset.space],
        ['版本 / 状态', asset.version + ' / ' + ({ draft: '草稿', review: '待审核', published: '已发布' }[asset.status] || asset.status)],
        ['数据来源', asset.sourceLabel || asset.sourceKind],
        ['环节数 / 节点数 / 角色数', asset.stats.stageCount + ' / ' + asset.stats.nodeCount + ' / ' + asset.stats.laneCount],
        ['生成时间', nowStr()]
      ]
    });
    sections.push({
      type: 'table', title: '二、业务环节总览',
      head: ['序号', '业务环节', '环节说明', '节点数', '参与角色'],
      rows: asset.stages.map(function (st, i) {
        var ns = asset.nodes.filter(function (n) { return n.stageId === st.id || n.stage === st.name; });
        var roles = [];
        ns.forEach(function (n) { if (roles.indexOf(n.role) < 0) roles.push(n.role); });
        return [String(i + 1), st.name, dash(st.desc), String(ns.length), roles.join('、') || '—'];
      })
    });
    sections.push({
      type: 'table', title: '三、操作节点明细',
      head: ['序号', '业务环节', '操作节点', '操作角色', '输入', '输出', '涉及系统', '主状态'],
      rows: asset.nodes.map(function (n, i) {
        return [String(i + 1), n.stage, n.name, n.role, dash(n.input), dash(n.output), dash(n.system), dash(n.status)];
      })
    });
    sections.push({
      type: 'table', title: '四、业务操作说明',
      head: ['操作节点', '情况', '操作角色', '说明'],
      rows: (function () {
        var out = [];
        asset.nodes.forEach(function (n) {
          if (n.variants && n.variants.length) {
            n.variants.forEach(function (v) {
              out.push([n.name, v.label, dash(v.role), dash(v.text || n.desc)]);
            });
          } else {
            out.push([n.name, '—', n.role, dash(n.desc)]);
          }
        });
        return out;
      })()
    });
    var exc = asset.nodes.filter(function (n) { return n.hasException; });
    sections.push({
      type: 'table', title: '五、异常场景与回退',
      head: ['操作节点', '异常说明'],
      rows: exc.length ? exc.map(function (n) {
        return [n.name, n.variants && n.variants.length
          ? n.variants.map(function (v) { return v.exception; }).filter(Boolean).join('\n')
          : n.exception];
      }) : [['—', '本流程暂无结构化异常说明（建议在系统中补全）']]
    });
    var fee = asset.nodes.filter(function (n) { return n.hasFee; });
    sections.push({
      type: 'table', title: '六、费用与计费点',
      head: ['操作节点', '费用说明'],
      rows: fee.length ? fee.map(function (n) {
        return [n.name, n.variants && n.variants.length
          ? n.variants.map(function (v) { return v.fee; }).filter(Boolean).join('\n')
          : n.fee];
      }) : [['—', '本流程暂无费用说明']]
    });
    sections.push({
      type: 'table', title: '七、涉及系统清单',
      head: ['系统', '关联节点数'],
      rows: asset.systems.length ? asset.systems.map(function (s) {
        var c = asset.nodes.filter(function (n) { return (n.system || '').indexOf(s) >= 0; }).length;
        return [s, String(c)];
      }) : [['—', '未标注（建议补全后再发布）']]
    });
    return sections;
  }
  report.buildDoc = buildDoc;

  /* ---------------- HTML 预览 ---------------- */
  report.toHTML = function (asset) {
    var secs = buildDoc(asset);
    var h = ['<div class="doc-page" id="sop-doc-page">'];
    secs.forEach(function (sec) {
      if (sec.type === 'cover') {
        h.push('<div class="doc-cover"><div class="t">' + esc(sec.title) + '</div><div class="s">标准作业流程（SOP）</div>' +
          '<div class="s">' + esc(sec.sub) + '</div><div class="s">编制日期：' + esc(sec.date) + '</div></div>');
        return;
      }
      h.push('<h2>' + esc(sec.title) + '</h2>');
      h.push('<table><thead><tr>' + sec.head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>');
      sec.rows.forEach(function (r) {
        h.push('<tr>' + r.map(function (c) { return '<td>' + esc(c).replace(/\n/g, '<br/>') + '</td>'; }).join('') + '</tr>');
      });
      h.push('</tbody></table>');
    });
    h.push('</div>');
    return h.join('');
  };

  /* ---------------- WordprocessingML ---------------- */
  var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  function wP(text, o) {
    o = o || {};
    var rpr = '';
    if (o.bold) rpr += '<w:b/>';
    if (o.color) rpr += '<w:color w:val="' + o.color + '"/>';
    if (o.size) rpr += '<w:sz w:val="' + (o.size * 2) + '"/><w:szCs w:val="' + (o.size * 2) + '"/>';
    var jc = o.align ? '<w:jc w:val="' + o.align + '"/>' : '';
    var lines = String(text == null ? '' : text).split('\n');
    return lines.map(function (ln) {
      return '<w:p><w:pPr>' + jc + '</w:pPr><w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') +
        '<w:t xml:space="preserve">' + esc(ln) + '</w:t></w:r></w:p>';
    }).join('');
  }

  function wTable(head, rows) {
    var s = ['<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>',
      '<w:tblBorders>',
      '<w:top w:val="single" w:sz="4" w:color="9BB0CC"/><w:left w:val="single" w:sz="4" w:color="9BB0CC"/>',
      '<w:bottom w:val="single" w:sz="4" w:color="9BB0CC"/><w:right w:val="single" w:sz="4" w:color="9BB0CC"/>',
      '<w:insideH w:val="single" w:sz="4" w:color="C9D6E4"/><w:insideV w:val="single" w:sz="4" w:color="C9D6E4"/>',
      '</w:tblBorders></w:tblPr>'];
    s.push('<w:tr>');
    head.forEach(function (c) {
      s.push('<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:shd w:fill="EEF3FA"/></w:tcPr>' + wP(c, { bold: true, size: 10 }) + '</w:tc>');
    });
    s.push('</w:tr>');
    rows.forEach(function (r) {
      s.push('<w:tr>');
      r.forEach(function (c) {
        s.push('<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + wP(c, { size: 9 }) + '</w:tc>');
      });
      s.push('</w:tr>');
    });
    s.push('</w:tbl>');
    s.push(wP(''));
    return s.join('');
  }

  function buildDocumentXML(asset) {
    var secs = buildDoc(asset);
    var body = [];
    secs.forEach(function (sec) {
      if (sec.type === 'cover') {
        body.push(wP(sec.title, { bold: true, size: 22, align: 'center', color: '0A3D91' }));
        body.push(wP('标准作业流程（SOP）', { size: 12, align: 'center', color: '666666' }));
        body.push(wP(sec.sub, { size: 11, align: 'center', color: '666666' }));
        body.push(wP('编制日期：' + sec.date, { size: 11, align: 'center', color: '666666' }));
        body.push(wP(''));
        return;
      }
      body.push(wP(sec.title, { bold: true, size: 14, color: '0A3D91' }));
      body.push(wTable(sec.head, sec.rows));
    });
    // A4 横向
    var sectPr = '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' + W + '><w:body>' + body.join('') + sectPr + '</w:body></w:document>';
  }

  report.toDocxBlob = function (asset) {
    var zip = new JSZip();
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>');
    zip.file('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>');
    zip.file('word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');
    zip.file('word/styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles ' + W + '><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="21"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
    zip.file('word/document.xml', buildDocumentXML(asset));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'STORE' });
  };

  report.downloadDocx = function (asset) {
    return report.toDocxBlob(asset).then(function (blob) {
      SOP.util.downloadBlob(blob, asset.name + '-SOP-' + asset.version + '.docx');
      return blob;
    });
  };

  /* ---------------- 打印 PDF ---------------- */
  report.printDoc = function (asset) {
    var host = document.getElementById('print-root');
    if (!host) { host = document.createElement('div'); host.id = 'print-root'; document.body.appendChild(host); }
    host.className = 'view-pane printing doc-preview';
    host.innerHTML = report.toHTML(asset);
    setTimeout(function () { window.print(); }, 120);
  };
})();
