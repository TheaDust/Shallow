# ShallowCode Constrained Pipeline Implementation Plan

> **执行约束：** 使用 `superpowers:test-driven-development` 逐任务执行；每个行为先观察失败测试，再写最小实现。完成前使用 `superpowers:verification-before-completion` 运行全部验收命令并检查实际输出。

**目标：** 搭建 TypeScript 版 ShallowCode V1-Lite，使无 API 凭证的测试能以 FakeBuilder/FakeProbePlanner 和真实 Playwright 跑通 `schedule -> build -> plan -> judge -> accept/repair/restore -> final verify`，同时提供真实 OpenCode SDK Builder 与 OpenAI-compatible Probe Planner 适配器。

**架构边界：** 生产代码只包含比赛全局控制、独立 probe 规划与确定性浏览器执行。目标应用的创建、技术选型、业务实现、局部构建和局部修复全部交给 OpenCode。测试 FakeBuilder 只复制测试 fixture，不构成生产 Capability Kernel。Git 仅暴露 `captureAccepted` 和 `restoreAccepted` 两个全局状态操作。

**技术栈：** Node.js 20、TypeScript ESM、`@opencode-ai/sdk@1.18.27`、`yaml@2.9.0`、`@playwright/test@1.54.0`、Node `node:test`。

**规格：** `docs/superpowers/specs/2026-09-02-shallowcode-v1-lite-design.md`

---

## 计划文件树

```text
index.ts
package.json
package-lock.json
tsconfig.json
src/
  builder/
    opencode-sdk.ts
    port.ts
    prompt.ts
  judge/
    llm-probe-planner.ts
    playwright-probe-runner.ts
    probe-schema.ts
  catalog.ts
  cli.ts
  final-verifier.ts
  git-ops.ts
  pipeline.ts
  run-state.ts
  scheduler.ts
  types.ts
test/
  browser/
    playwright-probe-runner.test.ts
  fakes/
    fake-builder.ts
    fake-git-ops.ts
    fake-probe-planner.ts
  fixtures/
    app/
      package.json
      server.mjs
    requirements.yaml
  helpers/
    fixture-server.ts
    temp-dir.ts
  builder-prompt.test.ts
  catalog.test.ts
  cli.test.ts
  decision-loop.test.ts
  final-verifier.test.ts
  git-ops.test.ts
  llm-probe-planner.test.ts
  pipeline.e2e.test.ts
  scheduler.test.ts
```

生产代码中不出现 `FakeBuilder`、fixture app、Kernel、`CheckpointManager` 或第二套代码编辑器。

