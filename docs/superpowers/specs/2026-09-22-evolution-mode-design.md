# Evolution 模式设计（已有代码库增量开发）

日期：2026-09-22。状态：已与用户确认设计，待实现。

参考：`tmp/octos-arc/arc/main.py`（evolution 判定、`unchanged_node_ids`、`regression_cycle`、`already_passing_nodes`）、`docs/2026-09-15-feature-slices-and-builder-loop.md` §3.5（"evolution 先检查已有实现"）。

确认记录：增量依据＝自携带状态清单；回归失败＝就地修复；指纹＝节点本地字段；范围＝仅主线；同 ID 未 verified＝重做。

## 目标

当输出目录已含上一轮交付的应用（`frontend/` + `backend/`）时，管线进入 evolution 模式，按需求编号做增量开发：

1. 与上一轮相比内容未变、且上一轮独立验收 `verified` 的原子需求：跳过实现，只在本轮模块边界与最终全量验收中做回归复验；
2. 新增 ID、同 ID 内容变化、以及同 ID 未 verified 的需求：正常实现（Builder 收到"已有应用"上下文）；
3. 被移除的 ID：不实现、不删除既有行为，仅进观测；
4. 回归失败的 carried-over 需求并入所属模块的就地修复配额。

无清单时退化为"全部按待实现"，但 Builder 仍收到已有应用上下文。

## 非目标

- baseline 入口不新增 evolution 语义（`GitCliOps` 已有的模板接受能力不变）；
- 不解析 `progress.log`、不读 `.arc/traceability`：`shallow-progress/evolution-state.json` 是唯一增量依据；
- 不做全量黑盒探测识别（octos-arc 的 `already_passing_nodes`）；
- 不丢弃/迁移模板（octos-arc 的 `discard_template`）；Builder 有完整文件工具，可自行判断重建；
- 不做应用树 digest 校验（逐需求指纹比对已覆盖内容变化）；
- 不新增"重实现"路径：未 verified 的同 ID 需求走常规 implement，回归失败走常规 repair。

## 术语

- **carried-over**：内容未变且上一轮 verified 的原子需求，本轮跳过实现；
- **清单**：`shallow-progress/evolution-state.json`；
- **增量**：`carriedOver` / `changed` / `added` / `unverified` / `removed` 分类结果。

## 清单（evolution-state.json）

路径：`<outputDir>/shallow-progress/evolution-state.json`。

```json
{
  "version": 1,
  "generatedAt": "2026-09-22T12:00:00.000Z",
  "acceptedSha": "<本轮接受 SHA>",
  "requirements": {
    "REQ-1": { "name": "计数器核心", "fingerprint": "9f2c1d4e5a6b7c8d", "status": "verified" }
  }
}
```

- 每个原子需求一条；`fingerprint` 为 sha256 前 16 hex；`status` 取本轮最终 `RequirementStatus`。
- **写入时机**：管线正常走完（`delivered`/`partial`/`failed` 三种汇总状态）时写，且无论本轮是否 evolution 都写——使下一次在同一目录运行可增量。异常退出（catch 路径）不写：宁可下轮重做，也不携带半成品状态。
- 写失败按 best-effort 忽略（与 `ProgressJournal.appendLine` 一致）；不新增事件。
- 该文件天然满足既有约束：位于 `shallow-progress/` → 随交付包回传、不进 git 历史（`captureAccepted` 排除）、回滚保留、Builder 屏蔽、`GitCliOps` 残留清理保留。
- 本地复用同一 `--output-dir` 时同样生效；平台模板若不含该文件则视为无清单。

## 指纹

对原始需求树节点（`RequirementNode`）取字段：

```
id, name, description, scenarios（id/name/steps.keyword/steps.content 原样）,
dependencies（原文，不展开祖先）, visual_reference
```

按固定键序序列化为紧凑 JSON，sha256 取前 16 hex。祖先/文件夹描述变化不触发重算（与 octos-arc 一致，改动可控）。

## 分类

`classifyEvolution(catalog, previous: EvolutionState | undefined)` 逐原子需求：

| 条件 | 分类 | 处理 |
|---|---|---|
| 上一轮无该 ID | added | 实现 |
| 指纹不同 | changed | 实现（提示词列出，要求在既有实现上更新） |
| 指纹相同且 `status === "verified"` | carriedOver | 跳过实现，进回归复验 |
| 指纹相同但非 verified（blocked/failed/inconclusive/todo） | unverified | 实现 |
| 上一轮有、本轮无 | removed | 仅事件/日志，不告知 Builder |

