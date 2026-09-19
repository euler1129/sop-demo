/* Excel(.xlsx/.xls/.csv) 解析 → 与预解析脚本一致的 {sheet, rows} 结构
   依赖：vendor/xlsx.full.min.js (SheetJS) */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var parsers = (SOP.parsers = SOP.parsers || {});

  parsers.xlsx = {
    accept: /\.(xlsx|xls|xlsm|csv)$/i,
    label: 'Excel SOP 表格',

    parse: function (file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onerror = function () { reject(new Error('文件读取失败')); };
        fr.onload = function (e) {
          try {
            var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: false });
            var sheets = (wb.SheetNames || []).map(function (nm) {
              var ws = wb.Sheets[nm];
              var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
              var maxCol = 0;
              rows.forEach(function (r) { maxCol = Math.max(maxCol, r.length); });
              rows = rows.map(function (r) {
                var out = [];
                for (var i = 0; i < maxCol; i++) out.push(r[i] == null ? '' : String(r[i]));
                return out;
              });
              while (rows.length && !rows[rows.length - 1].some(function (x) { return String(x).trim(); })) rows.pop();
              return { sheet: nm, rows: rows };
            }).filter(function (s) { return s.rows && s.rows.length > 1; });

            if (!sheets.length) { reject(new Error('未读到有效工作表')); return; }
            resolve({ kind: 'xlsx', sheets: sheets, fileName: file.name });
          } catch (err) {
            reject(err);
          }
        };
        fr.readAsArrayBuffer(file);
      });
    }
  };
})();