## Task 1：建立可复现的 TypeScript 测试骨架

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`
- Create: `test/cli.test.ts`

- [ ] **1.1 先写入口合同的失败测试**

在 `test/cli.test.ts` 导入尚不存在的 `parseCliArgs`，验证：

```ts
const parsed = parseCliArgs([
  "--requirements-dir", "C:/fixture/requirements",
  "--output-dir", "C:/fixture/output",
  "--budget-ms", "600000",
]);
assert.deepEqual(parsed, {
  requirementsDir: resolve("C:/fixture/requirements"),
  outputDir: resolve("C:/fixture/output"),
  budgetMs: 600000,
});
```

再验证缺失路径、非正数 budget 和未知参数会抛出带参数名的错误。

- [ ] **1.2 运行测试并确认 RED**

Run: `npm test -- --test-name-pattern="CLI"`

Expected: 因 `src/cli.ts` 不存在而失败。

- [ ] **1.3 添加最小工程配置和共享类型**

`package.json` 固定：

```json
{
  "name": "shallowcode",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx --test test/*.test.ts",
    "test:browser": "tsx --test test/browser/*.test.ts",
    "test:all": "npm run typecheck && npm test && npm run test:browser",
    "start": "tsx index.ts"
  },
  "dependencies": {
    "@opencode-ai/sdk": "1.18.27",
    "@playwright/test": "1.54.0",
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "@types/node": "20.19.43",
    "tsx": "4.23.13",
    "typescript": "7.0.2"
  }
}
```

`tsconfig.json` 使用 `NodeNext`、`strict: true`、`noEmit: true`，覆盖 `index.ts`、`src/**/*.ts`、`test/**/*.ts`。

`src/types.ts` 定义且只定义跨模块合同：

```ts
export type RequirementStatus = "todo" | "verified" | "blocked";

export interface AtomicRequirement {
  id: string;
  folderPath: string[];
  declarationIndex: number;
  name: string;
  text: string;
  dependencyIds: string[];
  scenarios: string[];
  references: string[];
  exactUiStrings: string[];
}

export interface RequirementCatalog {
  requirements: AtomicRequirement[];
  statusById: Record<string, RequirementStatus>;
}

export interface WorkPacket {
  id: string;
  requirementIds: string[];
  requirements: AtomicRequirement[];
  attempt: 1 | 2 | 3;
}

export interface ProcessCommand {
  executable: string;
  args: string[];
  cwd: "output" | "frontend" | "backend";
}

export interface PlatformContract {
  baseUrl: string;
  port: number;
  installCommands: ProcessCommand[];
  buildCommands: ProcessCommand[];
  startCommand: ProcessCommand;
  healthPath: string;
  buildTimeoutMs: number;
  startTimeoutMs: number;
}

export interface RunEvent {
  at: string;
  type: string;
  packetId?: string;
  detail?: Record<string, unknown>;
}
```

- [ ] **1.4 实现 `src/cli.ts` 并获得 GREEN**

实现纯函数 `parseCliArgs(argv: string[]): CliOptions`，不读取环境、不启动 pipeline。

Run: `npm test -- --test-name-pattern="CLI"`

Expected: PASS。

- [ ] **1.5 锁定依赖并类型检查**

Run: `npm install --package-lock-only --ignore-scripts`

Run: `npm ci --ignore-scripts`

Run: `npm run typecheck`

Expected: lockfile 与 package.json 一致，类型检查通过。

- [ ] **1.6 Commit**

```powershell
git add package.json package-lock.json tsconfig.json src/types.ts src/cli.ts test/cli.test.ts
git commit -m "chore: bootstrap ShallowCode TypeScript harness"
```

## Task 2：无损解析 Catalog 并确定性选择 WorkPacket

**Files:**

- Create: `src/catalog.ts`
- Create: `src/scheduler.ts`
- Create: `test/fixtures/requirements.yaml`
- Create: `test/catalog.test.ts`
- Create: `test/scheduler.test.ts`

- [ ] **2.1 写 Catalog RED 测试**

fixture 至少包含两层 FOLDER、三个 ATOMIC、一个 dependency、具名 scenario、Markdown reference 和带引号 UI 文本。测试断言：

- 深度优先保留原声明顺序；
- ATOMIC 的 `folderPath`、完整 description、scenario step 原文和依赖不丢失；
- 提取 reference 路径和弯引号/反引号中的显式 UI 文本；
- 重复 ID、未知 dependency、dependency cycle 分别抛错；
- parser 只接收明确文件路径，不自行遍历 sibling 目录。

Run: `npm test -- --test-name-pattern="Catalog"`

Expected: 因 `src/catalog.ts` 不存在而失败。

- [ ] **2.2 最小实现 Catalog parser**

入口：

```ts
export async function loadRequirementCatalog(
  requirementsFile: string,
): Promise<RequirementCatalog>;
```

使用 `yaml.parse`，递归验证 `id/name/type/dependencies/description/children/scenarios`。只把 `ATOMIC` 放入 `requirements`，初始化全部状态为 `todo`。用 DFS 三色标记检测 dependency cycle。

Run: `npm test -- --test-name-pattern="Catalog"`

Expected: PASS。

- [ ] **2.3 写 Scheduler RED 测试**

覆盖：

- 未验证 dependency 的节点不可选；
- scenario 数更高的 ready seed 优先；
- 直接依赖者数解决同分；
- 同最近 FOLDER 且共享 dependency/场景词项的节点最多合并到 3 个；
- blocked 节点永不返回；
- 同样输入重复调用得到字节级相同 packet id 和 requirement 顺序；
- 无 ready 节点返回 `undefined`。

Run: `npm test -- --test-name-pattern="Scheduler"`

Expected: 因 `src/scheduler.ts` 不存在而失败。

- [ ] **2.4 实现确定性 Scheduler**

入口：

```ts
export function selectNextPacket(
  catalog: RequirementCatalog,
): WorkPacket | undefined;
```

packet id 使用排序后 requirement ID 的稳定拼接 hash；首次 `attempt` 固定为 `1`。不调用 LLM，不维护 frontier。

Run: `npm test -- --test-name-pattern="Catalog|Scheduler"`

Expected: PASS。

- [ ] **2.5 Commit**

```powershell
git add src/catalog.ts src/scheduler.ts test/fixtures/requirements.yaml test/catalog.test.ts test/scheduler.test.ts
git commit -m "feat: parse and schedule requirement slices"
```

## Task 3：定义 Builder 边界并接入 OpenCode SDK

**Files:**

- Create: `src/builder/port.ts`
- Create: `src/builder/prompt.ts`
- Create: `src/builder/opencode-sdk.ts`
- Create: `test/builder-prompt.test.ts`
- Create: `test/fakes/fake-builder.ts`
- Create: `test/fixtures/app/package.json`
- Create: `test/fixtures/app/server.mjs`

- [ ] **3.1 写 Builder prompt 与生命周期 RED 测试**

测试 `buildBuilderPrompt`：

- 包含当前 packet 的原始 requirement/scenario/reference、output 目录和平台合同；
- 不包含 catalog 中其他 packet、全局 budget、accepted SHA、tests path；
- attempt 2 包含 `ShadowReport`；
- attempt 3 额外包含 root-cause-first 指令；
- 不要求固定框架、Kernel 或 Shallow 生成业务文件。

为 `OpenCodeSdkBuilder` 注入 `OpenCodeRuntime` fake，验证：一个 builder 实例只 `start()` 一次；每次 `run()` 创建新 session；timeout 调用 abort；`close()` 关闭 server。

Run: `npm test -- --test-name-pattern="Builder"`

Expected: 因 builder 模块不存在而失败。

- [ ] **3.2 实现窄 BuilderPort**

```ts
export interface BuilderRequest {
  packet: WorkPacket;
  outputDir: string;
  platformContract: PlatformContract;
  shadowReport?: ShadowReport;
  requireRootCauseFirst: boolean;
}

export interface BuilderResult {
  sessionId: string;
  outcome: "completed" | "failed" | "timed_out";
  summary: string;
}

export interface BuilderPort {
  run(request: BuilderRequest): Promise<BuilderResult>;
  close(): Promise<void>;
}
```

`OpenCodeRuntime` 仅包住当前 SDK 的五个操作：`start(directory)`、`createSession(title)`、`prompt(sessionId, text)`、`abort(sessionId)`、`close()`。真实实现先调用 `createOpencode({ config })`；随后分别调用 `client.session.create({ body: { title }, query: { directory } })`、`client.session.prompt({ path: { id: sessionId }, query: { directory }, body: { parts: [{ type: "text", text }] } })` 和 `client.session.abort({ path: { id: sessionId }, query: { directory } })`。返回值缺少 `data` 或带 `error` 时转成 `BuilderResult.failed`。V1 以 `session.prompt` 的完成响应作为 session 结束信号，不再实现事件订阅状态机。

模型字符串只在适配器内部解析为 SDK 需要的 `{ providerID, modelID }`；无法可靠拆分时不传 SDK `model` 字段，让 OpenCode config 决定模型。

- [ ] **3.3 实现测试专用 FakeBuilder 和 fixture app**

`test/fakes/fake-builder.ts` 实现同一 `BuilderPort`，把 `test/fixtures/app` 复制到临时 output，并可按构造参数返回预定 outcome。fixture app 使用 Node `http`：

- `GET /health` 返回 200；
- `/` 提供带 label 的输入框、`Save` button 和 live status；
- 保存后写入 fixture 进程内状态；刷新仍显示保存值；
- `PORT` 默认 3000。

该 fixture 只服务 harness 测试，不从 `src/` 导出。

- [ ] **3.4 运行 Builder 测试与类型检查**

Run: `npm test -- --test-name-pattern="Builder"`

Run: `npm run typecheck`

Expected: PASS。

- [ ] **3.5 Commit**

```powershell
git add src/builder test/builder-prompt.test.ts test/fakes/fake-builder.ts test/fixtures/app
git commit -m "feat: add OpenCode SDK builder boundary"
```

## Task 4：LLM 只生成受限 ProbePlan

**Files:**

- Create: `src/judge/probe-schema.ts`
- Create: `src/judge/llm-probe-planner.ts`
- Create: `test/llm-probe-planner.test.ts`
- Create: `test/fakes/fake-probe-planner.ts`

- [ ] **4.1 写 ProbePlan schema RED 测试**

验证合法 happy-path/persistence plan 通过；以下输入必须拒绝：

- 未知 op；
- `goto` 绝对 URL、`..` 或协议相对 URL；
- CSS/XPath selector；
- `evaluate`、shell、file、request；
- 空 cases、case 不属于当前 packet、重复 case id；
- 超过固定 case/step/string 长度上限；
- refinement 改变输入值、断言或 step 数量。

Run: `npm test -- --test-name-pattern="Probe Planner"`

Expected: 因 judge 模块不存在而失败。

- [ ] **4.2 实现类型、JSON Schema 常量和运行时校验**

`src/judge/probe-schema.ts` 导出 `ProbeLocator`、`ProbeStep`、`ProbeCase`、`ProbePlan`、`ShadowReport`、`PROBE_PLAN_JSON_SCHEMA`、`parseProbePlan`、`assertLocatorOnlyRefinement`。

不引入通用 schema 框架；手写 exhaustiveness check，并给 `cases <= 6`、`steps/case <= 30`、字符串长度设置常量上限。

- [ ] **4.3 写 LLM transport RED 测试**

给 `LlmProbePlanner` 注入 fake `fetch`，断言：

- 请求只包含 packet 证据、DSL schema 和 planner system instruction；
- 不包含 outputDir、源码、diff、OpenCode summary、accepted SHA；
- 一次正常 `plan()` 只发一个 HTTP 请求；
- 非 2xx、无 choices/content、非法 JSON、schema 不合法均返回带稳定 category 的错误；
- `refineLocators()` 只接收截断并去敏的 accessibility snapshot，且每个 plan 最多一次。

- [ ] **4.4 实现 OpenAI-compatible Planner**

```ts
export interface ProbePlanner {
  plan(packet: WorkPacket): Promise<ProbePlan>;
  refineLocators(
    original: ProbePlan,
    snapshot: string,
  ): Promise<ProbePlan>;
}
```

从显式配置对象读取 `baseUrl/apiKey/model/timeoutMs`，使用 Node `fetch` 和 `AbortSignal.timeout` 请求 `/chat/completions`。API key 只进 header，不写日志。响应先提取 JSON，再由 `parseProbePlan` 决定是否接受；V1 不做自由文本修补。

- [ ] **4.5 实现 FakeProbePlanner 并运行测试**

Fake 由测试直接注入静态合法 plan，并记录调用次数。

Run: `npm test -- --test-name-pattern="Probe Planner"`

Run: `npm run typecheck`

Expected: PASS。

- [ ] **4.6 Commit**

```powershell
git add src/judge/probe-schema.ts src/judge/llm-probe-planner.ts test/llm-probe-planner.test.ts test/fakes/fake-probe-planner.ts
git commit -m "feat: plan bounded black-box probes with LLM"
```

## Task 5：用真实 Playwright 解释 ProbePlan

**Files:**

- Create: `src/judge/playwright-probe-runner.ts`
- Create: `test/helpers/fixture-server.ts`
- Create: `test/helpers/temp-dir.ts`
- Create: `test/browser/playwright-probe-runner.test.ts`

- [ ] **5.1 写真实浏览器 RED 测试**

测试启动 fixture server 和 Chromium，执行合法 plan：`goto -> fill label -> click role -> expectText -> reload -> expectValue`。再覆盖：

- 第二 case 获得隔离 context；
- `newContext` 替换当前 context/page；
- assertion failure 分类为 `assertion`；
- locator timeout 分类为 `locator` 并附带限长 accessibility snapshot；
- navigation failure、step timeout、runner crash 各有稳定 category；
- 所有 context/browser 和 fixture process 在 `finally` 中退出。

Run: `npm run test:browser`

Expected: 因 runner 不存在而失败。

- [ ] **5.2 实现 allowlist interpreter**

```ts
export interface ProbeRunOptions {
  baseUrl: string;
  stepTimeoutMs: number;
  caseTimeoutMs: number;
}

export class PlaywrightProbeRunner {
  run(plan: ProbePlan, options: ProbeRunOptions): Promise<ShadowReport>;
}
```

逐个 switch `ProbeStep.op`，locator 仅调用 `getByRole/getByLabel/getByText`。`goto` 通过 `new URL(path, baseUrl)` 后再次检查 origin 相同。禁止 `page.evaluate`；snapshot 使用 Playwright 1.54 的 `locator.ariaSnapshot()` 从页面根节点取得并限长，不包含 cookie、localStorage 或 network body。

- [ ] **5.3 运行 browser 测试两次检查资源清理**

Run: `npm run test:browser`

Run: `npm run test:browser`

Expected: 两次均 PASS，第二次无端口占用或残留进程错误。

- [ ] **5.4 Commit**

```powershell
git add src/judge/playwright-probe-runner.ts test/helpers test/browser/playwright-probe-runner.test.ts
git commit -m "feat: execute probe plans in real Playwright"
```

## Task 6：实现有界 DecisionLoop 和最小 GitOps

**Files:**

- Create: `src/run-state.ts`
- Create: `src/git-ops.ts`
- Create: `test/decision-loop.test.ts`
- Create: `test/git-ops.test.ts`
- Create: `test/fakes/fake-git-ops.ts`

- [ ] **6.1 写 DecisionLoop RED 测试**

以纯函数测试 transition：

```ts
type Decision =
  | { kind: "accept" }
  | { kind: "repair"; nextAttempt: 2 | 3; requireRootCauseFirst: boolean }
  | { kind: "block_and_restore" }
  | { kind: "enter_delivery" };
```

覆盖：pass 接受；attempt 1 fail 进入 attempt 2；attempt 2 fail 进入 root-cause-first attempt 3；attempt 3 fail 阻塞并恢复；剩余预算小于等于 20% 时不可逆进入 delivery；inconclusive 仅在尚未 refinement 时允许 refinement，不消耗 Builder attempt。

Run: `npm test -- --test-name-pattern="Decision Loop"`

Expected: 因 `src/run-state.ts` 不存在而失败。

- [ ] **6.2 实现 RunState 和追加 ledger**

`RunStateStore` 在内存维护状态，并把每次 transition 追加到 output 外、harness 自己的 `run-ledger.jsonl`。写入前删除 key/token、截断错误文本。V1 不实现恢复数据库。

- [ ] **6.3 写 GitOps RED 测试**

在临时目录初始化 Git repo 和局部 identity，验证：

- `captureAccepted("packet x")` 只在 output repo 中执行 `git add -A` 和 commit，返回新 HEAD；
- 第一次 capture 在空 repo 中创建允许为空的 baseline commit，后续无变化时返回现有 HEAD；
- `restoreAccepted(sha)` 拒绝非本 repo commit；
- restore 后 tracked/untracked 候选改动消失且 HEAD 对应 accepted SHA；
- 任何 Git 命令失败都抛出，不伪造成功。

测试专用 `FakeGitOps` 只记录调用，不执行 Git。

- [ ] **6.4 实现两个 Git 操作**

`GitCliOps` 构造时接收已 `realpath` 的 output repo。命令参数用数组传给 `spawn`，禁止 shell 字符串；restore 前用 `git cat-file -e <sha>^{commit}` 和 `git merge-base --is-ancestor <sha> HEAD` 验证目标。

实现可采用 `git reset --hard <acceptedSha>` 和 `git clean -fd`，但只允许对构造时验证过的临时 output repo 执行；生产代码不接受运行期任意路径切换。

- [ ] **6.5 运行测试**

Run: `npm test -- --test-name-pattern="Decision Loop|GitOps"`

Run: `npm run typecheck`

Expected: PASS。

- [ ] **6.6 Commit**

```powershell
git add src/run-state.ts src/git-ops.ts test/decision-loop.test.ts test/git-ops.test.ts test/fakes/fake-git-ops.ts
git commit -m "feat: bound repairs and retain one accepted git state"
```

## Task 7：编排完整 pipeline，并用真实浏览器端到端验证

**Files:**

- Create: `src/pipeline.ts`
- Create: `test/pipeline.e2e.test.ts`

- [ ] **7.1 写主成功路径 RED 测试**

注入 `FakeBuilder + FakeProbePlanner + PlaywrightProbeRunner + FakeGitOps`：

1. 从 fixture YAML 选 packet；
2. FakeBuilder 写出 fixture app；
3. fixture server 启动；
4. FakeProbePlanner 返回真实交互 plan；
5. Playwright runner 通过；
6. `captureAccepted` 调用两次：首次保存 starter baseline，Shadow pass 后保存候选；
7. packet requirements 标为 verified；
8. ledger 顺序为 selected/built/planned/judged/accepted；
9. builder、browser、server 都关闭。

Run: `npm test -- --test-name-pattern="Pipeline E2E"`

Expected: 因 `src/pipeline.ts` 不存在而失败。

- [ ] **7.2 写修复和止损 RED 测试**

覆盖两条独立路径：

- 第一次 plan 故意断言错误，第二次 plan 通过：Builder 收到 attempt 2 和原 ShadowReport，最终 accept。
- 三次均 fail：Builder 调用恰好三次，第三次 root-cause-first，`restoreAccepted(initialSha)` 恰好一次，packet 标为 blocked，pipeline 可调度其他 ready packet。

再验证 locator inconclusive 只触发一次 `refineLocators`，不增加 Builder attempt。

- [ ] **7.3 实现依赖注入式 Pipeline**

```ts
export interface PipelineDeps {
  builder: BuilderPort;
  planner: ProbePlanner;
  runner: PlaywrightProbeRunner;
  git: GitOps;
  appLifecycle: AppLifecycle;
  clock: Clock;
}

export interface AppLifecycle {
  start(outputDir: string, contract: PlatformContract): Promise<{
    baseUrl: string;
    stop(): Promise<void>;
  }>;
}

export interface Clock {
  nowMs(): number;
}

export interface PipelineOptions {
  requirementsFile: string;
  outputDir: string;
  ledgerFile: string;
  totalBudgetMs: number;
  platformContract: PlatformContract;
}

export interface RunSummary {
  status: "delivered" | "partial" | "failed";
  verifiedRequirementIds: string[];
  blockedRequirementIds: string[];
  acceptedSha: string;
}

export async function runPipeline(
  options: PipelineOptions,
  deps: PipelineDeps,
): Promise<RunSummary>;
```

`Pipeline` 只编排，不直接 import OpenCode SDK、Playwright browser factory、Git CLI 或 `fetch`。所有 cleanup 放入一个顶层 `finally`，原始错误和 cleanup 错误都进入 summary/ledger。

- [ ] **7.4 跑完整无凭证 pipeline**

Run: `npm test -- --test-name-pattern="Pipeline E2E"`

Run: `npm run test:browser`

Expected: PASS，且不读取 `OPENAI_API_KEY`。

- [ ] **7.5 Commit**

```powershell
git add src/pipeline.ts test/pipeline.e2e.test.ts
git commit -m "feat: orchestrate the constrained build and judge loop"
```

## Task 8：FinalVerifier、生产入口和凭证门控 smoke

**Files:**

- Create: `src/final-verifier.ts`
- Create: `index.ts`
- Create: `test/final-verifier.test.ts`
- Update: `test/cli.test.ts`
- Update: `package.json`

- [ ] **8.1 写 FinalVerifier RED 测试**

在临时 fixture output 上验证：

- 依次执行 contract 配置的 install/build/start；
- 等待 `/health` 和 `/`；
- 用真实 Playwright 打开根页面；
- 无论 pass/fail/timeout 都终止本次启动进程；
- readiness 失败返回结构化报告；
- delivery 触发后 scheduler 不再选新 packet。

Run: `npm test -- --test-name-pattern="Final Verifier"`

Expected: 因 `src/final-verifier.ts` 不存在而失败。

- [ ] **8.2 实现 FinalVerifier**

命令全部来自固定 `PlatformContract` 配置，不来自 LLM 输出。进程调用使用 executable/args 数组并设置 cwd，不开启 shell。只终止自己创建且持有 handle 的进程。

- [ ] **8.3 写并实现生产入口**

`index.ts`：

1. 解析 `--requirements-dir`、`--output-dir`、`--budget-ms`；
2. 验证 `requirements.yaml` 和 output 真实路径；
3. 从 `OPENAI_API_KEY/OPENAI_BASE_URL/MODEL` 构造真实 `OpenCodeSdkBuilder` 和 `LlmProbePlanner`；
4. 构造真实 Runner、GitOps、clock 和 platform contract；
5. 调用 `runPipeline`；
6. 以 summary 决定 exit code；
7. 不提供 production `--fake` flag，Fake 只从测试注入。

为避免 SDK 与 Planner 争抢不可控预算，入口从总预算派生每 packet Builder/Planner timeout，并把最后 20% 留给 FinalVerifier。

- [ ] **8.4 添加显式 credential smoke script**

在 package scripts 增加：

```json
"smoke:credentials": "node --import tsx --test --test-name-pattern='credential smoke' test/credential-smoke.test.ts"
```

Create: `test/credential-smoke.test.ts`。仅当三个环境变量和 `RUN_CREDENTIAL_SMOKE=1` 同时存在时，运行一个最小 packet：真实 OpenCode session、真实 Planner、真实 Playwright；否则使用 `test.skip` 并输出 skip 原因。测试不得读取官方 tests 或评分结果。

- [ ] **8.5 运行最终验收**

Run: `npm ci`

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run test:browser`

Expected: 全部 PASS；credential smoke 明确 SKIP，不计为真实集成通过。

如果本机 Chromium 未安装，先运行一次：`npx playwright install chromium`，随后重新运行 `npm run test:browser`。不得以缺少浏览器为由改成 DOM mock。

- [ ] **8.6 安全和范围审计**

Run: `rg -n "CheckpointManager|CapabilityKernel|FakeBuilder|official.*test|/workspace/tests|page\.evaluate|child_process.*shell" src index.ts`

Expected: 不出现 CheckpointManager/Kernel/FakeBuilder/官方测试路径/page.evaluate；child process 不使用 shell。

Run: `rg -n "TODO|FIXME|placeholder|not implemented|throw new Error\(\"stub" index.ts src test package.json`

Expected: 无占位实现。

Run: `git diff --check`

Expected: 无空白错误。

- [ ] **8.7 Commit**

```powershell
git add index.ts src/final-verifier.ts test/final-verifier.test.ts test/cli.test.ts test/credential-smoke.test.ts package.json package-lock.json
git commit -m "feat: verify and launch the ShallowCode pipeline"
```

## 完成判定

只有以下证据齐全才宣称首个 pipeline 跑通：

- `npm ci` 成功；
- `npm run typecheck` 成功；
- 所有 Node 单元/集成测试成功；
- Playwright 浏览器测试成功且使用 Chromium；
- pipeline e2e 同时覆盖 accept、repair、restore/block；
- 生产 source 范围审计通过；
- 若未执行 credential smoke，交付说明必须明确“真实 OpenCode/LLM 集成尚未现场验证”，不得把 contract test 当成真实调用证据。

## 规格覆盖自检

| 收敛规格要求 | 实施任务 |
| --- | --- |
| OpenCode 是唯一生产 Builder | Task 3、Task 8 |
| 只在 Shallow 中维护全局 catalog/schedule/budget | Task 2、Task 6、Task 7 |
| LLM 生成多个受限 probes | Task 4 |
| 真实 Playwright 确定性执行 | Task 5、Task 7 |
| locator-only refinement 最多一次 | Task 4、Task 7 |
| 最多两次 repair | Task 6、Task 7 |
| 不设 CheckpointManager，只保留 accepted SHA | Task 6 |
| 最后 20% 进入交付验证 | Task 6、Task 8 |
| 无凭证完整 pipeline | Task 7、Task 8 |
| 真实集成不被 fake 掩盖 | Task 8 |
