# ShallowCode

ShallowCode 是 OpenCode 之外的一层轻量比赛控制器，面向 GOSIM Factory 2026 / ARC-Bench。它的边界只有一句话：

> 只实现 OpenCode 因为不知道整场比赛的全局状态而无法可靠实现的部分。

OpenCode 负责创建和修改目标应用、选择技术栈、局部构建与修复；ShallowCode 负责解析整棵需求树、调度 WorkPacket、用独立 LLM 生成黑盒探针、用真实浏览器确定性判定、维护唯一的 accepted SHA，并完成最终交付验证。详细设计见 `docs/superpowers/specs/2026-09-02-shallowcode-v1-lite-design.md`（主设计）、`2026-09-04-shallowcode-opencode-prompts-design.md` 与 `2026-09-05-builder-prompts-externalization-design.md`（Builder prompt 体系）。

## 快速开始

```powershell
npm ci
```

配置三个网关变量（OpenCode Builder 与 Probe Planner 共用同一网关）：

| 环境变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | 网关 API key，交给 Planner 请求头与 OpenCode provider 配置 |
| `OPENAI_BASE_URL` | OpenAI-compatible 网关地址 |
| `MODEL` | 网关接受的完整模型 ID（含 `/` 时原样传递） |

三个变量可以写入仓库根目录的 `.env` 文件（模板见 `.env.example`，`.env` 不会入库），真实环境变量优先于文件值；credential smoke 同样读取 `.env`。

OpenCode 使用控制器显式配置的 `shallow-gateway` provider，主模型和辅助模型均走上述网关；SDK 服务使用随机空闲端口。运行环境须提供 `opencode` 可执行程序。

启动一次完整运行：

```powershell
npm start -- --requirements-dir <需求目录> --output-dir <输出目录> --budget-ms 600000
```

| 参数 | 说明 |
| --- | --- |
| `--requirements-dir` | 包含 `requirements.yaml` 的目录 |
| `--output-dir` | 目标应用输出目录（会作为独立 Git 仓库维护 accepted 状态） |
| `--budget-ms` | 可选，总 wall-clock 预算（非负整数毫秒）；缺省或 `0` 表示不限时 |

运行结束返回 `RunSummary`，`failed` 时进程退出码为 1，其余为 0。

`delivered` 要求最终验证通过且所有原子需求均已 verified；仍有 blocked 或 todo 需求时为 `partial`。`pipeline_finished` 事件包含结果、接受 SHA、已验证、阻塞和待处理需求 ID。

## 运行流程总览

```mermaid
flowchart LR
    R["requirements.yaml"] --> C["Catalog 解析"]
    C --> S["Scheduler 确定性调度"]
    S --> W["WorkPacket"]
    W --> B["OpenCode Builder"]
    B --> A["候选应用"]
    W --> P["LLM Probe Planner"]
    P --> PP["ProbePlan"]
    A --> PR["Playwright Runner"]
    PP --> PR
    PR --> SR["ShadowReport"]
    SR --> D["DecisionLoop"]
    D -->|"pass"| G["captureAccepted"]
    D -->|"fail"| W
    D -->|"三次失败"| X["restoreAccepted + block"]
    G --> S
    X --> S
    S -->|"无 ready 需求或预算耗尽"| F["FinalVerifier"]
    F --> SM["RunSummary"]
```

