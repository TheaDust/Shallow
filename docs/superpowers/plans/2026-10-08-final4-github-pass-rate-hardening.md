# final-4 GitHub 通过率提升与 Sheet 防回归实施计划

**目标：** 覆盖 final-4 GitHub 剩余的 12 个失败，在不写入 GitHub、Search、特定种子名或具体 requirement ID 硬编码的前提下，提高下一轮官方通过率；同时以 final-4 Sheet 的 27/30 为基线，避免通用 Judge 改动造成 Sheet 规划、定位和业务语义回归。

**当前基线：** final-4 GitHub 18/30，Sheet 27/30。final-3 为 GitHub 16/30、Sheet 26/30。final-4 已解决此前 12 个 GitHub `banner → Search` 首入口失败，但其中 9 个用例继续暴露下游问题，3 个真正通过，Active Sessions 又回归 1 个，净增 2 个通过。

**核心原则：** 使用“需求探针 + 兼容性探针”双层结构。需求探针仍是唯一可以把原子需求标记为 `verified` 的证据；兼容性探针只检查继承 Web 应用的公共交互和无障碍约定，可以触发 Builder 修复，但不能单独授予 `verified`。这样既能覆盖官方探针依赖的结构约定，又不把官方测试实现细节伪装成需求语义。

**明确排除：**

- 不按产品名、requirement ID、种子值、路由文本或 final-4 用例名称分支。
- 不读取或引用官方测试源码。
- 不用逗号对所有 THEN 文本做无条件切分。
- 不恢复最终阶段的全量 plan 生成；`SHALLOW_FINAL_AUDIT_GENERATE_PLAN=0` 保持默认关闭。
- 不重复实现 `cb3ec0f` 已加入的公共入口结构检查、`expectCss`、脚手架 Dialog 子树卸载和 Builder prompt 规则。
- 本计划不能在新的官方运行前保证 30/30；其中标题、可访问计数和冲突页面上下文属于平台兼容约定，而不是所有需求都逐字声明的结果。通过独立的兼容性探针表达这些约定，避免制造虚假的需求覆盖率。

---

## 1. final-4 失败清单与根因

| 失败簇 | 用例 | 直接表现 | 根因 |
|---|---:|---|---|
| Active Sessions | 3 | 当前会话命中隐藏 Dialog 文本；reload 后无 revoked/inactive；撤销当前浏览器后缺 main 内 `Sign in` 链接 | 已关闭 Dialog 内容仍在查询表面；撤销状态没有持久化/没有 reload 后语义；未验证退出后的公共重入入口 |
| Archive / Restore | 2 | 嵌套路由上的全局 Search 不再能找到仓库；恢复后无可见 Active | 公共控件只验了首页结构，没有跨路由行为；REQ-3-5 在最终阶段缺失缓存 plan，恢复后的独立状态事实没有被断言 |
| Default branch | 1 | 默认分支按钮正确，但地址不包含分支 | DSL 没有 URL 断言，规划把明确的地址结果登记为 uncovered |
| Releases | 3 | tag 不是精确 heading；重复发布错误后 tag 可见计数为 0 | 没有详情页主身份标题兼容约定；冲突结果没有保留用户刚提交的稳定标识上下文 |
| Reactions | 3 | 找不到精确 `1 reaction`、`0 reactions` 或通用数字计数 | 类型与裸数字分散在相邻节点，视觉上可见但无单个可访问计数；计划只验证按钮/类型，没有验证计数事实 |

现有控制器还暴露出以下系统性问题：

1. outcome 只按分号及 `and|but` 粗分，逗号列举的多个字段、状态与计数、即时结果与 reload 结果容易被绑成一个事实。
2. 映射校验只确认 outcome 指向某个 `expect*`，不确认该断言是否真的证明了对应字段、阶段或计数。
3. 后台预规划失败时，模块边界前没有有限恢复；最终阶段又因 plan 生成默认关闭而直接缺验。
4. 公共入口检查目前只验证首页 banner 的结构，没有验证声明为 global/top/banner 的控件在嵌套路由仍保持同一动作语义。

---

## 2. 总体架构

### 2.1 两层探针

