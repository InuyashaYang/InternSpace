# Feature Tree smoke screenshots

浏览器 smoke tests 会在本目录生成并更新正式数据截图，其中 `canvas-panned.png` 展示缩放后拖拽空白画布，Feature 与结构边通过统一 viewport transform 整体平移。

`bilingual-display.png` 使用 Web 测试 fixture 展示中文节点标题、英文详情副标题、中文摘要以及中文父/依赖 Feature 名称。

当前 11 节点正式树截图：

- `root-initial.png`：根与四条结构一级分支，卡片含 validation badge 和短代码定位；
- `formal-all-nodes.png`：11 个正式 Feature 全量展开；
- `d08-conditional.png`：D08 条件性 / 待等价性确认与详情证据；
- `selected-detail-dependency.png`：固定顺序详情与辅助关系；
- `canvas-panned.png`：缩放后 Pointer pan。
