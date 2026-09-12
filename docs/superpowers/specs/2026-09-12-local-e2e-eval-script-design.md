# 本地端到端评测脚本设计（main / baseline）

日期：2026-09-12。状态：已与用户确认设计，待实现。

## 目标

提供一个本地命令，把「ShallowCode 生成产物 → 构建 → 启动 → 跑 ARC-Bench 官方隐藏用例 → 汇总」串成一次可复现的评测，main 与 baseline 两条入口都支持，并实时流式显示各阶段日志。

不在范围内：修改 `benchmarks/arc-bench` 仓库、并发跑多 app、生成失败自动重试、解析 Playwright HTML 报告、自动 git 提交、容器化。

## 入口与参数

脚本：`scripts/eval-local.mjs`（Node ESM），npm 快捷方式：

```powershell
npm run eval:local -- --agent main --app keep
npm run eval:local -- --agent baseline --requirements-dir <dir> --test-app keep
```

- `--agent main|baseline`：必填，选择驱动入口。
- `--app <name>`：benchmark app 名；同时解析需求目录与测试目录。
- `--requirements-dir <dir>` + `--test-app <name>`：通用入口，二选一（与 `--app` 互斥）。
- `--eval-only`：跳过生成，可只给 `--test-app`（不需要需求目录），要求 `--output-dir` 已有产物。
- `--output-dir <dir>`：缺省 `tmp/eval-local/<agent>`（指定 app 时为 `tmp/eval-local/<agent>/<app>`）。
- `--port <n>`：本地评测端口，缺省 3301。
- `--budget-ms <ms>`：透传生成管线预算（经 `SHALLOW_BUDGET_MS`），缺省 0（不限）。
- `--generate-only`：只生成，不构建/启动/测试。
- `--skip-install`：跳过 frontend/backend `npm install`。
- `--skip-build`：跳过 frontend `npm run build`。
- `--keep-running`：测试后保留 backend 进程。
- `--playwright-timeout <ms>` / `--expect-timeout <ms>`：透传官方 runner。
- `--grep <pattern>`：透传官方 runner 的 Playwright `--grep`，用于本地调试子集（汇总会注明已过滤）。
- `--help`。

## 路径解析

- 仓库根：脚本所在目录的上一级（`scripts/` 的父目录）。
- benchmark 根：`<repo>/benchmarks/arc-bench`；读取其中 `apps.config.json`。
- `--app <name>` → `requirementDir = <benchmarkRoot>/arc-bench/webapp/<name>/requirements`，测试 app 名 `<name>`。
- `--requirements-dir` 通用入口必须显式 `--test-app`，仅用于定位官方测试；`--app` 与 `--requirements-dir` 同时给出时报错。

## 流程

1. 解析参数、校验（agent 合法；`--app`/`--requirements-dir` 二选一；`--eval-only` 的 output-dir 存在）。
2. 打印 banner 与配置（禁止打印密钥）。
3. **生成**：`python main.py <reqdir> --output-dir <out> --type web --web-port <port>`；baseline 为 `python baseline/main.py ...`。仓库根为 cwd，尝试 `python`，失败回退 `py -3`。流前缀 `[gen:main]` / `[gen:baseline]`。`--generate-only` 在此结束。
4. **构建**：`<out>/frontend` 执行 `npm install --no-audit --no-fund` 与 `npm run build`；`<out>/backend` 执行 `npm install --no-audit --no-fund`。前缀 `[build]`。
5. **启动**：`<out>/backend` 执行 `npm run start`，环境注入 `PORT=<port>`，前缀 `[app]`；轮询 `http://127.0.0.1:<port>/health` 就绪（默认 60s 超时）；进程提前退出视为失败。
6. **官方测试**：benchmark 根执行 `node scripts/run-playwright.js --app <testApp> --target-url http://127.0.0.1:<port>`，前缀 `[test]`；benchmark 根缺 `node_modules` 时先 `npm install` 与 `npm run test:install`。
7. **停止 backend**：终止进程树（Windows `taskkill /T /F`，其余 SIGTERM 进程组）；`--keep-running` 跳过。
8. **汇总**：生成/构建/测试退出码；通过数 = 官方 spec 用例总数（`<benchmarkRoot>/arc-bench/webapp/<testApp>/tests/**/*.spec.ts` 里 `test(` 的出现次数）减去 `test-results/<testApp>/.last-run.json` 的 `failedTests` 数量；打印 `playwright-report/index.html` 与 `test-results/<testApp>/` 路径。

## 日志

- 阶段分隔线：`===== [n/4] 阶段名 =====`。
- 子进程 stdout/stderr 逐行实时转发，带前缀与 ANSI 颜色；`pipe` 停止时 flush 残留缓冲。
- 错误行红色；失败阶段停下后续阶段。
- 终端输出；不落盘。

## 错误处理

- 任一阶段失败即停止后续阶段（生成失败不构建；构建失败不启动；启动/健康检查失败不测试）。
- 无论成功失败，退出前都尝试停止 backend（`--keep-running` 除外）。
- 失败时仍打印已知产物、报告、日志路径，便于排查。
- 退出码：0 全通过；非 0 表示首个失败阶段。

## 测试

- 用 `--help` 与参数校验路径手动验证。
- 至少用一个 app（建议 `keep`，体量最小）跑通 main 的 `--eval-only` 复用路径，避免每次烧模型预算。
- 不新增单测（脚本为本地工具，逻辑以真实端到端运行验证）。