```text
需求文本 / seed / 场景输入
          │
          ├── 需求探针（requirement probes）
          │      ├── 严格 expectationBasis
          │      ├── 每个 observable facet 有真实断言
          │      └── 唯一能够产生 verified
          │
          └── 兼容性探针（compatibility probes）
                 ├── 只能由通用需求属性触发
                 ├── 不含产品、REQ、种子硬编码
                 ├── 失败可形成白名单观测并触发修复
                 └── 通过不能单独产生 verified
```

### 2.2 信任边界

- Planner/Runner 仍不得读取目标源码、diff、Builder 会话或官方测试。
- 兼容性探针的目标与期望值只能从当前需求、祖先公共合同、seed declaration、场景输入以及已成功业务路径中派生。
- 定位精化只能修改 locator，不得改写 URL 片段、计数、稳定标识、角色或阶段语义。
- 兼容性探针结果进入修复诊断时，必须使用现有白名单 ShadowObservation，不暴露计划内部或平台测试信息。

---

## 3. 通用改动方案

### 3.1 增加受需求约束的 URL 断言

新增白名单操作 `expectUrlContains`。只有当前场景明确出现 `address`、`URL` 或等价的页面地址要求时，Planner 才能生成该操作。

约束：

- URL 片段必须直接来自需求、seed、场景输入或此前动作中已明确选择的值。
- 不允许 Planner 猜测路由形式。
- locator refinement 不得修改 URL 片段。
- URL 断言必须关联到对应的 `url` facet，不能只作为无映射的附加检查。

直接覆盖：Default branch S2。

Sheet 风险控制：final-4 Sheet 当前需求没有页面地址合同，探测器必须返回 not-applicable，不能增加 Sheet 步骤或 Planner 自由度。

### 3.2 outcome 保持稳定，新增可观察 facet

不破坏现有 outcome key，也不对整句进行激进重切分。在每个稳定 outcome 下抽取可观察 facet：

```ts
interface ScenarioOutcome {
  scenarioId: string;
  stepIndex: number;
  clauseIndex?: number;
  text: string;
  facets: ObservableFacet[];
}

interface ObservableFacet {
  id: string;
  kind: "text" | "visibility" | "state" | "count" | "url" | "persistence";
  text: string;
  phase: "immediate" | "after_reload";
}
```

抽取规则：

- 明确列举的多个显示字段分别形成 facet。
- 状态与计数分别形成 facet。
- 操作后的即时结果和 reload 后结果使用不同 `phase`。
- 地址、可见性、持久化分别形成 facet。
- `or` 等备选表达保留为同一事实，不能拆成两个都必须满足的断言。
- 不拆分引号内文本、RGB/十六进制颜色、公式、坐标、日期、数字格式和其他结构化 literal。
- 保持 final-4 Sheet 当前解析器实际产生的 82 个 outcome key 不变；facet 是附属验证单位，不改变 traceability 的主键。早期人工分析中的 58 是低估值，实施前用当前 `scenarioOutcomes()` 对同一份 final-4 requirements 复算后更正为 82；该数字只进入 golden test，不进入生产分支。

覆盖校验从“outcome 映射到任意 `expect*`”改为：

- 每个 facet 必须映射到实际执行的断言。
- 一个断言可以证明多个 facet，但必须能从操作参数中确定性地证明每个 facet 的值和阶段。
- `after_reload` facet 只能由 reload 后执行的断言覆盖。
- `count` facet 不能由仅验证按钮或类型标签的断言覆盖。
- `url` facet 只能由 URL 断言覆盖。
- 不能用登记在 metadata 中但未执行的映射冒充覆盖。

直接覆盖：Active S1/S2、Archive S3、Reactions S1/S2/S3，并为 Releases 的冲突结果提供准确的事实边界。

Sheet 风险控制：用 final-4 GitHub 与 Sheet 需求建立双语料回归。Sheet outcome 总数和 key 必须稳定；对 Sheet 长句只增加安全 facet，不改变其 locator、角色或业务步骤。特别禁止把类似 `Replaced 3 cells`、`Match 2 of 3`、`Frozen rows...` 内部的数字和名词拆成互不关联的断言。

### 3.3 在模块边界前恢复缺失计划

保持最终阶段默认不生成 plan，把缺失恢复提前到模块规划/模块边界阶段：

