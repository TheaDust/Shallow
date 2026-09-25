# AGENTS.md — ShallowCode

## 项目定位

ShallowCode 是 GOSIM Factory 2026 / ARC-Bench 比赛用的轻量控制器（harness）：Pi coding-agent（`@mariozechner/pi-coding-agent`）是唯一写代码的 Builder，ShallowCode 本身**从不生成目标应用的业务代码**，只负责调度需求、生成黑盒探针、执行验收和止损。核心理念是 "Never let the builder grade itself"——Judge 与 Builder 之间有严格的信息防火墙（见下）。

当前模块优先流程见 `docs/2026-09-13-module-first-refactor.md`；引擎替换与模块反馈见 `docs/2026-09-14-pi-sdk-refactor-plan.md`。竞赛背景见 `competition-info.txt`；早期设计文档：`docs/superpowers/specs/2026-09-02-shallowcode-v1-lite-design.md`（主设计）、`2026-09-04-shallowcode-opencode-prompts-design.md` 与 `2026-09-05-builder-prompts-externalization-design.md`（Builder prompt 体系）。

## 常用命令

```powershell
npm run typecheck        # tsc --noEmit（strict，覆盖 index.ts + baseline + src + test）
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
baseline/
  main.py                       baseline 适配入口：驱动 baseline/index.ts、检查输出目录
  index.ts                      loadRootModules / baselineMain：ROOT 子树顺序执行、复用单会话、模块状态
  system.md                     baseline 系统提示词与平台合同（与 prompts/system/platform-contract.md 措辞对齐，无工作包概念）

prompts/                        Prompt 资产（system/、fragments/ 为 Builder 中文 Markdown；judge/ 为 Judge 中文 Markdown；改文案改这里，不改 TS）
  system/builder-system.md      Builder 固定系统合同（含全新项目 React+Vite+TypeScript 缺省栈：既有栈一律延续，
                                缺省手写 hash 路由、规模需要时允许 react-router-dom 且必须 HashRouter、
                                零依赖原生 http 后端、Vitest + @testing-library/react 角色查询测试）
  system/task-*.md              四种模式的任务模板：implement / repair / root-cause-repair / delivery-repair
  system/action-*.md            模板里的动作段（含 {{占位符}}）
  system/receipt.md             每次任务附带的完成回执格式
  system/self-test.md           Builder 开发检查流程（传统测试、昂贵 browser 工具约定）、清理责任与结果报告
  system/platform-contract.md   平台命令与端口合同模板（评测缺省 3000、生成期注入探针端口、额外端口段由发现结果决定）
  system/platform-extra-ports.md 额外端口合同段：由验收 spec 发现的端口（{{EXTRA_PORTS}}）双重监听要求
  system/seed-data.md           顶层 data 的种子数据段模板
  system/reference-images*.md   图片附件说明与模型拒图后的纯文本说明
  fragments/*.md                产品域实现规则碎片；由词典选择（见 prompt-fragments.ts）
  judge/probe-planner.md        Judge Planner 计划生成系统提示词（中文）
  judge/probe-refinement.md     Judge Planner locator 精化系统提示词（中文）
  judge/probe-review.md         Judge 语义复核系统提示词（中文）

src/
  types.ts                      领域类型：AtomicRequirement、WorkPacket、PlatformContract、ShadowReport、RunEvent
  cli.ts                        parseCliArgs：严格解析 --requirements-dir/--budget-ms；--output-dir 可选（缺省 shallowcode-local/<entry>）
  catalog.ts                    requirements.yaml → 需求树、ProductContext.seedData 与原子级 seedDeclarations
                                （保留 Seed data、Seed values、evaluation seed 来源的摘录）；校验 ID 和依赖
  scheduler.ts                  featureGroupPackets：确定性有界功能组（同父目录→同 ROOT 子树扩展、依赖亲和 tie-break、3 条/5 场景/3k 字符阈值封口、单条超限独立成组、内置唯一覆盖与依赖序验证、GroupingStats 落账）；auditPackets：逐原子验收及前置需求文字上下文
  pipeline.ts                   编排核心：模块实现、可运行检查点、模块边界验收与就地修复、最终全量验收（只检测）与最终交付
  run-budget.ts                 RunBudget：显式正预算的阶段预留和调用剩余额度；缺省/0 不限总时长
  run-state.ts                  RunStateStore（功能状态、可运行检查点 SHA、ledger+logSink）、
                                sanitizeDiagnosticText（诊断文本清洗）
  git-ops.ts                    GitCliOps.open（仓库校验 + .gitignore 初始化并提交）、captureAccepted/
                                restoreAccepted（保留 .arc 的应用回滚）、runGit（单命令 30s 超时）
  final-verifier.ts             FinalVerifier（install→build→启动→/health readiness→浏览器 smoke→grader-like 复验）与
                                CommandAppLifecycle（平台合同进程启停）、verifyGraderLikeStart（只设 PORT 时额外端口与未知路径）
  arc-protocol.ts               ArcEventSink：官方 .arc 事件、完整需求树、投影 journal 与幂等重建
  progress-journal.ts           产物可见的进度日志与 probe plan 镜像（shallow-progress/）：保持 untracked、排除 digest 与回滚、对 Builder 屏蔽
  diagnostics.ts               sanitizeDiagnosticText：已知密钥及常见凭证脱敏、控制字符清理、截断
  runtime-config.ts             readGatewayConfig、readEnvFile（.env）、createArcPlatformContract、
                                resolvePlatformExtraPorts（按 ARCBENCH_TESTS_DIR 的验收 spec 发现端口，缺省回退 [3301]）、
                                deriveModelTimeouts（预算→Builder/Planner 超时）、SHALLOW_PROBE_PORT、pickFreePort
  process-spawn.ts              spawnProcess：Windows .cmd/bat 经 cmd.exe 启动并拒绝 shell 元字符；其余直接 spawn
  gateway-failure.ts           网关 HTTP/连接错误元数据，Worker 只观测配置的模型端点
  gateway-recovery.ts          Builder/Planner 共享退避、Planner 串行、调用窗口与重试
  execution-fault.ts            ExecutionFault：浏览器执行故障、Builder 运行时启动故障；与 Shadow 判词分离
  human-log.ts                  HumanRunFormatter：RunEvent JSON → 中文日志行（[本地时间 +耗时] 描述），未知类型返回 null
  prompt-assets.ts              loadPrompt（读 prompts/ 资产，LF 归一+缓存）、fillTemplate（{{占位符}} 校验）
  builder/
    port.ts                     BuilderPort / BuilderResult（outcome、execution 元数据与可选 referenceImages 诊断）
    execution-port.ts           CodingAgentPort 引擎无关执行端口（controller 与 raw baseline 共用）
    prompt-builder.ts           PromptBuilder：实现 BuilderPort、编译 prompt、拒图纯文本回退、驱动 CodingAgentPort
    pi-worker-client.ts         PiWorkerClient：fork 独立 Node Worker、IPC、会话文件映射、进程组/作业回收与退出确认
    pi-worker.ts                唯一导入 Pi SDK 的入口：单次调用、会话续接、工具装配、SDK 事件与终态判定
    pi-model-config.ts          piProviderModel / DEFAULT_CONTEXT_WINDOW：网关 provider 模型描述，上下文窗口可按运行覆盖
    sse-resilience.ts           始终启用的网关 SSE 容错：丢弃非法事件、补 [DONE]，内容/工具事件截断则报可重试错误
    pi-tools.ts                 read/edit/write 路径限制与 shell 命令白名单后端（复用 SDK schema/截断，替换执行后端）；
                                shell 确定性拒绝临时测试命令并引导到 run_tests；装配 run_tests 与会话内 browser 工具
    pi-test-tool.ts             run_tests 工具：限内存的传统测试执行（frontend Vitest 固定 --maxWorkers=1、backend
                                node:test 固定 --test-concurrency=1、直起 node 不经 npm shim、输出尾部截断、超时/中止杀进程）
    pi-browser-tool.ts          Builder browser：脚本/expect、页面文字与可访问结构、可选截图；失败带诊断报错
    builder-app.ts              父进程持有的开发应用生命周期：串行 start/status/stop，Worker 结束后清理
    pi-app-tool.ts              app 工具：通过 IPC 请求父进程执行平台启动合同
    reference-images.ts        loadReferenceImages：当前 packet 图片读取、真实路径/格式/大小校验
    prompt-input.ts             BuilderPromptInput 判别联合（implement/repair/root_cause_repair/delivery_repair）
    prompt.ts                   compileBuilderPrompt / buildBuilderTaskPrompt：系统合同 + 模板填充 + fragments 拼装
                                + 本包初始数据原文摘录（seedDeclarations 聚合）
    prompt-fragments.ts         selectPromptFragments：产品 kind 基础集 + generic_web 关键词 lexicon + 观测扩展
    shadow-observation.ts       toBuilderShadowObservation：ShadowReport → 白名单观测（控制字符清洗、1500 截断）
  judge/
    audit.ts                    auditPacket：计划恢复、定位恢复、行为失败先经受限语义复核（依据成立或按需求重建）再复现/修复；
                                Judge 故障返回 inconclusive
    probe-schema.ts             ProbePlan/ProbeCase schema（expectationBasis 逐字引用落地校验）、显式终末 assertion、单层 scope、
                                parseProbePlan（白名单校验）、assertLocatorOnlyRefinement（refinement 只许改 locator、
                                保留需求锚定名与 exact 匹配、交互控件不得降级为纯 text）
    semantic-review.ts          语义复核合同：PlanReview（sound/corrected）、引用落地校验、纠正计划重建约束
    llm-probe-planner.ts        LlmProbePlanner：网关调用（json_schema）、extractJsonPayload（剥围栏/杂文提取 JSON）、
                                plan/refineLocators/reviewPlan（失败步骤诊断 + locator 校验；系统提示词见 prompts/judge/；恢复额度由 pipeline 管理）
    playwright-probe-runner.ts  PlaywrightProbeRunner（白名单 DSL 执行）+ deriveProbeVerdict（pass/fail/inconclusive）
  process-lifecycle.ts          ownProcessTree（Windows Job Object / POSIX 进程组回收）、toolEnvironment（工具最小环境）
  memory-snapshot.ts            memorySnapshot：Linux cgroup 内存诊断采样（memory.current/peak/max/events）；
                                resolveCgroupMemoryMount 挂载点解析供 memory-gate 复用
  memory-gate.ts                MemoryGate：cgroup 水位背压。重活前等待余量——候选安装(600MiB)/构建(500MiB)
                                （candidate-runtime）与探针浏览器启动(400MiB)（playwright-probe-runner）；
                                无 cgroup/无上限时 no-op，等待超过 maxWaitMs 放行，实际等待写 stderr 诊断行

test/
  *.test.ts                     node:test 单元/集成；pipeline.e2e.test.ts 是无凭证全链路
  browser/                      真实 Chromium 的 Playwright 测试
  fakes/                        FakeBuilder / FakeProbePlanner / FakeGitOps（仅测试用，不是生产架构）
  fixtures/                     fixtures/requirements.yaml 与 fixture app（e2e 的被测应用）
  helpers/                      withTempDir、fixture-server 等工具

docs/superpowers/               设计文档（specs/）与实施计划（plans/）
data/github、data/sheet         初赛题目的需求树（原文、结构化 YAML）：github 对应
                                repository_collaboration、sheet 对应 spreadsheet；各自包含 reference/。
                                generic_web 是未识别根名时的分类。
```

