# Agentic Requirement Compiler：对 ShallowCode 的借鉴分析

日期：2026-09-11。性质：源码调研与设计建议，尚未实施。

## 1. 结论与审阅基线

ARC 最值得借鉴的是把需求变成可核查的工程约束：每个场景有对应验证、共享接口有明确职责、失败能定位到阶段、重试保留仍然有效的资产。ShallowCode 应优先吸收这些约束，继续由 OpenCode 实现应用、独立 Judge 验收。

本次审阅基线：

- 外部仓库：[code-philia/agentic-requirement-compiler][arc]，固定提交 `c52f92d2af6a2d773d31ed4663eef395ae722c46`，浅克隆后读取源码，未安装依赖或运行其代理。
- ShallowCode：`017df63274e9392a7f0c04b146c85868414fd0e2`，调研开始时工作区无变更；现状结论以此代码为准。
- ARC 的 [README][readme] 自述：它是 ARC-Bench 团队维护的内置 ARC 实现，相关论文被 ISSTA 2026 接收。这使其具有直接参考价值；本次未独立核验论文录用信息，也未复现论文实验。仓库实现不是比赛规则文件，不能据此推导官方测试的读取权限。

下文区分三种证据：**源码机制**是控制流实际执行的检查；**提示词约定**是对模型的要求，不等于强制保证；**建议**是针对 ShallowCode 的适配判断。没有实测分数、耗时或 token 收益。

## 2. 两套系统的关键差别

| 维度 | ARC 当前实现 | ShallowCode 当前实现及含义 |
| --- | --- | --- |
| 工作单元 | 队列递归加入节点 DESIGN、子节点任务、节点 IMPLEMENT；非叶节点有专门跳过/设计逻辑 [S1][workflow] [S2][phases] | 依赖就绪的 1–3 个原子需求组成 packet；不宜把树遍历直接替换进依赖调度 |
| 阶段 | InterfaceDesigner 定义接口与小型骨架，TestGenerator 生成测试，TestDrivenDeveloper 实现与修复 [S2][phases] | OpenCode 是唯一应用代码 Builder；Planner 与 Runner 承担独立黑盒验收 |
| 测试可见性 | 开发代理收到生成测试和接口，可修复当前节点内的生成测试与配置；这是其提示词明确授权的工作 [S3][tdd-prompt] | Builder 仅收到白名单观测；隐藏计划与 Planner 推理留在 Judge 侧 |
| 通过依据 | 控制器执行测试、解析退出码，汇总各已调度层的结果；并非只相信 `IMPLEMENTED` 文本 [S2][phases] | ShadowReport 驱动接受决策，接受时核对候选身份并更新 accepted SHA |
| 上下文与记录 | 接口、测试清单、节点会话、阶段队列 [S1][workflow] [S4][context] | 完整需求树、直接依赖合同、Builder 架构笔记、私有事件台账、ARC 投影 |

这里的“接口合同”指某个边界应提供什么行为、由谁实现、供谁使用，例如登录后的会话读取与导航栏状态更新。它不一定意味着新增接口文件。“黑盒验收”指只通过用户可见界面与受控操作检查行为，不读取应用源码。

## 3. 优先借鉴：逐场景覆盖与前置条件

### 3.1 从需求 ID 覆盖推进到场景结果覆盖

**ARC 证据。** [测试层选择说明][test-selection] 要求将每个场景拆成 GIVEN（前置条件）、WHEN（动作）、THEN（结果），用户场景应有 E2E 覆盖，不能用页面渲染冒烟代替，也不能断言前置条件的反面。这属于提示词约定。[`_prepare_tests`][phases] 检查测试清单的类型、路径、重复 ID 等结构；这些检查本身不证明每个场景已经被正确验证。

**本地现状。** [`ProbeCase`](../src/judge/probe-schema.ts) 有 `requirementIds`、`purpose` 和动作，但没有场景关联字段。解析器保证 packet 需求 ID 被覆盖、每 case 有断言；[`LlmProbePlanner`](../src/judge/llm-probe-planner.ts) 已要求正常路径、按证据添加边界、各 case 建立自己的前置条件。剩余问题是：一个“页面可见”的断言仍可能在形式上覆盖包含多个行为的需求。