1. 实现阶段仍后台预生成当前模块的 packet plan。
2. 后台任务失败或返回无效 plan 时记录具体原因。
3. 进入模块边界验收前，只对当前验收范围内缺失或无效的 packet 做一次有界恢复。
4. 恢复成功后写入正常缓存与 `shallow-progress/plans/` 镜像。
5. 恢复失败仍记 inconclusive，不循环耗费 token。
6. 最终全量验收继续 cache-only；`SHALLOW_FINAL_AUDIT_GENERATE_PLAN=0` 不变。

不能把“后台失败”简单改成永久 `retryPlan=false`。恢复次数要按 packet 记账，确保每个模块边界最多补一次。

直接覆盖：REQ-3-5 完全漏验，使 Archive S1/S3 能在 Builder 仍可修复的阶段暴露。

Sheet 风险控制：final-4 Sheet 当前 10 个 Evolution packet 都已有有效计划，正常路径不得增加 Planner 调用；只在原后台预规划实际失败时产生一次额外调用。

### 3.4 将明确的全局控件扩展为跨路由行为检查

扩展现有 `declaredGlobalSearchControls()` 和 `publicEntryPlan()`，不要增加宽泛的 `header` 正则。

触发条件：需求明确把控件称为 global、top、banner 或等价的公共入口，并且已有确定性 detector 识别成功。

执行方式：

- 在首页验证该控件可见、可用和基本动作语义。
- 从当前模块已经成功执行的业务计划中选择一个嵌套页面，不猜测路径、不拼接产品路由。
- 在该嵌套页面再次从相同公共 scope 找到控件。
- 用同一份需求派生输入执行动作，并验证结果语义与首页一致。
- 该检查是兼容性检查，不能替代对应业务需求断言，也不能单独授予 verified。

直接覆盖：Archive S1 中嵌套仓库页面的 banner Search 被重解释为 repository-local code search。

Sheet 风险控制：final-4 Sheet 只有宽泛 header 文案，没有被精确 detector 识别为全局搜索入口；必须返回 not-applicable。测试要固定这一点，防止未来扩大触发范围。

### 3.5 继承应用的 Dialog 生命周期检查

`cb3ec0f` 已修改通用脚手架和 prompt，要求关闭 Dialog 后卸载内容。本轮只补黑盒候选兼容性检查，不重复修改已有实现。

检查语义：

- 打开一个可从当前需求路径自然触发的 dialog。
- 记录其标题、描述、表单和动作区域。
- 关闭后允许保留空的容器或动画壳，但这些用户可见内容不能继续留在 role/text 查询表面。
- 再次打开必须仍可正常使用，避免“通过删除节点但无法重开”的伪修复。
- 不对所有隐藏菜单做一刀切；只有明确完成关闭生命周期的 dialog/menu 才检查其内容是否退出查询表面。

直接覆盖：Active S1 中隐藏的登出 Dialog 描述抢占 `/current/i).first()`。

Sheet 风险控制：final-4 Sheet 的 Dialog/Menu 已在关闭时卸载开放内容，候选检查应直接通过；不得改变 Sheet locator 或业务规划。

### 3.6 鉴权后的公共重入入口

新增条件兼容性合同：当需求明确包含会使当前会话 revoked/expired/unauthenticated 的动作时，从祖先公共需求中派生该应用原本声明的未登录入口角色和名称。

断言：

- 当前受保护工作区不再可用。
- 原本声明的公共重入入口在 `main` 中可见且可操作。
- 登录表单可以同时存在，但仅有表单字段不能替代公共入口。
- 入口名称和角色必须来自公共需求合同，不允许硬编码 `Sign in`。

直接覆盖：Active S3。

Sheet 风险控制：没有鉴权撤销/过期语义时不触发。

### 3.7 详情实体的主身份标题

新增兼容性合同：当场景创建或打开一个具有稳定唯一标识的独立实体，并明确要求详情页显示该标识时，详情页需要有一个精确、可访问的主身份 heading。

边界：

- 标识必须来自需求、seed 或用户刚提交的输入。
- 只适用于独立详情页实体，不把状态、辅助属性、表格单元格、按钮文案升级成 heading。
- 标题检查是兼容性约定；需求探针仍需验证需求明确要求的显示事实。