排错速查：想知道"跑哪一步了"→ run-log.txt（路径在启动时打印到 stderr）；想知道"某事件的原始字段"→ run-ledger.jsonl 或 stderr JSON 行；想知道"平台看到了什么"→ `<output-dir>/.arc/`。

## 环境变量

生产运行必需（`src/runtime-config.ts` 中校验，缺失即抛错）：

- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MODEL`
- Builder（Pi coding-agent）与 Probe Planner 共用这套 gateway/model 配置。
- Pi Worker 在进程内注册 `shallow-gateway` provider（Chat Completions），网关密钥经 IPC 注入；`MODEL` 是网关完整模型 ID，含 `/` 也不拆分。运行环境须 Node >= 20.18.1，无需全局安装 Pi CLI 或其它 coding agent。
- 三个变量也支持写入仓库根 `.env`（入口默认加载，真实环境变量优先；`.env` 不入库，模板 `.env.example`）。

可选覆盖：

- `SHALLOW_PROBE_PORT`：环境变量或 `.env` 显式指定探针/交付验证端口（缺省随机；3000 是评测端口，显式指定也会被拒绝）。
- `SHALLOW_EVAL_PORT`：评测端口（缺省 3000，由适配入口按 `--web-port`/`ARCBENCH_WEB_PORT`/`ARC_WEB_PORT` 写入）；探针选端口时排除它，显式探针端口与它相同即报错。
- `SHALLOW_RUN_DIR`：环境变量或 `.env` 指定运行日志目录（run-ledger.jsonl 与 run-log.txt；缺省 `%TMP%/shallowcode-runs/<pid>-<ts>/`，设置后仍按运行 ID 分子目录）。
- `SHALLOW_MEMORY_GATE_MAX_WAIT_MS`：cgroup 内存背压的最长等待毫秒数（缺省 60000；`0` 表示不在候选安装/构建与探针浏览器启动前等待）。等待超时后放行并写 stderr 诊断行。
- `SHALLOW_CAPTURE_SSE`：诊断用，仅在排查网关 SSE 坏块时打开。取值为真值（`1`/`true`/`yes`/`on`）时把 Pi Worker 收到的每个 `text/event-stream` 响应体原样落到 `<SHALLOW_RUN_DIR>/<运行 ID>/sse-capture/`（`<label>-<pid>-<n>.sse` 原文 + `.meta.json` 元数据/坏事件），其他取值按目录路径解析，缺省/`0` 关闭。抓包只读克隆分支、不改请求路径，也不影响超时或结果判定。抓到的内容可能包含被测应用代码与模型输出，属临时诊断产物，不要入库。抓捕开关独立于容错：`src/builder/sse-resilience.ts` 始终启用，先于客户端丢弃截断事件并补 `[DONE]`；抓包在容错内层，仍记录网关原始字节。
- `RUN_CREDENTIAL_SMOKE=1`：三个网关变量齐全时才运行真实 Pi/LLM/Playwright 冒烟测试，默认 skip——不要为了"通过"而伪造成功。
- `ARCBENCH_TESTS_DIR`（评测由 runner 注入；本地可无）：验收 spec 目录。入口只用于按 `http://127.0.0.1:<port>`/`localhost:<port>` 字面量发现额外端口（排除评测端口），spec 内容不进入 Builder/Judge。缺省再尝试 `/workspace/tests`，都没有则回退 `[3301]`。
- `SHALLOW_BUDGET_MS` / `ARCBENCH_TASK_DIR` / `ARCBENCH_TEMPLATE_DIR`：主线和 baseline 的 Python 适配入口读取真实环境。

