# Incremental and progressive stage support

日期：2026-10-02。

更新：2026-10-06，支持决赛注入基线、原始根名、Evolution 前缀及共享三态起点动作。

## 分阶段合同

GitHub 题目拆成三个互不重叠的阶段需求树：

- Stage 1：REQ-1、REQ-2；
- Stage 2：REQ-3、REQ-4；
- Stage 3：REQ-5、REQ-6。

Stage 2/3 优先以前序阶段被平台选中的应用为起点；没有可用应用时从空白模板开始。每轮只执行当前阶段测试。后续阶段 YAML 仍可通过 `dependencies` 引用前序阶段 ID，但这些 ID 不在当前需求树中。

## 控制器语义

1. 根名称中的完整 `Evolution` 分隔段、括号/方括号标签或 `Evolution Requirements for ...` 前缀保存为 `ProductContext.evolution`。主线起点为已有完整应用且没有阶段后缀时，也通过 `loadRequirementCatalog` 的 inheritedApplication 上下文启用增量语义，不要求改写决赛原始根名。末尾 `Stage N`、`Phase N` 或 `第 N 阶段` 仍保存为 `ProductContext.stage`，继承应用不覆盖显式阶段语义；两种标记可并存。原始根名称完整保留，移除标记后做产品分类。
2. 当前树内依赖继续展开为 `AtomicRequirement.dependencyIds`，参与分组排序、依赖门和当前阶段前置需求证据。
3. Evolution 及 Stage 2 以后的当前树外依赖保存为 `externalDependencyIds`：它们是前序增量上下文，不进入本轮覆盖率，不阻塞调度，也不生成独立探针。
4. `installStarterScaffold` 的结果决定 Builder 的起点：已有完整 frontend/backend 为 `inherited_application`；安装通用脚手架为 `blank_template`；其他情况为 `unknown`。
5. 继承应用时 Builder 延续既有栈和接口并增量修改；空模板时只补当前场景所需的最小前序支撑能力。Evolution 与分阶段入口按起点共用 `prompts/system/incremental-start-*.md` 三份动作资产。两种模式标记并存时只发送 Evolution 上下文，包含可选阶段编号；`ProductContext.stage` 中的阶段元数据完整保留，启动日志同步记录起点、外部依赖与阶段编号。
6. Judge 接收外部前置 ID 作为上下文，但不得把它们放进 case.requirementIds，或仅凭 ID 猜测前序合同与断言。
7. 最终汇总、ARC 需求树和 verified 分母都只包含当前 YAML 的原子需求；编号作为标识处理，允许延续前序编号。

## 决赛注入与旧计划

平台将基线直接放入输出目录，适配入口不复制基线。Git 初始化将当前应用文件采纳为本轮接受点，即使有旧 Shallow 历史，也保留暂存、未暂存、新增及删除状态；失败尝试只恢复到本轮接受点。通用脚手架跳过已有应用。

已核对 `data/final` 的实际需求：GitHub 保留初赛根名，共 52 条原子需求、114 个场景；Sheet 使用 `Evolution Requirements for an Online Spreadsheet Data Workspace`，共 10 条原子需求、30 个场景，另引用 4 个树外前置 ID。两份原文均保持不动，产品分类与增量上下文由控制器建立。

当前树中的原始需求以本轮全文为合同：复用正确实现、局部修正变化并复查保留行为；新增需求沿用既有模型和接口完成完整链路。两类均核对当前场景，树外能力仅作前置上下文。首次调用标签是“实现当前工作包”，不表示重建整个产品。

| 需求类型 | Builder 行为 | Judge 行为 |
| --- | --- | --- |
| 当前树中的原始需求 | 对照既有实现，复用正确部分，局部补齐或修改 | 依据本轮全文重新规划并执行 |
| 当前树中的新增需求 | 沿用既有模型、接口和组件，完成完整链路 | 完整规划并执行 |
| 当前树外的前序能力 | 作为必要支撑保留，按当前场景检查 | 仅作前置上下文，不进入当前 verified 分母 |

`shallow-progress/plans` 是产物可见的历史镜像，不带需求版本信息。PlanCache 只读本轮独立日志目录，不导入镜像；当前树全部需求重新规划并执行，本轮内部仍复用有效计划。旧通过结果不能授予本轮 verified，旧镜像继续对 Builder 屏蔽。新生成的同编号计划覆盖对应镜像文件，其他历史文件保留。

主线按决赛信息边界停止测试目录端口发现，忽略 ARCBENCH_TESTS_DIR 和 `/workspace/tests`，使用公共兼容端口 3301（排除已作为评测端口的值）。旧 baseline 的端口发现入口未纳入本次改动。

## 新增工作包的前置检查

Builder 在同一实施计划中按新场景列出实际使用的既有前置：身份与权限、完整对象身份与初态、公开入口链路及接口，并标明检查方式。实施前用相关既有测试或最小公开交互确认现状，缺口随当前工作包局部补齐。

相关测试覆盖准备、初态断言、新行为与全部结果，前置缺口修复保留对应回归。同一源码状态下，实质等价的前置检查可以复用，保留场景对应关系；无法由传统测试确认的入口可达性或异步时序按现有 browser 约定检查，未确认项在回执说明。该指导由 `action-implement.md` 和共享 `self-test.md` 装配到新增工作包，baseline 同步到每次 ROOT 子树任务。

检查范围按当前场景实际依赖确定；控制器实现和验收仍只覆盖当前需求树，外部前置 ID 的调度与判词语义保持原状。

## 与历史指纹复用设计的区别

`docs/superpowers/specs/2026-09-22-evolution-mode-design.md` 描述的是同一需求全集跨运行按指纹跳过已验收需求。当前增量入口的实现和验收范围由本轮 YAML 定义，旧需求 ID 可作为外部前置上下文；既有兼容行为由 Builder 复用和维护。

## 安全退化

- 没有 Evolution 标记且没有继承应用上下文的普通需求，以及普通 Stage 1，仍拒绝未知依赖。
- Evolution 及 Stage 2 以后允许树外依赖；这些依赖只影响上下文，当前树内的依赖与循环校验继续生效。
- 起点无法确定时，Builder 必须先检查项目文件，再选择增量扩展或空模板策略。

## 验证

- `test/catalog.test.ts`：Evolution/阶段识别、产品分类、树外依赖分离与当前树内循环校验；
- `test/scheduler.test.ts`：树外依赖不阻塞且不进入当前阶段审计；
- `test/feature-grouping-pipeline.test.ts`：Pipeline 只实现和验收当前需求树，并传递 Evolution/阶段继承上下文；
- `test/git-ops.test.ts`：旧 Shallow 历史的注入文件采纳与本轮回滚边界；
- `test/plan-cache.test.ts`：历史镜像不会导入新运行私有缓存；
- `test/builder-prompt.test.ts`：普通、Evolution 和分阶段工作包的起点上下文、前置实施计划与自测装配；
- `test/human-log.test.ts`：Evolution、可选阶段编号和起点可观测；
- `test/baseline.test.ts`：baseline 模块保留 ROOT 阶段合同。

2026-10-06 的本地验证：专项回归 79 项通过；`npm run test:all` 的类型检查通过，但并行单元/集成中 Worker completion 测试达到原有 30 秒超时并挂起，已停止该次运行。保持原超时，改用 `npx tsx --test --test-concurrency=1 test/*.test.ts` 完整重跑，716 项中 713 通过、3 项按环境或配置跳过、0 失败；`npm run test:browser` 的 37 项 Chromium 回归全部通过。`git diff --check` 通过。本轮未调用真实模型生成决赛产物或执行官方评测。
