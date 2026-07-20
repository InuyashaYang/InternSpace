# Feature Tree 静态浏览器

页面只读加载仓库正式数据 `/data/feature-tree.json`，主画布仅渲染由 `parent_id` 组成的 Feature Tree。`depends_on` 与 `related_to` 只在选中相关 Feature 后显示，不参与布局。

双语字段采用渐进兼容：节点、详情、关系和搜索结果显示 `title_zh || title`，摘要显示 `summary_zh || summary`；存在不同英文标题时，只在详情标题下方显示低干扰英文副标题。搜索同时匹配中英文标题、摘要和 Feature ID。翻译字段不参与结构排序或布局，旧数据无需中文字段即可继续显示。

空白画布支持鼠标、触控笔和触屏 Pointer Events 拖拽平移。平移只更新统一 viewport transform，不改变 Feature 的确定性布局坐标；节点仍只能点击选择或展开，不能自由拖动。移动超过 6px 才进入 pan，避免 click 与 drag 混淆。`适配` 会重新计算完整可见树视图，`1:1` 固定恢复为 `translate(0 0) scale(1)`，重新加载恢复初始适配视图。

## 本地运行

```bash
cd web
npm install
npm run serve
```

持续运行的本地地址为 <http://127.0.0.1:4173/web/>。服务以仓库根目录作为只读静态根，以便页面访问正式数据文件。

## 测试

```bash
npm test
npm run test:browser
```

Node 测试直接验证正式 IS-S01 数据，并覆盖数据契约、单根/环校验、确定性布局、折叠可见性、搜索路径和 pan 阈值。浏览器 smoke tests 直接消费正式数据，覆盖根初始态、两级展开、失败分支、选中详情、辅助依赖、搜索、缩放、Pointer Events 平移、布局与边不变、节点 click、视图重置、移动端页面滚动隔离，以及正式数据缺失时的明确错误。

测试 fixture 只用于测试路由，不会被应用 loader 使用；产品页面没有 fallback 数据。
