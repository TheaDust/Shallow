# AGENTS.md — ShallowCode

## 项目定位

ShallowCode 是 GOSIM Factory 2026 / ARC-Bench 比赛用的轻量控制器（harness）：OpenCode（经 `@opencode-ai/sdk`）是唯一写代码的 Builder，ShallowCode 本身**从不生成目标应用的业务代码**，只负责调度需求、生成黑盒探针、执行验收和止损。核心理念是 "Never let the builder grade itself"——Judge 与 Builder 之间有严格的信息防火墙（见下）。

竞赛背景见 `competition-info.txt`；设计文档：`docs/superpowers/specs/2026-09-02-shallowcode-v1-lite-design.md`（主设计）、`2026-09-04-shallowcode-opencode-prompts-design.md` 与 `2026-09-05-builder-prompts-externalization-design.md`（Builder prompt 体系）。

## 常用命令

```powershell
npm run typecheck        # tsc --noEmit（strict，覆盖 index.ts + src + test）
npm test                 # 单元与集成（部分含 Chromium）：tsx --test test/*.test.ts
npm run test:browser     # 真实 Chromium 浏览器测试：test/browser/*.test.ts
npm run test:all         # typecheck && npm test && test:browser（交付前必跑）
npm run smoke:credentials
npm start                # tsx index.ts
```

- 单跑一个测试文件：`npx tsx --test test/catalog.test.ts`。
- 没有独立的 lint/format 脚本；验证手段只有 typecheck + 测试。
- 浏览器测试需要已安装 Playwright Chromium（`npx playwright install chromium`），它们会 spawn `test/fixtures/app` 的 fixture server（自动预留随机端口）。

## 项目结构与索引

定位代码时按此索引找；每行给出职责与关键入口符号。

```text
index.ts                        生产入口与装配：CLI、.env、探针端口、依赖注入 runPipeline；
                                createRunLogSink 把事件同时写 stderr（JSON）与 run-log.txt（中文）
main.py                         ARC-Bench 适配入口：参数解析、Node 运行时准备、驱动 TS 管线（不写业务）

prompts/                        Builder prompt 资产（全部中文 Markdown，改文案改这里，不改 TS）
  system/builder-system.md      Builder 固定系统合同
  system/task-*.md              四种模式的任务模板：implement / repair / root-cause-repair / delivery-repair
  system/action-*.md            模板里的动作段（含 {{占位符}}）
  system/receipt.md             每次任务附带的完成回执格式
  system/platform-contract.md   平台命令与端口合同模板（评测缺省 3000、生成期注入探针端口）
  fragments/*.md                产品域实现规则碎片；由词典选择（见 prompt-fragments.ts）

src/
  types.ts                      领域类型：AtomicRequirement、WorkPacket、PlatformContract、ShadowReport、RunEvent
  cli.ts                        parseCliArgs：严格解析 --requirements-dir/--output-dir/--budget-ms
  catalog.ts                    requirements.yaml → 需求树；拒绝重复 ID、未知依赖、依赖环
  scheduler.ts                  selectNextPacket：无模型确定性调度，1–3 个依赖全 verified 的需求
  pipeline.ts                   编排核心：packet 循环、runShadowProbes、修复梯子、交付窗口、
                                MAX_PACKET_ITERATIONS=6 止损、state.record 事件发射点都在这里
  run-state.ts                  decideAfterReport（accept/repair/block 梯子）、RunStateStore（ledger+logSink）、
                                sanitizeDiagnosticText（诊断文本清洗）
  git-ops.ts                    GitCliOps.open（仓库校验 + .gitignore 初始化并提交）、captureAccepted/
                                restoreAccepted（保留 .arc 的应用回滚）、runGit（单命令 30s 超时）
  final-verifier.ts             FinalVerifier（install→build→启动→/health readiness→浏览器 smoke）与
                                CommandAppLifecycle（平台合同进程启停）
  arc-protocol.ts               ArcEventSink：.arc/runner-events.jsonl、七张溯源表、builderDiagnostic 回执信号
  runtime-config.ts             readGatewayConfig、readEnvFile（.env）、createArcPlatformContract、
                                deriveModelTimeouts（预算→Builder/Planner 超时）、SHALLOW_PROBE_PORT、pickFreePort
  process-spawn.ts              spawnProcess：Windows .cmd/bat 经 cmd.exe 启动并拒绝 shell 元字符；其余直接 spawn
  human-log.ts                  HumanRunFormatter：RunEvent JSON → 中文日志行（[本地时间 +耗时] 描述），未知类型返回 null
  builder/
    port.ts                     BuilderPort / BuilderResult（outcome: completed|failed|timed_out）
    opencode-sdk.ts             OpenCodeSdkBuilder（短会话、超时 abort 后等 prompt 落地再返回）、SdkOpenCodeRuntime
    prompt-input.ts             BuilderPromptInput 判别联合（implement/repair/root_cause_repair/delivery_repair）
    prompt.ts                   compileBuilderPrompt / buildBuilderTaskPrompt：系统合同 + 模板填充 + fragments 拼装
    prompt-assets.ts            loadBuilderPrompt（读 prompts/ 资产，LF 归一+缓存）、fillTemplate（{{占位符}} 校验）
    prompt-fragments.ts         selectPromptFragments：产品 kind 基础集 + generic_web 关键词 lexicon + 观测扩展
    shadow-observation.ts       toBuilderShadowObservation：ShadowReport → 白名单观测（控制字符清洗、1500 截断）
  judge/
    probe-schema.ts             ProbePlan/ProbeCase schema、parseProbePlan（白名单校验）、
                                assertLocatorOnlyRefinement（refinement 只许改 locator）
    llm-probe-planner.ts        LlmProbePlanner：网关调用（json_schema）、extractJsonPayload（剥围栏/杂文提取 JSON）、
                                plan/refineLocators（每 packet 一次 refinement）
    playwright-probe-runner.ts  PlaywrightProbeRunner（白名单 DSL 执行）+ deriveProbeVerdict（pass/fail/inconclusive）

test/
  *.test.ts                     node:test 单元/集成；pipeline.e2e.test.ts 是无凭证全链路
  browser/                      真实 Chromium 的 Playwright 测试
  fakes/                        FakeBuilder / FakeProbePlanner / FakeGitOps（仅测试用，不是生产架构）
  fixtures/                     fixtures/requirements.yaml 与 fixture app（e2e 的被测应用）
  helpers/                      withTempDir、fixture-server 等工具

docs/superpowers/               设计文档（specs/）与实施计划（plans/）
data/github、data/sheet         比赛需求样例（原文、结构化 YAML）
```