## CLI 与运行契约

`npm start -- --requirements-dir <dir> [--output-dir <dir>] [--budget-ms <ms>]`（严格解析：只认这三个 flag，且必须 `--key value` 成对出现，未知/缺值直接抛错；`--output-dir` 可选，缺省 `<系统临时目录>/shallowcode-local/<main|baseline>`——主线与 baseline 各用各的，绝不共用；`--budget-ms` 可选，缺省或 `0` 表示不限时，管线按模块实现、模块边界验收与就地修复、最终全量验收（只检测）、交付顺序运行；显式正预算按 60%/20%/15%/5% 预留阶段时间）。

ARC-Bench 评测走适配包入口 `python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]`（契约见 `octos-org/arc-adapter`）。`main.py` 只做参数解析、Node 运行时准备与驱动 TS 管线，不写业务逻辑。

本地运行缺省把产物写到**项目外**的系统临时目录：主线 `%TEMP%\shallowcode-local\main`、baseline `%TEMP%\shallowcode-local\baseline`（两个入口各用各的，绝不共用 output-dir，否则 `.arc` 会混写）。目录在仓库外，`GitCliOps.open` 会自动 `git init`，无需任何预置；重跑同一目录时残留清理会复位到上次接受状态（保留已接受提交），想全新开始就整个删掉目录（含 `.git` 也可直接删）。评测/固定目录用显式 `--output-dir` 或 `ARCBENCH_TEMPLATE_DIR`。完整命令（在仓库根执行）：

