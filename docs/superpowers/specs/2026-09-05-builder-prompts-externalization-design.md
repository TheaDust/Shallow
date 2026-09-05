# Builder 提示词外置设计（prompts/ 目录）

日期：2026-09-05
状态：已与用户确认方案 A（运行时读取 Markdown），本文档为实施规格

## 1. 背景与动机

Builder 的全部提示词目前内嵌在 TS 源码中：

- `src/builder/prompt.ts`（12.9KB）：`SYSTEM_PROMPT`（系统合同）、四个任务组装函数（implement / repair / root_cause_repair / delivery_repair）、`receiptSection()`（结果收据）。
- `src/builder/prompt-fragments.ts`（6.4KB）：`PROMPT_FRAGMENTS`（6 个片段）与 `GENERIC_FALLBACK_LEXICON`（版本化兜底词典）。

竞赛期需要高频手调中文措辞。内嵌字符串意味着每改一句话都要面对模板字符串转义、diff 噪声和编码风险（本会话曾发生 PowerShell 写坏 prompt.ts UTF-8 的事故）。目标：把提示词文本搬到独立目录，代码只负责加载、组装与选择。

## 2. 目标 / 非目标

**目标**

1. 固定提示词与片段提示词分别放在 `prompts/system/`、`prompts/fragments/` 两个目录，一条提示词一个 `.md` 文件。
2. 代码通过统一加载器引用；对 `prompt.ts` / `prompt-fragments.ts` 的外部调用者而言 API 签名零变化。
3. 迁移是**逐字搬移**：编译产出的提示词与现状保持文本一致；验收标准为现有内容断言测试不改一行全部通过。
4. 用守卫测试锁住「ID↔文件一一对应、占位符齐全、文本非空」。

**非目标**

- 不外置探针规划器（`llm-probe-planner.ts:51,83`）的两小段 system 消息——它们是结构化 JSON 输出指令，几乎不改。
- 不外置 `GENERIC_FALLBACK_LEXICON`（用户已确认）——它是选择逻辑的匹配数据，与 TS 类型强耦合，不作为提示词文本发出。
- 不引入 watch/热重载、不加新依赖（仅 `node:fs` / `node:url`）、不做构建期代码生成。

## 3. 目录结构

```
prompts/
  system/                          ← 固定提示词
    builder-system.md              系统合同（现 prompt.ts L25-47，纯静态）
    task-implement.md              首次实现任务骨架（含静态头部"任务模式：首次实现"）
    task-repair.md                 第一次修复任务骨架
    task-root-cause-repair.md      最后一次根因修复任务骨架
    task-delivery-repair.md        交付修复任务骨架（无工作包字段）
    action-implement.md            实现行动块（纯静态）
    action-repair.md               修复行动块
    action-root-cause-repair.md    根因修复行动块
    action-delivery-repair.md      交付修复行动块（内嵌平台合同占位符）
    receipt.md                     结果收据（纯静态，含字面 {{主要变更}} 等）
  fragments/                       ← 片段提示词（一片段一文件）
    accessible-web-controls.md
    server-persistence.md
    auth-and-permission.md
    repository-collaboration.md
    spreadsheet-grid.md
    delivery-contract.md
```

文件名与 `PromptFragmentId` / 模板名的对应关系固定；命名采用现 ID 的 kebab-case。

### 各文件占位符清单

| 文件 | 占位符 |
| --- | --- |
| task-implement.md | `{{PACKET_ID}}` `{{PACKET_ATTEMPT}}` `{{OUTPUT_DIR}}` `{{ACTION}}` `{{PROJECT_CONTEXT}}` `{{WORK_PACKET}}` `{{PLATFORM_CONTRACT}}` `{{FRAGMENTS}}` |
| task-repair.md | 同上 |
| task-root-cause-repair.md | 同上 |
| task-delivery-repair.md | `{{OUTPUT_DIR}}` `{{ACTION}}` `{{FRAGMENTS}}` |
| action-repair.md | `{{PASSED_CASE_IDS}}` `{{FAILURES}}` |
| action-root-cause-repair.md | `{{PASSED_CASE_IDS}}` `{{FAILURES}}` |
| action-delivery-repair.md | `{{FAILURE_STAGE}}` `{{FAILURE_COMMAND}}` `{{FAILURE_EXPECTED}}` `{{FAILURE_ACTUAL}}` `{{PLATFORM_CONTRACT}}` |
| builder-system.md、receipt.md、action-implement.md、全部 fragments | 无代码填充占位符（receipt.md 的字面 `{{主要变更}}` 等是发给 Builder 的收据格式，见 §4，不属于填充点） |

任务模板头部直接写死各自的模式标签（如"任务模式：第一次修复"）与固定字段骨架，动态值走占位符。模式标签随之从代码迁入文件。

## 4. 加载器 `src/builder/prompt-assets.ts`

```ts
export function loadBuilderPrompt(
  category: "system" | "fragments",
  name: string,
): string;

export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string;
```

- **定位**：`new URL(`../../prompts/${category}/${name}.md`, import.meta.url)` + `fileURLToPath`。与 CWD 无关，tsx / node --test / ARC-Bench `main.py` 驱动均可。
- **读取**：`readFileSync(..., "utf8")`，随后 `\r\n → \n` 归一并 `trimEnd()`（保留内部缩进）。Windows 编辑器保存 CRLF 不影响产物。
- **缓存**：模块级 `Map<`${category}/${name}`, string>`，同一 key 返回同一实例。
- **fillTemplate**：对 `values` 的每个 key 做 `{{KEY}}` 全量替换；替换完成后扫描残留 `{{...}}`，存在即抛错并列出——防止模板与代码漂移。
- **错误**：文件缺失/不可读抛 `PromptAssetError`（消息含 category、name、绝对路径），fail-fast。