排错速查：想知道"跑哪一步了"→ run-log.txt（路径在启动时打印到 stderr）；想知道"某事件的原始字段"→ run-ledger.jsonl 或 stderr JSON 行；想知道"平台看到了什么"→ `<output-dir>/.arc/`。

## 环境变量

生产运行必需（`src/runtime-config.ts` 中校验，缺失即抛错）：

- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MODEL`
- Builder（OpenCode SDK）与 Probe Planner 共用这套 gateway/model 配置。
- OpenCode 显式注入 `shallow-gateway` provider；`MODEL` 是网关完整模型 ID，含 `/` 也不拆分。SDK 服务用随机端口，运行环境需已安装 `opencode` 可执行程序。
- 三个变量也支持写入仓库根 `.env`（入口默认加载，真实环境变量优先；`.env` 不入库，模板 `.env.example`）。

可选覆盖：

- `SHALLOW_PROBE_PORT`：环境变量或 `.env` 显式指定探针/交付验证端口（缺省随机；3000 是评测端口，显式指定也会被拒绝）。
- `RUN_CREDENTIAL_SMOKE=1`：三个网关变量齐全时才运行真实 OpenCode/LLM/Playwright 冒烟测试，默认 skip——不要为了"通过"而伪造成功。
- `SHALLOW_BUDGET_MS` / `ARCBENCH_TASK_DIR` / `ARCBENCH_TEMPLATE_DIR`：仅供 `main.py` 适配入口使用。

## CLI 与运行契约

`npm start -- --requirements-dir <dir> --output-dir <dir> [--budget-ms <ms>]`（严格解析：只认这三个 flag，且必须 `--key value` 成对出现，未知/缺值直接抛错；`--budget-ms` 可选，缺省或 `0` 表示不限时，管线在没有 ready 需求后进入交付）。

ARC-Bench 评测走适配包入口 `python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]`（契约见 `octos-org/arc-adapter`）。`main.py` 只做参数解析、Node 运行时准备与驱动 TS 管线，不写业务逻辑。

- requirements 文件固定为 `<requirements-dir>/requirements.yaml`，缺失即报错。
- 平台合同（ARC-Bench）：目标应用 `frontend/` + `backend/` 目录（npm install/build/start），backend 必须读 `PORT` 环境变量（缺省 3000），暴露 `/health`；Windows 上自动用 `npm.cmd`（经 `src/process-spawn.ts`）。
- 输出目录必须是 git 仓库根（`GitCliOps.open` 会 init 或校验）；仓库内提交统一使用内联 `-c user.name=ShallowCode -c user.email=shallowcode@local.invalid`。
- 首次打开输出仓库时若无 `.gitignore` 则写入 `node_modules/`、`dist/`、`build/`、`.next/`、`.env` 并立即提交（回滚 `clean -fd` 后仍生效）；已有 `.gitignore` 不动。**不要**把 `.arc/` 加进忽略规则。
- 运行产物四件套：stderr 脱敏 JSON 事件流、`%TMP%/shallowcode-runs/<pid>-<ts>/run-ledger.jsonl`（机读台账）、同目录 `run-log.txt`（中文人类可读，`HumanRunFormatter` 生成）、`<output-dir>/.arc/`（平台事件流 + 溯源表）。
- 运行事件经 `RunStateStore.record` 统一发射；新增阶段观测就新增 `state.record({type: ...})`，需要人类可读时在 `src/human-log.ts` 的 `describe` 里补对应中文文案。
- `RunSummary.delivered` 要求全部原子需求 verified 且最终验证通过；有 todo 或 blocked 时为 partial。未接受的交付修复与异常退出都回滚；`pipeline_finished` 记录汇总及待处理 ID。
- 回滚先 `reset --mixed <acceptedSha>`，再 `restore --worktree -- . :(top,exclude).arc` 和 `clean -fd -e .arc/`，保留 `.arc` 中包括失败在内的完整审计记录。

## 架构不变量（改动前必读）

管线：`catalog → scheduler → WorkPacket → OpenCodeSdkBuilder → LlmProbePlanner → PlaywrightProbeRunner → DecisionLoop → GitOps`；`src/arc-protocol.ts` 并行维护平台 `.arc/` 事件流与溯源表。

以下约束当前是设计核心：

1. **信息防火墙**：Probe Planner 和 Probe Runner 绝不能看到目标应用源码；Builder 只看到当前 packet 原文 + 白名单化 ShadowReport 观测（`src/builder/shadow-observation.ts` 清洗与截断），修复 prompt 不得泄露 planner 的隐藏推理。官方测试/官方结果任何模块都不允许读取。
2. **Packet 尝试上限**：首次实现 + 最多 2 次修复；第 3 次 Shadow 失败后必须 `restoreAccepted` 回滚并阻塞该 packet，不得继续烧预算。判定循环另有 `MAX_PACKET_ITERATIONS=6`（`src/pipeline.ts`）迭代止损保险。
3. **单调接受**：只在 Shadow `pass` 后 `captureAccepted` 更新 acceptedSha；失败一律回滚到最后接受状态。
4. **Probe DSL 白名单**：探针是声明式步骤（`src/judge/probe-schema.ts`），locator 只映射 `getByRole/getByLabel/getByText`，`goto` 只允许相对路径绑定受控 baseUrl；禁止 `page.evaluate`、任意网络请求、动态代码。判词（`deriveProbeVerdict`）有界：`inconclusive` 仅当全部失败为 locator 类且至少一个带 aria snapshot；断言/导航/超时/runner 失败一律 `fail`。
5. **交付窗口**：预算耗尽或没有可调度的 ready 需求后才停止领新 packet，只做 FinalVerifier（+ 至多一次交付修复 session）；一旦进入不可退出。
6. **Builder 不做局部决策之外的事**：选型、文件结构、局部构建修复都归 OpenCode；ShallowCode 不新增第二套源码编辑工具。
7. **Builder prompt 外置**：所有 Builder 文案在 `prompts/` 中文资产里；`src/builder/` 只做组装。改文案改 `.md`，改结构改 `prompt.ts`/`prompt-fragments.ts`，两者都要同步 `test/builder-prompt.test.ts` 与 `test/prompt-assets.test.ts` 的锚点断言。
8. **超时自愈**：git 单命令 30s；Builder 超时后对 abort 与 prompt 落地各给最多 5s（`promptSettleTimeoutMs`）。abort 失败或落地超时则关闭运行时，下一次调用重启。每次 packet 尝试前检查预算；预算不强行中断已开始的调用或最终交付。

调度器（`src/scheduler.ts`）是**无模型**的确定性规则：只选依赖全 verified 的 todo 需求，packet 上限 3 个相邻需求。

Catalog 将目录依赖展开为原子叶子并继承祖先依赖，展开后检查环。ProbePlan 必须覆盖 packet 的所有 ID，每个 case 至少一个断言；空输入及空值断言合法，wire schema 使用 nullable 可选字段。

## 代码与测试惯例

- **ESM/NodeNext**：所有相对 import 必须带 `.js` 后缀（TS 源文件也写 `.js`）。
- 测试框架是 Node 内建 `node:test` + `node:assert/strict`（不是 vitest/jest），经 `tsx --test` 运行。
- 无凭证测试一律用 `test/fakes/` 下的 FakeBuilder/FakeProbePlanner/FakeGitOps；Fake 只属于测试，不是生产架构。
- `index.ts` 通过注入 `AgentExecution` 支持测试替换生产装配；生产模块依赖（Builder/Planner/Runner/Git）都通过接口 port 注入，新模块照此模式。
- LLM 调用只用 Node 内建 `fetch` + OpenAI-compatible gateway，不引入第二个模型 SDK。
- 生产代码不直接 `console.*`：观测输出只有 `state.record → logSink` 一条通道（stderr JSON + run-log.txt + ledger）。
- prompt 资产是 UTF-8 无 CR 的 Markdown，`{{占位符}}` 必须被填满（`fillTemplate` 残留即抛错）；新增 fragment 需同步 `prompt-fragments.ts` 的词典与对应测试。