```powershell
# 主线（ShallowCode 管线）：以 sheet 题目为例，产物缺省到 %TEMP%\shallowcode-local\main
npm start -- --requirements-dir data/sheet
# 或走评测同款适配入口
python main.py data/sheet --type web

# baseline（raw Pi 对照），产物缺省到 %TEMP%\shallowcode-local\baseline
python baseline/main.py data/sheet --type web
# 或直接驱动 TS
npx tsx baseline/index.ts --requirements-dir data/sheet
```

题目换成 `data/github` 即跑另一道题。网关三变量在 `.env`；`ARCBENCH_*` 环境变量不读 `.env`（Python 层只看真实环境），但本地缺省目录已内置，无需显式传 `--output-dir`。

- requirements 文件固定为 `<requirements-dir>/requirements.yaml`，缺失即报错。
- 平台合同（ARC-Bench）：目标应用 `frontend/` + `backend/` 目录（npm install/build/start），backend 必须读 `PORT` 环境变量（缺省 3000）并在监听 PORT 的同时额外监听 `PlatformContract.extraPorts`（由 `ARCBENCH_TESTS_DIR` 的验收 spec 发现，排除评测端口；无 spec 时回退 `[3301]`；部分题目验收测试把目标地址硬编码为 `http://127.0.0.1:3301`），暴露 `/health` 与 `/api/health`；Windows 上自动用 `npm.cmd`（经 `src/process-spawn.ts`）。探针端口会避开评测端口与发现到的额外端口；探针/候选启动传 `ARC_EXTRA_PORTS=0` 跳过额外端口；交付验证额外执行 `verifyGraderLikeStart`，只设 `PORT` 以复现评测条件（额外端口必须绑定，未知路径必须响应且进程不退出），完成后释放端口并复查候选摘要。
- 输出目录必须是 git 仓库根（`GitCliOps.open` 会 init 或校验）；仓库内提交统一使用内联 `-c user.name=ShallowCode -c user.email=shallowcode@local.invalid`。
- 首次打开输出仓库时若无 `.gitignore` 则写入 `node_modules/`、`dist/`、`build/`、`.next/`、`.env` 并立即提交（回滚 `clean -fd` 后仍生效）；已有 `.gitignore` 不动。**不要**把 `.arc/` 加进忽略规则。
- `GitCliOps.open` 首次初始化允许目录为空，或只含 `.gitignore` 与平台预置脚手架 `.arc/`、`requirements/`；其他残留会被拒绝。目录同时含 `frontend/` 与 `backend/` 时视为 evolution 模板（上一轮产物），整目录被接受：跳过空目录校验，脏的第三方仓库也直接采纳为基线，并用仓库本地的 `.git/info/exclude` 排除 `node_modules/`、`dist/` 等（不改模板自身的 `.gitignore`）。既有仓库按根提交标题识别为 ShallowCode 仓库时，会硬重置并清理应用的未提交改动、删除旧 `runner-events.jsonl`；其他脏仓库会被拒绝。复用输出目录前先备份人工修改和历史记录，根提交标题并不证明未提交改动的来源。
- 运行产物四件套：stderr 脱敏 JSON 事件流、`%TMP%/shallowcode-runs/<pid>-<ts>/run-ledger.jsonl`（机读台账）、同目录 `run-log.txt`（中文人类可读，`HumanRunFormatter` 生成）、`<output-dir>/.arc/`（平台事件流 + 溯源表）。
- 产物可见诊断 `shallow-progress/`：进度日志 `progress.log`（与 run-log 同源的中文行）+ `plans/<packetId>.json`（完整 ProbePlan）。平台会按 `.gitignore` 过滤交付包且专门隐藏 `.arc`，所以它**故意不 ignore**——靠它是"未 ignore 的 untracked"来同时被平台打包、又不进 git 历史：`captureAccepted` 用 `:(top,exclude)shallow-progress` 排除、`restorableInputDigest` 按路径跳过、回滚 `restore`/`clean` 排除（与 `.arc` 同等待遇）。它含隐藏计划，`pi-tools.ts` 对该目录与 `.arc` 一并屏蔽。
- 运行事件经 `RunStateStore.record` 统一发射并注入运行/事件 ID、序号、耗时和接受基线；新增事件同步 `types.ts` 的判别联合与 `human-log.ts` 中文文案。Planner `contentPreview` 仅写私有 ledger；Builder 回执属于内部自述诊断。
- 修改脱敏、证据或 ARC 投影时，先读 `docs/2026-09-07-observability-arc-projection.md`：官方固定提交与字段、投影重建范围和安全限制均在此。验证 `test/observability.test.ts`、`test/arc-protocol.test.ts`、`test/human-log.test.ts`、`test/pipeline.e2e.test.ts`；目录链接检查不代表 OS 隔离。
- `RunSummary.delivered` 要求当前交付版本全部原子需求 verified 且最终验证通过；todo/blocked/failed/inconclusive 均为 partial。implementedRequirementIds 表示模块完成且构建/启动检查通过，不代表功能正确。未接受的交付修复与异常退出都回滚；`pipeline_finished` 记录汇总及待处理 ID。
- 回滚不再移动 HEAD：`restore --source <acceptedSha> --staged --worktree -- . :(top,exclude).arc :(top,exclude)shallow-progress` 同步索引与工作区（会删除被拒尝试引入的源码文件），`clean -fd -e .arc/ -e shallow-progress/` 清掉未跟踪残留，然后以 `--allow-empty` 提交一个恢复提交。失败尝试保留在历史中永远可达，`.arc` 保留包括失败在内的完整审计记录。

