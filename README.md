# InternSpace

以 Architecture Proposal Issue 为节点的 OLMo 模型谱系。Issue #13（OLMo-3）是根节点，
`Parent issue` 决定父子关系；PR、W&B、commit 与代码文件在对应模型详情中展示。

原有 11 个 canonical Feature 仍保留为辅助档案和实现证据，但不再进入主画布布局，也不再
与 Issue 节点叠成第二套图。

- 在线站点：<https://inuyashayang.github.io/InternSpace/>
- 项目定义：[Project.md](Project.md)
- Feature 准入：[FEATURE_ADMISSION_POLICY.md](FEATURE_ADMISSION_POLICY.md)
- 结构 Feature 边界：[STRUCTURAL_FEATURE_POLICY.md](STRUCTURAL_FEATURE_POLICY.md)
- 贡献流程：[CONTRIBUTION_WORKFLOW.md](CONTRIBUTION_WORKFLOW.md)

未来的新模型节点采用 GitHub Issue review 驱动：被接受的 Architecture Proposal Issue
在数据库刷新后自动进入静态页面。Feature 文件继续用于维护辅助研究档案。

结构、模型配置、训练配置、数据和运行时变化都可能构成节点。层数、hidden size、heads、
batch、训练 token、GPU、并行和超参变化允许建点，但必须有明确 diff、位置和效果。

## 本地运行

刷新 Issue 模型数据库，并验证辅助 Feature source：

```bash
GH_TOKEN="$(gh auth token)" python3 scripts/build_template_test_database.py --fallback-existing
python3 scripts/build_feature_tree.py --check
python3 scripts/validate_feature_tree.py
```

安装 Web 依赖、运行 Node 测试并启动只读静态服务：

```bash
npm ci --prefix web
npm test --prefix web
npm run serve --prefix web
```

本地入口为 <http://127.0.0.1:4173/web/>。主图数据位于
`data/template-test-data.json`；辅助 Feature 位于 `features/*.json`，并确定性生成
`data/feature-tree.json`。

## 辅助 Feature 与实验档案

loss、W&B run 和训练状态属于实验记录，不属于单个 Feature 点。一个实验可以覆盖多个
Feature。当前主模型画布不渲染这些实验光标；它们作为历史辅助数据继续保留。

- 已完成实验：展示 W&B URL、最终 loss 和其他 final metrics；
- 正在展示的曲线：只能来自已抓取的 W&B loss trace 回放，并标为 `W&B replay`；
- 真正实时日志：未来作为 `cursor_type: live` 接入，必须声明来源；
- 没有 W&B 或结果 artifact 的实验保持 `planned` / `inconclusive`，不补假 loss。

第一版实验索引位于 `data/experiments.json`。它是页面运行数据的一部分，但不会改变
Feature Tree 的结构父子关系。Pages artifact 构建仍会阻止 `demo/mock/simulated`
telemetry 字段写入正式 Feature canonical。

## GitHub Pages 部署

`.github/workflows/pages.yml` 在 `main` merge/push 后自动部署触发 commit：

1. 以 `${{ github.sha }}` checkout 精确 revision，且不持久化 checkout credential；
2. 运行 canonical builder `--check`、schema/semantic validator 与模型测试；
3. 运行 Web Node 单元测试和部署 artifact 合同测试；
4. 构建严格白名单 artifact，并检查 project Pages `/InternSpace/` 与本地 `/web/` 路径；
5. 使用 GitHub 官方 Pages artifact/deploy actions 发布。

发布 artifact 只包含：

```text
.nojekyll
index.html
web/index.html
web/styles.css
web/src/*.js
data/feature-tree.json
data/experiments.json
data/template-test-data.json
data/template-test-overlay.json
```

不会上传 tests、evaluation、ingest、sources、features、schema、私有工作材料、Web 文档、
test-results、package metadata 或 `node_modules`。Workflow 不访问私有
`concept_olmo`，不读取或写入 PAT；build job 只有 `contents: read`，deploy job 只有
`pages: write` 与 `id-token: write`。

本地复现 Pages artifact 检查：

```bash
python3 -m unittest discover -s tests/deploy -p 'test_*.py' -v
python3 scripts/build_pages_artifact.py --output /tmp/internspace-pages
```

仓库 Settings → Pages 的 Source 必须选择 **GitHub Actions**。切换后可手动运行 workflow
或等待下一次 `main` push；无需额外 secret。
