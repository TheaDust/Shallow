# ShallowCode OpenCode 中文提示词实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有单一英文 Builder Prompt 替换为可测试的中文系统合同、四种任务模式、固定产品规则包和只记录不判定的 Builder 收据链路。

**Architecture:** `Catalog` 保留产品和祖先上下文，`PromptCompiler` 以判别联合类型接收 WorkPacket 或交付失败，`FragmentSelector` 只用产品类型和结构化失败信号选择短规则片段。OpenCode SDK 分别发送 `system` 与 `parts`；Pipeline 仍只根据 ShadowReport、尝试次数和 FinalVerifier 决策，Builder 最终文本只进入诊断日志。

**Tech Stack:** TypeScript 7、Node.js ESM/NodeNext、`@opencode-ai/sdk@1.18.27`、`node:test`、`node:assert/strict`、`tsx`

**Spec:** `docs/superpowers/specs/2026-09-04-shallowcode-opencode-prompts-design.md`

## Global Constraints

- OpenCode 仍是唯一生产 Builder；ShallowCode 不生成目标应用业务代码。
- 所有新提示词指令使用中文；需求原文、场景、精确 UI 文案、路径和命令保持原文。
- 当前 Web 产品必须恒载四条平台 UI 硬规则：`type="text"`、可见关联 `<label>`、JavaScript 渲染校验错误且绝不依赖 HTML5 `required`/`pattern`、纯文本 `<button>`。
- Builder 只能看到当前 WorkPacket、相关项目上下文、平台合同和清洗后的 Shadow 观察。
- 不向 Builder 发送完整 catalog、其他待办需求、accepted SHA、全局预算、ProbePlan、Planner 推理、官方测试或官方结果。
- 首次实现加两次修复的上限、单调接受、回滚和 FinalVerifier 决策规则保持不变。
- `BuilderResult.summary` 是不可置信诊断文本；不得解析收据字段，不得用于接受、修复、阻塞、回滚或跳过 Judge。
- `.arc` 收据镜像只能是非状态变更的 `signal`，不能修改 runner、requirement 或 traceability 状态。
- 所有相对 import 使用 `.js` 后缀。
- 不增加生产依赖，不引入 Prompt 分类 LLM，不创建 OpenCode Skill。
- 保留用户对 `AGENTS.md` 的未提交改动；未经明确授权不提交或推送。

---

## File Structure

- Modify: `src/types.ts` — 保存产品身份和每条需求的祖先上下文。
- Modify: `src/catalog.ts` — 从根节点精确识别产品并无损保留 ROOT/FOLDER 说明。
- Create: `src/builder/prompt-input.ts` — 定义四种 Prompt 输入、项目上下文和交付失败输入。
- Modify: `src/builder/port.ts` — 在 Pipeline 接入阶段把 BuilderRequest 切换为已验证的 Prompt 输入联合类型。
- Create: `src/builder/prompt-fragments.ts` — 保存六个中文规则片段和确定性选择器。
- Create: `src/builder/shadow-observation.ts` — 把 ShadowReport 清洗成 Builder 可见观察。
- Modify: `src/builder/prompt.ts` — 编译稳定系统提示词与动态中文任务提示词。
- Modify: `src/builder/opencode-sdk.ts` — 通过 SDK 的 `system` 和 `parts` 分开发送提示词。
- Modify: `src/pipeline.ts` — 显式选择四种模式、构造上下文和交付失败输入、记录诊断摘要。
- Modify: `src/run-state.ts` — 清洗诊断文本，并确保日志写入失败不改变 Pipeline 决策。
- Modify: `src/arc-protocol.ts` — 用非状态变更 signal 镜像 Builder 诊断摘要。
- Modify: `test/catalog.test.ts` — 验证产品和祖先上下文。
- Modify: `test/builder-prompt.test.ts` — 验证中文模板、规则包、信息边界和 SDK 调用。
- Create: `test/prompt-fragments.test.ts` — 独立验证片段选择器。
- Create: `test/shadow-observation.test.ts` — 验证 Shadow 观察白名单和长度限制。
- Modify: `test/pipeline.e2e.test.ts` — 验证模式流转、独立交付修复和收据不参与判定。
- Modify: `test/arc-protocol.test.ts` — 验证诊断 signal 不改变平台状态。
- Modify: `test/scheduler.test.ts`, `test/llm-probe-planner.test.ts`, `test/credential-smoke.test.ts` — 更新新增的必填 requirement 上下文字段。