**最小建议。** 先在 Planner 约定和评审样例中要求逐场景检查 GIVEN/WHEN/THEN；随后再考虑在 Judge 私有计划中加入稳定场景 ID 与结果关联，并验证引用有效、遗漏明确。一个 case 可覆盖多个相关场景，但必须能说明对应结果。覆盖关系只供审计，不把“字段齐全”解释为语义充分。

**例子。** “已有私有仓库，邀请成员后成员可访问”：至少要建立已有仓库和用户前置状态，执行邀请，再切换用户确认访问结果。只看到“邀请成功”不足以证明成员权限生效。

**验收建议。** 使用本项目自有 fixture：故意让界面显示成功、但没有实际状态变更，确认探针失败；删除一个场景的对应验证时能报告遗漏。未表达的权限规则不得由模型补造。

### 3.2 把自然语言 GIVEN 当作应用初始化责任

**ARC 证据。** [接口设计提示词][design-prompt] 与 [实现提示词][tdd-prompt] 均把自然语言描述的已有数据视为实现前提，要求通过正常种子、启动或持久化路径建立，并保留关系、所有权、状态与幂等性。[测试说明][test-selection] 要求验证正常运行路径，而不是自行插入数据库记录或添加隐藏种子端点。这里“幂等”指重复初始化不会复制记录或覆盖用户的正常修改。

**本地现状。** [`seed-data.md`](../prompts/system/seed-data.md) 已传递顶层数据，完整场景也进入 Builder；[`builder-system.md`](../prompts/system/builder-system.md) 已强调状态全链路。因此不需要再建一套种子服务。值得补强的是：数据约定可能只出现在场景文字中，并不只在 YAML 顶层 `data`。

**最小建议。** 在现有种子与实现文案中明确自然语言前置数据的责任；要求正常启动可用、重复启动不重复创建、关系和权限完整。该职责只覆盖当前 packet 所需前置条件，由 OpenCode 决定实现方式。

**验收建议。** 自有 fixture 从空状态启动、重复启动、创建新记录后再次启动，分别检查初始关系存在、无重复、用户修改保留。Judge 通过正常界面验证；若需要受控数据重置，先明确运行合同，不能临时扩展任意 SQL 或网络执行能力。

## 4. 借鉴接口职责与按需上下文，复用已有架构笔记

**ARC 证据。** [接口设计提示词][design-prompt] 要求优先复用当前、父级和依赖接口，保留稳定 ID，记录调用关系。[ContextPipeline][context] 提供已有接口摘要、当前接口合同、源文件/测试文件定位卡及最近失败摘要，并按阶段组织和缓存。[阶段执行器][phases] 将接口与测试关联写入 traceability。

**本地现状。** [`prompt.ts`](../src/builder/prompt.ts) 已传当前完整需求与直接依赖合同；[`action-root-cause-repair.md`](../prompts/system/action-root-cause-repair.md) 已要求读取、按需更新目标项目 `ARCHITECTURE.md`，记录入口、模块、数据和接口约定。这是承接 ARC 经验的现成位置，无需新增设计代理和完整接口数据库。

**建议。** 在现有笔记中优先保留容易跨 packet 出错的事实：认证状态由哪个模块维护、导航栏如何订阅、持久化入口在哪里、共享 API 的输入输出。涉及共享行为的 Builder 在改动前核对代码，在改动后更新过时事实。只有实际运行证明笔记不足以定位时，再考虑增加结构化摘要。

**边界。** Builder 的接口笔记是定位资料，不是验收证据；不得进入 Planner 输入。需求原文、场景与种子数据继续完整提供，不能照搬 ARC 的摘要压缩而丢失约束。控制器也不从源码抽取业务接口来替 Builder 做设计。

**验收建议。** 用连续 packet 检查登录、导航栏身份显示、登出之间是否共享同一会话路径；以运行行为判断，而不是以是否生成笔记文件判断成功。

## 5. 借鉴失败分层与修复定位，保持现有配额

**ARC 证据。** [`_run_tdd_for_node`][phases] 按 Unit → Integration → E2E 运行当前节点已选层，各层有独立 `run_tests` 配额，且控制器限制只能运行当前层登记文件。前一层失败或耗尽后仍可进入下一层，最后汇总失败；不是“前一层通过才允许下一层”。[修复提示词][tdd-prompt] 要求围绕最新错误定位，重复失败时更换假设，沿 UI/API/函数/数据链找共同原因。

**本地现状。** ShallowCode 已有 `ExecutionFault`、`ProbePlannerError` 分类、浏览器重试、三次 Builder 尝试和根因修复提示词。借鉴重点应是失败记录的定位质量，而不是再增加修复阶段。