待实现集合 = added ∪ changed ∪ unverified。

## 调度（src/scheduler.ts）

`featureGroupPackets(catalog, thresholds = DEFAULT_FEATURE_GROUP_THRESHOLDS, prescheduled: ReadonlySet<string> = ∅)`：

- prescheduled（carried-over）不进入任何功能组，但视为"已调度"，满足待实现项的依赖；
- 分组、阈值、依赖亲和与覆盖校验只针对待实现项；`GroupingStats.requirements` 为待实现条数；
- 校验规则：每条待实现依赖必须 prescheduled、或在更早的包、或同包更早位置。

## 管线集成（src/pipeline.ts）

1. 开头（`storeRequirementTree` 覆盖 `.arc` 之前）：`isDeliveredApplication(outputDir)` 判定模板；有模板则 `readEvolutionState` 并分类。
2. `implemented` 预置为 carried-over 集合；`buildBuilderProjectContext` 的 satisfiedDependencies、文件夹汇总、审计 eligibility 随之生效。
3. 发 `evolution_detected` 事件；carried-over 逐条发 ARC `design running/completed` 与 `implement running/completed`；test 状态仍只由本轮探针经 `publish()` 决定——上一轮 verified 绝不直接当本轮 verdict。
4. 审计包映射：由审计包集合建立 `requirementId → auditPacketId`；按模块（`folderPath[1] ?? id`）聚合 carried-over 的审计包 ID。
5. 模块边界：
   - 实现循环进入某模块时，把该模块 carried-over 审计包并入 `pendingModuleAudit`（与实现包的审计包同批）→ 同模块回归在边界一并复验、失败进就地修复；
   - 每次调用 `runModuleBoundaryAudit` 时把其 `moduleId` 记入已审计模块集合；循环结束并完成既有"最后模块"边界审计后，对含 carried-over 但从未审计过的模块（纯 carried-over 模块，按声明序）补跑 `runModuleBoundaryAudit` → 覆盖跨模块回归并给予修复配额；
   - 修复语义复用现有规则：先复查本模块已通过路径，失去 pass/无法复验/无修复目标 → 恢复检查点并停止。
6. 最终全量验收（只检测）照常覆盖全部 implemented（含 carried-over），`publish()` 统一发布状态。
7. 结尾写清单（全部原子需求，含最终状态）。

## 模块与文件改动

新增 `src/evolution.ts`：

- `isDeliveredApplication(root)`：`frontend/` + `backend/` 同为目录。`src/git-ops.ts` 删除本地实现并改为 import，保持单一判断来源。
- `requirementFingerprint(node)`：节点本地指纹。
- `readEvolutionState(outputDir)` / `writeEvolutionState(outputDir, state)`：清单读写；路径基于 `PROGRESS_DIR_NAME`。
- `classifyEvolution(catalog, previous)`：五类分类。
- `listApplicationSources(outputDir, limit = 60)`：源码清单。

修改：`src/types.ts`（事件与 `EvolutionState`/`EvolutionDelta` 类型）、`src/human-log.ts`（新事件文案）、`src/pipeline.ts`（集成）、`src/scheduler.ts`（prescheduled）、`src/judge/plan-cache.ts`（mirror 回退）、`src/builder/prompt.ts` + `src/builder/prompt-input.ts`（evolution 上下文）、`prompts/system/evolution-context.md`（新资产）、`AGENTS.md`（索引与契约同步）。

## 计划缓存复用（src/judge/plan-cache.ts）

`read()` 先读本轮 run 目录，再回退 mirror（`shallow-progress/plans/`）。carried-over 计划大多直接复用上轮成果，避免 N 次 Planner 调用；`parseProbePlan` 按当前包内容重新校验，旧计划不匹配即作废并重新规划。本轮新生成的计划仍优先于 mirror。

## Builder 提示词

新资产 `prompts/system/evolution-context.md`，由 `projectContextSection` 在 `BuilderProjectContext.evolution` 存在时拼装（implement/repair/root_cause_repair 都带）：

