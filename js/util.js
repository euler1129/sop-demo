/* 通用工具：下载、格式转换、提示 */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var util = (SOP.util = {});

  /** Blob 下载（file:// 与 http 下均可用） */
  util.downloadBlob = function (blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  };

  util.downloadText = function (text, filename, mime) {
    util.downloadBlob(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), filename);
  };

  /** SVG → PNG（用于导出图片） */
  util.svgToPngBlob = function (svgEl, scale) {
    return new Promise(function (resolve, reject) {
      try {
        scale = scale || 2;
        var clone = svgEl.cloneNode(true);
        var vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/);
        var w = parseInt(svgEl.getAttribute('width'), 10) || (vb[2] ? +vb[2] : 1200);
        var h = parseInt(svgEl.getAttribute('height'), 10) || (vb[3] ? +vb[3] : 800);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);
        var xml = new XMLSerializer().serializeToString(clone);
        var img = new Image();
        var svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        img.onload = function () {
          var cv = document.createElement('canvas');
          cv.width = w * scale; cv.height = h * scale;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('PNG 生成失败')); }, 'image/png');
        };
        img.onerror = function () { reject(new Error('SVG 转换失败')); };
        img.src = svg64;
      } catch (e) { reject(e); }
    });
  };

  util.toast = function (msg, kind, ms) {
    var box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    var d = document.createElement('div');
    d.className = 'toast ' + (kind || 'ok');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(function () {
      d.style.transition = 'opacity .3s ease';
      d.style.opacity = '0';
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 320);
    }, ms || 2600);
  };
})();
