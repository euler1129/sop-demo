/* PDF 存量 SOP 解析（尽力而为）
   说明：PDF 中文常使用 CID 内嵌字体 + ToUnicode 映射，纯前端无字库时无法可靠还原。
   本解析器处理 FlateDecode 流中的字面量字符串（Tj / TJ）；若抽取不到可读文本，
   会明确抛出提示，引导改用 Word/Excel 源，绝不伪造内容。
*/
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var parsers = (SOP.parsers = SOP.parsers || {});

  function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var ds = new DecompressionStream('deflate');
      var stream = new Blob([u8]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); })
        .catch(function () {
          // 部分实现要求带 zlib 头
          try {
            var ds2 = new DecompressionStream('deflate');
            var s2 = new Blob([u8]).stream().pipeThrough(ds2);
            return new Response(s2).arrayBuffer().then(function (b2) { return new Uint8Array(b2); }).catch(function () { return null; });
          } catch (e) { return null; }
        });
    } catch (e) { return Promise.resolve(null); }
  }

  function decodeLiteral(s) {
    var out = '', i = 0;
    while (i < s.length) {
      var ch = s[i];
      if (ch === '\\') {
        var nx = s[i + 1];
        if (nx === 'n') out += '\n';
        else if (nx === 'r') out += '\r';
        else if (nx === 't') out += '\t';
        else if (/[0-7]/.test(nx || '')) {
          var oct = s.substr(i + 1, 3);
          out += String.fromCharCode(parseInt(oct, 8));
          i += 3;
        } else out += nx || '';
        i += 2;
      } else { out += ch; i += 1; }
    }
    return out;
  }

  parsers.pdf = {
    accept: /\.pdf$/i,
    label: 'PDF SOP 文档',

    parse: function (file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onerror = function () { reject(new Error('文件读取失败')); };
        fr.onload = function (e) {
          var buf = new Uint8Array(e.target.result);
          var latin = '';
          for (var i = 0; i < buf.length; i++) latin += String.fromCharCode(buf[i]);

          var jobs = [];
          var re = /stream\r?\n?/g, m;
          while ((m = re.exec(latin)) !== null) {
            var start = m.index + m[0].length;
            var end = latin.indexOf('endstream', start);
            if (end < 0) continue;
            var raw = buf.subarray(start, end);
            if (raw.length < 8) continue;
            jobs.push(inflateRaw(raw));
          }
          Promise.all(jobs).then(function (chunks) {
            var text = chunks.filter(Boolean).map(function (u8) {
              var s = '';
              for (var k = 0; k < u8.length; k++) s += String.fromCharCode(u8[k]);
              return s;
            }).join('\n');

            var lines = [];
            var reTj = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g, mm;
            while ((mm = reTj.exec(text)) !== null) {
              var t = decodeLiteral(mm[1]).trim();
              if (t) lines.push(t);
            }
            var reTJ = /\[([\s\S]{0,4000}?)\]\s*TJ/g;
            while ((mm = reTJ.exec(text)) !== null) {
              var inner = mm[1], buf2 = '', rm;
              var rsub = /\(((?:[^()\\]|\\.)*)\)/g;
              while ((rm = rsub.exec(inner)) !== null) buf2 += decodeLiteral(rm[1]);
              var t2 = buf2.trim();
              if (t2) lines.push(t2);
            }
            lines = lines.filter(function (x) { return x.length > 0; });
            if (lines.length < 3) {
              reject(new Error('PDF 未能抽取到可读文本（多为内嵌 CID 字体）。建议改用 Word / Excel 版本的 SOP，或用「自然语言建模」直接描述流程。'));
              return;
            }
            resolve({ kind: 'text', lines: lines, fileName: file.name, label: file.name });
          });
        };
        fr.readAsArrayBuffer(file);
      });
    }
  };
})();