---

### Task 1: 保留产品身份和需求层级上下文

**Files:**
- Modify: `src/types.ts`
- Modify: `src/catalog.ts`
- Modify: `test/catalog.test.ts`
- Modify: `test/arc-protocol.test.ts`
- Modify: `test/scheduler.test.ts`
- Modify: `test/llm-probe-planner.test.ts`
- Modify: `test/builder-prompt.test.ts`
- Modify: `test/credential-smoke.test.ts`

**Interfaces:**
- Produces: `ProductKind`, `ProductContext`, `RequirementAncestor` and required `AtomicRequirement.product`/`ancestors` fields.
- Consumes: Existing YAML ROOT/FOLDER/ATOMIC tree parsed by `loadRequirementCatalog()`.

- [ ] **Step 1: Write failing catalog tests for context preservation and exact product mapping**

Add assertions to `test/catalog.test.ts`:

```ts
assert.deepEqual(first.product, {
  kind: "generic_web",
  rootId: "ROOT",
  rootName: "Demo Product",
  description: "Root description.",
});
assert.deepEqual(first.ancestors, [
  { id: "AREA-A", name: "Account Area", description: "Account features." },
]);
```

Add a small YAML fixture test for each known root name:

```ts
assert.equal(github.requirements[0].product.kind, "repository_collaboration");
assert.equal(sheet.requirements[0].product.kind, "spreadsheet");
assert.equal(unknown.requirements[0].product.kind, "generic_web");
```

- [ ] **Step 2: Run the focused test and confirm the new fields are absent**

Run: `npx tsx --test test/catalog.test.ts`

Expected: FAIL because `AtomicRequirement` does not yet expose `product` or `ancestors`.

- [ ] **Step 3: Add the context types and catalog propagation**

Add to `src/types.ts`:

```ts
export type ProductKind =
  | "repository_collaboration"
  | "spreadsheet"
  | "generic_web";

export interface ProductContext {
  kind: ProductKind;
  rootId: string;
  rootName: string;
  description: string;
}

export interface RequirementAncestor {
  id: string;
  name: string;
  description: string;
}
```

Add required fields to `AtomicRequirement`:

```ts
product: ProductContext;
ancestors: RequirementAncestor[];
```

In `src/catalog.ts`, classify only the two exact known root names:

```ts
function classifyProduct(rootName: string): ProductKind {
  if (rootName === "GitHub Collaboration Platform Core Requirements") {
    return "repository_collaboration";
  }
  if (rootName === "Core Requirements for an Online Spreadsheet Data Workspace") {
    return "spreadsheet";
  }
  return "generic_web";
}
```

Construct one immutable `ProductContext` from the parsed root and pass an array of `{ id, name, description }` ancestors through `collectAtomics`. Exclude the root from `ancestors` because it is already present in `product`.

- [ ] **Step 4: Update all test requirement literals with explicit generic context**

Use the same literal shape in test factories:

```ts
product: {
  kind: "generic_web",
  rootId: "ROOT",
  rootName: "Demo Product",
  description: "Root description.",
},
ancestors: [
  { id: "PROFILE", name: "Profile", description: "Profile area" },
],
```

Do not make these production fields optional merely to reduce fixture edits.

- [ ] **Step 5: Run catalog, scheduler, planner and type checks**

Run:

```powershell
npx tsx --test test/catalog.test.ts test/scheduler.test.ts test/llm-probe-planner.test.ts
npm run typecheck
```

Expected: all selected tests and typecheck PASS.

---

### Task 2: 定义四种 Prompt 输入和 Shadow 观察白名单

**Files:**
- Create: `src/builder/prompt-input.ts`
- Create: `src/builder/shadow-observation.ts`
- Create: `test/shadow-observation.test.ts`

**Interfaces:**
- Consumes: `WorkPacket`, `PlatformContract`, `ShadowReport`, `ProductContext`, `RequirementAncestor`.
- Produces: `BuilderMode`, `BuilderProjectContext`, `BuilderShadowObservation`, `DeliveryFailureObservation`, discriminated union `BuilderPromptInput`, and `toBuilderShadowObservation(report)`.

