# InternSpace Feature Tree

## 核心定义

InternSpace 展示的不是模型组件图，也不是由多个根组成的研究森林。

它是一棵只有一个根的 **Feature 演进树**：

```text
● OLMo-3 标准态
├── ● Feature A
│   ├── ● Feature A1
│   └── ● Feature A2
├── ● Feature B
└── ● Feature C
```

**一个点就是一个 Feature。**

根点固定表示 `OLMo-3 标准态`。每个非根点表示在父 Feature 所代表的模型状态之上，完成的一次研究或工程 Feature。根到某个点的唯一路径，就是得到该点模型状态所需的 Feature 累积顺序。

## 强约束

1. 全树只有一个根：`feat-olmo3-standard`。
2. 根节点没有父节点；每个非根 Feature 恰有一个 `parent_id`。
3. `parent_id` 构成连通、无环的树，所有 Feature 都可从根到达。
4. 主画布上的每个点都必须是 Feature；Python 类、组件、commit、session、论文和实验不能伪装成树节点。
5. 多支系依赖使用 `depends_on`、`related_to` 等辅助引用，不改变主树的单父结构。
6. 辅助关系默认不画在主树上，只在选中 Feature 后显示。
7. OLMo-3 的内部架构、组件变化和实现事实属于 Feature 详情，不在主画布展开成第二套本体。

## Feature 的朴素定义

一个 Feature 是能够独立讲清楚的一次工作单元：

```text
问题/目标
  → 假设或需求
  → 设计与相对父节点的变化
  → 实现（commit / session / code）
  → 验证（实验 / 测试 / artifact）
  → 当前结论
```

并非每个 Feature 都必须已经成功。`proposed`、`implementing`、`validating`、`analyzed`、`abandoned` 都是合法状态，失败分支必须能够保留。

## 最小数据形状

```yaml
id: feat-context-prediction
title: Context prediction
kind: feature
parent_id: feat-olmo3-standard
status: validating

summary: 一句话说明这个 Feature 做了什么
hypothesis: 为什么要做
design: 如何做

delta:
  summary: 相对父 Feature 改变了什么
  operations: []

implementation:
  commits: []
  sessions: []
  code_symbols: []

experiments: []
analysis: null
evidence: []

depends_on: []
related_to: []
provenance: {}
```

第一阶段不追求复杂 change algebra。`delta.operations` 可以是开放的结构化记录，但必须保留 before/after、目标和证据，不能把组件变成主树节点。

## 根 Feature

根 Feature 的固定身份为：

```yaml
id: feat-olmo3-standard
title: OLMo-3 标准态
kind: baseline
parent_id: null
```

根点在画布上只显示为一个点及简短标签。具体 OLMo-3 模型规模、代码仓库、immutable revision、配置、checkpoint 和来源必须放在详情中。

当前尚未指定“OLMo-3 标准态”的精确规模与 revision。第一版允许将这些字段标记为 `unresolved`，但不得伪造来源；正式数据稳定前必须补成 pinned provenance。

## 页面契约

- 首屏就是树，不显示大幅介绍区。
- 根点清晰但保持紧凑，子 Feature 从根向外展开。
- 默认只显示树结构边；辅助依赖、证据和实现关系按需出现。
- 支持展开/收起子树、选中、搜索、适配窗口和缩放。
- 右侧详情栏展示 Feature 的假设、设计、delta、实现、实验、结论和来源。
- 节点颜色只表达少量稳定状态，不为每种关系创造强颜色。
- 大树必须使用确定性布局；更新数据后同一 Feature 不应无故跳位。

## 第一阶段非目标

- 不迁移 LumiaTree 的 v1/v2 canonical architecture IR。
- 不把 ContextLM、Python 类或模型组件作为顶层节点。
- 不实现多根森林或主结构多父 DAG。
- 不接真实飞书、不做无人化长期 session cursor。
- 不在第一版实现完整组件级图重写系统。
- 不复制 `/home/inuyasha/Lumia/LumiaTree` 的代码；需要复用的思想应重新实现为更小的接口。

## M1 完成标准

1. 有一份可验证的 Feature Tree schema。
2. 有且只有一个 OLMo-3 根点。
3. 至少有 6 个示例 Feature，覆盖分叉、失败分支和跨支系辅助依赖。
4. 页面可以从根逐层展开，点击节点查看完整详情。
5. 非 Feature 事实不会出现在主树上。
6. 本地服务、数据校验、单元测试和浏览器 smoke test 可重复运行。

