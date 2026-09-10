# Builder 提示词链路架构

日期：2026-09-10
状态：基于当前代码的运行时架构参考

## 1. 全景

Builder 提示词由 4 层资产组成，通过 `compileBuilderPrompt()` 组装为 systemPrompt + taskPrompt：

```
系统级资产（固定，所有模式共用）
  builder-system.md        职责边界 + 实现原则
  self-test.md             Playwright 自测流程

任务级资产（4 种模式各 1 份）
  task-implement.md        首次实现
  task-repair.md           修复（第 2 次尝试）
  task-root-cause-repair.md 根因修复（第 3 次尝试）
  task-delivery-repair.md  交付修复

动作级资产（填入任务模板的 {{ACTION}} 占位符）
  action-implement.md
  action-repair.md          + {{PASSED_CASE_IDS}} {{FAILURES}}
  action-root-cause-repair.md + {{PASSED_CASE_IDS}} {{FAILURES}}
  action-delivery-repair.md  + 故障阶段字段

领域碎片资产（按产品类型 + 观测动态选择 0-5 份）
  accessible-web-controls.md   可访问 Web 控件
  server-persistence.md        状态与持久化
  auth-and-permission.md       权限
  repository-collaboration.md  仓库协作
  spreadsheet-grid.md          电子表格网格
  delivery-contract.md         交付合同

辅助资产（在不同场景被填充/引入，不参与任务模板本身）
  platform-contract.md   平台运行合同（端口/命令/健康检查）
  seed-data.md           种子数据段
  receipt.md             完成回执格式（所有模式共用）
  reference-images.md    图片说明
  candidate-prepare.md   候选构建说明
```

所有资产文件位于 `prompts/system/` 与 `prompts/fragments/`，均为 UTF-8 无 BOM 的 Markdown（无 `\r`）。

## 2. 组装流程

`compileBuilderPrompt(request: BuilderPromptInput)` 返回：

```typescript
interface CompiledBuilderPrompt {
  systemPrompt: string;   // 固定，不随模式变化
  taskPrompt: string;     // 随模式变化，模板填充产物
  fragmentIds: PromptFragmentId[];  // 本次选中的碎片 ID（日志用）
}
```

### 2.1 systemPrompt（固定）

```
builder-system.md + "\n\n" + self-test.md
```

`builder-system.md` 定义 Builder 的宪法（21 行）：

| 条款 | 内容 |
|------|------|
| 职责边界 1-2 | 只处理当前工作包明确包含的需求，不主动做其他待办 |
| 职责边界 3 | 保留已存在且可工作的行为；修改公共接口时检查影响 |
| 职责边界 4 | 不判断工作包是否最终通过，不声称获得官方评分 |
| 职责边界 5 | 不得搜索或读取官方测试源、评分状态、其他工作包、ShallowCode 内部状态 |
| 实现原则 2 | 实现通用行为，不针对场景的固定输入编写硬编码特例 |
| 实现原则 3 | 涉及状态的功能，检查完整链路：界面→网络→服务端→领域状态→持久化→重新读取 |
| 实现原则 5 | 按 Playwright 自测要求验证关键界面路径 |

`self-test.md` 定义 Builder 使用 Playwright MCP 浏览器自测的流程、清理责任和结果报告格式。

### 2.2 taskPrompt（模式相关）

模式与模板/动作段的对应关系：

| 模式 | 模板 | 动作段 | 额外数据段 |
|------|------|--------|-----------|
| `implement` | task-implement.md | action-implement.md | 项目上下文 + 工作包 + 平台合同 + 碎片 |
| `repair` | task-repair.md | action-repair.md + {{FAILURES}} | 同上 + shadowObservation |
| `root_cause_repair` | task-root-cause-repair.md | action-root-cause-repair.md + {{FAILURES}} | 同上 + shadowObservation |
| `delivery_repair` | task-delivery-repair.md | action-delivery-repair.md + 故障阶段 | 碎片（仅 delivery_contract） |

#### 模板占位符

任务模板通过 `fillTemplate()` 填充，所有占位符必须被填满，否则抛错：