- [ ] **Step 1: Write failing tests for Shadow observation sanitization**

Create `test/shadow-observation.test.ts` with assertions equivalent to:

```ts
const observation = toBuilderShadowObservation({
  packetId: "packet-a",
  verdict: "fail",
  passedCases: ["already-working"],
  failures: [{
    caseId: "missing-control",
    stepIndex: 2,
    category: "locator",
    message: `Could not find button\u0000${"x".repeat(2_000)}`,
    locatorSnapshot: `button Save\u0007${"y".repeat(5_000)}`,
  }],
});

assert.deepEqual(observation.passedCaseIds, ["already-working"]);
assert.equal(observation.failures[0].category, "locator");
assert.doesNotMatch(observation.failures[0].message, /\u0000/);
assert.ok(observation.failures[0].message.length <= 1_500);
assert.ok((observation.failures[0].accessibilityExcerpt?.length ?? 0) <= 1_500);
assert.equal(observation.applicationStartupFailed, false);
```

Add a case with `caseId: "<application>"` and assert `applicationStartupFailed === true`.

- [ ] **Step 2: Run the observation test and confirm the module is missing**

Run: `npx tsx --test test/shadow-observation.test.ts`

Expected: FAIL because `src/builder/shadow-observation.ts` does not exist.

- [ ] **Step 3: Define a discriminated Prompt input union without changing BuilderPort yet**

Define in `src/builder/prompt-input.ts`:

```ts
export type BuilderMode =
  | "implement"
  | "repair"
  | "root_cause_repair"
  | "delivery_repair";

export interface BuilderProjectContext {
  product: ProductContext;
  ancestors: RequirementAncestor[];
  satisfiedDependencies: Array<{ id: string; name: string; contract: string }>;
}

export interface BuilderShadowObservation {
  packetId: string;
  passedCaseIds: string[];
  failures: Array<{
    caseId: string;
    stepIndex: number;
    category: ProbeFailure["category"];
    message: string;
    accessibilityExcerpt?: string;
  }>;
  applicationStartupFailed: boolean;
}

export interface DeliveryFailureObservation {
  stage: "install" | "build" | "readiness" | "browser" | "complete";
  command?: string;
  expected: string;
  actual: string;
}
```

Use a shared base `{ outputDir, platformContract }`, then define:

```ts
export type BuilderPromptInput =
  | {
      mode: "implement";
      packet: WorkPacket;
      projectContext: BuilderProjectContext;
      outputDir: string;
      platformContract: PlatformContract;
    }
  | {
      mode: "repair" | "root_cause_repair";
      packet: WorkPacket;
      projectContext: BuilderProjectContext;
      shadowObservation: BuilderShadowObservation;
      outputDir: string;
      platformContract: PlatformContract;
    }
  | {
      mode: "delivery_repair";
      deliveryFailure: DeliveryFailureObservation;
      outputDir: string;
      platformContract: PlatformContract;
    };
```

This union makes missing repair evidence and empty delivery WorkPacket compile-time errors.

Keep the existing `BuilderRequest` in `src/builder/port.ts` unchanged during this task. The new union is consumed first by isolated PromptCompiler tests and becomes the BuilderPort request type atomically with the Pipeline migration in Task 4, so every task ends type-correct.

- [ ] **Step 4: Implement the observation whitelist without parsing failure messages**

In `src/builder/shadow-observation.ts`, map only the allowed fields. Normalize control characters to spaces and limit both free text fields to 1,500 characters. Determine `applicationStartupFailed` only from the structured migration marker `caseId === "<application>"`; do not inspect `message` for routing.

```ts
export function toBuilderShadowObservation(
  report: ShadowReport,
): BuilderShadowObservation {
  return {
    packetId: report.packetId,
    passedCaseIds: [...report.passedCases],
    failures: report.failures.map((failure) => ({
      caseId: failure.caseId,
      stepIndex: failure.stepIndex,
      category: failure.category,
      message: sanitize(failure.message),
      ...(failure.locatorSnapshot
        ? { accessibilityExcerpt: sanitize(failure.locatorSnapshot) }
        : {}),
    })),
    applicationStartupFailed: report.failures.some(
      (failure) => failure.caseId === "<application>",
    ),
  };
}
```

