# Incremental and progressive stage support

日期：2026-10-02。

更新：2026-10-06，加入根名称含独立 `Evolution` 标记的增量任务。

## 官方合同

GitHub 题目拆成三个互不重叠的阶段需求树：

- Stage 1：REQ-1、REQ-2；
- Stage 2：REQ-3、REQ-4；
- Stage 3：REQ-5、REQ-6。

Stage 2/3 优先以前序阶段被平台选中的应用为起点；没有可用应用时从空白模板开始。每轮只执行当前阶段测试。后续阶段 YAML 仍可通过 `dependencies` 引用前序阶段 ID，但这些 ID 不在当前需求树中。

## 控制器语义

1. 根名称中的独立 `Evolution` 标记（大小写不敏感）保存为 `ProductContext.evolution`，末尾的 `Stage N`、`Phase N` 或 `第 N 阶段` 保存为 `ProductContext.stage`。两者可同时存在，阶段编号独立于增量模式；产品分类在移除标记后按原有规则判断，原始根名称完整保留。
2. 当前树内依赖继续展开为 `AtomicRequirement.dependencyIds`，参与分组排序、依赖门和当前阶段前置需求证据。
3. Evolution 及 Stage 2 以后的当前树外依赖保存为 `externalDependencyIds`：它们是前序增量上下文，不进入本轮覆盖率，不阻塞调度，也不生成独立探针。
4. `installStarterScaffold` 的结果决定 Builder 的起点：已有完整 frontend/backend 为 `inherited_application`；安装通用脚手架为 `blank_template`；其他情况为 `unknown`。
5. 继承应用时 Builder 延续既有栈和接口并增量修改；空模板时只补当前场景所需的最小前序支撑能力。Evolution 通过独立的 Builder 上下文和 prompt 资产传递起点、外部依赖与可选阶段编号，启动日志同步记录这些信息。
6. Judge 接收外部前置 ID 作为上下文，但不得把它们放进 case.requirementIds，或仅凭 ID 猜测前序合同与断言。
7. 最终汇总、ARC 需求树和 verified 分母都只包含当前 YAML 的原子需求；编号作为标识处理，允许延续前序编号。

## 与历史指纹复用设计的区别

`docs/superpowers/specs/2026-09-22-evolution-mode-design.md` 描述的是同一需求全集跨运行按指纹跳过已验收需求。当前增量入口的实现和验收范围由本轮 YAML 定义，旧需求 ID 可作为外部前置上下文；既有兼容行为由 Builder 复用和维护。

## 安全退化

- 没有 Evolution 标记的普通需求及 Stage 1 仍拒绝未知依赖，避免拼写错误静默通过。
- Evolution 及 Stage 2 以后允许树外依赖；这些依赖只影响上下文，当前树内的依赖与循环校验继续生效。
- 起点无法确定时，Builder 必须先检查项目文件，再选择增量扩展或空模板策略。

## 验证

- `test/catalog.test.ts`：Evolution/阶段识别、产品分类、树外依赖分离与当前树内循环校验；
- `test/scheduler.test.ts`：树外依赖不阻塞且不进入当前阶段审计；
- `test/feature-grouping-pipeline.test.ts`：Pipeline 只实现和验收当前需求树，并传递 Evolution/阶段继承上下文；
- `test/builder-prompt.test.ts`：继承应用与空模板两种提示词；
- `test/human-log.test.ts`：Evolution、可选阶段编号和起点可观测；
- `test/baseline.test.ts`：baseline 模块保留 ROOT 阶段合同。