直接覆盖：Releases S1/S2 的 tag 精确 heading。

Sheet 风险控制：final-4 Sheet 没有符合“独立实体详情页 + 稳定唯一标识”的触发形态，应返回 not-applicable。

### 3.8 聚合可访问计数

新增兼容性操作，可采用如下抽象：

```ts
interface ExpectAccessibleCountStep {
  op: "expectAccessibleCount";
  noun: string;
  exact?: number;
  minimum?: number;
}
```

语义：

- 数字和名词必须形成一个人类可理解、辅助技术可查询的聚合文本或 accessible name。
- 不接受“一个 span 是类型、相邻 span 只有裸数字”作为聚合计数。
- noun 必须从需求文本派生，不得硬编码 `reaction`。
- 支持单复数，但不能放宽为只要页面任意位置存在数字即可。
- 若需求已经给出完整精确字符串，如 `Replaced 3 cells`，优先使用原字符串断言，不转换为泛化计数。

直接覆盖：Reactions S1/S2/S3。

Sheet 风险控制：Sheet 的状态句、替换统计和匹配计数继续优先走精确文本断言；不能被拆成全页面的裸数字检查。

### 3.9 唯一键冲突时保留提交上下文

新增条件兼容性合同，适用于独立列表/详情实体的 create/publish 流程：当稳定唯一标识发生 uniqueness conflict 时，需要同时满足：

- 错误信息可见。
- 表单或当前创建上下文仍可见，不发生无解释跳转。
- 非敏感的已提交稳定标识仍以用户可见方式出现一次。
- 不产生第二个实体。

约束：

- 只适用于独立实体的创建/发布，不适用于 dialog 内轻量管理项、筛选视图、named range 等局部配置。
- 密码、token、邮箱及需求标记为敏感的信息不能被该合同要求回显。
- 标识来自用户输入或 seed，不写死 release/tag 名。
- “出现一次”必须限定在当前错误/表单上下文，不能对整个 DOM 的隐藏模板做全局脆弱计数。

直接覆盖：Release S3。

Sheet 风险控制：排除 Sheet 的重复 filter view 等轻量 dialog 配置，不改变其既有交互语义。

---

## 4. 12 个失败的完整覆盖矩阵

| final-4 失败 | 主要机制 | 必须验证的事实 |
|---|---|---|
| Active S1 | Dialog 生命周期 + outcome facet | 关闭弹层后隐藏描述不参与查询；当前会话标记仍可见 |
| Active S2 | `after_reload` state/persistence facet | reload 后 revoked/inactive 状态仍可观察 |
| Active S3 | 鉴权公共重入入口 | 受保护区退出；祖先合同声明的公共入口在 main 中可见可用 |
| Archive S1 | 缺失 plan 恢复 + 全局控件跨路由 | 嵌套路由上的公共 Search 与首页保持同一语义 |
| Archive S3 | 缺失 plan 恢复 + state facet | restore 后明确可观察 Active 状态 |
| Branch S2 | `expectUrlContains` + url facet | 地址包含需求声明的分支值 |
| Release S1 | 详情实体主身份标题 | 新 release 的稳定 tag 是精确可访问 heading |
| Release S2 | 详情实体主身份标题 | seed release 的稳定 tag 是精确可访问 heading |
| Release S3 | 唯一键冲突上下文 | 错误、表单上下文、稳定标识和单一实体同时成立 |
| Reactions S1 | 可访问计数 + count facet | 添加后出现准确的聚合计数 |
| Reactions S2 | 可访问计数 + count facet | 移除后出现准确的零计数 |
| Reactions S3 | 可访问计数 + count facet | reload 后持久计数仍是聚合可访问文本 |

---

## 5. 实施顺序

### Task 1：建立 final-4 双产品回归夹具

- [x] 从 final-4 的需求和现有计划生成匿名化的 GitHub/Sheet 需求特征夹具；夹具中不使用产品名、REQ ID 或 EVO 种子名作为行为分支。
- [x] 固定 Sheet 现有 82 个 outcome key，记录每个 packet 的 plan 可解析状态。
- [x] 为 12 个 GitHub 失败分别建立最小需求属性夹具，确保测试验证的是通用触发条件。
- [x] 添加 detector not-applicable 测试：Sheet 不触发 URL、鉴权、全局搜索跨路由、独立详情实体和独立发布冲突合同。

