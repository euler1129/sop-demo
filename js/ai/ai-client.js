/* 在线大模型客户端（可选增强，OpenAI 兼容 /chat/completions）
   设计原则：
   - 默认关闭，仅在设置页填入 baseURL / Key / model 后启用
   - 超时与失败一律降级到离线规则引擎，绝不阻塞演示
   - UI 必须真实标注当前模式，不允许把规则输出伪装成 AI 输出 */
(function () {
  var SOP = (window.SOP = window.SOP || {});
  var ai = (SOP.ai = SOP.ai || {});

  var KEY = 'sop_ai_config';

  ai.config = { enabled: false, baseURL: '', apiKey: '', model: 'gpt-4o-mini', timeout: 20000 };

  ai.loadConfig = function () {
    try {
      var s = localStorage.getItem(KEY);
      if (s) {
        var c = JSON.parse(s);
        Object.keys(c).forEach(function (k) { ai.config[k] = c[k]; });
      }
    } catch (e) { /* localStorage 在 file:// 下可能受限，静默降级 */ }
    return ai.config;
  };

  ai.saveConfig = function (c) {
    Object.keys(c).forEach(function (k) { ai.config[k] = c[k]; });
    try { localStorage.setItem(KEY, JSON.stringify(ai.config)); } catch (e) { }
    return ai.config;
  };

  ai.isOnline = function () {
    return !!(ai.config.enabled && ai.config.baseURL && ai.config.apiKey && ai.config.model);
  };

  /** 调用 chat/completions；失败抛错由调用方降级 */
  ai.chat = function (messages, opts) {
    opts = opts || {};
    var url = ai.config.baseURL.replace(/\/$/, '') + '/chat/completions';
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ai.config.timeout || 20000);
    return fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ai.config.apiKey
      },
      body: JSON.stringify({
        model: ai.config.model,
        messages: messages,
        temperature: opts.temperature != null ? opts.temperature : 0.2
      })
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200)); });
      return r.json();
    }).then(function (j) {
      var c = j && j.choices && j.choices[0];
      var txt = (c && c.message && c.message.content) || '';
      return txt;
    }).catch(function (e) {
      clearTimeout(timer);
      throw e;
    });
  };

  /** 提取 JSON（模型常被 ```json 包裹） */
  ai.extractJSON = function (text) {
    var t = String(text || '').trim();
    var m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) t = m[1].trim();
    var s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    return JSON.parse(t);
  };
})();
