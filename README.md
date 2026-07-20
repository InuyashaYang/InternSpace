# InternSpace

从 `OLMo-3 标准态` 单一根点向外展开的 Feature 演进树。

项目定义见 [Project.md](Project.md)。

未来的新节点采用 Git review 驱动：贡献者提交独立 Feature 文件，CI
验证后由 Pull Request merge 接受，聚合树和静态页面随主分支自动更新。
详见 [CONTRIBUTION_WORKFLOW.md](CONTRIBUTION_WORKFLOW.md)。

结构、模型配置、训练配置、数据和运行时变化都可能构成节点。层数、hidden
size、heads、batch、训练 token、GPU、并行和超参变化允许建点，但必须有
明确 diff、位置和效果。详见
[FEATURE_ADMISSION_POLICY.md](FEATURE_ADMISSION_POLICY.md)；结构子类型另见
[STRUCTURAL_FEATURE_POLICY.md](STRUCTURAL_FEATURE_POLICY.md)。
