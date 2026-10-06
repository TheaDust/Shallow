# Incremental and progressive stage support

日期：2026-10-02。

更新：2026-10-06，支持决赛注入基线、原始根名、Evolution 前缀及按历史 ID 和明确修改段筛选实现与可配置验收范围。

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
7. 普通阶段的最终汇总与 verified 分母取当前 YAML；Evolution 可按下述开关排除当前树中的沿用项。ARC 需求树始终保留当前 YAML 全文与层级；编号作为标识处理，允许延续前序编号。

## 决赛注入与旧计划

平台将基线直接放入输出目录，适配入口不复制基线。Git 初始化将当前应用文件采纳为本轮接受点，即使有旧 Shallow 历史，也保留暂存、未暂存、新增及删除状态；失败尝试只恢复到本轮接受点。通用脚手架跳过已有应用。

已核对 `data/final` 的实际需求：GitHub 保留初赛根名，共 52 条原子需求、114 个场景；Sheet 使用 `Evolution Requirements for an Online Spreadsheet Data Workspace`，共 10 条原子需求、30 个场景，另引用 4 个树外前置 ID。两份原文均保持不动，产品分类与增量上下文由控制器建立。

当前树中的原始需求以本轮全文为合同：复用正确实现、局部修正变化并复查保留行为；新增需求沿用既有模型和接口完成完整链路。两类均核对当前场景，树外能力仅作前置上下文。首次调用标签是“实现当前工作包”，不表示重建整个产品。

| 需求类型 | Builder 行为 | Judge 行为 |
| --- | --- | --- |
| 有明确 Original/Modified 段的原始需求 | 完整接收两段及当前场景，局部修改并保留原行为 | 依据本轮全文重新规划并执行 |
| 历史 plan 中出现且没有修改标记的当前需求 | 通过继承应用可运行检查后跳过初次实现 | 缺省跳过独立验收；开关设为 1 时完整回归并按缺口修复 |
| 当前树中的新增需求 | 沿用既有模型、接口和组件，完成完整链路 | 完整规划并执行 |
| 当前树外的前序能力 | 作为必要支撑保留，按当前场景检查 | 仅作前置上下文，不进入当前 verified 分母 |

`shallow-progress/plans` 是产物可见的历史镜像，不带需求版本信息。控制器仅读取历史需求 ID 作初次实现筛选；PlanCache 只读本轮独立日志目录，不导入镜像，Judge 使用当前需求重新规划并执行，本轮内部复用有效计划。旧通过结果不能授予本轮 verified，旧镜像继续对 Builder 屏蔽。新生成的同编号计划覆盖对应镜像文件，其他历史文件保留。

### 初次实现筛选

仅在 Evolution 上下文且起点为 `inherited_application` 时启用。`src/evolution.ts` 在本轮规划开始前扫描历史 `plans/*.json`，从可读的 `cases[].requirementIds` 建立一次性的 ID 集合。文件名、计划中的通过标记和诊断日志均不参与判定。缺失或损坏记录不提供跳过依据。

分类优先级：当前描述有依次出现的完整 `Original Feature Description` / `Modified Feature Description` 段时，作为修改项；其余 ID 不在历史集合时，作为新增或历史记录缺失项；其余当前需求作为沿用项。当前树外的历史 ID 不进入本轮调度或覆盖分母。

沿用项只有在继承应用通过安装、构建、启动与候选一致性检查并保存检查点后，才作为可运行前置采纳并跳过初次 Builder。不能运行的应用恢复全量实现；进程启动或清理执行故障仍按既有止损规则终止。沿用项不会自动变成 `verified`；是否独立验收及计入交付汇总由下述开关决定。

分组只接收待实现视图：穿过沿用项的依赖继续追到待实现项，避免把间接依赖的修改项排到新增项之后。分组校验保持唯一覆盖、依赖序与容量约束；交给 Builder 的工作包恢复原始 Catalog 对象，描述、场景、原始依赖、公共合同及种子数据保留。沿用的直接依赖只传 ID 和名称，其全文与场景不再附带。选择旧功能回归时，需要修复的沿用项仍完整进入对应修复包。