### Task 2：实现 observable facet 与语义覆盖校验

- [x] 在 `src/judge/probe-coverage.ts` 及相关类型中引入 facet，不改变现有 outcome key。
- [x] 添加安全的列举、状态、计数、阶段、URL、持久化识别规则。
- [x] 修改 plan 覆盖校验，要求 facet 对应到能够证明该事实的实际 assertion。
- [x] 为 alternatives、literal、RGB、公式、坐标、日期和 Sheet 长句添加不过度拆分测试。
- [x] 确认 GitHub 与 Sheet 的 outcome 主数量回归稳定。

### Task 3：增加 `expectUrlContains`

- [x] 扩展 probe schema、Planner prompt 和 Playwright runner。
- [x] 只有显式 URL/address facet 时允许该操作。
- [x] 在 locator-only refinement 校验中冻结 URL 期望值。
- [x] 添加允许、拒绝、执行成功、执行失败和精化篡改测试。

### Task 4：补模块边界前的有界 plan 恢复

- [x] 检查 `src/pipeline.ts` 后台预规划、模块验收及 final audit 的当前状态流转。
- [x] 对当前模块中缺失/无效计划的 packet 最多恢复一次。
- [x] 保持 final audit cache-only 和默认开关关闭。
- [x] 添加“后台失败→模块边界恢复成功”“恢复仍失败→inconclusive”“已有 plan→零额外调用”“final 阶段不补生成”测试。

### Task 5：扩展公共入口跨路由检查

- [x] 复用 `declaredGlobalSearchControls()`，不要增加按 `header` 单词触发的宽泛判断。
- [x] 从已成功业务计划中派生嵌套路由。
- [x] 比较首页和嵌套路由的公共控件动作语义。
- [x] 将检查标记为 compatibility-only，禁止它单独生成 verified。
- [x] 添加 Sheet not-applicable 回归。

### Task 6：候选应用 Dialog 生命周期检查

- [x] 复用现有 scaffold/prompt 改动，只新增候选黑盒检查。
- [x] 验证关闭后内容退出查询表面以及重新打开可用。
- [x] 不对全部 hidden menu 做全局禁令。
- [x] 用 final-4 Sheet 的关闭行为验证不产生误报。

### Task 7：实现三类兼容性合同

- [x] 鉴权后的公共重入入口。
- [x] 独立详情实体的主身份 heading。
- [x] 聚合可访问计数。
- [x] 唯一键冲突后的提交上下文保留。
- [x] 每类合同都必须有正向、not-applicable、敏感信息/错误作用域等负向测试。
- [x] 所有兼容性检查失败只能触发修复，不能单独改变 requirement verified 状态。

### Task 8：端到端回归与提交拆分

- [ ] 先跑受影响的 Judge、schema、runner、pipeline 单测。
- [x] 运行 `npm run typecheck`。
- [ ] 运行 `npm test`；浏览器行为有改动时运行对应 `npm run test:browser`。
- [ ] 以匿名 fixtures 验证全部 12 个失败都有确定性探针入口。
- [ ] 验证 Sheet 82 个 outcome key、10 个已有 packet plan 和 not-applicable 判定不变。
- [ ] 按“facet/DSL”“plan 恢复”“兼容性探针”拆分提交，方便发现 Sheet 回归时单独回退。

---

## 6. Sheet 硬性防回归门槛

以下条件任一不满足，都不能提交为通过率优化完成：