1. **Catalog**（`src/catalog.ts`）：按声明顺序保留原文、目录路径、场景、引用与显式 UI 文本；拒绝重复 ID、未知依赖与依赖环。目录依赖展开为该目录下所有原子需求，祖先的依赖由叶子继承；展开后再次检查依赖环。所有 ATOMIC 需求初始为 `todo`。
2. **Scheduler**（`src/scheduler.ts`）：确定性规则选择 1–3 个依赖全部 `verified` 的 ATOMIC 需求组成 WorkPacket；排序信号依次为具名场景数、直接依赖者数、显式 UI 文本数、较低的描述成本、声明顺序；packet id 由选中 ID 的 slug 拼接生成，重复调用结果一致。
3. **Builder**（`src/builder/`）：通过 `@opencode-ai/sdk` 驱动 OpenCode。Prompt 由 `prompts/` 目录的中文资产编译：固定的系统合同 + 按模式填充的任务模板（实现 / 修复 / 根因修复 / 交付修复），并按产品类型与需求关键词挑选实现规则碎片；每次任务附带统一的完成回执（receipt）。修复上下文只包含白名单化的 `ShadowReport` 观测（清洗、截断）；第三次修复要求先给出根因判断再改代码。超时自动 abort 并等待会话落地，返回 `completed / failed / timed_out`。
4. **Probe Planner**（`src/judge/llm-probe-planner.ts`、`probe-schema.ts`）：LLM 只根据 packet 证据生成声明式 `ProbePlan`（`goto/click/fill/select/expectVisible/expectText/expectValue/expectCount/reload/newContext`），禁止 CSS/XPath、脚本执行与跨源导航；网关返回的 JSON 自动剥离 markdown 围栏与前后杂文后解析。
5. **Probe Runner**（`src/judge/playwright-probe-runner.ts`）：真实 Chromium 按白名单执行探针，locator 只映射 `getByRole / getByLabel / getByText`，`goto` 绑定受控 baseUrl，每个 case 使用隔离 context；单步超时 2s、单 case 超时 15s，输出带失败分类（`assertion / locator / navigation / timeout / runner`）的结构化 `ShadowReport`。
6. **DecisionLoop**（`src/run-state.ts`）与 **GitOps**（`src/git-ops.ts`）：见下两节。
7. **FinalVerifier**（`src/final-verifier.ts`）：见交付阶段。

ProbePlan 的 JSON Schema 完整描述步骤与 locator 字段；每个 case 必须有断言，计划必须覆盖 packet 中每个需求 ID。空输入与空值断言均合法。每个 case 独立建立其所需前提。

