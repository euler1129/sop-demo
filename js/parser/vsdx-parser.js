/* Visio(.vsdx) 解析 → {name, shapes, connects}
   与 tools/pregen_samples.py 抽取规则完全一致：
     - Page 与 pageN.xml 的映射必须经过 pages.xml.rels 的 r:id，不能假设同名
     - 子形状的 PinX/PinY 相对父级左下角（Visio Y 轴向上）
     - 连线由 Connect 的 BeginX(源) / EndX(目标) 还原
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

  function textOf(shapeEl) {
    var ts = kids(shapeEl, 'Text');
    if (!ts.length) return '';
    var parts = [];
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) { parts.push(c.nodeValue); }
        else {
          if (c.localName === 'pp') parts.push('\n');
          walk(c);
        }
      }
    })(ts[0]);
    return parts.join('').replace(/\n{2,}/g, '\n').trim();
  }

  function cellsOf(shapeEl) {
    var d = {};
    kids(shapeEl, 'Cell').forEach(function (c) { d[c.getAttribute('N')] = c.getAttribute('V') || '0'; });
    return d;
  }

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  /** 取自定义属性值：Section[Property] → Row[N=name] → Cell[N=Value] */
  function propOf(shapeEl, name) {
    var secs = kids(shapeEl, 'Section');
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].getAttribute('N') !== 'Property') continue;
      var rows = kids(secs[i], 'Row');
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].getAttribute('N') !== name) continue;
        var cs = kids(rows[j], 'Cell');
        for (var k = 0; k < cs.length; k++) {
          if (cs[k].getAttribute('N') === 'Value') return cs[k].getAttribute('V') || '';
        }
      }
    }
    return '';
  }

  parsers.vsdx = {
    accept: /\.(vsdx|vsdm)$/i,
    label: 'Visio 泳道图',

    parse: function (file) {
      return new Promise(function (resolve, reject) {
        JSZip.loadAsync(file).then(function (z) {
          var relsFile = z.file('visio/pages/_rels/pages.xml.rels');
          var pagesFile = z.file('visio/pages/pages.xml');
          if (!pagesFile) { reject(new Error('不是有效的 Visio 文件')); return; }
          return Promise.all([pagesFile.async('string'), relsFile ? relsFile.async('string') : Promise.resolve('')]);
        }).then(function (res) {
          var dp = new DOMParser();
          var plan = [];
          if (res[1]) {
            var relRoot = dp.parseFromString(res[1], 'application/xml').documentElement;
            var rels = {};
            for (var i = 0; i < relRoot.children.length; i++) {
              var r = relRoot.children[i];
              rels[r.getAttribute('Id')] = r.getAttribute('Target');
            }
            var pgRoot = dp.parseFromString(res[0], 'application/xml').documentElement;
            kids(pgRoot, 'Page').forEach(function (pg) {
              var target = null;
              kids(pg, 'Rel').forEach(function (rel) {
                var rid = rel.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
                  || rel.getAttribute('r:id');
                if (!target && rid && rels[rid]) target = rels[rid];
              });
              plan.push({ name: pg.getAttribute('Name') || pg.getAttribute('NameU') || '未命名页', file: 'visio/pages/' + target });
            });
          }
          if (!plan.length) plan = [{ name: file.name, file: 'visio/pages/page1.xml' }];

          var z = null;
          return JSZip.loadAsync(file).then(function (zip) {
            z = zip;
            var jobs = plan.map(function (p) {
              var f = z.file(p.file);
              return f ? f.async('string').then(function (s) { return { name: p.name, xml: s }; }) : Promise.resolve(null);
            });
            return Promise.all(jobs);
          }).then(function (list) {
            var pages = [];
            list.forEach(function (it) {
              if (!it) return;
              var root = dp.parseFromString(it.xml, 'application/xml').documentElement;
              var shapes = [], connects = [];

              /* 两阶段：先建树（局部坐标）→ 自底向上补算 Group 缺失的 Height
                 → 再自顶向下折算绝对坐标。Visio 的 Group 常不写 Height 单元格。 */
              function build(sh, parentId) {
                var c = cellsOf(sh);
                var item = {
                  id: sh.getAttribute('ID'), p: parentId,
                  n: sh.getAttribute('NameU') || '', t: sh.getAttribute('Type') || '',
                  lx: num(c['PinX']), ly: num(c['PinY']), w: num(c['Width']), h: num(c['Height']),
                  txt: textOf(sh), fn: propOf(sh, 'Function'), kids: []
                };
                kids(sh, 'Shapes').forEach(function (sub) {
                  kids(sub, 'Shape').forEach(function (ks) { item.kids.push(build(ks, item.id)); });
                });
                kids(sh, 'Connects').forEach(function (cs) {
                  kids(cs, 'Connect').forEach(function (cn) {
                    connects.push({ f: cn.getAttribute('FromSheet'), fc: cn.getAttribute('FromCell'), t: cn.getAttribute('ToSheet') });
                  });
                });
                return item;
              }

              function fixHeight(item) {
                item.kids.forEach(fixHeight);
                if (!item.h && item.kids.length) {
                  var top = -Infinity, bot = Infinity;
                  item.kids.forEach(function (k) {
                    top = Math.max(top, k.ly + k.h / 2);
                    bot = Math.min(bot, k.ly - k.h / 2);
                  });
                  if (isFinite(top) && isFinite(bot) && top > bot) item.h = top - bot;
                }
              }

              function r4(v) { return Math.round(v * 10000) / 10000; }
              function flatten(item, ox, oy) {
                var ax = ox + item.lx, ay = oy + item.ly;
                shapes.push({
                  id: item.id, p: item.p, n: item.n, t: item.t,
                  x: r4(ax), y: r4(ay), w: r4(item.w), h: r4(item.h), txt: item.txt, fn: item.fn
                });
                var nOx = ax - item.w / 2, nOy = ay - item.h / 2;
                item.kids.forEach(function (k) { flatten(k, nOx, nOy); });
              }

              var tree = [];
              kids(root, 'Shapes').forEach(function (s) {
                kids(s, 'Shape').forEach(function (sh) { tree.push(build(sh, '')); });
              });
              tree.forEach(function (t) { fixHeight(t); flatten(t, 0, 0); });
              kids(root, 'Connects').forEach(function (cs) {
                kids(cs, 'Connect').forEach(function (cn) {
                  connects.push({ f: cn.getAttribute('FromSheet'), fc: cn.getAttribute('FromCell'), t: cn.getAttribute('ToSheet') });
                });
              });
              pages.push({ name: it.name, shapes: shapes, connects: connects });
            });
            if (!pages.length) { reject(new Error('Visio 文件中未找到页面')); return; }
            resolve({ kind: 'vsdx', pages: pages, fileName: file.name });
          });
        }).catch(function (e) { reject(e); });
      });
    }
  };
})();