## 架构不变量

管线：`catalog → 功能组实现 → 可运行检查点 → 模块边界验收与就地修复 → 最终全量验收（只检测） → 最终交付`；`src/arc-protocol.ts` 并行维护平台 `.arc/` 事件流与溯源表。

1. **信息防火墙**：Planner/Runner 不读取目标源码、diff 或 Builder 会话。Builder 接收需求、种子数据、图片及白名单失败观测。隐藏计划与 Planner 推理仅留在 Judge；官方测试和结果不进入任何运行模块。入口仅按字面量从验收 spec 提取 `http://127.0.0.1:<port>`/`localhost:<port>` 端口用于交付验证，spec 内容不进入任何 prompt 或判词。
2. **功能组实现**：实现工作包是确定性有界功能组（设计文档 `docs/2026-09-15-feature-slices-and-builder-loop.md` §3）：种子取全局声明序中第一个依赖已调度的原子项，扩展限同一直接父目录与同 ROOT 子树，按依赖亲和与声明序 tie-break，达 3 条/5 场景/3,000 字符阈值封口，单条超限独立成组；组不跨模块合并，允许离开模块后再回来补齐。分组内置程序化验证：全部原子 ID 唯一覆盖、每条依赖在当前项之前或同组内之前、原文不截断。所有功能组先实现，再验收；实现阶段每个工作包从全新会话开始；正常回执后安装/构建/启动检查失败时，同包最多续接一次，共用原调用截止时间；跨包交接只经项目文件（代码、测试、ARCHITECTURE.md）。组内依赖和未 verified 的外部依赖不阻塞实现。
3. **检查点与验收分离**：`captureAccepted` 现在保存通过安装、构建、启动及候选一致性检查的可运行版本。只有独立探针通过才记 `verified`。Planner/定位/浏览器故障记 `inconclusive`，保留代码。Builder 普通失败先保存尝试再实测：仅在相对接受基线有实际应用改动且代码可运行时 rescue；没有改动或无法运行则恢复并标 blocked。实现超时最多以新会话续做同包一次（至多 45min，受实现阶段剩余预算限制）；可运行部分保存为空需求检查点，再次超时标 blocked，不记 implemented。网关失败单独恢复：中断代码可保存为检查点，控制器持续重试直到网关恢复或阶段预算耗尽。被拒尝试保留在历史中。
4. **模块边界验收与修复**：每个模块（ROOT 子树）实现完毕后执行模块边界验收，使用缓存的探针计划（实现阶段已并行生成并落盘，见 `src/judge/plan-cache.ts`）。发现可复现业务失败，或需求明示的操作控件在此前已有成功交互、且两次新应用实例中均于同一步缺失时触发模块边界修复（后者仍记 inconclusive，Builder 按需求诊断），每个模块独立拥有至多两轮修复配额（`boundaryRepairCount` 在切换模块时重置）。修复后重跑缓存计划，优先复查已通过路径。失去既有 pass、无法重新验证它或没有任何修复目标→verified 改善时恢复原检查点并停止修复。修复统一在模块边界就地发生，没有末尾集中修复。
5. **最终验收（只检测）**：所有模块实现完毕后执行最终全量验收，重跑缓存计划、优先复查已通过路径，只发布结果不发起修复——late consolidated repair 的巨型包与全量重审代价高于收益，failed 直接计入交付状态。纯业务失败仍须在新应用实例中复现才可记 failed。只检测的最终审计与交付修复后的重审都跳过定位精化（仍完整执行探针），精化只在会触发修复的模块边界审计里进行。
6. **Probe DSL**：role/label/text 定位可附单层 `scope`（及字面 hasText），用于卡片/行/对话框内定位；禁止嵌套 scope、CSS/XPath、动态代码和跨源导航。wire case 必须有终末 `assertion`；内部解析成统一 steps。goto 默认从 `/` 进入，非根路径须在需求文字中明示；精化仅改 locator，保留需求明示的目标名称与 exact 匹配，固定操作、输入与预期，且不得降低定位强度（带名称的交互控件角色不得降级为纯 text，label 不得降级为纯 text；button/link/menuitem 等同类角色互换允许）。终末断言对需求给出的控件名使用 role + exact，不用 text 兜底。支持 expectHidden 与有限 ARIA 状态 expectAttribute 断言，检查每次状态变化。混合失败先处理带快照的 locator 部分；会触发修复的每次原子验收至多两轮精化、一次浏览器基础设施重试（只检测审计不做精化）。业务失败复现共享这些额度。语义复核只改需求依据冲突，不改定位（定位仍走精化）；检测型审计不触发复核；每 case 每运行至多一次语义修正，旧判词作废、只采纳纠正后重跑的结果。
7. **交付**：最终验证为安装/构建/就绪/浏览器 smoke/grader-like 复验（只设 `PORT`，额外端口与未知路径），至多一次浏览器基础设施重试。剩余额度允许时至多三轮交付修复：每轮 Builder 未完成回执即直接回滚、不做无效复验（其结果必然被丢弃），完成回执才复验；未通过复验的轮次回滚到接受基线后再开下一轮。修复被保留后重新验收，未重验的功能标 inconclusive，不能沿用旧版本的 pass。
8. **预算**：默认和显式 `0` 均不限总时长；正预算分别预留实现60%、初验20%、修复15%、交付5%，未用时间向后结转。main 单次实现上限90min（正预算时另受实现阶段剩余预算限制），模块边界修复上限90min（最多剩余修复阶段一半），交付修复单次上限30min（至多三轮）；Planner 请求在没有总预算时持续等待回复，有正预算时受当前阶段剩余额度限制。构建/清理/最终检查有独立超时，因此总预算不是进程硬截止时刻。
9. **Builder 边界**：Pi coding-agent 是唯一业务代码写入者，每次调用运行在独立 Worker 子进程，结束后由控制器回收进程组并做安装/构建/独立浏览器检查。文案外置 `prompts/`；Builder 持文件、shell、`app`（父进程管理开发服务 start/status/stop）、`run_tests`（限内存传统测试执行，见 `src/builder/pi-test-tool.ts`）与会话内 browser 工具（昂贵操作，惰性启动 Chromium，仅用于常规检查无法回答的真实浏览器行为；见 `src/builder/pi-browser-tool.ts`），不持常驻浏览器/MCP。实现按规划→实施→检查→交接进行，复杂或边界逻辑必须编写传统测试并用 run_tests 运行。模块边界由控制器抽样独立路径反馈（不授予整条需求 verified）。改文案同步 prompt 资产和测试。
10. **运行时恢复**：主线 Builder 与 Planner 通过 `gateway-recovery.ts` 共享临时网关故障退避；Planner 单路排队。控制器在同一调用窗口内持续退避重试（429 限流 30s 起、上限 5min；5xx/408/断连 5s 起、上限 1min；均遵守 Retry-After，不越过阶段/调用剩余额度）；窗口耗尽返回最后一次网关失败，控制器用新窗口重试同一需求包或修复批次，直至网关恢复或阶段预算耗尽——网关中断只暂停派发，不会终结本轮（预算 0 时可一直等待恢复）。网关将上游 `connection reset by peer` 包装成 HTTP 400 时，Worker 只根据实际网关状态与 SDK/provider 错误消息的精确组合将其按连接故障重试，模型内容不参与分类；普通请求错误不重试，Builder 的请求错误与认证失败一样停止派发（需求保持待处理）；Planner 单独的认证/协议错误不停止仍可工作的 Builder。git 单命令30s；Pi Worker 进程组/作业回收最多5s。每次调用结束后父进程回收拥有的进程组并等待退出确认，启动故障终止运行并恢复检查点，清理失败按执行故障终止本轮。Judge 故障保留应用并报告不确定。cgroup 计数仅用于诊断。新增事件同步 types/human-log；app 工具启动的服务由父进程在 Worker 结束后回收，再清理临时数据；启动中的请求先收敛再停止服务。源码或构建发生变化会使候选证据失效。接受输入 digest 只覆盖 Git 回滚能还原的文件（tracked + 未被忽略的 untracked），被忽略的运行/构建产物（dist、data、依赖）不计入，否则失败修复留下的产物会让回滚口径对不上。