1. final-4 Sheet 的稳定 outcome key 和主数量仍为 82（仅为 golden fixture 断言；生产代码不知道该数字）。
2. Sheet 当前 10 个 Evolution packet 的缓存计划全部可解析。
3. 已有有效计划时，模块边界不得新增 Planner 调用。
4. Sheet 夹具对 URL、鉴权、全局搜索跨路由、独立实体详情标题、独立发布冲突合同均返回 not-applicable。
5. Sheet 的 Dialog/Menu 生命周期检查通过。
6. 新 facet 不得删除现有通过断言与 outcome 的映射。
7. `Replaced 3 cells`、`Match 2 of 3`、`Frozen rows...` 等完整状态句仍按整体业务语义验证。
8. locator refinement 仍只能修改 locator，不能改变角色、需求锚定名、exact 值、URL、计数或阶段。
9. 已通过的 Sheet 路径作为修复前缀复验；某次 GitHub 修复若破坏这些路径，应拒绝该候选而不是接受后再补救。
10. 所有测试 fixture 使用匿名产品和实体名，生产代码不出现 GitHub、Sheet、Search、release、reaction 或 EVO 专用分支。

---

## 7. 验收标准

### 控制器级

- 每个显式可观察 facet 都由真实执行的断言覆盖。
- 没有 URL/address 需求时，`expectUrlContains` 在 schema/计划校验阶段被拒绝。
- 后台 plan 失败可在模块边界前恢复一次，最终阶段仍不生成新计划。
- compatibility probe 通过不能单独产生 `verified`；失败可以通过白名单观测触发修复。
- 公共控件跨路由检查只由明确 global/top/banner 合同触发。

### GitHub 行为级

- 12 个 final-4 失败均能被至少一个通用需求探针或兼容性探针在模块修复期捕获。
- Active 的隐藏弹层、reload 持久化和公共重入入口分别有独立证据。
- Archive 的 plan 不再缺失，公共搜索跨路由语义和恢复状态分别被检查。
- Branch 地址合同由 URL 断言实际执行。
- Release 的详情标题和冲突上下文有独立检查。
- Reaction 的即时、归零和 reload 后计数均以聚合可访问文本验证。

### Sheet 行为级

- 达到上一节全部十条硬门槛。
- 不改变 Sheet 现有 locator、角色、业务动作和精确状态文本的语义。
- 对已有有效 plan 不增加 token 开销；只有原后台预规划失败的 packet 才允许一次恢复调用。

---

## 8. 风险与止损

| 风险 | 早期信号 | 止损措施 |
|---|---|---|
| facet 过度拆分 Sheet 长句 | Sheet outcome/facet 数暴涨，已有映射大量失效 | 保留 outcome 主键；literal/替代项保护；以 final-4 Sheet 82 个 key 的 golden snapshot 为硬门槛 |
| 兼容性探针污染 verified | 只有 compatibility pass 就把需求标绿 | 在类型和状态汇总层禁止 compatibility 产生 verified，并加反向单测 |
| plan 恢复增加大量 token | 已有 plan 的 packet 仍调用 Planner | 恢复条件限定为后台失败/缓存无效，每 packet 每模块最多一次 |
| 全局控件规则误伤 Sheet | 仅出现 header 就触发跨路由 | 只复用精确 detector，Sheet not-applicable 固化为测试 |
| 可访问计数退化为任意数字 | 页面其他数字造成假通过 | 要求 noun 与数字形成同一 accessible text/name，并限定作用域 |
| 冲突上下文泄露敏感信息 | 密码/token/email 被要求回显 | 明确敏感字段排除，schema 和测试双重拒绝 |
| Dialog 检查误伤动画/portal | 关闭动画短暂保留节点 | 允许空壳和合理稳定等待，只禁止用户可见内容长期留在查询表面 |
| 详情标题规则过宽 | 普通属性被要求 heading | 仅独立详情页的稳定唯一标识触发，兼容性层不改变需求覆盖 |

---

## 9. 预期收益

这套方案把 final-4 暴露的问题分成三类并分别收口：

- **漏验：** facet 语义覆盖和模块边界 plan 恢复解决“登记了但没断言”和“完全没有计划”。
- **公共行为不一致：** URL、跨路由全局控件、鉴权重入和 Dialog 生命周期解决应用在真实浏览器入口上的结构/状态问题。
- **可访问表达不足：** 详情主标题、聚合计数、冲突上下文解决视觉上存在但官方 role/text 探针无法可靠观察的问题。

预期上限是让下一轮控制器在交付前发现并推动修复 final-4 的全部 12 个 GitHub 失败，同时让 Sheet 保持原有需求语义和计划形态。最终成绩仍必须以新的官方运行确认，不能仅凭内部探针宣称恢复 30/30。
