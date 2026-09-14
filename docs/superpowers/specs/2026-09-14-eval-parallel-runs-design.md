# 本地评测脚本并行隔离设计（eval-local）

日期：2026-09-14。状态：已与用户确认设计，待实现。
前置：`2026-09-12-local-e2e-eval-script-design.md`（脚本初版）。本文件只描述并行隔离增量，不重复初版内容。

## 目标

让 `scripts/eval-local.mjs` 可以被**并发启动多次**（外部并发：多个终端/进程同时跑不同 agent、app、变体），各次运行相互独立：

- 端口不冲突；
- 生成的 app 产物目录不互相覆盖；
- Playwright 报告、trace、`.last-run.json` 不互相覆盖；
- benchmark 根的一次性安装（`node_modules`、浏览器）不因并发而损坏。

不在范围内：让单次调用内部并行跑多个包；修改 `benchmarks/arc-bench` 仓库；评测结果合并/对比。

## 并发模型

外部并发：每次脚本调用仍只处理一个包（一个 agent + 一个 app/需求目录）。脚本保证**默认配置下**同机多次运行安全；用户显式给出 `--output-dir`/`--port` 时按显式值执行。

## 运行标识

- 新增 `--run-id <id>`（可选）。缺省自动生成短 id：`<yyyyMMdd-HHmmss>-<4位随机十六进制>`。
- 缺省产物目录：`tmp/eval-local/<agent>[/<app>]/<runId>`（`--app` 时带 `<app>` 段，否则仅 `<agent>`）。
- `--output-dir <dir>` 给出时原样使用，不再拼接 `runId`（隔离责任交给用户）。
- banner 与汇总打印实际 `runId` 与产物目录，便于用 `--eval-only --run-id <id>` 复用同一产物。

## 端口

- `--port` 缺省值由固定 `3301` 改为**自动挑选当前空闲端口**（`net.createServer().listen(0)` 取得后立即关闭）。
- `--port <n>` 显式给出时仍使用该值，不探测。
- 选到的端口统一用于：生成命令的 `--web-port <port>`、backend 的 `PORT=<port>`、官方 runner 的 `--target-url http://127.0.0.1:<port>`。

## Playwright 写目录隔离

官方 runner `scripts/run-playwright.js` 已支持两个环境变量：

- `PLAYWRIGHT_OUTPUT_ROOT`：追加 `<app>/test-results` 作为 Playwright `outputDir`（trace、截图、`.last-run.json`）；
- `PLAYWRIGHT_REPORT_ROOT`：追加 `<app>/playwright-report` 作为 HTML 报告目录。

脚本据此隔离：

- 新增 `--artifacts-dir <dir>`，缺省 `tmp/eval-local/artifacts/<runId>`。
- 运行官方 runner 时注入 `PLAYWRIGHT_OUTPUT_ROOT=<artifactsDir>`、`PLAYWRIGHT_REPORT_ROOT=<artifactsDir>`。
- `summarize` 从 `<artifactsDir>/<testApp>/test-results/.last-run.json` 读取失败数，并打印 `<artifactsDir>/<testApp>/playwright-report/index.html` 与 `<artifactsDir>/<testApp>/test-results/`。
- 不再读写 benchmark 根下共享的 `test-results/`、`playwright-report/`。

## benchmark 根并发安装

- benchmark 根缺 `node_modules` 时需执行 `npm install` + `npm run test:install`。并发下用原子目录锁串行化：
  - 锁路径 `benchmarks/arc-bench/.eval-install.lock`，用 `mkdirSync` 原子创建；拿到后先**复查** `node_modules` 是否已存在（可能已被其他运行装好），存在则直接释放。
  - 拿不到锁时轮询等待（间隔 `POLL_MS`，设上限），装好后释放（`rmdirSync`）。等待超时视为失败，给出提示。
- 锁文件不对 benchmark 仓库做任何持久修改，评测结束前无论成败都尽力释放。

## 参数变化汇总

新增：`--run-id <id>`、`--artifacts-dir <dir>`。
变更：`--port` 缺省由 3301 改为自动；缺省 `--output-dir` 追加 `<runId>`。
其余参数语义不变。

## 错误处理

- 保持初版规则：任一阶段失败即停止后续阶段；退出前尽力停止 backend（`--keep-running` 除外）。
- 锁等待超时、空闲端口探测失败都按普通阶段失败处理，退出码非 0。

## 测试

- `--help` 与参数校验路径手动验证（含非法 `--run-id`/`--artifacts-dir` 缺值）。
- 用 `keep` 的 `--eval-only` 复用两份产物**并行启动两次**：确认端口不同、`artifacts/<runId>` 不同、两次报告/结果互不覆盖。
- 不用真实模型预算验证并行正确性；不新增单测（沿用初版「本地工具以真实端到端验证」的取舍）。