| 占位符 | 来源 | 模式 |
|--------|------|------|
| `{{PACKET_ID}}` | `packet.id` | implement / repair / root_cause_repair |
| `{{PACKET_ATTEMPT}}` | `packet.attempt`（1-3） | implement / repair / root_cause_repair |
| `{{OUTPUT_DIR}}` | `request.outputDir` | 全部 |
| `{{ACTION}}` | 对应 action-*.md 的填充产物 | 全部 |
| `{{PROJECT_CONTEXT}}` | `projectContextSection()` 渲染 | implement / repair / root_cause_repair |
| `{{WORK_PACKET}}` | `workPacketSection()` 渲染 | implement / repair / root_cause_repair |
| `{{PLATFORM_CONTRACT}}` | `platformContractSection()` 渲染 | 全部 |
| `{{FRAGMENTS}}` | `fragmentSection()` 渲染 | 全部 |

action-*.md 的额外占位符：

| 占位符 | 来源 | 模板 |
|--------|------|------|
| `{{PASSED_CASE_IDS}}` | 观测中通过的 case id 列表，以"、"分隔 | action-repair / action-root-cause-repair |
| `{{FAILURES}}` | `renderFailures()` 渲染的失败摘要 | action-repair / action-root-cause-repair |
| `{{FAILURE_STAGE}}` | 交付验证阶段 | action-delivery-repair |
| `{{FAILURE_COMMAND}}` | 失败命令 | action-delivery-repair |
| `{{FAILURE_EXPECTED}}` | 预期结果 | action-delivery-repair |
| `{{FAILURE_ACTUAL}}` | 实际结果 | action-delivery-repair |

#### 组装顺序

```
taskPrompt = fillTemplate(task-*.md, {
  PACKET_ID, PACKET_ATTEMPT, OUTPUT_DIR,
  ACTION: fillTemplate(action-*.md, { ... }),
  PROJECT_CONTEXT, WORK_PACKET, PLATFORM_CONTRACT, FRAGMENTS
})
taskPrompt = taskPrompt + "\n\n" + receipt.md（原样，不经过 fillTemplate）
taskPrompt = taskPrompt.trim()
```

`receipt.md` 内含字面 `{{主要变更}}` 等收据格式占位符——这些是发给 Builder 的格式引导，**不经过 fillTemplate**，由代码在模板填充完成后以 `\n\n` 拼接追加。

### 2.3 数据渲染段（代码内，非占位符填充）

以下函数由 `prompt.ts` 内联实现，将 TS 类型数据渲染为中文 Markdown 文本：

| 函数 | 产物 |
|------|------|
| `projectContextSection()` | `## 项目上下文`（产品描述 + 种子数据 + 功能路径 + 已满足依赖） |
| `workPacketSection()` | `## 当前工作包`（每个需求：id/name、父级路径、需求原文、验收场景、引用资料、exactUiStrings） |
| `platformContractSection()` | `## 平台运行合同`（端口、安装/构建/启动命令、健康检查路径、基础地址） |
| `fragmentSection()` | `## 本次适用的实现规则`（选中的碎片按固定顺序拼接） |
| `renderFailures()` | 失败观察列表（caseId、stepIndex、category、消息、可访问性节选） |

## 3. 碎片选择逻辑

`selectPromptFragments()` 决定哪些领域碎片被注入：

### 3.1 基础碎片

按产品类型（`ProductKind`）固定分配：

| ProductKind | 基础碎片 |
|-------------|----------|
| `repository_collaboration` | accessible_web_controls, server_persistence, auth_and_permission, repository_collaboration |
| `spreadsheet` | accessible_web_controls, server_persistence, spreadsheet_grid |
| `generic_web` | accessible_web_controls |

### 3.2 词典匹配（仅 generic_web）

当产品类型为 `generic_web` 时，扫描工作包中所有需求的 name 和 scenarios，匹配领域词汇追加碎片：

| 碎片 | 词典关键词 |
|------|-----------|
| server_persistence | 保存、刷新、重开、切换、历史、同步、save、refresh、reopen、switch、history、sync、persist |
| auth_and_permission | 登录、账号、成员、所有者、角色、私有、权限、login、account、member、owner、role、private、permission |
| repository_collaboration | 仓库、分支、提交、议题、合并请求、repository、branch、commit、issue、merge request、pull request |
| spreadsheet_grid | 工作簿、工作表、单元格、公式、区域、workbook、worksheet、spreadsheet、cell、formula、region |