管线启动时先 `captureAccepted` 一次，把输出目录初始状态（空目录时为空提交）记录为 baseline SHA。所有事件的去向见[运行产物与日志](#运行产物与日志)。

## 单个 WorkPacket 的判定循环

```mermaid
flowchart TD
    A["Builder 实现 / 修复（短 session）"] --> B{"Builder outcome？"}
    B -->|"failed / timed_out"| F["按失败报告进入判定"]
    B -->|"completed"| C["Planner 生成 ProbePlan"]
    C --> D["启动应用并执行探针"]
    D --> E{"ShadowReport verdict？"}
    E -->|"pass"| OK["captureAccepted 标记 verified"]
    E -->|"inconclusive 且未 refinement"| R["refineLocators 一次后重跑"]
    R --> D
    E -->|"fail"| N{"当前 attempt？"}
    N -->|"1"| A2["attempt 2 修复"]
    N -->|"2"| A3["attempt 3 修复（root-cause-first）"]
    N -->|"3"| BLK["restoreAccepted + 标记 blocked"]
    A2 --> A
    A3 --> A
```

判定规则（`deriveProbeVerdict`）：

- **pass**：没有任何失败。`captureAccepted` 更新 accepted SHA，packet 需求标记 `verified`，继续调度。
- **fail**：存在 locator 之外的失败（断言、导航、超时、runner），或 locator 失败没有任何 aria snapshot。按 attempt 递进——第一次失败进入 attempt 2 修复；第二次失败进入 attempt 3 修复（prompt 要求先做根因分析）；第三次失败调用 `restoreAccepted` 回滚到 accepted SHA 并将该 packet 标记 `blocked`。每个 packet 最多三次 Builder 调用。
- **inconclusive**：仅当全部失败都是 `locator` 类且至少一个携带 aria snapshot 时，把清洗后的快照交给 Planner 做一次 locator-only refinement（不得改变输入值、断言或步骤数），重跑探针；refinement 不消耗 Builder 修复次数。
- 判定循环另有迭代上限（6）作为止损保险：超出即回滚并阻塞该 packet。
- 每次 Builder 尝试前检查预算；预算耗尽时不再开启 packet 修复，回滚未接受的候选并进入交付。
- 修复 prompt 只包含白名单化的观测结果，Planner 的隐藏推理与目标应用源码不进入修复上下文。

## 交付阶段

调度器持续领取新 packet，直到没有可调度的 ready 需求或总预算耗尽，随后不可逆进入交付。

```mermaid
flowchart TD
    S["无可调度 ready 需求 / 预算耗尽"] --> V["FinalVerifier：install → build → 启动 → readiness → 浏览器 smoke"]
    V --> P{"验证通过？"}
    P -->|"是"| FIN["记录 delivery_finished"]
    P -->|"否"| RP["唯一一次交付修复 session（root-cause-first，携带验证失败报告）"]
    RP --> V2["完整重跑 FinalVerifier"]
    V2 --> P2{"Builder completed 且复验通过？"}
    P2 -->|"是"| ACC["captureAccepted 接受交付修复"]
    P2 -->|"否"| FAIL["summary = failed，退出码 1"]
    FIN --> SUM["输出 RunSummary"]
    ACC --> SUM
    FAIL --> SUM
```

- FinalVerifier 按固定平台合同执行 install → build → 启动（注入 `PORT`）→ 轮询 `/health` readiness → 用真实浏览器打开根页面做最小 smoke；无论结果如何都终止本次验证启动的进程。
- 验证失败时启动恰好一次交付修复 session：Builder 收到 root-cause-first 指令与由验证报告转换的失败证据；随后**完整重跑**全部验证步骤，只接受复验通过的修复（`captureAccepted`）。
- 交付修复最多一次：只有 Builder 返回 `completed` 且复验通过才接受；其余情况恢复 accepted SHA 并以 `failed` 退出。异常 runner 故障同样会停止 Builder、回滚并记录失败。
- 启动日志持续读取，避免管道塞满；启动命令不存在时返回 readiness 失败。Windows 清理进程树，Linux 使用独立进程组停止启动器及其后代。

## 运行产物与日志

每次运行产生四类可观测产物：

- **stderr**：每个运行事件一行脱敏 JSON（`key/token/password/secret/cookie` 字段替换为 `[redacted]`，超长文本截断到 1500 字符），覆盖 `pipeline_started / packet_selected / builder_started / builder_finished / probe_planned / probe_finished / probe_refined / packet_accepted / packet_blocked / delivery_* / pipeline_finished` 等全部阶段。
- **run-log.txt（人类可读）**：与 ledger 同目录的中文运行日志，每个事件一行 `[本地时间 +耗时] 描述`（如 `[14:02:13 +2m13s] Builder 完成（auth-login）`）；启动时会把该文件的绝对路径打印到 stderr。
- **run-ledger.jsonl（机读台账）**：`%TMP%/shallowcode-runs/<运行ID>/run-ledger.jsonl`，与 stderr 同源同脱敏，仅审计用；可用 `SHALLOW_RUN_DIR` 换到自定义目录（仍按运行 ID 分子目录）。
- **输出仓库与 `.arc/`**：见 ARC-Bench 提交一节。

GitOps（`src/git-ops.ts`）细节：

- 输出目录必须是 git 仓库根（`open` 会 init 或校验），仓库内提交统一使用内联 `-c user.name=ShallowCode -c user.email=shallowcode@local.invalid`。
- 首次打开时若没有 `.gitignore`，会写入 `node_modules/`、`dist/`、`build/`、`.next/`、`.env` 并**立即提交**；已有文件（包括空文件）保持原样，读取错误直接报告。
- 回滚先 `reset --mixed <acceptedSha>`，再恢复除 `.arc` 外的已跟踪文件，并 `clean -fd -e .arc/`。应用回到 accepted 状态，`.arc` 保留完整运行事件和当前溯源记录，不加入忽略规则。
- 单条 git 命令默认 30s 超时，超时杀死子进程并等其退出后报错，避免悬挂与目录句柄泄漏。

## 预算与超时

| 超时 | 值 | 来源 |
| --- | --- | --- |
| 总预算 | `--budget-ms`，缺省或 `0` 为不限时 | CLI |
| Builder 单次调用 | 预算的 40%，下限 30s、上限 1200s；不限时取 1200s | `deriveModelTimeouts` |
| Planner 单次调用 | 预算的 10%，下限 10s、上限 720s；不限时取 720s | `deriveModelTimeouts` |
| Builder 超时后落地等待 | 5s（可经 `promptSettleTimeoutMs` 配置） | `OpenCodeSdkBuilder` |
| git 单命令 | 30s | `runGit` |
| 探针单步 / 单 case | 2s / 15s | pipeline 固定 |
| 构建 / 启动就绪 | 180s / 30s | 平台合同 |

预算控制新 packet 与后续修复的启动，进行中的调用仍受各自超时控制；最终交付独立执行，因此 `--budget-ms` 不是整个进程的强制终止时刻。Builder abort 也有 5s 等待上限；abort 失败或 prompt 在等待结束后仍未落地时关闭运行时，后续修复重启服务。

## ARC 平台合同

`src/runtime-config.ts` 固定目标应用的平台合同（不来自 LLM 输出）：

- 健康检查 `/health`
- `frontend/`、`backend/` 各自 `npm install`
- `frontend/` 执行 `npm run build`
- `backend/` 执行 `npm run start`，必须读取 `PORT` 环境变量（缺省 3000）
- 前端通过同源相对路径访问后端，构建产物中不写死主机或端口

端口 3000 是评测端口：平台在评测阶段用它访问网站，生成期占用会被 SIGTERM。因此 ShallowCode 在生成与验证阶段使用独立探针端口——每次运行随机挑选空闲端口，可用环境变量或 `.env` 中的 `SHALLOW_PROBE_PORT` 显式指定（拒绝 3000）；Builder prompt 中会写明这两个端口语义。

无论 OpenCode 选择什么框架，Builder 按此形态产出，判定与交付按此形态验证，保证跨 WorkPacket 的可复现判定。

## ARC-Bench 提交（适配包契约）

ShallowCode 依照官方参考实现 [`octos-org/arc-adapter`](https://github.com/octos-org/arc-adapter) 的适配包契约提交评测。

平台调用方式：

```
python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]
```

| 输入 | 来源 |
| --- | --- |
| 需求目录 | argv 或 `ARCBENCH_TASK_DIR` |
| 交付目录 | `--output-dir` 或 `ARCBENCH_TEMPLATE_DIR` |
| 模型通道 | 环境变量 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `MODEL`（也支持 `.env`） |

`main.py`（仅用 Python 标准库）只做四件事：解析参数与 `ARCBENCH_*` 回退、准备 Node 运行时（`npm ci` + `npx playwright install chromium`）、以 `npx tsx index.ts` 驱动管线（参数映射为 `--requirements-dir/--output-dir/--budget-ms`，总预算可用 `SHALLOW_BUDGET_MS` 注入）、收尾检查交付目录含 `frontend/` 与 `backend/`。

平台通过交付目录内的文件观察进度，管线运行时写入：

- `<交付目录>/.arc/runner-events.jsonl`：`runner_state` / `requirement_state` / `signal` 事件流（`src/arc-protocol.ts`，时间戳为 UTC `YYYY-MM-DD HH:MM:SS`）
- `<交付目录>/.arc/traceability/*.json`：七张溯源表——requirements、scenarios（从需求树生成）、node_states（随 accept/block 更新），其余表保留空对象
- `signal` 事件：`git_commit`（每次 accept 刷新提交历史）、`builder_receipt_recorded`（Builder 完成回执的脱敏摘要）、`requirement_tree_stored`
- 交付仓库的 git 提交历史（`captureAccepted` 每次 accept 自动产生）

工程要点：

- 运行事件以脱敏 JSON 行镜像到 stderr，人类可读中文日志见 run-log.txt（启动时打印路径）
- 上传上限约 50MB：本仓库不含 node_modules 与浏览器二进制，Playwright Chromium 在评测机运行时下载
- 评测机是共享的：探针端口随机化、每个 case 隔离 context、不依赖本地残留状态
- UI 契约（写入 Builder prompt）：关键输入用 `type="text"`、每个字段配可见 `<label>`、校验错误用 JS 输出文字而不用 HTML5 `required`、按钮用带纯文本的 `<button>`

提交流程（按官方 `arc.sh`）：

```sh
sh arc.sh pack   https://github.com/<org>/<repo>   # 验证打包
sh arc.sh submit <题目> <模型> https://github.com/<org>/<repo>
sh arc.sh check
```

## 测试

```powershell
npm run typecheck        # TypeScript 类型检查
npm test                 # 单元与集成测试（含无凭证完整 pipeline e2e）
npm run test:browser     # 真实 Chromium 浏览器测试
npm run test:all         # 以上全部
```

无凭证测试使用 `FakeBuilder` / `FakeProbePlanner` / `FakeGitOps`（仅存在于 `test/fakes/`）加真实 Playwright 跑通 `schedule → build → plan → judge → accept/repair/restore → final verify` 全链路，覆盖 accept、修复后通过、三次失败后 restore/block、locator refinement、builder 超时落地等待、git 超时与忽略规则、交付修复 + 完整复验。

真实 OpenCode / LLM 集成由 credential smoke 覆盖：

```powershell
npm run smoke:credentials
```

仅当 `RUN_CREDENTIAL_SMOKE=1` 且三个网关变量齐备（环境变量或 `.env`）时执行，否则明确 SKIP。

## 目录结构

```text
main.py                        ARC-Bench 适配包入口：参数解析、Node 运行时准备、驱动管线
index.ts                       生产入口：CLI、.env 加载、凭证装配、依赖注入、退出码
prompts/
  system/                      Builder 系统合同、四类任务模板（实现/修复/根因修复/交付修复）、action 与 receipt 资产
  fragments/                   产品域实现规则：可访问控件、服务端持久化、权限、仓库协作、表格、交付合同
src/
  types.ts                     领域类型：需求、WorkPacket、平台合同、ShadowReport、RunEvent
  cli.ts                       严格 CLI 参数解析
  catalog.ts                   requirements.yaml → 需求树（重复/依赖/环校验）
  scheduler.ts                 无模型确定性调度（1–3 个依赖全 verified 的需求）
  pipeline.ts                  依赖注入编排：packet 循环、修复梯子、交付窗口、事件记录
  run-state.ts                 判定决策、运行状态、脱敏 ledger 与 logSink
  git-ops.ts                   输出仓库操作：初始化 + .gitignore、capture/restore、单命令超时
  final-verifier.ts            交付验证（install→build→启动→readiness→浏览器 smoke）与 CommandAppLifecycle
  arc-protocol.ts              .arc/ 事件流、七张溯源表、builder 回执信号
  runtime-config.ts            网关配置、预算→模型超时派生、平台合同、探针端口
  process-spawn.ts             子进程 seam：Windows .cmd 经 cmd.exe，拒绝 shell 元字符
  human-log.ts                 运行事件 → 中文人类可读日志行（本地时间 + 耗时）
  builder/
    port.ts                    BuilderPort/BuilderResult 端口（completed/failed/timed_out）
    opencode-sdk.ts            OpenCode SDK 适配：短会话、超时 abort + 落地等待
    prompt.ts / prompt-input.ts  prompt 编译（四种模式）与输入类型
    prompt-assets.ts           prompts/ 资产加载与 {{占位符}} 模板填充
    prompt-fragments.ts        产品词典 → fragments 选择
    shadow-observation.ts      ShadowReport → 白名单观测（清洗、截断）
  judge/
    probe-schema.ts            ProbePlan 白名单 schema 与 locator-only refinement 校验
    llm-probe-planner.ts       LLM 探针规划（JSON 容错提取、一次 locator refinement）
    playwright-probe-runner.ts 真实 Chromium 探针执行与 verdict 判定
test/
  *.test.ts                    单元/集成测试（含无凭证全链路 e2e）
  browser/                     真实 Chromium 测试
  fakes/ fixtures/ helpers/    测试专用 fake、fixture app 与工具（不属于生产架构）
docs/superpowers/              设计文档（specs/）与实施计划（plans/）
data/github、data/sheet        比赛需求样例
```

## 设计边界

- 生产路径只有一个业务代码 Builder：OpenCode SDK；ShallowCode 不新增第二套源码编辑工具。
- Builder 文案全部外置在 `prompts/` 中文资产中（系统合同、任务模板、规则碎片、回执），代码只负责组装与填充。
- Probe Planner 看不到目标应用源码、diff 与 OpenCode 对话；Builder 只看到白名单化的观测（清洗 + 截断），看不到官方测试与评分反馈。
- Probe Runner 不执行模型生成的任意代码，只解释白名单 DSL。
- 失败次数有硬上限（每个 packet 最多两次修复、判定循环 6 次迭代上限，交付阶段最多一次修复），失败总能回到最后 accepted SHA。