选择旧功能回归时，混合模块在边界验收沿用项，纯沿用模块同样获得边界验收及既有修复配额。因待修改前置尚未完成而暂缓的沿用项，在前置完成后补做整个模块的边界验收，把同模块已有通过需求的完整用例保留在修复保护范围内；前置失败则保持依赖阻塞，不预规划或执行下游探针。最终完整检测所选验收范围，回滚规则保持不变。

此分类依赖当前增量格式明确标注全部修改项，不能识别未标注的同 ID 描述、场景或公共合同变化。它表达开发范围，不证明沿用功能已经正确。两份 `data/final` 均符合该格式；历史 ID 完整时，GitHub 初次实现为 5 条修改＋5 条新增，42 条沿用；Sheet 为 5 条修改＋5 条新增。

`evolution_scope_selected` 事件记录历史记录数、忽略数、分类 ID、实际初次实现 ID、验收及跳过 ID 和可运行检查失败原因。未继承应用、空模板、未知起点及普通阶段任务保持原有调度语义。

### 比赛验收开关

`SHALLOW_EVOLUTION_AUDIT_INHERITED` 控制主线是否验收沿用项：缺省 `0`（也接受 false/no/off），比赛模式只验收新增、历史记录缺失及明确修改项；设为 `1`（true/yes/on）恢复旧功能回归。支持根 `.env`，真实环境优先；非法值直接报错。管线对应选项为 `auditInheritedRequirements`，缺省 false；baseline 不读取此开关。

比赛模式在规划前移除沿用项的独立审计包，因此模块边界、纯沿用模块补审、跨模块回归抽查、修复守卫、最终审计和交付修复后的复验都只涉及增量项。沿用能力仍保留在当前需求的前置证据中，当前场景必须验证实际使用的准备条件与全部结果。安装、构建、启动、健康检查、浏览器 smoke 和 grader-like 启动合同继续执行。

交付汇总的 implemented/verified/failed/inconclusive/blocked/pending 与缺计划 ID 均限于所选验收范围；`auditRequirementIds`、`skippedRequirementIds` 明确列出范围与跳过项。只有范围内全部 verified 且运行合同通过才返回 delivered，跳过项不冒充通过，也不作为待处理项拉低当前范围的交付状态。无新增或修改项时只执行运行合同，功能 verified 为空。

ARC 继续投影完整当前需求树，跳过项不发 test/passed；纯沿用目录不做验收汇总，含跳过子节点的混合目录只汇总实现状态，不宣称整个目录已通过功能验收。历史 ID 缺失时仍完整开发和验收当前树；继承应用无法运行而恢复全量实现时，比赛验收范围仍按已冻结的历史 ID 筛选。

历史记录完整时，两份真实决赛需求的比赛模式均只有 10 条初次开发及独立验收目标：GitHub 排除 42 条沿用项，Sheet 当前树本身即为 5 条修改＋5 条新增。设为 1 时 GitHub 恢复 52 条验收目标，Sheet 仍为 10 条。

主线按决赛信息边界停止测试目录端口发现，忽略 ARCBENCH_TESTS_DIR 和 `/workspace/tests`，使用公共兼容端口 3301（排除已作为评测端口的值）。旧 baseline 的端口发现入口未纳入本次改动。

## 新增工作包的前置检查

Builder 在同一实施计划中按新场景列出实际使用的既有前置：身份与权限、完整对象身份与初态、公开入口链路及接口，并标明检查方式。实施前用相关既有测试或最小公开交互确认现状，缺口随当前工作包局部补齐。

相关测试覆盖准备、初态断言、新行为与全部结果，前置缺口修复保留对应回归。同一源码状态下，实质等价的前置检查可以复用，保留场景对应关系；无法由传统测试确认的入口可达性或异步时序按现有 browser 约定检查，未确认项在回执说明。该指导由 `action-implement.md` 和共享 `self-test.md` 装配到新增工作包，baseline 同步到每次 ROOT 子树任务。

