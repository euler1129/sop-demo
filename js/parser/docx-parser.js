/* Word(.docx) 解析 → 文本行（标题识别为环节，列表项识别为节点）
   自行解析 word/document.xml，不引入 mammoth，减少体积与依赖
   依赖：vendor/jszip.min.js */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var parsers = (SOP.parsers = SOP.parsers || {});

  function kids(el, name) {
    var out = [];
    if (!el) return out;
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i].localName === name) out.push(el.children[i]);
    }
    return out;
  }

  function nodeText(el) {
    var s = '';
    (function walk(n) {
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.localName === 't' || c.localName === 'tab' || c.localName === 'br') {
          if (c.localName === 'tab') s += ' ';
          if (c.localName === 'br') s += '\n';
          walk(c);
        } else walk(c);
      }
    })(el);
    return s.replace(/\s+$/, '').replace(/^\s+/, '');
  }

  parsers.docx = {
    accept: /\.docx$/i,
    label: 'Word SOP 文档',

    parse: function (file) {
      return new Promise(function (resolve, reject) {
        JSZip.loadAsync(file).then(function (z) {
          var f = z.file('word/document.xml');
          if (!f) { reject(new Error('不是有效的 Word 文档')); return null; }
          return f.async('string');
        }).then(function (xml) {
          if (!xml) return;
          var dp = new DOMParser();
          var root = dp.parseFromString(xml, 'application/xml').documentElement;
          var body = kids(root, 'body')[0];
          if (!body) { reject(new Error('文档结构异常')); return; }

          var lines = [];
          kids(body, 'tbl').forEach(function (tbl) {          // 表格：每行拼成一行文本
            kids(tbl, 'tr').forEach(function (tr) {
              var cells = [];
              kids(tr, 'tc').forEach(function (tc) { cells.push(nodeText(tc)); });
              var s = cells.filter(function (x) { return x; }).join(' - ');
              if (s) lines.push(s);
            });
          });

          // 段落按文档流顺序处理（表格已单独抽取）
          (function walkBlocks(parent) {
            for (var i = 0; i < parent.children.length; i++) {
              var el = parent.children[i];
              var ln = el.localName;
              if (ln === 'p') {
                var txt = nodeText(el);
                if (!txt) continue;
                var pPr = kids(el, 'pPr')[0];
                var style = '';
                var numPr = null;
                if (pPr) {
                  var ps = kids(pPr, 'pStyle')[0];
                  if (ps) style = ps.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
                    || ps.getAttribute('w:val') || '';
                  numPr = kids(pPr, 'numPr')[0];
                }
                var isHead = /heading|标题|^[1-9]$/i.test(style) || (/^(\d+[.、]|[一二三四五六七八九十]+、)/.test(txt) && txt.length <= 24);
                if (isHead) lines.push('环节：' + txt.replace(/^(\d+[.、]|[一二三四五六七八九十]+、)\s*/, ''));
                else if (numPr) lines.push('- ' + txt);
                else lines.push(txt);
              } else if (ln === 'tbl' || ln === 'sdt') {
                if (ln === 'sdt') walkBlocks(el);
              }
            }
          })(body);

          if (!lines.length) { reject(new Error('Word 文档中未抽取到文本')); return; }
          resolve({ kind: 'text', lines: lines, fileName: file.name, label: file.name });
        }).catch(function (e) { reject(e); });
      });
    }
  };
})();