- [ ] **Step 5: Run the focused tests and typecheck**

Run:

```powershell
npx tsx --test test/shadow-observation.test.ts
npm run typecheck
```

Expected: observation tests and typecheck PASS. No existing Builder construction site changes in this task.

---

### Task 3: 实现固定产品规则包和中文 PromptCompiler

**Files:**
- Create: `src/builder/prompt-fragments.ts`
- Modify: `src/builder/prompt.ts`
- Create: `test/prompt-fragments.test.ts`
- Modify: `test/builder-prompt.test.ts`

**Interfaces:**
- Consumes: `BuilderPromptInput` and `ProductKind`.
- Produces: `PromptFragmentId`, `selectPromptFragments(request)`, `buildBuilderSystemPrompt()`, `buildBuilderTaskPrompt(request)`, and `compileBuilderPrompt(request)`.

- [ ] **Step 1: Write failing selector tests**

Create `test/prompt-fragments.test.ts`:

```ts
assert.deepEqual(selectPromptFragments(repositoryRequest()), [
  "accessible_web_controls",
  "server_persistence",
  "auth_and_permission",
  "repository_collaboration",
]);

assert.deepEqual(selectPromptFragments(spreadsheetRequest()), [
  "accessible_web_controls",
  "server_persistence",
  "spreadsheet_grid",
]);

assert.deepEqual(selectPromptFragments(deliveryRequest()), [
  "delivery_contract",
]);
```

Add tests proving that:

```ts
assert.deepEqual(
  selectPromptFragments(genericRequest("User may rename a role")),
  ["accessible_web_controls", "auth_and_permission"],
);

assert.deepEqual(
  selectPromptFragments(genericRepairWithMessage("spreadsheet formula failed")),
  ["accessible_web_controls"],
);
```

The second assertion proves arbitrary Shadow error text cannot select a domain fragment.

- [ ] **Step 2: Run selector tests and confirm the module is missing**

Run: `npx tsx --test test/prompt-fragments.test.ts`

Expected: FAIL because the selector is not implemented.

- [ ] **Step 3: Implement stable fragment IDs, exact Chinese strings and fixed ordering**

Define:

```ts
export type PromptFragmentId =
  | "accessible_web_controls"
  | "server_persistence"
  | "auth_and_permission"
  | "repository_collaboration"
  | "spreadsheet_grid"
  | "delivery_contract";

const FRAGMENT_ORDER: PromptFragmentId[] = [
  "accessible_web_controls",
  "server_persistence",
  "auth_and_permission",
  "repository_collaboration",
  "spreadsheet_grid",
  "delivery_contract",
];
```

Copy the six Chinese fragment bodies verbatim from design spec §8. The `accessible_web_controls` constant must contain these exact lines:

```text
每一个与评分相关的输入控件都必须使用 type="text"。
每一个输入字段都必须有与之关联且可见的 <label> 元素。
校验错误必须由 JavaScript 渲染为可见文本；绝不能依赖 HTML5 required 或 pattern 属性。
操作控件必须是 <button> 元素，并具有可见的纯文本。
```

Implement known product bundles as constant arrays. Only `generic_web` may use a versioned Chinese/English fallback lexicon over requirement names, ancestor names and scenarios. Do not inspect Shadow `message`.

- [ ] **Step 4: Write failing PromptCompiler tests for the four modes and firewall**

Replace English assertions in `test/builder-prompt.test.ts` with assertions over `{ systemPrompt, taskPrompt, fragmentIds }`:

```ts
const compiled = compileBuilderPrompt(implementRequest());
assert.match(compiled.systemPrompt, /唯一代码实现者/);
assert.match(compiled.taskPrompt, /# 行动：实现当前工作包/);
assert.match(compiled.taskPrompt, /REQ-PROFILE/);
assert.match(compiled.taskPrompt, /Root description/);
assert.match(compiled.taskPrompt, /Profile area/);
assert.match(compiled.taskPrompt, /type="text"/);
assert.match(compiled.taskPrompt, /绝不能依赖 HTML5 required 或 pattern/);
assert.doesNotMatch(compiled.taskPrompt, /SECRET-OTHER-REQ/);
assert.doesNotMatch(compiled.taskPrompt, /acceptedSha|global budget|\/workspace\/tests/i);
```

