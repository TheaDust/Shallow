# AGENTS.md — ShallowCode

## 项目定位

ShallowCode 是 GOSIM Factory 2026 / ARC-Bench 比赛用的轻量控制器（harness）：OpenCode（经 `@opencode-ai/sdk`）是唯一写代码的 Builder，ShallowCode 本身**从不生成目标应用的业务代码**，只负责调度需求、生成黑盒探针、执行验收和止损。核心理念是 "Never let the builder grade itself"——Judge 与 Builder 之间有严格的信息防火墙（见下）。

竞赛背景见 `competition-info.txt`；设计文档：`docs/superpowers/specs/2026-09-02-shallowcode-v1-lite-design.md`（**与 `docs/design-v0.md` 冲突时以 V1-Lite 规格为准**）。

## 常用命令

```powershell
npm run typecheck        # tsc --noEmit（strict，覆盖 index.ts + src + test）
npm test                 # 单元测试（无浏览器）：tsx --test test/*.test.ts
npm run test:browser     # 真实 Chromium 浏览器测试：test/browser/*.test.ts
npm run test:all         # typecheck && npm test && test:browser（交付前必跑）
npm run smoke:credentials
npm start                # tsx index.ts
```

- 单跑一个测试文件：`npx tsx --test test/catalog.test.ts`。
- 没有独立的 lint/format 脚本；验证手段只有 typecheck + 测试。
- 浏览器测试需要已安装 Playwright Chromium（`npx playwright install chromium`），它们会 spawn `test/fixtures/app` 的 fixture server（自动预留随机端口）。

## 环境变量

生产运行必需（`src/runtime-config.ts` 中校验，缺失即抛错）：

- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MODEL`
- Builder（OpenCode SDK）与 Probe Planner 共用这套 gateway/model 配置。
- 三个变量也支持写入仓库根 `.env`（入口默认加载，真实环境变量优先；`.env` 不入库，模板 `.env.example`）。

凭据冒烟测试默认 **skip**，只有 `RUN_CREDENTIAL_SMOKE=1` 且上述三个变量齐全时才运行真实 OpenCode/LLM/Playwright——不要为了"通过"而伪造成功。

## CLI 与运行契约

`npm start -- --requirements-dir <dir> --output-dir <dir> [--budget-ms <ms>]`（严格解析：只认这三个 flag，且必须 `--key value` 成对出现，未知/缺值直接抛错；`--budget-ms` 可选，缺省或 `0` 表示不限时，管线在没有 ready 需求后进入交付）。

ARC-Bench 评测走适配包入口 `python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]`（契约见 `octos-org/arc-adapter`；env 回退 `ARCBENCH_TASK_DIR` / `ARCBENCH_TEMPLATE_DIR`；`SHALLOW_BUDGET_MS` 注入总预算）。`main.py` 只做参数解析、Node 运行时准备与驱动 TS 管线，不写业务逻辑。

- requirements 文件固定为 `<requirements-dir>/requirements.yaml`，缺失即报错。
- 平台合同（ARC-Bench）：目标应用 `frontend/` + `backend/` 目录（npm install/build/start），backend 必须读 `PORT` 环境变量（缺省 3000），暴露 `/health`；Windows 上自动用 `npm.cmd`。
- 端口 3000 是评测端口，生成期不得占用：管线每次运行用随机空闲端口做探针/交付验证，可用 `SHALLOW_PROBE_PORT` 覆盖。
- 平台观察协议：管线把 `runner_state`/`requirement_state`/`signal` 事件追加到 `<output-dir>/.arc/runner-events.jsonl`，维护 `.arc/traceability/` 七张 JSON 表（`src/arc-protocol.ts`），关键事件同时镜像 stderr。
- 输出目录必须是 git 仓库根（`GitCliOps.open` 会 init 或校验）；仓库内提交统一使用内联 `-c user.name=ShallowCode -c user.email=shallowcode@local.invalid`。
- 运行 ledger 追加写到 `%TMP%/shallowcode-runs/<pid>-<ts>/run-ledger.jsonl`（仅审计用）。

## 架构不变量（改动前必读）

管线：`catalog → scheduler → WorkPacket → OpenCodeSdkBuilder → LlmProbePlanner → PlaywrightProbeRunner → DecisionLoop → GitOps`；`src/arc-protocol.ts` 并行维护平台 `.arc/` 事件流与溯源表。

以下约束当前是设计核心：

1. **信息防火墙**：Probe Planner 和 Probe Runner 绝不能看到目标应用源码；Builder 只看到当前 packet 原文 + ShadowReport，修复 prompt 不得泄露 planner 的隐藏推理。官方测试/官方结果任何模块都不允许读取。
2. **Packet 尝试上限**：首次实现 + 最多 2 次修复；第 3 次 Shadow 失败后必须 `restoreAccepted` 回滚并阻塞该 packet，不得继续烧预算。
3. **单调接受**：只在 Shadow `pass` 后 `captureAccepted` 更新 acceptedSha；失败一律回滚到最后接受状态。
4. **Probe DSL 白名单**：探针是声明式步骤（`src/judge/probe-schema.ts`），locator 只映射 `getByRole/getByLabel/getByText`，`goto` 只允许相对路径绑定受控 baseUrl；禁止 `page.evaluate`、任意网络请求、动态代码。
5. **交付窗口**：预算耗尽或没有可调度的 ready 需求后才停止领新 packet，只做 FinalVerifier（+ 至多一次交付修复 session）；一旦进入不可退出。
6. **Builder 不做局部决策之外的事**：选型、文件结构、局部构建修复都归 OpenCode；ShallowCode 不新增第二套源码编辑工具。

调度器（`src/scheduler.ts`）是**无模型**的确定性规则：只选依赖全 verified 的 todo 需求，packet 上限 3 个相邻需求。

## 代码与测试惯例

- **ESM/NodeNext**：所有相对 import 必须带 `.js` 后缀（TS 源文件也写 `.js`）。
- 测试框架是 Node 内建 `node:test` + `node:assert/strict`（不是 vitest/jest），经 `tsx --test` 运行。
- 无凭证测试一律用 `test/fakes/` 下的 FakeBuilder/FakeProbePlanner/FakeGitOps；Fake 只属于测试，不是生产架构。
- `index.ts` 通过注入 `AgentExecution` 支持测试替换生产装配；生产模块依赖（Builder/Planner/Runner/Git）都通过接口 port 注入，新模块照此模式。
- LLM 调用只用 Node 内建 `fetch` + OpenAI-compatible gateway，不引入第二个模型 SDK。