### 字面 `{{...}}` 的豁免（关键约束）

`receipt.md` 内的 `{{主要变更}}`、`{{命令或检查方式}}`、`{{必要的简短摘要}}`、`{{根因修复或交付修复填写；其他模式写"不适用"}}` 是**发给 Builder 的字面收据格式**，不是代码填充点。因此：

1. `receipt.md` 由加载器原样返回，**永远不经过 `fillTemplate`**；
2. 任务模板中不含 `{{RECEIPT}}` 占位符——收据由代码在模板填充完成后以 `"\n\n"` 拼接追加（与现组装顺序一致）；
3. 残留检测因此不会误伤收据字面量。

已知边界：`{{FAILURE_ACTUAL}}` 等填充值来自控制器自身生成的失败观察文本。若其中出现字面 `{{`，fillTemplate 会抛错——这是期望行为（发送前 fail-fast，而不是发出被篡改的模板），在规格中明示。

## 5. 代码改造

### prompt-fragments.ts

- `PROMPT_FRAGMENTS: Record<PromptFragmentId, string>` 改为用 `loadBuilderPrompt("fragments", kebab(id))` 逐个构建；导出类型与值形态不变。
- `FRAGMENT_ORDER`、`selectPromptFragments`、词典与 `GENERIC_FALLBACK_LEXICON_VERSION` 原样保留。

### prompt.ts

- `SYSTEM_PROMPT` ← `loadBuilderPrompt("system", "builder-system")`；`buildBuilderSystemPrompt()` 返回值不变。
- 四个行动块函数改为：加载 `action-*.md` →（repair/root_cause/delivery）先 `fillTemplate` 填入观察/失败字段 → 返回字符串。
- `buildBuilderTaskPrompt` 各分支改为：加载 `task-*.md` → `fillTemplate` 填入 `{{PACKET_ID}}`/`{{PACKET_ATTEMPT}}`/`{{OUTPUT_DIR}}`（取自现 `packetHeader` 的字段取值逻辑，模式标签已写死在各自模板头部）以及 `{{ACTION}}`、`{{PROJECT_CONTEXT}}`、`{{WORK_PACKET}}`、`{{PLATFORM_CONTRACT}}`、`{{FRAGMENTS}}` → 末尾 `"\n\n"` 拼接收据 → `trim()`。`packetHeader` 函数随之删除；delivery 模板头部只含 `{{OUTPUT_DIR}}`。
- **留在代码中的数据渲染**（与 TS 类型强耦合、非措辞调优对象）：`renderRequirement`、`renderFailures`、`projectContextSection`、`platformContractSection`、`fragmentSection` 的列表拼接、`packetHeader` 的字段取值。若后续需要外置这些小节骨架，是纯机械扩展。
- 对外导出（`CompiledBuilderPrompt`、`buildBuilderSystemPrompt`、`compileBuilderPrompt`、`buildBuilderTaskPrompt`）签名不变；`index.ts`、`opencode-sdk.ts`、pipeline、测试的调用点零改动。

### 组装顺序（保证逐字节一致）

现状外层 `join("\n\n")` + `trim()`。迁移后模板文件内各小节之间以恰好一个空行分隔，占位符值保持各 section 函数现有内部 `join("\n")` 产物，最终 `template + "\n\n" + receipt` 后 `trim()`。守卫：现有 `test/builder-prompt.test.ts` / `test/prompt-fragments.test.ts` 的硬编码中文断言不改一行全部通过，即视为逐字搬移成功。

## 6. 守卫测试 `test/prompt-assets.test.ts`

1. **ID↔文件一一对应**：每个 `PromptFragmentId` 在 `prompts/fragments/` 有同名 kebab-case 文件；`fragments/` 目录无孤儿文件。
2. **非空与锚点**：每个加载文件非空且含关键锚点（如 builder-system.md 含"唯一代码实现者"、receipt.md 含"结果：完成 | 阻塞"、task-delivery-repair.md 含"交付修复"）。
3. **占位符齐全**：按 §3 清单断言每个模板/行动块包含其必填占位符集合。
4. **fillTemplate 行为**：全量替换成功；残留 `{{UNKNOWN}}` 抛错且错误消息列出占位符名。
5. **归一化**：加载产物不含 `\r`；缓存生效（两次加载同一引用）。
6. **现有测试不动**：`builder-prompt.test.ts`、`prompt-fragments.test.ts`、`pipeline.e2e.test.ts` 原样通过。

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Windows 编辑器 CRLF 污染提示词 | 加载器强制归一 + 守卫测试断言无 `\r` |
| 再次发生 PowerShell 写坏 UTF-8 | 约束：编辑 prompts/ 只用编辑器/Read-Write 工具；守卫测试的中文锚点断言会在回归时暴露乱码 |
| 模板与代码漂移（占位符改名漏改） | fillTemplate 残留检测抛错 + 守卫测试占位符清单 |
| 收据字面 `{{...}}` 被误填充 | 收据不经过 fillTemplate、模板不含 `{{RECEIPT}}`（§4） |
| ARC-Bench 环境缺文件 | 提交整仓库目录，`prompts/` 随包分发；缺文件 fail-fast 并在启动即崩 |
| 防火墙回归 | 本次只动存放位置，不改任何提示词内容与发送对象；`npm run test:all` + 既有防火墙扫描复验 |

## 8. 验证命令

```powershell
npm run typecheck
npm test                 # 含新增 prompt-assets 守卫
npm run test:browser
npm run test:all
```
