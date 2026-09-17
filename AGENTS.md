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
  system.md                     baseline 系统提示词与平台合同

prompts/                        Prompt 资产（system/、fragments/ 为 Builder 中文 Markdown；judge/ 为 Judge 中文 Markdown；改文案改这里，不改 TS）
  system/builder-system.md      Builder 固定系统合同
  system/task-*.md              四种模式的任务模板：implement / repair / root-cause-repair / delivery-repair
  system/action-*.md            模板里的动作段（含 {{占位符}}）
  system/receipt.md             每次任务附带的完成回执格式
  system/self-test.md           Builder 开发检查流程（传统测试、昂贵 browser 工具约定）、清理责任与结果报告
  system/platform-contract.md   平台命令与端口合同模板（评测缺省 3000、生成期注入探针端口）
  system/seed-data.md           顶层 data 的种子数据段模板
  system/reference-images*.md   图片附件说明与模型拒图后的纯文本说明
  fragments/*.md                产品域实现规则碎片；由词典选择（见 prompt-fragments.ts）
  judge/probe-planner.md        Judge Planner 计划生成系统提示词（中文）
  judge/probe-refinement.md     Judge Planner locator 精化系统提示词（中文）

src/
  types.ts                      领域类型：AtomicRequirement、WorkPacket、PlatformContract、ShadowReport、RunEvent
  cli.ts                        parseCliArgs：严格解析 --requirements-dir/--budget-ms；--output-dir 可选（缺省 shallowcode-local/<entry>）
  catalog.ts                    requirements.yaml → 需求树与 ProductContext.seedData；校验 ID 和依赖
  scheduler.ts                  featureGroupPackets：确定性有界功能组（同父目录→同 ROOT 子树扩展、依赖亲和 tie-break、6 条/12 场景/18k 字符阈值封口、单条超限独立成组、内置唯一覆盖与依赖序验证、GroupingStats 落账）；auditPackets：逐原子验收及前置需求文字上下文
  pipeline.ts                   编排核心：模块实现、可运行检查点、独立验收、至多两轮集中修复与最终交付
  run-budget.ts                 RunBudget：显式正预算的阶段预留和调用剩余额度；缺省/0 不限总时长
  run-state.ts                  RunStateStore（功能状态、可运行检查点 SHA、ledger+logSink）、
                                sanitizeDiagnosticText（诊断文本清洗）
  git-ops.ts                    GitCliOps.open（仓库校验 + .gitignore 初始化并提交）、captureAccepted/
                                restoreAccepted（保留 .arc 的应用回滚）、runGit（单命令 30s 超时）
  final-verifier.ts             FinalVerifier（install→build→启动→/health readiness→浏览器 smoke）与
                                CommandAppLifecycle（平台合同进程启停）
  arc-protocol.ts               ArcEventSink：官方 .arc 事件、完整需求树、投影 journal 与幂等重建
  diagnostics.ts               sanitizeDiagnosticText：已知密钥及常见凭证脱敏、控制字符清理、截断
  runtime-config.ts             readGatewayConfig、readEnvFile（.env）、createArcPlatformContract、
                                deriveModelTimeouts（预算→Builder/Planner 超时）、SHALLOW_PROBE_PORT、pickFreePort
  process-spawn.ts              spawnProcess：Windows .cmd/bat 经 cmd.exe 启动并拒绝 shell 元字符；其余直接 spawn
  execution-fault.ts            ExecutionFault：浏览器执行故障、Builder 运行时启动故障；与 Shadow 判词分离
  human-log.ts                  HumanRunFormatter：RunEvent JSON → 中文日志行（[本地时间 +耗时] 描述），未知类型返回 null
  prompt-assets.ts              loadPrompt（读 prompts/ 资产，LF 归一+缓存）、fillTemplate（{{占位符}} 校验）
  builder/
    port.ts                     BuilderPort / BuilderResult（outcome、execution 元数据与可选 referenceImages 诊断）
    execution-port.ts           CodingAgentPort 引擎无关执行端口（controller 与 raw baseline 共用）
    prompt-builder.ts           PromptBuilder：实现 BuilderPort、编译 prompt、拒图纯文本回退、驱动 CodingAgentPort
    pi-worker-client.ts         PiWorkerClient：fork 独立 Node Worker、IPC、会话文件映射、进程组/作业回收与退出确认
    pi-worker.ts                唯一导入 Pi SDK 的入口：单次调用、会话续接、工具装配、SDK 事件与终态判定
    pi-tools.ts                 read/edit/write 路径限制与 shell 命令白名单后端（复用 SDK schema/截断，替换执行后端）；
                                装配会话内 browser 工具
    pi-browser-tool.ts          Builder 会话内 browser 工具：惰性启动 Chromium、脚本执行、输出截断，Worker 结束时关闭
    reference-images.ts        loadReferenceImages：当前 packet 图片读取、真实路径/格式/大小校验
    prompt-input.ts             BuilderPromptInput 判别联合（implement/repair/root_cause_repair/delivery_repair）
    prompt.ts                   compileBuilderPrompt / buildBuilderTaskPrompt：系统合同 + 模板填充 + fragments 拼装
    prompt-fragments.ts         selectPromptFragments：产品 kind 基础集 + generic_web 关键词 lexicon + 观测扩展
    shadow-observation.ts       toBuilderShadowObservation：ShadowReport → 白名单观测（控制字符清洗、1500 截断）
  judge/
    audit.ts                    auditPacket：计划恢复、定位恢复、业务失败复现；Judge 故障返回 inconclusive
    probe-schema.ts             ProbePlan/ProbeCase schema、显式终末 assertion、单层 scope、parseProbePlan（白名单校验）、
                                assertLocatorOnlyRefinement（refinement 只许改 locator）
    llm-probe-planner.ts        LlmProbePlanner：网关调用（json_schema）、extractJsonPayload（剥围栏/杂文提取 JSON）、
                                plan/refineLocators（失败步骤诊断 + locator 校验；系统提示词见 prompts/judge/；恢复额度由 pipeline 管理）
    playwright-probe-runner.ts  PlaywrightProbeRunner（白名单 DSL 执行）+ deriveProbeVerdict（pass/fail/inconclusive）
  process-lifecycle.ts          ownProcessTree（Windows Job Object / POSIX 进程组回收）、toolEnvironment（工具最小环境）
  memory-snapshot.ts            memorySnapshot：Linux cgroup 内存诊断采样（memory.current/peak/max/events）

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
- `RUN_CREDENTIAL_SMOKE=1`：三个网关变量齐全时才运行真实 Pi/LLM/Playwright 冒烟测试，默认 skip——不要为了"通过"而伪造成功。
- `SHALLOW_BUDGET_MS` / `ARCBENCH_TASK_DIR` / `ARCBENCH_TEMPLATE_DIR`：主线和 baseline 的 Python 适配入口读取真实环境。

## CLI 与运行契约

`npm start -- --requirements-dir <dir> [--output-dir <dir>] [--budget-ms <ms>]`（严格解析：只认这三个 flag，且必须 `--key value` 成对出现，未知/缺值直接抛错；`--output-dir` 可选，缺省 `<系统临时目录>/shallowcode-local/<main|baseline>`——主线与 baseline 各用各的，绝不共用；`--budget-ms` 可选，缺省或 `0` 表示不限时，管线按模块实现、独立验收、集中修复、交付顺序运行；显式正预算按 60%/20%/15%/5% 预留阶段时间）。

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
- 平台合同（ARC-Bench）：目标应用 `frontend/` + `backend/` 目录（npm install/build/start），backend 必须读 `PORT` 环境变量（缺省 3000）并在监听 PORT 的同时额外监听 3301（部分题目验收测试把目标地址硬编码为 `http://127.0.0.1:3301`；生成期自检与控制器启动应用都传 `ARC_EXTRA_PORTS=0`，跳过 3301），暴露 `/health` 与 `/api/health`；Windows 上自动用 `npm.cmd`（经 `src/process-spawn.ts`）。
- 输出目录必须是 git 仓库根（`GitCliOps.open` 会 init 或校验）；仓库内提交统一使用内联 `-c user.name=ShallowCode -c user.email=shallowcode@local.invalid`。
- 首次打开输出仓库时若无 `.gitignore` 则写入 `node_modules/`、`dist/`、`build/`、`.next/`、`.env` 并立即提交（回滚 `clean -fd` 后仍生效）；已有 `.gitignore` 不动。**不要**把 `.arc/` 加进忽略规则。
- `GitCliOps.open` 首次初始化允许目录为空，或只含 `.gitignore` 与平台预置脚手架 `.arc/`、`requirements/`；其他残留会被拒绝。目录同时含 `frontend/` 与 `backend/` 时视为 evolution 模板（上一轮产物），整目录被接受：跳过空目录校验，脏的第三方仓库也直接采纳为基线，并用仓库本地的 `.git/info/exclude` 排除 `node_modules/`、`dist/` 等（不改模板自身的 `.gitignore`）。既有仓库按根提交标题识别为 ShallowCode 仓库时，会硬重置并清理应用的未提交改动、删除旧 `runner-events.jsonl`；其他脏仓库会被拒绝。复用输出目录前先备份人工修改和历史记录，根提交标题并不证明未提交改动的来源。
- 运行产物四件套：stderr 脱敏 JSON 事件流、`%TMP%/shallowcode-runs/<pid>-<ts>/run-ledger.jsonl`（机读台账）、同目录 `run-log.txt`（中文人类可读，`HumanRunFormatter` 生成）、`<output-dir>/.arc/`（平台事件流 + 溯源表）。
- 运行事件经 `RunStateStore.record` 统一发射并注入运行/事件 ID、序号、耗时和接受基线；新增事件同步 `types.ts` 的判别联合与 `human-log.ts` 中文文案。Planner `contentPreview` 仅写私有 ledger；Builder 回执属于内部自述诊断。
- 修改脱敏、证据或 ARC 投影时，先读 `docs/2026-09-07-observability-arc-projection.md`：官方固定提交与字段、投影重建范围和安全限制均在此。验证 `test/observability.test.ts`、`test/arc-protocol.test.ts`、`test/human-log.test.ts`、`test/pipeline.e2e.test.ts`；目录链接检查不代表 OS 隔离。
- `RunSummary.delivered` 要求当前交付版本全部原子需求 verified 且最终验证通过；todo/blocked/failed/inconclusive 均为 partial。implementedRequirementIds 表示模块完成且构建/启动检查通过，不代表功能正确。未接受的交付修复与异常退出都回滚；`pipeline_finished` 记录汇总及待处理 ID。
- 回滚不再移动 HEAD：`restore --source <acceptedSha> --staged --worktree -- . :(top,exclude).arc` 同步索引与工作区（会删除被拒尝试引入的源码文件），`clean -fd -e .arc/` 清掉未跟踪残留，然后以 `--allow-empty` 提交一个恢复提交。失败尝试保留在历史中永远可达，`.arc` 保留包括失败在内的完整审计记录。

## 架构不变量

管线：`catalog → 功能组实现 → 可运行检查点 → 原子需求独立验收 → 集中修复 → 最终交付`；`src/arc-protocol.ts` 并行维护平台 `.arc/` 事件流与溯源表。

1. **信息防火墙**：Planner/Runner 不读取目标源码、diff 或 Builder 会话。Builder 接收需求、种子数据、图片及白名单失败观测。隐藏计划与 Planner 推理仅留在 Judge；官方测试和结果不进入任何运行模块。
2. **功能组实现**：实现工作包是确定性有界功能组（设计文档 `docs/2026-09-15-feature-slices-and-builder-loop.md` §3）：种子取全局声明序中第一个依赖已调度的原子项，扩展限同一直接父目录与同 ROOT 子树，按依赖亲和与声明序 tie-break，达 6 条/12 场景/18,000 字符阈值封口，单条超限独立成组；组不跨模块合并，允许离开模块后再回来补齐。分组内置程序化验证：全部原子 ID 唯一覆盖、每条依赖在当前项之前或同组内之前、原文不截断。所有功能组先实现，再验收；实现阶段每个工作包使用全新会话，跨包交接只经项目文件（代码、测试、ARCHITECTURE.md）。组内依赖和未 verified 的外部依赖不阻塞实现。
3. **检查点与验收分离**：`captureAccepted` 现在保存通过安装、构建、启动及候选一致性检查的可运行版本。只有独立探针通过才记 `verified`。Planner/定位/浏览器故障记 `inconclusive`，保留代码。Builder 回执失败/超时先保存尝试再实测：代码可运行则直接接受为可运行版本（`module_rescued`）；确实无法构建/启动才恢复上一检查点并标 blocked（`module_failed`），被拒尝试保留在历史中。
4. **模块边界验收与修复**：每个模块（ROOT 子树）实现完毕后执行模块边界验收，使用缓存的探针计划（实现阶段已并行生成并落盘，见 `src/judge/plan-cache.ts`）。发现失败时触发模块边界修复，每个模块独立拥有至多两轮修复配额（`boundaryRepairCount` 在切换模块时重置）。修复后重跑缓存计划，优先复查已通过路径。失去既有 pass、无法重新验证它或没有任何 failed→verified 改善时恢复原检查点并停止修复。模块边界修复与末尾集中修复的配额独立。
5. **集中修复**：所有模块实现完毕后执行最终集中验收。纯业务失败须在新应用实例中复现，再按需求汇总交给 Builder；每次运行至多两轮（`repairCount` 全局计数器）。修复后重跑缓存计划，优先复查已通过路径。失去既有 pass、无法重新验证它或没有任何 failed→verified 改善时恢复原检查点并停止修复。
6. **Probe DSL**：role/label/text 定位可附单层 `scope`（及字面 hasText），用于卡片/行/对话框内定位；禁止嵌套 scope、CSS/XPath、动态代码和跨源导航。wire case 必须有终末 `assertion`；内部解析成统一 steps。精化仅改 locator，固定操作、输入与预期。混合失败先处理带快照的 locator 部分；每次原子验收至多两轮精化、一次浏览器基础设施重试。业务失败复现共享这些额度。
7. **交付**：最终验证为安装/构建/就绪/浏览器 smoke，至多一次浏览器基础设施重试。剩余额度允许时至多一次交付修复；修复被保留后重新验收，未重验的功能标 inconclusive，不能沿用旧版本的 pass。
8. **预算**：默认和显式 `0` 均不限总时长；正预算分别预留实现60%、初验20%、修复15%、交付5%，未用时间向后结转。main 不限总时长时单次实现保留1h超时；正预算时实现上限10min，集中修复4min（最多剩余修复阶段一半），交付修复2min；Planner 单次尝试上限180s；实际取阶段剩余及 runtime 配置的较小值。构建/清理/最终检查有独立超时，因此总预算不是进程硬截止时刻。
9. **Builder 边界**：Pi coding-agent 是唯一业务代码写入者，每次调用运行在独立 Worker 子进程，结束后由控制器回收进程组并做安装/构建/独立浏览器检查。文案外置 `prompts/`；Builder 持文件、shell 与会话内 browser 工具（昂贵操作，惰性启动 Chromium，仅用于常规检查无法回答的真实浏览器行为；见 `src/builder/pi-browser-tool.ts`），不持常驻浏览器/MCP。实现按规划→实施→检查→交接进行，复杂或边界逻辑必须编写并运行传统测试。模块边界由控制器抽样独立路径反馈（不授予整条需求 verified）。改文案同步 prompt 资产和测试。
10. **运行时恢复**：git 单命令30s；Pi Worker 进程组/作业回收最多5s。每次调用结束后父进程回收拥有的进程组并等待退出确认，启动故障终止运行并恢复检查点，清理失败按执行故障终止本轮。Judge 故障保留应用并报告不确定。cgroup 计数仅用于诊断。新增事件同步 types/human-log；源码或构建发生变化会使候选证据失效。接受输入 digest 只覆盖 Git 回滚能还原的文件（tracked + 未被忽略的 untracked），被忽略的运行/构建产物（dist、data、依赖）不计入，否则失败修复留下的产物会让回滚口径对不上。

Catalog 继续展开并验证原子依赖，保留完整原文与树。修改功能分组验证 `test/scheduler.test.ts`；修改主流程验证 `test/pipeline.e2e.test.ts`、`test/locator-recovery.test.ts`、`test/candidate-runtime.test.ts`、`test/run-budget.test.ts`；修改 runtime 同时验证 baseline、自测与图片输入测试。

## Builder 需求输入

- 开发检查与模块边界审计：Builder 持文件与 shell 工具做开发检查（Windows PowerShell / Linux Bash），另持昂贵的会话内 browser 工具（仅特殊场景）；不持常驻浏览器/MCP；检查流程在 `prompts/system/self-test.md`。控制器在每次调用结束并回收进程后执行安装、构建与独立浏览器检查；每个模块边界切换时执行完整模块边界审计，使用缓存的探针计划，修复配额每个模块独立至多两轮（与末尾集中修复的配额独立）。修改时验证 `test/pipeline.e2e.test.ts`、`test/builder-prompt.test.ts` 和 `test/prompt-assets.test.ts`；进程和数据清理责任见 README“Builder 开发检查与模块边界审计”。

- 种子数据：`catalog.ts` 的 `parseSeedData` 读取 YAML 顶层 `data`，`prompt.ts` 的 `projectContextSection` 经 `seed-data.md` 按分类全量渲染到 implement、repair、root_cause_repair。空数组省略该段；交付修复仅携带交付失败及平台合同，Planner 维持当前需求的文字证据输入。需求原文与种子数据保持完整，1500 字符限制属于观测与诊断通道。
- 图片：生产入口把需求目录传给 `PromptBuilder.options.requirementsDir`（经 `PiWorkerClient`）；`loadReferenceImages` 仅加载当前 packet 的引用，校验解码路径、真实路径、文件签名并去重。支持本地 PNG/JPEG/WebP/GIF，单图 10 MiB、每包 30 MiB；不可用引用写入 `skipped` 并依据文字继续。SDK 使用 `file` part 的 data URL 传递附件。
- 拒图回退：携图请求被明确识别为图片输入不支持、且响应没有工具或已完成步骤的执行证据时，先 abort 原会话，再用新会话发送纯文本；每次尝试至多一次，复用原超时额度，当前 Builder 实例记住文本模式。普通错误仍走失败路径，packet 尝试计数和验收门槛保持原语义。
- 观测：`BuilderResult.referenceImages` 只保存模式、附件数量与跳过原因；`pipeline.ts` 发出 `builder_reference_images`，`human-log.ts` 渲染中文说明。图片载荷只用于模型输入。
- 修改上述链路时，联合验证 `test/builder-prompt.test.ts`、`test/prompt-assets.test.ts`、`test/reference-images.test.ts`、`test/builder-reference-input.test.ts`、`test/pi-worker.test.ts`、`test/pi-errors.test.ts`；事件变化同步 `test/human-log.test.ts` 和 `test/pipeline.e2e.test.ts`。

## Baseline 开发范围

`baseline/index.ts` 以 ROOT 直接子树为工作单元、单会话顺序调用同一个 `PiWorkerClient`（raw Pi 对照），共享网关配置但自行组织提示词。输入由 `baseline/system.md` 与 `modulePrompt` 组装。完成状态来自调用结果，输出 `[baseline]` stderr 日志与 `.arc` 模块状态；业务正确性由独立评估确认。主线的模块调度、集中修复、Shadow 验收、可运行检查点、种子数据和图片装配位于主线控制器中。修改共享执行层时同时检查两条入口；运行方式及结果解释见 README 的“Raw Pi baseline”节。

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