检查范围按当前场景实际依赖确定；控制器实现和验收仍只覆盖当前需求树，外部前置 ID 的调度与判词语义保持原状。

## 与历史指纹复用设计的区别

`docs/superpowers/specs/2026-09-22-evolution-mode-design.md` 描述的是同一需求全集跨运行按指纹跳过已验收需求。当前实现按历史 plan ID 和明确修改段筛选初次开发，不导入旧状态清单、旧通过结果或旧计划；实现范围取待实现视图，验收范围由当前 YAML 和上述开关共同确定。

## 安全退化

- 没有 Evolution 标记且没有继承应用上下文的普通需求，以及普通 Stage 1，仍拒绝未知依赖。
- Evolution 及 Stage 2 以后允许树外依赖；这些依赖只影响上下文，当前树内的依赖与循环校验继续生效。
- 起点无法确定时，Builder 必须先检查项目文件，再选择增量扩展或空模板策略。

## 验证

- `test/catalog.test.ts`：Evolution/阶段识别、产品分类、树外依赖分离与当前树内循环校验；
- `test/scheduler.test.ts`：树外依赖不阻塞且不进入当前阶段审计；
- `test/feature-grouping-pipeline.test.ts`：Pipeline 只实现和验收当前需求树，并传递 Evolution/阶段继承上下文；
- `test/evolution.test.ts` / `test/evolution-pipeline.test.ts`：历史 ID 冻结、损坏记录、明确修改识别、两份真实决赛范围、间接依赖、纯沿用模块、局部修复及回归回滚；
- `test/git-ops.test.ts`：旧 Shallow 历史的注入文件采纳与本轮回滚边界；
- `test/plan-cache.test.ts`：历史镜像不会导入新运行私有缓存；
- `test/builder-prompt.test.ts`：普通、Evolution 和分阶段工作包的起点上下文、前置实施计划与自测装配；
- `test/human-log.test.ts`：Evolution、可选阶段编号和起点可观测；
- `test/baseline.test.ts`：baseline 模块保留 ROOT 阶段合同。

此前注入兼容改动的本地验证（2026-10-06）：专项回归 79 项通过；`npm run test:all` 的类型检查通过，但并行单元/集成中 Worker completion 测试达到原有 30 秒超时并挂起，已停止该次运行。保持原超时，改用 `npx tsx --test --test-concurrency=1 test/*.test.ts` 完整重跑，716 项中 713 通过、3 项按环境或配置跳过、0 失败；`npm run test:browser` 的 37 项 Chromium 回归全部通过。

此前初次实现筛选的本地验证（2026-10-06）：`npm run test:all` 全部通过，包含类型检查、733 项单元/集成（730 通过、3 项按环境或配置跳过、0 失败）和 37 项 Chromium 回归。新增回归确认延后验收的沿用项修复会保护同模块已通过需求的完整用例，发生退化时恢复检查点。当时两份真实决赛需求的离线管线只向初次 Builder 分配 10 条原子需求，Judge 范围分别为 52 和 10 条。

本次比赛验收开关的本地验证（2026-10-06）：`npm run test:all` 全部通过，包含类型检查、743 项单元/集成（740 通过、3 项按环境或配置跳过、0 失败）及 37 项 Chromium 回归。回归覆盖缺省比赛模式、开关恢复全量回归、环境优先级、交付修复后的增量复验、当前需求失败仍为 partial、零增量的运行合同检查、继承应用无法运行时的验收范围及 ARC 不虚构旧通过状态。两份真实决赛需求的比赛模式离线管线均只有 10 条 Planner 目标，GitHub 显式跳过 42 条沿用项；离线测试未生成有效业务探针，不授予业务通过。`git diff --check` 通过。本次未调用真实模型生成决赛产物、执行官方评测或测量实际 token 降幅。