**建议。** 先从已有 ledger 观察连续失败是否来自同一 case、操作和错误类别。若重复表面修复确实高发，再加入确定性的失败归类摘要，帮助最后一次根因修复识别共同问题；反馈仍通过 [`toBuilderShadowObservation`](../src/builder/shadow-observation.ts)，不带隐藏计划或内部推理。

ARC 的“每层 10 次”不适合直接移植；ShallowCode 的首次实现加两次修复、基础设施独立配额与预算边界继续有效。Builder 自测可以采用先局部逻辑、再联通、最后浏览器的检查顺序，但其测试通过不能更新 `verified`。

## 6. 按阶段恢复：值得做，但排在证据可靠性之后

**ARC 源码机制。** [`workflow.py`][workflow] 中：

- `_recover_interrupted_queue` 将运行中任务转回待处理，按阶段恢复节点状态并记录恢复上下文。
- `_reset_node_from_design_retry` 重置设计及实现、清理设计资产。
- `_reset_node_from_implement_retry` 保留完成的设计，仅重置实现及相关测试通过状态。
- `_reset_node_for_full_retry` 可对已完成节点重新设计，保留已有资产用于增量修改。

这些机制说明“重试应该失效哪些资产”是显式状态设计，而不是简单清空输出。不过，存在队列文件不等于已经证明崩溃恢复的一致性。

**本地现状。** [`RunStateStore`](../src/run-state.ts) 的决策状态位于内存；[`ArcEventSink`](../src/arc-protocol.ts) 可以重放平台投影。现有[观测设计](2026-09-07-observability-arc-projection.md)已明确投影重建不恢复 Builder 会话、剩余预算和调度状态。

**适配建议。** 后续恢复设计至少绑定需求内容摘要、配置/提示词版本、accepted SHA、需求状态、累计尝试、预算消耗和交付阶段。先识别最后一个一致接受点，丢弃或重新验证未接受候选，再恢复可调度工作。恢复不能清零 packet 修复计数；进入交付后不能恢复成开发阶段。

**验收建议。** 在 Git 接受前后、事件落盘前后强制中断，确认恢复后不重复接受、不把未经验证的文件当作基线、不重置配额；需求内容变动或 SHA 不匹配时必须明确处理。此项涉及状态与持久化结构，实施前需独立方案。

## 7. 溯源与回归：借鉴关联方式，补足验收时效性

ARC 的接口—测试关联可帮助解释“这个验证在保护哪个需求”。ShallowCode 更需要保留的是 **需求/场景 → 私有探针 → 被测候选 → 报告 → 接受点**。当前已有候选身份检查、接受 SHA 和事件关联，不应把早期路线图中的“没有候选构建绑定”当作现状；参见[候选构建复用设计](2026-09-08-candidate-build-reuse.md)和 [`pipeline.ts`](../src/pipeline.ts)。

当前主要缺口仍是：packet 的计划在局部变量中使用，接受后没有形成可执行的跨 packet 回归集合；[`FinalVerifier`](../src/final-verifier.ts) 的浏览器检查是根页面 `main` 可见。新 packet 或交付修复可能破坏已接受业务。这里的回归建议延续[现有路线图](2026-09-05-pipeline-improvement-roadmap.md)，不是宣称 ARC 已经实现完整历史回归。

尤其应避免照搬 ARC 的测试汇总粒度：本次所读 `_run_tdd_for_node` 允许运行当前层的文件子集，最后用该层最新退出码为整层测试标记状态；后续层修改代码后，也未在该函数中看到强制重跑之前通过层。**“曾经通过”不代表“最终候选上的全部相关测试通过”。** 这是控制流层面的审阅发现，未运行复现。

建议在前置数据可重复后，再保存 Judge 私有回归计划并对最终候选执行关键行为复验。报告必须准确区分本轮实际执行的 case 与历史结果。隐藏计划的持久化需要先设计私有存储与访问边界；目前观测文档明确不把隐藏计划放入 ARC、失败证据或 Builder 回执，不能为了填满平台 `tests/interfaces` 表而泄漏或虚构记录。

## 8. 暂不照搬的机制