Add one test per mode:

```ts
assert.match(repair.taskPrompt, /根据外部黑盒观察修复/);
assert.match(rootCause.taskPrompt, /最后一次根因修复/);
assert.match(delivery.taskPrompt, /修复最终交付故障/);
assert.doesNotMatch(delivery.taskPrompt, /当前工作包|delivery-repair/);
```

- [ ] **Step 5: Implement PromptCompiler using exhaustive mode switches**

Export:

```ts
export interface CompiledBuilderPrompt {
  systemPrompt: string;
  taskPrompt: string;
  fragmentIds: PromptFragmentId[];
}

export function compileBuilderPrompt(
  request: BuilderPromptInput,
): CompiledBuilderPrompt;
```

Use an exhaustive `switch (request.mode)`. Render WorkPacket context only for the three packet modes. Render delivery failure and platform contract only for delivery mode. End every `taskPrompt` with the exact Chinese receipt block from spec §11.

For direct dependencies, render only `projectContext.satisfiedDependencies`; never walk or serialize the full catalog inside the compiler.

- [ ] **Step 6: Run prompt unit tests**

Run:

```powershell
npx tsx --test test/prompt-fragments.test.ts test/shadow-observation.test.ts test/builder-prompt.test.ts
```

Expected: all prompt-focused tests PASS.

---

### Task 4: 原子接入 OpenCode SDK 和四种 Pipeline 模式

**Files:**
- Modify: `src/builder/port.ts`
- Modify: `src/builder/opencode-sdk.ts`
- Modify: `src/pipeline.ts`
- Modify: `test/builder-prompt.test.ts`
- Modify: `test/pipeline.e2e.test.ts`
- Modify: `test/fakes/fake-builder.ts`

**Interfaces:**
- Consumes: `BuilderPromptInput`, `compileBuilderPrompt(request)`, `toBuilderShadowObservation(report)`, and `RequirementCatalog`.
- Produces: `BuilderRequest` as the validated discriminated union, exact attempt-to-mode mapping, `buildBuilderProjectContext(packet, catalog)`, packet-free delivery repair, and `OpenCodeRuntime.prompt(sessionId, input)` with separate prompt channels.

- [ ] **Step 1: Write failing runtime and Pipeline contract assertions**

Change `RecordingRuntime.prompts` to store both channels:

```ts
assert.match(runtime.prompts[0].input.systemPrompt, /唯一代码实现者/);
assert.match(runtime.prompts[0].input.taskPrompt, /当前工作包/);
assert.doesNotMatch(runtime.prompts[0].input.systemPrompt, /REQ-PROFILE/);
```

Update repair and delivery E2E expectations:

```ts
assert.deepEqual(
  builder.requests.map((request) => request.mode),
  ["implement", "repair", "root_cause_repair"],
);

const delivery = builder.requests[1];
assert.equal(delivery.mode, "delivery_repair");
if (delivery.mode !== "delivery_repair") assert.fail("expected delivery repair");
assert.equal(delivery.deliveryFailure.stage, "build");
assert.equal("packet" in delivery, false);
```

- [ ] **Step 2: Run focused tests and confirm the legacy request shape fails**

Run:

```powershell
npx tsx --test test/builder-prompt.test.ts test/pipeline.e2e.test.ts
```

Expected: FAIL because runtime still accepts one string and Pipeline still sends attempt flags plus raw ShadowReport.

- [ ] **Step 3: Switch BuilderPort to the validated Prompt input union**

In `src/builder/port.ts`, import and re-export the union without duplicating its fields:

```ts
import type { BuilderPromptInput } from "./prompt-input.js";

export type BuilderRequest = BuilderPromptInput;
```

Remove the old `shadowReport?` and `requireRootCauseFirst` interface.

- [ ] **Step 4: Build the smallest legal Builder project context**

Add in `src/pipeline.ts`:

```ts
function buildBuilderProjectContext(
  packet: WorkPacket,
  catalog: RequirementCatalog,
): BuilderProjectContext {
  const first = packet.requirements[0];
  if (!first) throw new Error(`Packet ${packet.id} has no requirements`);
  const dependencyIds = new Set(
    packet.requirements.flatMap((item) => item.dependencyIds),
  );
  return {
    product: first.product,
    ancestors: dedupeAncestors(packet.requirements.flatMap((item) => item.ancestors)),
    satisfiedDependencies: catalog.requirements
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ id: item.id, name: item.name, contract: item.text })),
  };
}
```

