# SOP 流程资产线上化平台 · 售前演示原型

把散落在各开发人员手中的 **Excel / Visio / Word / PDF 存量 SOP**，一键导入 → 自动生成泳道流程图与标准 BPMN 2.0 → 一键生成 SOP 文档，并用 AI 完成自然语言建模、文档智能解析与合规诊断。

> 本工程是**纯前端静态站点**：零后端、零构建、零运行时依赖。所有第三方库已本地化到 `vendor/`，**没有任何 CDN 外链**，断网可用。

---

## 一、三种运行方式（按推荐顺序）

### 1. 单文件版（推荐给客户 / 销售）

```
dist\SOP流程资产平台-脱敏版.html   ← 双击即开（dist\safe\index.html 为同内容的 ASCII 名，便于分享）
```

- 自包含：样式、脚本、第三方库、内置样例全部内联在一个 HTML 里（约 1.2 MB）
- 断网可用，可直接微信 / 邮件发送，对方无需安装任何东西
- 重新生成：`python tools/build_single_file.py`

### 2. 一键演示.bat

```
一键演示.bat                   ← 双击，自动打开单文件版
```

不依赖 Python / Node / Java，只调用 Windows 自带命令。

### 3. 在线链接（GitHub Pages）

仓库 **Settings → Pages → Source: Deploy from a branch → main / (root)**，一两分钟后拿到：

| 链接 | 内容 |
| --- | --- |
| `https://euler1129.github.io/sop-demo/` | 多文件源码版（二次开发用，按目录加载脚本） |
| `https://euler1129.github.io/sop-demo/dist/` | **单文件版（推荐发给甲方）**，点开即用、零注册、零安装，另存即可离线 |

> 本仓库发布的是**脱敏版**：样例中的客户 / 系统 / 船公司 / 口岸 / 园区一律为代称（客户A、系统A、船公司A…），
> 不含任何真实主体名；发布前可用 `python tools/publish_clean.py` 复核（自检命中数应为 0）。

> 也可自己选择 GitLab Pages / Gitee Pages / 内网 Nginx，本工程是纯静态站，直接扔目录即可。

---

## 二、本地开发与回归

```bash
# 1) 本地起服务看多文件源码版
node tools/serve.js                 # → http://127.0.0.1:5137/index.html

# 2) 无头回归：统一模型 + BPMN 生成 + 离线诊断（产物在 .out/）
node tools/smoke_test.js             # 期望最后一行输出 SMOKE_OK

# 3) 改了源码后重新打包单文件版
python tools/build_single_file.py            # → dist/SOP流程资产平台.html + dist/index.html
python tools/build_single_file.py --safe     # → dist/SOP流程资产平台-脱敏版.html + dist/safe/index.html

# 4) 源 Excel/Visio 变更后重新生成内置样例（需要 openpyxl）
python tools/pregen_samples.py
```

---

## 三、核心能力

| 能力 | 说明 |
| --- | --- |
| 统一流程资产库 | 资产空间 → 流程架构 L1~Ln → 流程清单；版本（草稿 / 待审核 / 已发布） |
| 多源导入 | Excel（字段最全）、Visio 多页泳道图、Word、PDF、自然语言；也可反向解析外部 `.bpmn` |
| 四视图自动出图 | 泳道流程图（自绘 SVG 自动布局）、BPMN 2.0（可导出标准 XML）、价值链图、节点级资产表格 |
| 一键成文 | 由流程图生成 SOP 文档：HTML 预览 → 导出 `.docx` → 打印 PDF |
| AI 三件套 | 自然语言建模、文档智能解析、合规与优化诊断 |
| 版本对比 | JSON 快照 + 节点级 diff（新增 / 删除 / 修改）可视化 |
| 离线优先 | 默认本地规则引擎，可部署在信创内网；在线大模型只是可选增强，UI 会真实标注当前模式 |
| 脱敏开关 | 设置里可开启「演示时启用脱敏」，客户名 / 系统名替换为「客户A / 系统A」等代称 |

### 合规诊断规则（离线规则引擎）

缺失角色、缺失输入 / 输出、缺失承载系统、异常分支无回退、数据契约断链、
主状态断链、分支未闭环、孤立节点、环节缺节点、角色过载、跨系统未标注集成点。

---

## 四、目录结构

