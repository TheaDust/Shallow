# 观测、安全边界与 ARC 投影

更新日期：2026-09-07。对应 pipeline improvement roadmap 第 13 节；适用于主线生产装配。Baseline 继续使用自己的运行日志和模块状态流程。

## 1. 数据归属

| 数据 | 持有者与存储 | 可见范围 |
| --- | --- | --- |
| 运行事件 | `RunStateStore`；`run-ledger.jsonl` | 控制器审计；脱敏后输出 stderr 和中文日志 |
| Planner 响应片段 | ledger 的 `contentPreview` | 控制器与 Planner 重试；stderr 不输出该字段 |
| 失败证据 | 日志目录 `evidence/<id>.json` | 控制器人工复核；日志只输出 ID |
| Builder 反馈 | `toBuilderShadowObservation` 单独构建 | 白名单失败观测，经已知密钥与常见凭证脱敏 |
| 平台投影意图 | `arc-projection.jsonl` | 控制器持有，仅包含平台事件与需求树 |
| 平台状态 | 输出目录 `.arc/` | 平台读取；字段按官方参考实现 |

隐藏计划不存入 ARC、失败证据或 Builder 回执通道。原始浏览器 trace 和截图没有加入本轮采集；文本证据只保留报告中的必要字段。需求树、场景原文和种子数据与诊断文本分开处理，仍按源需求保留。

## 2. 内部事件与中文日志

`types.ts` 定义事件判别联合及各自 detail 字段；`RunStateStore.record` 注入运行 UUID、事件 ID、递增序号、阶段、累计耗时、最后接受 SHA，以及已登记的 packet attempt。一个进程内的运行 UUID 与日志目录的 `<pid>-<ts>` 名称用途不同，不应混用。

SHA 表示最后接受的基线，不代表 Builder 正在编辑的候选内容。累计耗时从首个事件计算；Builder 和探针完成事件另记录调用耗时。启动事件记录模型、Builder/Planner 超时、全部 Builder Markdown 资产的内容摘要、Probe wire schema 摘要；摘要用于实验比对，不改变 prompt。真实模型 usage 尚未接入，明确标记 `unavailable`。

人类日志覆盖：需求包名称、Builder 开始/完成、Planner 规划/失败/精化、应用启动/就绪/停止、探针执行与通过/失败数量、失败分类和证据 ID、修复次数与根因优先要求、交付验证、最终完成程度与未完成 ID。Builder 回执标为自述诊断，不能作为通过判定。正文换行显示为 `↵`，每个事件占一行。

`RunStateStore` 的日志文件或输出 sink 失败不影响决策；ARC 调用失败单独记录 `arc_projection_failed`。初始化/最终重建的 ARC 告警由入口直接输出，因此这两类告警可能没有完整内部 envelope。诊断失败不会被解释为一次业务修复机会。

## 3. 脱敏与私有证据

`diagnostics.ts` 先替换调用方提供的已知网关密钥，再处理常见授权头、Cookie、JSON/键值密码与 token、URL 用户密码；随后清理 ANSI、控制字符及双向控制字符并截断。日志、Planner 诊断/精化 snapshot、Builder 修复反馈共用它。字段名匹配保留 `inputTokens` 等数值统计；生产仍只报告 unavailable usage。

失败证据每运行最多 128 份，每份最多 8 个失败，每个自由文本字段最多 1500 字符，单文件最多 128 KiB。保留实际失败总数以显示截取范围，以及 packet、attempt、接受基线和错误分类。写入失败不改变判词。最多 16 MiB 的上限只针对这些证据文件，不包含 ledger、投影 journal 或 Builder 自测产物。到达数量上限后继续执行，但不再保存新证据。

运行目录由操作者归档、清理，没有自动过期任务；需要长期运行时再增加保留期限与总目录容量策略。脱敏规则无法保证识别所有未标记敏感内容，私有目录不应作为公开下载目录。

主线装配在运行前检查日志目录既不位于候选输出之下，也不通过符号链接/Windows junction 解析到候选之内。POSIX 新建目录/私有文件采用 0700/0600；不会重写已有目录权限。OpenCode runtime 启动时经 `OPENCODE_CONFIG_CONTENT` 注入工具级 deny（内联 config 优先级高于 Builder 可写的项目 `opencode.json`）：`read`/`edit` 拒绝 `.arc` 路径（相对/绝对、正反斜杠模式均覆盖），bash 命令文本含 `.arc` 即拒绝，`external_directory` 整体设为 `deny`（同时消除无头模式下默认 `ask` 的挂起风险）。已用真实 `opencode serve` 回读 `/config` 验证规则被接受。这是工具层限制而非 OS 隔离：命令文本变换、自定义 subagent 权限合并等路径仍可能绕过，Windows ACL、只读 `.arc` 挂载与容器隔离尚需部署侧验证。

## 4. ARC 官方参考与映射