词典版本通过 `GENERIC_FALLBACK_LEXICON_VERSION` 跟踪。

### 3.3 观测触发的追加

| 条件 | 追加碎片 |
|------|----------|
| `shadowObservation.failures` 含 `locator` 类 | accessible_web_controls |
| `shadowObservation.applicationStartupFailed` 为 true | delivery_contract |

### 3.4 交付修复特例

`delivery_repair` 模式只选 delivery_contract，不做产品类型匹配或词典扫描。

最终碎片按 `FRAGMENT_ORDER` 固定顺序排列。

## 4. 模式与动作段的内容差异

### implement（首次实现）

动作段为纯静态指导（6 步）：检查现状 → 选择方案 → 实现完整行为 → 不写硬编码特例 → 浏览器自测 → 输出收据。

### repair（修复）

动作段先展示独立验收结果（已通过的观察 + 失败观察），再给出 5 步修复要求：检查相关路径 → 复现现象 → 定位责任层 → 保留已通过行为 → 检查后输出收据。

### root_cause_repair（根因修复）

动作段强调"最后一次允许修复"，展示同样的通过/失败观察，但要求按因果链（用户操作 → 客户端状态 → HTTP 请求 → 认证权限 → 领域状态 → 持久化 → 重新读取 → 界面渲染）逐层排查，修复共同问题，并在收据中用不超过三句话给出根因摘要。

### delivery_repair（交付修复）

动作段仅包含交付验证失败信息和平台合同，不含工作包或需求数据，用于修复 `npm install`/`build`/`start`/`health` 等交付链路故障。

## 5. 填充约束

`fillTemplate()` 的安全边界：

1. **值中禁止 `{{`**：若任何填充值包含字面 `{{`，立即抛错（防止嵌套替换歧义）。
2. **残留检测**：替换完成后扫描残留 `{{...}}`，存在即抛错并列出未填占位符名。
3. **缓存**：加载后的资产按 `category/name` 键缓存，同一键返回同一实例。
4. **归一化**：读入时 `\r\n → \n` + `\r → \n` + `trimEnd()`，产物不含 `\r`。
5. **fail-fast**：文件缺失/不可读抛 `PromptAssetError`，消息含 category、name 和绝对路径。

## 6. 与 Judge 的信息边界

Builder 从 Judge 那里只能拿到 `BuilderShadowObservation`：

```typescript
interface BuilderShadowObservation {
  packetId: string;
  passedCaseIds: string[];
  failures: Array<{
    caseId: string;
    stepIndex: number;
    category: "assertion" | "locator" | "navigation" | "timeout" | "runner";
    message: string;              // 已脱敏
    accessibilityExcerpt?: string; // 已截断
  }>;
  applicationStartupFailed: boolean;
}
```

Builder **看不到**的信息：

- ProbePlan（探针计划）
- Planner 的推理过程
- 每个 case 的完整步骤
- 官方测试或评分结果
- 其他工作包的内容
- ShallowCode 内部运行状态

这是"Never let the builder grade itself"原则的实现基础。Builder 只看到可观察的失败现象（带 caseId、stepIndex、category 和脱敏消息），看不到 Judge 的内部判断标准和验收依据。

## 7. 读取与缓存

`loadBuilderPrompt(category, name)` 的定位逻辑：

```typescript
const assetPath = fileURLToPath(
  new URL(`../../prompts/${category}/${name}.md`, import.meta.url),
);
```

与 CWD 无关，tsx / node --test / ARC-Bench `main.py` 驱动均可。文件随包分发，环境缺文件时 fail-fast（启动即崩）。

## 8. 变更规则

- 改文案 → 改 `prompts/` 中的 `.md` 文件
- 改结构 → 改 `prompt.ts` / `prompt-fragments.ts`
- 两者都要同步 `test/builder-prompt.test.ts` 与 `test/prompt-assets.test.ts` 的锚点断言
- 新增碎片 → 同步 `prompt-fragments.ts` 的词典与 `PromptFragmentId` 联合类型
- 不修改 `builder-system.md` 的防火墙条款（职责边界 5、实现原则 2）
