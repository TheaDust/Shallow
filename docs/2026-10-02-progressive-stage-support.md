# Progressive stage support

日期：2026-10-02。

## 官方合同

GitHub 题目拆成三个互不重叠的阶段需求树：

- Stage 1：REQ-1、REQ-2；
- Stage 2：REQ-3、REQ-4；
- Stage 3：REQ-5、REQ-6。

Stage 2/3 优先以前序阶段被平台选中的应用为起点；没有可用应用时从空白模板开始。每轮只执行当前阶段测试。后续阶段 YAML 仍可通过 `dependencies` 引用前序阶段 ID，但这些 ID 不在当前需求树中。

## 控制器语义

1. 根名称末尾的 `Stage N`、`Phase N` 或 `第 N 阶段` 被识别为增量阶段，并在 `ProductContext.stage` 保存阶段编号与“只测本阶段”标记；阶段识别不绑定具体产品名或描述文案，产品领域仍由原有分类逻辑独立判断。
2. 当前树内依赖继续展开为 `AtomicRequirement.dependencyIds`，参与分组排序、依赖门和当前阶段前置需求证据。
3. 当前树外依赖保存为 `externalDependencyIds`：它们是前序阶段上下文，不进入当前阶段覆盖率，不阻塞调度，也不生成独立探针。
4. `installStarterScaffold` 的结果决定 Builder 的起点：已有完整 frontend/backend 为 `inherited_application`；安装通用脚手架为 `blank_template`；其他情况为 `unknown`。
5. 继承应用时 Builder 延续既有栈和接口并增量修改；空模板时只补当前场景所需的最小前序支撑能力，不扩张成前序阶段全量重做。
6. Judge 接收外部前置 ID 作为上下文，但不得把它们放进 case.requirementIds，或仅凭 ID 猜测前序合同与断言。
7. 最终汇总、ARC 需求树和 verified 分母都只包含当前阶段 YAML 的原子需求。

## 与 Evolution 设计的区别

`docs/superpowers/specs/2026-09-22-evolution-mode-design.md` 描述的是同一需求全集跨运行按指纹跳过已验收需求。官方 progressive task 是互不重叠的阶段增量，且只测试当前阶段，因此不读取旧需求清单、不把旧需求并入本轮审计，也不按“当前树缺少旧 ID”判定需求被移除。

## 安全退化

- 普通非阶段需求仍拒绝未知依赖，避免拼写错误静默通过。
- Stage 1 没有前序阶段，同样拒绝未知依赖。
- Stage 2 以后才允许树外依赖；这些依赖只影响上下文，不改变当前阶段的确定性分组验证。
- 起点无法确定时，Builder 必须先检查项目文件，再选择增量扩展或空模板策略。

## 验证

- `test/catalog.test.ts`：阶段识别、产品分类、树外依赖分离；
- `test/scheduler.test.ts`：树外依赖不阻塞且不进入当前阶段审计；
- `test/feature-grouping-pipeline.test.ts`：Pipeline 只实现当前阶段并传递继承上下文；
- `test/builder-prompt.test.ts`：继承应用与空模板两种提示词；
- `test/human-log.test.ts`：阶段和起点可观测；
- `test/baseline.test.ts`：baseline 模块保留 ROOT 阶段合同。