Catalog 继续展开并验证原子依赖，保留完整原文与树。修改功能分组验证 `test/scheduler.test.ts`；修改主流程验证 `test/pipeline.e2e.test.ts`、`test/locator-recovery.test.ts`、`test/candidate-runtime.test.ts`、`test/run-budget.test.ts`、`test/semantic-correction.test.ts`、`test/semantic-review.test.ts`；修改 runtime 同时验证 baseline、自测与图片输入测试。

## Builder 需求输入

- 开发检查与模块边界审计：Builder 持文件、shell 与 `run_tests` 工具做开发检查（Windows PowerShell / Linux Bash；传统测试一律经 run_tests，shell 中的测试命令被拒绝），另持昂贵的会话内 browser 工具（仅特殊场景）；不持常驻浏览器/MCP；检查流程在 `prompts/system/self-test.md`。控制器在每次调用结束并回收进程后执行安装、构建与独立浏览器检查；每个模块边界切换时执行完整模块边界审计，使用缓存的探针计划，修复配额每个模块独立至多两轮。修改时验证 `test/pipeline.e2e.test.ts`、`test/builder-prompt.test.ts` 和 `test/prompt-assets.test.ts`；进程和数据清理责任见 README“Builder 开发检查与模块边界审计”。

- 需求证据：catalog 保留原子及祖先中的双引号/中文引号/反引号界面文案，原子与祖先参考图均进入 Builder 图片输入；Planner 同时接收祖先文字。
- 种子状态按动作前初始态解释；GIVEN 所需变更通过场景准备动作建立。Builder 每次调用注入独立的 SHALLOW_DATA_DIR，shell/run_tests 继承，父进程回收 Worker 后清理；共享执行层使 baseline 同样生效。应用需遵守该变量。
- 种子数据：`catalog.ts` 的 `parseSeedData` 读取 YAML 顶层 `data`，`prompt.ts` 的 `projectContextSection` 经 `seed-data.md` 按分类全量渲染为产品级共享预置；空数组省略该段。交付修复仅携带交付失败及平台合同，Planner 维持当前需求的文字证据输入。需求原文与种子数据保持完整，1500 字符限制属于观测与诊断通道。`extractSeedDeclarations` 从需求证据文本（含祖先）摘录 `Seed data:`、`Seed values:` 与 `evaluation seed contains` 声明，保留来源措辞；`workPacketSection` 按需求 ID 聚合为“本包初始数据原文摘录”（空则省略）。摘录用于核对各自作用域：明确要求由应用提供且彼此相容的预置记录完整播种，独立场景中同名对象的互斥初始值分别保留。Builder 仍须核对需求全文，在 ARCHITECTURE.md 记录共享种子和按场景区分的初始条件。Planner 输入同样携带 `seedDeclarations`，探针规则明确种子是动作前初始数据、不是创建/修改的目标名。
- 图片：生产入口把需求目录传给 `PromptBuilder.options.requirementsDir`（经 `PiWorkerClient`）；`loadReferenceImages` 加载当前 packet 原子需求及祖先描述/visual_reference 中的图片引用并去重，校验解码路径、真实路径、文件签名并去重。支持本地 PNG/JPEG/WebP/GIF，单图 10 MiB、每包 30 MiB；不可用引用写入 `skipped` 并依据文字继续。SDK 使用 `file` part 的 data URL 传递附件。
- 拒图回退：携图请求被明确识别为图片输入不支持、且响应没有工具或已完成步骤的执行证据时，先 abort 原会话，再用新会话发送纯文本；每次尝试至多一次，复用原超时额度，当前 Builder 实例记住文本模式。普通错误仍走失败路径，packet 尝试计数和验收门槛保持原语义。
- 观测：`BuilderResult.referenceImages` 只保存模式、附件数量与跳过原因；`pipeline.ts` 发出 `builder_reference_images`，`human-log.ts` 渲染中文说明。图片载荷只用于模型输入。Builder 每次调用的 token 用量与模型/工具耗时分布保存在 `execution.usage`/`execution.timing`（由 `pi-execution-stats.ts` 聚合，只含计数与工具名，不含参数或消息内容），随 `builder_finished` 进私有台账与 run-log。
- 修改上述链路时，联合验证 `test/builder-prompt.test.ts`、`test/prompt-assets.test.ts`、`test/reference-images.test.ts`、`test/builder-reference-input.test.ts`、`test/pi-worker.test.ts`、`test/pi-errors.test.ts`、`test/pi-execution-stats.test.ts`；事件变化同步 `test/human-log.test.ts` 和 `test/pipeline.e2e.test.ts`。