```
sop-demo/
├── index.html                  单页应用入口（三栏控制台）
├── 一键演示.bat                 零依赖启动器
├── css/main.css                深蓝科技风主题（CSS 变量设计令牌、打印样式）
├── js/
│   ├── app.js                  应用主控：状态、事件、视图路由、持久化
│   ├── util.js                 下载 / SVG→PNG / Toast
│   ├── model/process-model.js  统一流程资产模型 + normalize()（所有来源共用一个出口）
│   ├── parser/                 xlsx / vsdx / docx / pdf 解析器插件
│   ├── render/                 泳道图 / BPMN / 价值链图 / 资产表格 渲染器插件
│   ├── report/sop-doc.js       SOP 文档生成（HTML + docx + 打印）
│   ├── version/diff.js         版本快照与节点级 diff
│   ├── ai/                     ai-client（OpenAI 兼容）/ rules（离线规则）/ features（三件套）
│   └── samples/                samples-data.js（内置样例，内联 JS 对象，禁止 fetch 本地 JSON）
│                               desensitize-map.js（脱敏映射，由 tools 生成）
├── tools/
│   ├── pregen_samples.py       离线预解析源 Excel/Visio → samples-data.js
│   ├── build_single_file.py    打包为自包含单文件 HTML
│   ├── smoke_test.js           无头回归：归一化 + BPMN + 诊断
│   ├── serve.js                开发用本地静态服务
│   └── desensitize-map.json    脱敏映射表（预解析与运行时共用同一份）
├── skill/sop-flow-assets/      workbuddy skill：抽取 / 脱敏检查 / 组装交付物
├── vendor/                     jszip.min.js、xlsx.full.min.js（全部本地化）
└── dist/                       【交付物】自包含单文件
    ├── SOP流程资产平台.html      内部演示版（真名），双击即开
    ├── SOP流程资产平台-脱敏版.html 【对外发布】数据本身已脱敏
    ├── index.html              内部版 ASCII 名（Pages 链接 <repo>/dist/）
    └── safe/index.html         脱敏版 ASCII 名（Pages 链接 <repo>/dist/safe/）
```

---

## 五、设计约束（后续迭代请勿破坏）

1. **禁止任何 CDN 外链**：离线是硬约束，单文件版必须断网可用。
2. **禁止 `fetch('samples/*.json')`**：`file://` 下会被 CORS 拦死导致白屏，样例必须内联为 JS 对象。
3. **禁止 ES Module `import`**：`file://` 下模块脚本同样被拦，全部使用经典 `<script>`。
4. **内置样例与现场导入必须走同一个 `normalize()`**：保证「样例能跑 ⇒ 真实文件也能跑」，不允许出现两套代码路径。
5. **AI 输出不得伪装**：离线规则引擎的结果必须在 UI 标注为「离线规则引擎」，不得标成「AI 生成」。

---

## 六、数据脱敏

`tools/desensitize-map.json` 定义真实名称 → 代称的映射：

| 真实 | 代称 |
| --- | --- |
| 客户A / 客户A国际海运 | 客户A / 客户A国际海运 |
| 客户B（供应链） | 客户B（供应链） |
| 系统A（口岸平台） | 系统A（口岸平台） |
| 系统B（外网协同） | 系统B（外网协同） |
| 系统C（内网作业） | 系统C（内网作业） |
| 区域海运（系统） | 系统D（区域海运） |
| 系统E（系统） | 系统E（报关） |
| 船公司A | 船公司A |
| 海关 / 园区A / 口岸B / 口岸C / 口岸D | 海关 / 园区A / 口岸B / 口岸C / 口岸D |
| 本集团 / 本集团 / 华南公司 | 本集团 / 华南公司 |

映射**顺序敏感**：长词必须排在前（`客户A国际海运` 在 `客户A` 之前），否则会替换成半截词。

### 两种用法

1. **运行时开关**：设置里勾选「演示时启用脱敏」，页面上的流程名、样例卡、节点字段、状态栏同步替换为代称。
   适合现场临时切换（内部演示看真名，对外演示看代称）。
2. **打包脱敏版**（推荐用于公网）：单独出一个**数据本身就是脱敏的**单文件，
   即使对方「查看源代码」也看不到真实主体：

```bash
python tools/build_single_file.py --safe
#  => dist/SOP流程资产平台-脱敏版.html
#  => dist/safe/index.html        （ASCII 名，GitHub Pages 用 <repo>/dist/safe/）
#  打包时会用映射表左列的 21 个真名对样例数据做漏网检查，命中就报错、不产生产物
```

换客户时的标准动作：改 `tools/desensitize-map.json` → `python tools/pregen_samples.py`
→ `python tools/build_single_file.py --safe`。
可用 `skill/sop-flow-assets/scripts/check_desensitize.py` 先扫一遍源文件，
确认没有漏掉的真实主体（输出分 HARD / SOFT 两级）。

---

## 七、边界说明

本 Demo 是**售前原型**，用于验证「存量 SOP → 结构化资产 → 图 → 引擎流程 → 文档」的链路可行性。
生产版本为 Java / 信创技术栈 + 后端服务 + 流程引擎（BPMN 2.0 XML 可被第三方引擎直接导入），
不在本原型范围内。
