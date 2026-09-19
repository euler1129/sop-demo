---
name: sop-flow-assets
description: This skill should be used when converting a client's legacy SOP files (Excel .xlsx, Visio .vsdx, Word .docx, PDF, or plain-text flow descriptions) into structured process assets, and delivering them as swimlane diagrams, standard BPMN 2.0 XML, and generated SOP documents through the "SOP 流程资产线上化平台" front-end. Trigger on requests such as "把这份 SOP 转成流程图", "客户的 Visio/Excel 流程能不能上线", "生成泳道图/BPMN/SOP 文档", "再做一套客户演示页面", "换一批样例数据", or any batch processing of newly received SOP source files.
---

# SOP 流程资产线上化 · SKILL

## 目的

把客户散落在各开发人员手里的存量 SOP（Excel 环节方案表、Visio 多页泳道图、Word/PDF 作业指引），
转成**结构化流程资产**，并产出可交付的三种形态：

1. 泳道流程图（自绘 SVG 自动布局）
2. 标准 BPMN 2.0 XML（可被 Camunda / Flowable / Activiti 等引擎直接导入）
3. SOP 文档（HTML 预览 / `.docx` / 打印 PDF）

最终打包为一个**自包含单文件 HTML**，双击即开、断网可用、微信邮件直发。

## 何时使用

- 收到新的客户 SOP 源文件，需要快速做出可演示的流程图与文档
- 需要给另一个客户复用同一套能力（换一批样例数据即可）
- 需要回归验证平台改造后核心链路（抽取 → 归一化 → 出图 → 出文档）是否仍然正常

## 必须先确认的两件事

动手前**不要跳过**这两步，否则会做出跑不通的页面：

1. **源文件的真实字段结构**：Excel 的列顺序、是否有合并单元格、单元格内是否混排多分支文本；
   Visio 有几个页面、泳道是用什么 Master 画的。用 `scripts/extract_sop.py` 抽取后先看统计输出。
2. **运行环境约束**：交付物必须零环境依赖、全离线。禁止引入 CDN、禁止 ES Module `import`、
   禁止 `fetch()` 本地文件——在 `file://` 下这三者都会被浏览器拦截，直接白屏。

## 工作流程

### Step 1 · 抽取（确定性脚本，不要手写解析代码）

```bash
python scripts/extract_sop.py <客户源文件或目录>... -o raw.json --space "<资产空间>"
```

- `.xlsx` → 每个工作表一个样例项；保持换行与缩进**原样**，不做任何清洗
- `.vsdx` → 每个页面一个样例项；还原形状树绝对坐标、连线、`Function`（业务环节）属性
- `.docx` / `.pdf` / `.txt` → 脚本只提示，交由页面内解析器处理（见 Step 5 说明）

输出是一份 `raw.json`，即"未归一化的来源数据"。**抽取脚本只做抽取，不做归一化**。

### Step 2 · 检查抽取质量

看脚本打印的统计：形状数、连线数、行数、列数、页面/工作表名。
若 Visio 的形状数明显偏少（例如只有几十个），大概率是 OPC 包的页面关系映射没走通，
参见 `references/pitfalls.md` 的「Visio 页面文件映射」一节。

### Step 3 · 归一化（由前端统一完成，不要另写一套）

把 `raw.json` 交给页面里的 `SOP.model.normalize()`。
**禁止**在 Python 侧再实现一遍归一化逻辑——内置样例与现场导入必须走同一个函数，
否则一定会出现"样例能跑、真实文件跑挂"。字段契约见 `references/asset-model.md`。

### Step 4 · 脱敏（对外演示必须做，换客户时改这一张表）

先更新 `references/desensitize-map.json`：把新客户的真实主体名（客户、船公司、口岸码头、内部系统、园区）
换成代称（客户A / 系统A / 船公司A / 口岸B…）。**长的排前面**（`客户A国际海运` 必须在 `客户A` 之前）。

然后用检查器确认没有漏网（这是发布前的最后一道闸，不要跳过）：

```bash
python scripts/check_desensitize.py raw.json     # 或直接用源 .xlsx/.vsdx
```

输出分两级：**HARD** 命中已知实体词典（船公司/知名企业/口岸码头/手机号邮箱）→ 必须处理，exit 1；
**SOFT** 是启发式挑出的疑似专名候选，人工确认后把真实主体补进映射表，再重跑一次直到 HARD 为 0。

确认后 `build_delivery.py` 会同时产出 `samples-data.js`（real，内部演示）与
`samples-data-safe.js`（safe，对外发布）两套样例，页面上的「脱敏」开关切换的正是这两套；
外链（`http://…`）在脱敏时统一替换为 `[链接已脱敏]`。

### Step 5 · 组装交付物

```bash
python scripts/build_delivery.py raw.json --repo <sop-demo 工程路径>
```

该脚本会：写入 `js/samples/samples-data.js` → 调用 `tools/build_single_file.py` 内联打包 →
产出 `dist/SOP流程资产平台.html`（自包含单文件）与 `dist/index.html`（同内容 ASCII 名，给 GitHub Pages 分享用）。

### Step 6 · 回归验证（必须做）

```bash
node <repo>/tools/smoke_test.js     # 期望最后一行 SMOKE_OK
```

再用浏览器打开 `dist/` 下的单文件版，确认：样例能加载、四个视图都能出图、
一键成文能出文档、控制台**零报错**。注意必须覆盖 `file://` 直接打开的路径——
那才是客户真实的打开方式。

## 常见客户问答（交付时一并给出）

- **能接我们自己的引擎吗？** 能，导出的是标准 BPMN 2.0 XML（含 DI 图形信息）。
- **AI 是真的吗？** 默认是离线规则引擎（11 条 SOP 完备性规则），界面会真实标注当前模式；
  接了大模型才会叠加 AI 建议，不把规则输出伪装成 AI。
- **数据安全吗？** 全离线、无外网依赖，可部署在信创内网；对外演示可开启脱敏。
- **交付边界：** 这是售前原型，用于验证链路可行性；生产版为 Java / 信创技术栈 + 后端服务 + 流程引擎。

## 安装

```bash
# 方式一：装成用户级 skill（跟随本机所有工程）
cp -r skill/sop-flow-assets ~/.codebuddy/skills/
# Windows: xcopy /E /I skill\sop-flow-assets "%USERPROFILE%\.codebuddy\skills\sop-flow-assets"

# 方式二：装成工程级 skill（随仓库共享给同事）
cp -r skill/sop-flow-assets <工程>/.codebuddy/skills/
```

打包成可分发 zip：

```bash
python <skill-creator>/scripts/package_skill.py skill/sop-flow-assets
```

## 注意

- `extract_sop.py` 产出的 `raw.json` 含**客户真实信息**，已加入 `.gitignore`，不要提交、不要外发。
  对外材料一律使用脱敏后的 `dist/` 单文件版。
- 每次换客户，先按客户实际情况更新 `references/desensitize-map.json`。

## 参考文件

- `references/asset-model.md` — 统一流程资产模型字段契约与 `normalize()` 分派规则
- `references/pitfalls.md` — 各格式的坑（Visio rels 映射/Group 缺 Height、Excel 合并单元格、PDF CID 字体、`file://` 限制）
- `references/desensitize-map.json` — 脱敏映射表（按客户替换）