## Baseline 开发范围

`baseline/index.ts` 以 ROOT 直接子树为工作单元、单会话顺序调用同一个 `PiWorkerClient`（raw Pi 对照），共享网关配置但自行组织提示词。输入由 `baseline/system.md` 与 `modulePrompt` 组装；系统提示词与 `prompts/system/platform-contract.md` 措辞对齐（不含工作包概念），单会话请求 1M 上下文窗口（`BASELINE_CONTEXT_WINDOW` 经 `CodingAgentRequest.contextWindow` 覆盖，主线缺省同为 1M）。完成状态来自调用结果，输出 `[baseline]` stderr 日志与 `.arc` 模块状态；业务正确性由独立评估确认。主线的模块调度、模块边界修复、Shadow 验收、可运行检查点、种子数据和图片装配位于主线控制器中。修改共享执行层时同时检查两条入口；运行方式及结果解释见 README 的“Raw Pi baseline”节。

## 代码与测试惯例

- **ESM/NodeNext**：所有相对 import 必须带 `.js` 后缀（TS 源文件也写 `.js`）。
- 测试框架是 Node 内建 `node:test` + `node:assert/strict`（不是 vitest/jest），经 `tsx --test` 运行。
- 无凭证测试一律用 `test/fakes/` 下的 FakeBuilder/FakeProbePlanner/FakeGitOps；Fake 只属于测试，不是生产架构。
- `index.ts` 通过注入 `AgentExecution` 支持测试替换生产装配；生产模块依赖（Builder/Planner/Runner/Git）都通过接口 port 注入，新模块照此模式。
- 模型接入复用 Planner 与 Pi 两条路径。Planner 使用 Node 内建 `fetch` 调用 OpenAI-compatible gateway；Pi Worker 在独立子进程内经进程内 `shallow-gateway` provider（Chat Completions）调用，网关密钥经 IPC 注入。
- 主线阶段观测走 `state.record → logSink`（stderr JSON + run-log.txt + ledger）；baseline 使用自己的 stderr 日志与 `ArcEventSink`。
- prompt 资产是 UTF-8 无 CR 的 Markdown，`{{占位符}}` 必须被填满（`fillTemplate` 残留即抛错）；新增 fragment 需同步 `prompt-fragments.ts` 的词典与对应测试。


## 工作原则

保持改动聚焦于当前任务，优先选择满足需求的最小且结构良好的方案。不要为假设中的未来需求增加抽象、扩展点、防御性 fallback 或无关重构；当前需求、现有架构、真实失败模式或明显简化实现能够证明其必要性时，可以增加复杂度。
对于安全、局部、可逆的仓库操作自行继续，包括读取代码、编辑、运行相关测试和修复由当前改动导致的失败。不要在首个可行实现后提前停止；完成相关验证后再结束任务。
在当前任务已授权的范围内，先从代码、文档和已有对话中解决不确定性；常规实现细节按现有项目惯例决定。同一具体事项的明确批准在当前任务中持续有效，无需重复询问；明确要求每次动作前确认的步骤仍逐次确认。需要澄清或批准时，只暂停依赖该决定的步骤，继续其他已授权工作。预算、重试上限和验收条件仍按各自规则执行。
