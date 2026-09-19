/* 冒烟测试（无头）：在 Node 中跑「统一归一化 + BPMN 生成 + 离线诊断」，
   不涉及 DOM，用于快速回归核心链路（前端页面用 playwright 另测）。
   用法：node tools/smoke_test.js
   产物：.out/<id>.bpmn（已被 .gitignore 忽略） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;
global.performance = require('perf_hooks').performance;

const ROOT = path.join(__dirname, '..');
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }

// 仓库对外只保留脱敏样例；内部版另有 samples-data.js（不进公开仓库）
const SAMPLE = fs.existsSync(path.join(ROOT, 'js/samples/samples-data.js'))
  ? 'js/samples/samples-data.js'
  : 'js/samples/samples-data-safe.js';
load(SAMPLE);
load('js/model/process-model.js');
load('js/render/bpmn.js');

const SOP = global.SOP;
const items = window.SOP_SAMPLES.items;
const outDir = path.join(ROOT, '.out');
fs.mkdirSync(outDir, { recursive: true });

let fail = 0;
items.forEach(it => {
  try {
    const a = SOP.model.normalize(it.source, { id: it.id, name: it.name, space: it.space });
    if (!a) { console.log('FAIL(normalize null):', it.id); fail++; return; }
    console.log('--- %s [%s] %s', it.id, it.kind, it.name);
    console.log('    stages=%d lanes=%d nodes=%d edges=%d systems=%d',
      a.stats.stageCount, a.stats.laneCount, a.stats.nodeCount, a.stats.edgeCount, a.systems.length);
    console.log('    stages:', a.stages.map(s => s.name).join(' / '));
    console.log('    lanes :', a.lanes.map(l => l.name).join(' / '));
    console.log('    nodes :', a.nodes.slice(0, 8).map(n => `${n.stage}/${n.name}[${n.role}]`).join(' ; '));

    const xml = SOP.bpmn.toXML(a);
    const f = path.join(outDir, it.id + '.bpmn');
    fs.writeFileSync(f, xml, 'utf8');
    console.log('    bpmn  : %d bytes -> %s', xml.length, path.basename(f));

    // 简易校验
    if (!/<bpmn:process /.test(xml)) { console.log('    !! 缺少 process 节点'); fail++; }
    if (!/<bpmndi:BPMNDiagram/.test(xml)) { console.log('    !! 缺少 DI'); fail++; }
  } catch (e) {
    fail++;
    console.log('FAIL(%s): %s', it.id, e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
});

// 诊断规则
load('js/ai/rules.js');
items.slice(0, 2).forEach(it => {
  const a = SOP.model.normalize(it.source, { id: it.id, name: it.name });
  const r = SOP.ai.rules.diagnose(a);
  console.log('--- 诊断 %s: high=%d mid=%d low=%d', it.id, r.summary.high, r.summary.mid, r.summary.low);
  r.items.slice(0, 4).forEach(x => console.log('    [%s] %s - %s', x.severity, x.title, x.text.slice(0, 60)));
});

console.log(fail ? ('SMOKE_FAIL ' + fail) : 'SMOKE_OK');
process.exit(fail ? 1 : 0);