本轮只读核对 `octos-org/arc-adapter` 固定提交 **`b0999c95f7875c8d4ff3e58e733fb2c5abc8caf7`**：

- [events.py](https://github.com/octos-org/arc-adapter/blob/b0999c95f7875c8d4ff3e58e733fb2c5abc8caf7/arcbench_agent_runtime/events.py)：事件字段、状态转换、refresh 六项布尔值。
- [traceability.py](https://github.com/octos-org/arc-adapter/blob/b0999c95f7875c8d4ff3e58e733fb2c5abc8caf7/arcbench_agent_runtime/traceability.py)：七张 keyed JSON 表、需求树遍历、节点状态字段。

| Shallow 输出 | 官方对应字段 |
| --- | --- |
| `runner_state` | `type/state/timestamp/message` |
| `requirement_state` | `type/node_id/phase/status/timestamp/message` |
| `signal` | `type/reason/timestamp/refresh`，refresh 包含 submission、logs、commit_history、traceability_selected、traceability_all、preview |
| requirements | req_id、id、name、description、visual_reference、scenarios、parent_id、children_ids、dependencies |
| scenarios | scenario_id、id、name、req_id、steps |
| node_states | req_id、state、phase、updated_at |

七张表为 requirements、scenarios、interfaces、tests、call_edges、node_states、node_contracts。当前 Shallow 维护需求、场景和节点状态，其余表为空；不会根据隐藏探针虚构平台 tests/interfaces 记录。时间戳采用官方 UTC `YYYY-MM-DD HH:mm:ss`。

已对照课程实验材料 `code-philia/agentic-software-engineering-hackathon` Lab04 的 `.arc` 清单复核：`.arc/requirement`、`.arc/node_sessions`、`.arc/processing_queue.json`、`.arc/validation` 属于 ARC Visualizer/编译器自身的工作区数据，适配包契约不读取；评测端只读 `runner-events.jsonl`、`.arc/traceability/*.json` 与 git 提交（`arc-adapter` README 与 `context.py` 中的固定路径）。

Catalog 同时保留原始完整树与调度用原子需求。投影包含 ROOT/FOLDER/ATOMIC（包括空目录和目录场景），依赖来自原始树，不使用调度器展开后的依赖覆盖源结构。显式场景 ID 优先保留；无 ID 的场景使用本项目稳定的 `<reqId>::<index>`。官方表没有节点 `type` 列，通过父子关系保留树结构。

Builder 回执只写内部日志。内部 envelope、证据附件和投影幂等 ID 不进入官方事件字段。

## 5. 投影重建与故障语义

主线 `ArcEventSink` 每次先把带 ID 的投影记录写入运行目录的 journal，再更新 `.arc`。写入按实例串行化，避免 node_states 读改写竞争。传入的树在入队时复制，后续调用方修改不影响已记录的意图。每次 `requirementState` 在 `requirement_state` 事件之后追加一条 `signal`（reason `node_state_updated`，refresh 同时置 submission、traceability_selected 与 traceability_all），与参考实现中节点状态写入附带 traceability 刷新的行为对齐。

`rebuild()` 读取完整 journal、校验可解析性与重复 ID 冲突，再按记录顺序折叠当前表并重写事件历史。同 ID 重复记录只输出一次；不同 ID 的真实失败/重试历史均保留。主线结束时自动重建一次，投影中断后也可用相同输出目录与 journal 创建 `ArcEventSink` 并调用该方法。

重建覆盖该运行的 `.arc/runner-events.jsonl` 与七张表，不改业务文件或 Git 接受点。只对匹配的运行和输出目录使用 journal；它不是合并其他运行记录的接口。官方 JSON 表和事件文件按单文件临时写入后 rename，跨文件尚不是原子事务。完整 journal 可再次重放修复中途失败；journal 本身缺失、损坏或写入失败时不承诺完整恢复，告警保留，已有判定继续有效。

投影 journal 是独立的公开字段记录，不是 canonical RunStore：接受 Git 提交与投影意图之间仍有崩溃窗口，也没有恢复 Builder 会话、剩余预算、调度状态的机制。当前实现不宣称第 13 节的完整运行恢复验收标准已经完成。

## 6. 验证入口

- `test/arc-protocol.test.ts`：官方字段、完整树、并发状态更新、写失败后重建、重复记录去重、失败历史与时间戳保留。
- `test/observability.test.ts`：自由文本脱敏、关联字段、usage 数值不被误删、私有预览与公共日志分离、证据上限、目录链接、人类日志。
- `test/catalog.test.ts`：原始目录依赖、空目录和显式场景 ID；调度展开保持原语义。
- `test/pipeline.e2e.test.ts`：日志与 ARC 同时失败仍接受正确候选；既有修复、回滚、基础设施配额回归。
- `npm run test:all`：类型检查、无凭证单元/集成与 fixture Chromium 测试；本轮不运行真实模型或官方评测。