| ARC 做法 | 本地取舍 |
| --- | --- |
| 独立接口设计代理写骨架，再由实现代理补齐 | 当前 OpenCode 可在单次任务内完成局部设计，先加强现有架构笔记和共享职责；增加代理需要额外收益证据 |
| 实现代理修复生成测试 | 可用于 Builder 自测；独立 Judge 仍只允许受约束的 locator 精化，不让 Builder 改验收标准 |
| 非叶节点有图时先做 UI 壳层设计 | 可启发祖先视觉上下文检查；若增加壳层工作单元，需另行定义其验收和依赖语义，不能将目录直接标为业务已验证 |
| 工具层阻止重复读写、设计文件数和单次写入行数上限 [S5][discipline] | 可以借鉴阶段权限显式化；这些启发式可能阻止合理核对，不直接套到 OpenCode。其实现是工具调用校验，也不能视为 OS 隔离 |
| 当前阶段按需选择技能 [S6][selection] | 本地已有 `prompt-fragments.ts`，沿用词典和真实失败触发即可；不增加第二个技能路由器 |
| 源码、接口摘要进入测试生成上下文 | 与本地 Planner 不读源码的边界不兼容，仅能用于 Builder 自测侧 |

## 9. 建议推进顺序与对照验证

| 顺序 | 范围 | 最小落点 | 判断是否值得保留 |
| --- | --- | --- | --- |
| P1 | 场景 GIVEN/WHEN/THEN、自然语言前置数据 | 现有 Planner 约定、Builder 文案与自有 fixture；必要时再扩展私有场景映射 | 能识别表面成功和缺失前置数据，且不凭空增加验收要求 |
| P1 | 共享职责与定位资料 | 现有 `ARCHITECTURE.md` 约定 | 连续 packet 的认证、持久化等共享行为更稳定，提示词没有明显膨胀 |
| P2 | 数据可重复、跨 packet 与交付回归 | 既有路线图中的验证链路 | 最终候选破坏旧功能时被拦截，能区分数据污染与业务回归 |
| P2 | 重复失败摘要 | 已有事件、白名单观测及根因修复阶段 | 同类失败减少无效修复；不增加尝试次数或泄漏计划 |
| P3 | 完整恢复 | 独立状态持久化设计 | 中断后状态与 Git 一致，配额与交付边界不被绕过 |

每项单独做对照，不把多项建议同时落地后笼统归因。固定模型、需求版本、提示词版本、初始数据和预算；记录最终候选上的自有独立验收结果、漏测/误接受、后续回归、修复次数、阶段耗时。真实 usage 获取不到时记为 unavailable，不用日志长度替代 token。先用无凭证故障 fixture 检查控制语义，再用相同条件重复真实模型实验；不能仅凭一次成功断言收益。

本文只建立借鉴清单和实施边界。涉及需求调度、状态恢复、Judge 持久化或验收条件变更的条目，需要在实施前展开相应设计。

## 10. 固定版本来源索引

所有外部源码链接锁定本次提交，便于后续逐项复核；仓库内的提示词和技能文件仅作为调研对象读取。

- S1：[`core/workflow.py`][workflow]，重点 `_build_processing_tasks`、`_recover_interrupted_queue`、`_reset_node_for_retry`。
- S2：[`core/phases.py`][phases]，重点设计分支、`_prepare_tests`、`_run_tdd_for_node`。
- S3：[`test_driven_developer` 提示词][tdd-prompt]、[接口设计提示词][design-prompt]、[测试层选择约定][test-selection]。
- S4：[`ContextPipeline`][context]，重点 `build_agent_context`、`_get_existing_interface_cards`、`get_interface_contract_context`。
- S5：[`StageDisciplineMiddleware`][discipline]，工具级阶段边界及读写限制。
- S6：[`agents/skills/selection.py`][selection]，按阶段、认证上下文和失败信息选择技能。

[arc]: https://github.com/code-philia/agentic-requirement-compiler/tree/c52f92d2af6a2d773d31ed4663eef395ae722c46
[readme]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/README.md
[workflow]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/core/workflow.py
[phases]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/core/phases.py
[tdd-prompt]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/agents/context/prompts/test_driven_developer.py
[design-prompt]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/agents/context/prompts/interface_designer.py
[test-selection]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/skills/leaf-test-layer-selection/SKILL.md
[context]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/agents/context/pipeline.py
[discipline]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/agents/runtime/stage_discipline.py
[selection]: https://github.com/code-philia/agentic-requirement-compiler/blob/c52f92d2af6a2d773d31ed4663eef395ae722c46/src/agents/skills/selection.py