- 沿用既有技术栈、目录结构、数据与接口；不得推倒重写或删除既有功能；
- 现有源码清单（不含依赖与构建产物）：`{{SOURCE_LISTING}}`；
- 已通过独立验收、本轮不再实现的需求（不得回归）：`{{CARRIED_OVER}}`；
- 与上一轮相比内容有变化的需求（在既有实现上更新）：`{{CHANGED}}`；
- 动手前先读 ARCHITECTURE.md 与相关源码；本包待实现需求可能已有部分实现，先核对再补齐。

配套改动：

- `BuilderProjectContext.evolution?: { sourceListing: string; carriedOver: {id,name}[]; changed: {id,name}[] }`；空列表渲染"无"。
- 源码清单：`frontend/` + `backend/` 递归、排除 `node_modules/dist/build/.next/.git/.arc/shallow-progress`，按路径排序，最多 60 条（超出以 `...` 收尾），带字节数。
- 管线在分类后计算一次并复用（repair 调用同样携带）。

## 观测

新事件 `evolution_detected`：

```ts
{ source: "state" | "none"; carriedOverRequirementIds: string[]; changedRequirementIds: string[];
  addedRequirementIds: string[]; unverifiedRequirementIds: string[]; removedRequirementIds: string[] }
```

- `human-log.ts` 中文行：`检测到已有应用（增量开发）：<沿用上一轮状态清单|无上一轮状态清单>；跳过 N 条已验收需求（前 10 个 ID，超出以"等 N 条"）；重做 M 条（变更 a、未验收 b、新增 c）；移除 R 条`。
- 仅模板在场时发；无模板（全新项目）不发，行为与现状一致。

## 失败与边界语义

- carried-over 回归失败：模块边界审计判 `failed` → 就地修复（与同模块新实现共享 2 轮配额）；修复被拒即恢复检查点，状态如实发布。
- 无清单 / 全部新增：`carriedOver=∅`，全部实现 + evolution 上下文。
- 移除需求：不进提示词，避免 Builder 删除仍被其他需求依赖的行为。
- 预算：实现量下降、审计量不变；沿用现有阶段预留与结转规则，无新预算逻辑。
- 崩溃不写清单；下轮读到旧清单时按指纹逐条比对，误判由本轮独立探针与就地修复纠正。

## 测试

- `test/evolution.test.ts`（新）：指纹稳定性（键序/空白无关、内容变化敏感、祖先描述变化不敏感）、五类分类、清单读写往返、损坏/缺失清单 → 无、源码清单排除项与 60 条截断。
- `test/scheduler.test.ts`：prescheduled 不进入包、满足依赖、覆盖与依赖序校验、stats 口径。
- `test/plan-cache.test.ts`：mirror 回退命中、本轮计划优先、校验失败回退重新规划。
- `test/pipeline.e2e.test.ts`：
  - 预置模板 + 清单的增量场景：FakeBuilder 只收到待实现包；carried-over 无 Builder 调用但经探针 verified；纯 carried-over 模块产生边界审计；清单回写含最终状态；
  - carried-over 回归失败 → 就地修复保留/回滚两分支；
  - 无模板场景现有用例全部不变。
- `test/builder-prompt.test.ts` / `test/prompt-assets.test.ts`：evolution 段渲染、占位符齐全、空列表"无"。
- `test/human-log.test.ts`：`evolution_detected` 文案与截断。
- 文档同步：AGENTS.md 模块索引加 `src/evolution.ts`、运行契约补 evolution 语义与清单说明。
- 交付前 `npm run test:all`。

## 验收标准

1. `npm run typecheck` 与 `npm test` 全绿。
2. 增量 e2e：模板 + 清单下 carried-over 零 Builder 调用、独立探针仍判 verified；纯 carried-over 模块有 `module_boundary_audit_finished`；清单内容与最终状态一致。
3. 无模板时所有既有测试不变（行为等价）。
4. 异常退出路径不产生清单文件。

## 风险

- 清单依赖平台把 `shallow-progress/` 打进模板；若平台策略变化，退化为全量实现（安全方向，不误跳过）。
- 指纹误判（内容未变但模板实际未实现）：本轮独立探针 + 就地修复兜底。
- 复用旧计划可能与新应用界面漂移：`parseProbePlan` 校验 + 失败触发定位精化/修复。
- carried-over 判定只看上轮 verified：verified 的代码必然已进入某个检查点（回滚只到最新检查点，不回退更早的接受版本），语义成立。