Pass the catalog into `executePacket`. Do not include statuses, unrelated requirements or transitive dependency closure.

- [ ] **Step 5: Replace attempt flags with explicit packet modes**

Construct:

```ts
const mode = attempt === 1
  ? "implement"
  : attempt === 2
    ? "repair"
    : "root_cause_repair";

const request: BuilderRequest = mode === "implement"
  ? { mode, packet, projectContext, outputDir, platformContract }
  : {
      mode,
      packet,
      projectContext,
      shadowObservation: toBuilderShadowObservation(previousReport),
      outputDir,
      platformContract,
    };
```

The branch structure must make `previousReport` mandatory before constructing either repair mode.

- [ ] **Step 6: Construct a packet-free delivery request**

Use a fixed exhaustive stage map:

```ts
const expectedByStage = {
  install: "平台安装命令成功退出",
  build: "平台构建命令成功退出并生成生产构建产物",
  readiness: "应用使用随机端口启动且健康检查返回成功",
  browser: "根页面可访问并显示主要内容区域",
  complete: "完整交付验证成功",
} satisfies Record<DeliveryFailureObservation["stage"], string>;
```

Send:

```ts
{
  mode: "delivery_repair",
  outputDir: options.outputDir,
  platformContract: options.platformContract,
  deliveryFailure: {
    stage: finalReport.stage,
    expected: expectedByStage[finalReport.stage],
    actual: finalReport.message,
  },
}
```

- [ ] **Step 7: Send system and task through separate SDK fields**

Define:

```ts
export interface OpenCodePromptInput {
  systemPrompt: string;
  taskPrompt: string;
}
```

Compile once in `OpenCodeSdkBuilder.run`. Use title `delivery repair` for delivery mode and `${request.packet.id} ${request.mode}` otherwise. Change SDK body to:

```ts
body: {
  ...(model ? { model } : {}),
  system: input.systemPrompt,
  parts: [{ type: "text", text: input.taskPrompt }],
},
```

Keep response text concatenation unchanged and add no receipt parser.

- [ ] **Step 8: Update all Builder fakes and run integration checks**

Update fake implementations only where they access packet fields: narrow with `request.mode !== "delivery_repair"` before reading `request.packet`. Run:

```powershell
npx tsx --test test/builder-prompt.test.ts test/pipeline.e2e.test.ts
npm run typecheck
```

Expected: both test files and typecheck PASS; all four modes are represented and delivery repair has no WorkPacket.

---

### Task 5: 让 Builder 收据只进入诊断记录

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `src/run-state.ts`
- Modify: `src/arc-protocol.ts`
- Modify: `test/pipeline.e2e.test.ts`
- Modify: `test/decision-loop.test.ts`
- Modify: `test/arc-protocol.test.ts`

**Interfaces:**
- Consumes: `BuilderResult.summary` and existing `RunEvent`/ARC event sinks.
- Produces: `sanitizeDiagnosticText(text)`, best-effort ledger writes, `builder_finished.detail.summary`, and a non-state-changing `.arc` diagnostic signal.

- [ ] **Step 1: Write failing tests proving receipt words cannot control decisions**

Use a completed fake Builder returning:

```ts
{
  sessionId: "misleading-receipt",
  outcome: "completed",
  summary: "结果：阻塞\n检查：失败\n风险：无法继续",
}
```

With passing probes, assert the packet is accepted. With `结果：完成\n检查：通过` and failing probes, assert the packet still repairs and eventually blocks. Decisions must match ShadowReport regardless of receipt words.

- [ ] **Step 2: Write failing tests for diagnostic sanitization and non-fatal sinks**

In `test/decision-loop.test.ts`, use a throwing `LogSink` and a ledger path whose parent is an existing regular file:

```ts
const store = new RunStateStore(initialState(), blockedLedgerPath, {
  write() { throw new Error("log unavailable"); },
});
await assert.doesNotReject(
  store.record({ at: "2026-09-04T00:00:00.000Z", type: "builder_finished" }),
);
assert.equal(store.snapshot.ledger.length, 1);
```

