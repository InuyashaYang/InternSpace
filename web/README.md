# Feature Tree 静态浏览器

页面只读加载仓库正式数据 `/data/feature-tree.json`，主画布仅渲染由 `parent_id` 组成的 Feature Tree。`depends_on` 与 `related_to` 只在选中相关 Feature 后显示，不参与布局。

## 视觉与卡片层级

页面使用近黑蓝 `#070b14` / `#0b1120` 背景、38px 低对比网格、64px 玻璃顶栏和深色青蓝卡片。仍然只有一棵从 OLMo-3 根向右生长的确定性 Feature Tree，不包含时间轴、lane、era 或多根森林。

卡片固定为约 224×100px，信息从上到下为：中文标题、英文标题或 Feature ID、category/validation badge、精简 qualified symbol、明确标记为 `SIM` 的演示 telemetry。真实 validation 和 canonical 证据不会被模拟数值覆盖。

Category accent 仅表达真实 `category`：architecture 青、model configuration 紫、training configuration 绿、data 橙、runtime 蓝。Filter chip 只降低对应卡片透明度，不删除节点、结构边或父路径，也不改变坐标。

双语字段采用渐进兼容：节点、详情、关系和搜索结果显示 `title_zh || title`，摘要显示 `summary_zh || summary`；存在不同英文标题时，只在详情标题下方显示低干扰英文副标题。搜索同时匹配中英文标题、摘要和 Feature ID。翻译字段不参与结构排序或布局，旧数据无需中文字段即可继续显示。

空白画布支持鼠标、触控笔和触屏 Pointer Events 拖拽平移。平移只更新统一 viewport transform，不改变 Feature 的确定性布局坐标；节点仍只能点击选择或展开，不能自由拖动。移动超过 6px 才进入 pan，避免 click 与 drag 混淆。`适配` 会重新计算完整可见树视图，`1:1` 固定恢复为 `translate(0 0) scale(1)`，重新加载恢复初始适配视图。

详情默认关闭，点击节点后从右侧滑出；移动端改为底部 overlay。固定顺序为双语标题与 validation/category、摘要、before/after、配置参数、结构化 commit-pinned locator、验证/效果、limitations/provenance。关闭 drawer 后画布恢复完整宽度。

## Telemetry provider

`TelemetryProvider.snapshot(featureIds, tick)` 是 display-only 接口。当前 `DemoTelemetryProvider` 使用 Feature ID、固定 seed 和确定性波形生成 loss、throughput、progress、activity 与 sparkline；不使用 `Math.random()`，也不写入 canonical 数据。所有 UI 数值持续标记 `DEMO`、`模拟` 或 `SIM`。

`StaticArtifactTelemetryProvider` 保留未来静态 artifact 接口。SSE、WebSocket、session 或 Feishu provider 本轮未连接。关闭“模拟实时”后数值隐藏并停止刷新；`prefers-reduced-motion` 下只生成首个确定性 snapshot。

## 本地运行

```bash
cd web
npm install
npm run serve
```

持续运行的本地地址为 <http://127.0.0.1:4173/web/>。服务以仓库根目录作为只读静态根，以便页面访问正式数据文件。

服务同时提供 GitHub Pages 路径 smoke：<http://127.0.0.1:4173/InternSpace/>。页面资源和正式数据 URL 均由当前 base path 推导，可部署在 `/InternSpace/`，也兼容本地 `/web/`。

## 测试

```bash
npm test
npm run test:browser
npm run test:pages
```

Node 测试直接验证正式数据，并覆盖数据契约、11 节点可达性、四主分支/HLM siblings、validation fallback、D08 条件性、结构化 locator、安全 URL、确定性布局、搜索、pan 阈值和 seeded telemetry。Chromium smoke tests 覆盖暗色首屏、drawer、真实/模拟统计分组、category dim、telemetry 开关与 reduced motion、搜索、zoom、Pointer pan、移动端、XSS 和 `/InternSpace/` Pages base path。

仓库独立正式 E2E：

```bash
cd ..
web/node_modules/.bin/playwright test --config tests/e2e/playwright.config.mjs
```

测试 fixture 只用于测试路由，不会被应用 loader 使用；产品页面没有 fallback 数据。
