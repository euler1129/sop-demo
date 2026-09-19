# 统一流程资产模型（字段契约）

**这是多模块共享契约，改动必须同步所有消费方。**
所有来源（Excel / Visio / 外部 .bpmn / 自然语言文本）都必须经 `SOP.model.normalize(raw, meta)`
归一化为同一份 `ProcessAsset`，渲染器 / 文档生成器 / 诊断 / diff 只认这一份结构。

## 分派规则（常见 bug 来源）

`normalize()` 按 raw 的**字段存在性**分派，不是按文件类型：

| raw 上的字段 | 走哪个解析器 | 典型来源 |
| --- | --- | --- |
| `rows` | `fromExcelSheet()` | `.xlsx` 单表 |
| `shapes` | `fromVisioPage()` | `.vsdx` 单页、外部 `.bpmn` 反向解析后的图形 |
| `lines`（字符串或数组） | `fromParagraphs()` | Word / PDF / 自然语言 |

Excel 的 raw 是 `{ sheet, rows }`，Visio 的 raw 是 `{ name, shapes, connects }`；
一个文件有多个工作表/页面时，**每个工作表/页面各算一个样例项**。

## ProcessNode

```js
{
  id, seq,                 // 稳定 id 与序号（BPMN 与 diff 都依赖 id 稳定）
  stage, stageId,          // 业务环节（泳道图的列）
  name, desc, stageDesc,   // 操作节点名 / 业务操作说明 / 业务环节说明
  role, roles: [],         // 操作角色（泳道图的行）；roles 支持一个节点多角色
  input, output,           // 输入 / 输出（数据契约，诊断用它查断链）
  system,                  // 涉及系统 —— 节点着色的依据
  status,                  // 主状态（待处理 / 已打单 / 已派车…）
  variants: [],            // 从「情况N」拆出的分支：{label, text, role, input, output, system, status, exception, fee}
  exception,               // 异常分支与处理说明
  fee,                     // 产生费用说明
  note,                    // 原样兜底文本（无法结构化的内容进这里，不要丢）
  x, y                     // 原始坐标（Visio 用；Excel/文本为空）
}
```

## ProcessAsset

```js
{
  id, name, space, desc, version, status,     // status: 草稿 / 待审核 / 已发布
  sourceKind, sourceLabel,                    // 来源标注（状态栏显示"当前数据源"）
  stages: [{id, name, desc, order, x0, x1}],  // 环节（列）
  lanes:  [{id, name}],                       // 角色泳道（行）
  nodes:  [ProcessNode],
  edges:  [{id, from, to, label, type}],      // from/to 必须是 nodes 里的 id
  systems: [],                                // 去重后的系统清单
  stats:  {stageCount, laneCount, nodeCount, edgeCount},
  versions: []
}
```

## 硬性约束

1. **`edges.from/to` 必须指向真实存在的节点 id。**
   Visio 连线用的是 Shape ID，节点在归一化时被重编号为 `n_i`，
   所以必须维护 `形状ID → 节点ID` 的映射（并向上回溯到最近的节点祖先：
   连线端点常常落在子形状上，而不是 Group 上）。漏了这一步 `edges` 会全空。
2. **Group + 子形状只能算一个节点**：以"最上层带文本的形状"为代表，后代不再单独计数。
3. **字段缺失不要抛异常**：统一填空字符串，把原始内容塞进 `note`，
   让诊断规则（缺失角色 / 缺失输入输出 / 缺失系统…）去报告，而不是让页面崩掉。
4. **`seed` 决定图上顺序**：按「环节顺序 → 纵向位置」排序，保证出图顺序与人工阅读顺序一致。

## 离线诊断的 11 条规则

缺失角色、缺失输入 / 输出、缺失承载系统、异常分支无回退、数据契约断链、主状态断链、
分支未闭环、孤立节点、环节缺节点、角色过载、跨系统未标注集成点。

诊断结果必须标注 `engine: 'offline'`，UI 显示为「离线规则引擎」——
**不允许把规则输出标注成 AI 生成。**