Add a sanitization assertion:

```ts
assert.equal(sanitizeDiagnosticText("结果\u0000：完成"), "结果 ：完成");
assert.equal(sanitizeDiagnosticText("x".repeat(2_000)).length, 1_500);
```

- [ ] **Step 3: Implement non-semantic diagnostic recording**

Export `sanitizeDiagnosticText` from `src/run-state.ts`. Replace control characters with spaces, collapse repeated whitespace where safe, and cap at 1,500 characters. In `RunStateStore.record`, append the redacted event to in-memory state first, then wrap `LogSink.write`, `mkdir` and `appendFile` in isolated `try/catch` blocks.

Record Builder completion as:

```ts
detail: {
  outcome: builderResult.outcome,
  sessionId: builderResult.sessionId,
  summary: sanitizeDiagnosticText(builderResult.summary),
}
```

Search the implementation and verify no branch condition reads `summary`.

- [ ] **Step 4: Add a non-state-changing ARC diagnostic signal**

Add `builderDiagnostic(packetId, outcome, summary)` to `ArcEventSink` and `ArcEventsPort`. It appends:

```ts
{
  type: "signal",
  reason: "builder_receipt_recorded",
  packet_id: packetId,
  outcome,
  message: sanitizeDiagnosticText(summary),
  timestamp: arcTimestamp(),
  refresh: {
    submission: false,
    logs: true,
    commit_history: false,
    traceability_selected: false,
    traceability_all: false,
    preview: false,
  },
}
```

Invoke it only through `emitArc`, whose errors are already swallowed. Test that `node_states.json` remains unchanged after this signal.

- [ ] **Step 5: Run diagnostic and decision tests**

Run:

```powershell
npx tsx --test test/decision-loop.test.ts test/arc-protocol.test.ts test/pipeline.e2e.test.ts
npm run typecheck
```

Expected: all selected tests and typecheck PASS; misleading receipt wording has no control effect and sink failures do not alter the in-memory decision path.

---

### Task 6: 完整回归、凭据边界和文档一致性

**Files:**
- Modify only if tests reveal a required compatibility update: `test/credential-smoke.test.ts`, `README.md`
- Verify: `docs/superpowers/specs/2026-09-04-shallowcode-opencode-prompts-design.md`

**Interfaces:**
- Consumes: completed PromptCompiler, SDK adapter and Pipeline integration.
- Produces: a verified repository state with no regression in the existing browser pipeline.

- [ ] **Step 1: Run all non-browser checks**

Run:

```powershell
npm run typecheck
npm test
```

Expected: both commands exit 0. If a test constructs old `BuilderRequest` or `AtomicRequirement` values, update that fixture to the required typed shape; do not reintroduce optional compatibility fields.

- [ ] **Step 2: Run real Chromium integration tests**

Run:

```powershell
npm run test:browser
```

Expected: all browser tests PASS on random non-grading ports.

- [ ] **Step 3: Run the complete delivery command once**

Run:

```powershell
npm run test:all
```

Expected: typecheck, unit tests and browser tests all exit 0.

- [ ] **Step 4: Perform explicit information-firewall scans**

Run:

```powershell
rg -n "acceptedSha|global budget|/workspace/tests|ProbePlan|planner reasoning" src/builder
rg -n "summary.*(includes|match|startsWith|结果|阻塞|通过|失败)" src
rg -n "required or pattern|可以同时使用|对应的原生类型" src/builder docs/superpowers/specs/2026-09-04-shallowcode-opencode-prompts-design.md
```

Expected:

- First scan finds only deliberate prohibition text or type names, never serialized runtime state.
- Second scan finds no receipt parsing or decision branches.
- Third scan finds no softened platform UI rule.

- [ ] **Step 5: Inspect the final diff scope**

Run:

```powershell
git status --short
git diff --check
git diff -- src test README.md docs/superpowers/specs/2026-09-04-shallowcode-opencode-prompts-design.md
```

Expected: no whitespace errors; `AGENTS.md` remains untouched; no generated target application code, dependency changes, Skill files or unrelated refactors appear.

- [ ] **Step 6: Report verification without committing**

Report the exact commands and outcomes, list any credential-gated smoke test that remained skipped, and provide the changed file list. Do not commit or push until the user explicitly authorizes it.
