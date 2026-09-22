# main-7 通过率改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 `docs/handoff/2026-09-22-main7-eval-handoff.md` §4 中"提升通过率"的改进项：网关修复回归验证（§4.1）、prompt 硬规则（§4.3）、首屏数据就绪（§4.4）、Judge 探针加严（§4.5）。

**Architecture:** 网关修复 `0a7a088` 已在 HEAD，本计划补一个跨多个调用窗口的回归测试。种子保真用确定性方案：`catalog.ts` 从需求证据文本逐字提取 `Seed data:` 子句（新字段 `AtomicRequirement.seedDeclarations`），`prompt.ts` 在工作包段渲染"本包初始数据清单"，再配合 builder-system.md 的硬规则（逐字文案、种子完整性 + ARCHITECTURE.md 种子清单、logo 可访问名约定、首帧数据就绪）与 probe-planner.md 的断言加严（登录后状态断言、引号文案逐字断言）。

**Tech Stack:** TypeScript (ESM/NodeNext, 相对 import 带 `.js`)、node:test + tsx、Markdown prompt 资产。

**明确排除（用户指示：用时暂不用优化）：**
- handoff §4.2 大树吞吐（scheduler 阈值）——属于时间优化，不做。
- handoff §4.6 信息防火墙纪律——无可执行代码改动，只遵守：改进依据只取需求文本与参考图，不把官方测试结构写进 prompt。
- handoff §4.8 三题重新官方评测——改完后由用户决定是否本地跑 `eval:local` 验证。

**信息防火墙自查：** 本计划所有 prompt 新增规则均来自需求文本特征（`Seed data:` 子句、引号文案、"BookStack logo" 是需求原文称呼、"Email address" 是 REQ-2.2 场景原文字段名），不来自官方测试文件结构。

---

### Task 1: 网关中断跨窗口恢复的回归测试

`0a7a088` 已修复"网关未恢复即停止派发"。现有 `test/pipeline-gateway.test.ts` 的 90min 中断测试只断言 `implementation_paused` 至少出现一次。本任务补一个中断超过**两个**调用窗口（单次实现上限 90min，`IMPLEMENTATION_CALL_CEILING_MS = 5_400_000`）的回归测试：同一实现包被反复续做、`implementation_paused` 反复出现、最终 delivered。这是 prestashop 级 +40 分的先决回归保障。

**Files:**
- Modify: `test/pipeline-gateway.test.ts`（追加一个测试）

- [ ] **Step 1: 写回归测试**

在 `test/pipeline-gateway.test.ts` 末尾（第 265 行后）追加：

```ts
test("A gateway outage spanning multiple call windows pauses repeatedly and still completes the same packet", async () => {
  await withModulePipeline(async f => {
    let elapsed = 0;
    f.options.totalBudgetMs = 0;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    const original = f.builder.run.bind(f.builder);
    const calls: string[] = [];
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      calls.push(request.packet.id);
      // One implementation call window is 90 minutes; fail past two windows.
      if (elapsed < 190 * 60_000) {
        f.git.applicationChanged = false;
        return { sessionId: "down", outcome: "failed", summary: "quota exhausted", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(summary.pendingRequirementIds, []);
    const firstPacketId = calls[0];
    let samePacketCalls = 0;
    while (samePacketCalls < calls.length && calls[samePacketCalls] === firstPacketId) samePacketCalls++;
    assert.ok(samePacketCalls > 20, `expected the same packet to be retried across call windows, saw ${samePacketCalls} calls`);
    const events = await f.events();
    const pauses = events.filter(event => event.type === "implementation_paused" && event.packetId === firstPacketId);
    assert.ok(pauses.length >= 2, `expected repeated implementation_paused events, saw ${pauses.length}`);
    assert.ok(elapsed >= 190 * 60_000, `expected the outage to span multiple call windows, saw ${elapsed}ms`);
    assert.equal(events.filter(event => event.type === "module_rescued").length, 0);
  });
});
```

- [ ] **Step 2: 运行该测试文件，确认通过（修复已在 HEAD，这是回归保障）**

Run: `npx tsx --test test/pipeline-gateway.test.ts`
Expected: 全部 PASS（含新测试）。若新测试失败，说明 `0a7a088` 的恢复语义有缺口，先停下来用 systematic-debugging 定位，不要改测试凑通过。

- [ ] **Step 3: Commit**

```powershell
git add test/pipeline-gateway.test.ts
git commit -m "test: 网关中断跨多个调用窗口反复暂停并恢复同一实现包的回归测试"
```

---

### Task 2: catalog 提取逐字 `Seed data:` 声明（`seedDeclarations`）

bookstack 失败簇之一：种子实体（如 `Shelf 4.3.1`）只出现在需求描述的 `Seed data:` 子句里，YAML 无顶层 `data:`，Builder 漏种。用确定性提取替代"靠模型注意到散文里的 Seed data"。

**Files:**
- Modify: `src/types.ts`（`AtomicRequirement` 加字段）
- Modify: `src/catalog.ts`（提取函数 + 接入 `collectAtomics`）
- Test: `test/catalog.test.ts`
- 机械修：所有构造 `AtomicRequirement` 的测试夹具（见 Step 4）

- [ ] **Step 1: 写失败测试**

在 `test/catalog.test.ts` 末尾追加（文件已有 `withYaml` helper，与既有测试同风格）：

```ts
test("Catalog extracts verbatim Seed data declarations from requirement evidence", async () => {
  const yaml = [
    "id: ROOT",
    "name: Root",
    "type: ROOT",
    "children:",
    "  - id: AREA",
    "    name: Area",
    "    type: FOLDER",
    "    dependencies: []",
    "    description: 'Area. Seed data: verified account with nickname \"Demo User\", email \"demo@example.com\", and password \"Password123!\".'",
    "    children:",
    "      - id: A",
    "        name: First",
    "        type: ATOMIC",
    "        dependencies: []",
    "        description: 'Create a shelf. Reference image: ![image](./reference/create.png) Seed data: shelf \"Shelf 4.3.1\".'",
    "      - id: B",
    "        name: Second",
    "        type: ATOMIC",
    "        dependencies: []",
    "        description: 'No seeds here.'",
    "  - id: OTHER",
    "    name: Other",
    "    type: FOLDER",
    "    dependencies: []",
    "    children:",
    "      - id: C",
    "        name: Third",
    "        type: ATOMIC",
    "        dependencies: []",
    "        description: 'Delete a shelf. Seed data: deletable shelf \"Shelf 4.4.1\". Seed data: account \"backup@example.com\".'",
  ].join("\n");
  await withYaml(`${yaml}\n`, async (file) => {
    const catalog = await loadRequirementCatalog(file);
    const byId = new Map(catalog.requirements.map((item) => [item.id, item]));
    assert.deepEqual(byId.get("A")?.seedDeclarations, [
      'verified account with nickname "Demo User", email "demo@example.com", and password "Password123!"',
      'shelf "Shelf 4.3.1"',
    ]);
    assert.deepEqual(byId.get("B")?.seedDeclarations, [
      'verified account with nickname "Demo User", email "demo@example.com", and password "Password123!"',
    ]);
    assert.deepEqual(byId.get("C")?.seedDeclarations, [
      'deletable shelf "Shelf 4.4.1"',
      'account "backup@example.com"',
    ]);
  });
});
```

注意：`withYaml` 的 import 与 `loadRequirementCatalog` 已在文件头部存在，直接复用。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test test/catalog.test.ts`
Expected: FAIL —— `seedDeclarations` 为 undefined（deepEqual 失败）。

- [ ] **Step 3: 实现提取**

`src/types.ts` 第 38 行附近，`AtomicRequirement.exactUiStrings` 之后加字段：

```ts
  exactUiStrings: string[];
  /** Verbatim `Seed data:` clauses from the requirement evidence text (ancestors included). */
  seedDeclarations: string[];
```

`src/catalog.ts` 第 207 行 `exactUiStrings: extractUiStrings(evidenceText),` 之后加一行：

```ts
      seedDeclarations: extractSeedDeclarations(evidenceText),
```

并在 `extractUiStrings` 函数（第 238 行）之后新增：

```ts
function extractSeedDeclarations(text: string): string[] {
  const declarations: string[] = [];
  for (const match of text.matchAll(/Seed data:\s*([^\n]+)/gim)) {
    const clause = match[1]
      .replace(/\s+(?:Reference image:|!\[)[\s\S]*$/i, "")
      .trim()
      .replace(/\.$/, "");
    if (clause && !declarations.includes(clause)) declarations.push(clause);
  }
  return declarations;
}
```

说明：子句截取到行尾（需求 YAML 描述是单行）；剥掉尾部 `Reference image:`/图片链接（keep 题描述里 Reference image 在 Seed data 前，这里只防其他题顺序相反）；去末尾句号（`Password123!".` → `Password123!"`）；同一需求内去重（祖先与自身描述可能重复同一种子）。

- [ ] **Step 4: 修全部 `AtomicRequirement` 构造点并过 typecheck**

以下文件构造了 `AtomicRequirement` 字面量，各加 `seedDeclarations: [],`（紧跟各自 `exactUiStrings` 行后）：

- `test/scheduler.test.ts:191`
- `test/prompt-fragments.test.ts:212`
- `test/probe-contract.test.ts:9`
- `test/llm-probe-planner.test.ts:659`
- `test/credential-smoke.test.ts:98`
- `test/builder-prompt.test.ts:312`（Task 3 会改成带值的夹具，此处先加空数组）

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 5: 运行 catalog 测试确认通过**

Run: `npx tsx --test test/catalog.test.ts`
Expected: 全部 PASS（含新测试）。

- [ ] **Step 6: 用真实题目验证提取效果（只读检查，不写代码）**

Run:
```powershell
node -e "import('./src/catalog.ts').catch(()=>{});" 2>$null; npx tsx -e "const { loadRequirementCatalog } = await import('./src/catalog.ts'); const c = await loadRequirementCatalog('benchmarks/arc-bench/arc-bench/webapp/bookstack/requirements/requirements.yaml'); const all = c.requirements.flatMap(r => r.seedDeclarations); console.log('requirements with seeds:', c.requirements.filter(r => r.seedDeclarations.length > 0).length, '/', c.requirements.length); console.log('sample:', JSON.stringify(all.slice(0, 3), null, 1)); console.log('has Shelf 4.3.1:', all.some(d => d.includes('Shelf 4.3.1')));"
```
Expected: 输出 `has Shelf 4.3.1: true`，且多数需求带种子声明。

- [ ] **Step 7: Commit**

```powershell
git add src/types.ts src/catalog.ts test/catalog.test.ts test/scheduler.test.ts test/prompt-fragments.test.ts test/probe-contract.test.ts test/llm-probe-planner.test.ts test/credential-smoke.test.ts test/builder-prompt.test.ts
git commit -m "feat: catalog 逐字提取需求 Seed data 声明为 seedDeclarations"
```

---

### Task 3: Builder 工作包 prompt 渲染"本包初始数据清单"

把 Task 2 提取的种子在工作包段聚合成显式清单，让 Builder 不再从散文里挑种子。

**Files:**
- Modify: `src/builder/prompt.ts`（`workPacketSection`）
- Test: `test/builder-prompt.test.ts`

- [ ] **Step 1: 写失败测试**

在 `test/builder-prompt.test.ts` 的 "Builder includes all seed data…" 测试（第 99–112 行）之后追加：

```ts
test("Work packet renders the aggregated verbatim seed checklist and omits it when empty", () => {
  const withSeeds = implementRequest();
  withSeeds.packet.requirements[0].seedDeclarations = ['shelf "Shelf 4.3.1"', 'account "demo@example.com"'];
  const seeded = compileBuilderPrompt(withSeeds).taskPrompt;
  assert.match(seeded, /### 本包初始数据清单/);
  assert.match(seeded, /逐字落库/);
  assert.ok(seeded.includes('- REQ-PROFILE：shelf "Shelf 4.3.1"'));
  assert.ok(seeded.includes('- REQ-PROFILE：account "demo@example.com"'));

  const withoutSeeds = compileBuilderPrompt(implementRequest()).taskPrompt;
  assert.doesNotMatch(withoutSeeds, /本包初始数据清单/);

  const repaired = compileBuilderPrompt(repairRequest("repair")).taskPrompt;
  assert.doesNotMatch(repaired, /本包初始数据清单/);
});
```

（夹具 `requirementFixture()` 在 Task 2 Step 4 已加 `seedDeclarations: []`，所以缺省无清单。）

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx --test test/builder-prompt.test.ts`
Expected: FAIL —— 没有 `### 本包初始数据清单`。

- [ ] **Step 3: 实现 `workPacketSection` 聚合**

`src/builder/prompt.ts` 第 163–169 行的 `workPacketSection` 替换为：

```ts
function workPacketSection(packet: WorkPacket): string {
  const seedLines = packet.requirements.flatMap((requirement) =>
    requirement.seedDeclarations.map((clause) => `- ${requirement.id}：${clause}`),
  );
  return [
    "## 当前工作包",
    "",
    packet.requirements.map(renderRequirement).join("\n\n"),
    ...(seedLines.length > 0 ? [
      "",
      "### 本包初始数据清单（Seed data 逐字落库）",
      "",
      "以下实体必须全部出现在首次启动的初始数据中：名称逐字、一个不落，包括仅作其他场景前置条件的实体；与先前工作包已交付的初始数据累加，不得覆盖或丢失。",
      ...seedLines,
    ] : []),
  ].join("\n");
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx tsx --test test/builder-prompt.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/builder/prompt.ts test/builder-prompt.test.ts
git commit -m "feat: 工作包 prompt 渲染本包初始数据清单（Seed data 逐字落库）"
```

---

### Task 4: builder-system.md 硬规则（逐字文案 / 种子完整性 / logo 约定 / 首帧数据）

对应 handoff §4.3 与 §4.4。全部是需求文本可合法推出的规则。

**Files:**
- Modify: `prompts/system/builder-system.md`
- Test: `test/prompt-assets.test.ts`、`test/builder-prompt.test.ts`

- [ ] **Step 1: 先写锚点断言（失败测试）**

`test/builder-prompt.test.ts` 第 21–87 行的系统合同锚点测试里，在第 42 行 `assert.match(compiled.systemPrompt, /@testing-library\/react/);` 之后追加：

```ts
  assert.match(compiled.systemPrompt, /逐字作为 label、placeholder、按钮与入口的可访问名/);
  assert.match(compiled.systemPrompt, /不得缩写、加长、同义替换或翻译/);
  assert.match(compiled.systemPrompt, /种子清单/);
  assert.match(compiled.systemPrompt, /首次启动的初始数据中逐字存在/);
  assert.match(compiled.systemPrompt, /产品名> logo/);
  assert.match(compiled.systemPrompt, /首帧渲染即带对象名称/);
```

Run: `npx tsx --test test/builder-prompt.test.ts`
Expected: FAIL（新锚点不存在）。

- [ ] **Step 2: 编辑 `prompts/system/builder-system.md`**

**改动 A**——第 42 行（【可观察的界面合同】第 1 条）整条替换为：

```markdown
1. 将需求和场景中的入口名称、按钮文案、字段 label、placeholder、菜单项、提示、默认数据与操作顺序作为实现合同。引号（含中文引号与反引号）内的文案逐字作为 label、placeholder、按钮与入口的可访问名，不得缩写、加长、同义替换或翻译；尤其是输入字段名（需求写 "Email address" 字段，关联 label 就必须逐字是 "Email address"，不能是 "Email"）和提交/取消按钮名。label 与 placeholder 是两个不同属性，引用图中给出的 placeholder 也要实现。相似入口在不同页面的文案可能不同，不要擅自统一成简称。
```

**改动 B**——第 44 行（第 3 条）中 "logo 的返回入口应能按产品名和用途辨识。" 替换为：

```markdown
logo 等返回首页入口的可访问名逐字采用需求中的称呼（需求称 "BookStack logo"，可访问名就逐字是 "BookStack logo"）；需求未给出称呼时，命名为 "<产品名> logo"。
```

**改动 C**——第 52 行（【初始数据与场景准备】）段末追加一句（接在 "明确要求已删除、已归档或已选中的种子则按原文初始化。新增种子仅补缺项，重启时保留用户已保存的修改。" 之后）：

```markdown
完整性是硬要求：本包及既有需求中每一处 `Seed data:` 声明的实体都必须在首次启动的初始数据中逐字存在，一个不落，包括仅作其他场景前置条件的实体；初始数据由代码内的种子定义在空数据存储时播种，不依赖交付目录里的数据文件。在 ARCHITECTURE.md 的 `## 数据与接口约定` 维护累计种子清单（逐字名称列表），新增或变更种子时同步更新，回执前对照本包初始数据清单逐条自查。
```

**改动 D**——第 56 行（【异步数据与交互就绪】）段末追加：

```markdown
种子与列表数据在首帧即可用：初始数据固定且体积小，内联进前端启动载荷（或由后端首个响应直出），让列表与详情在首帧渲染即带对象名称，不经历先空后填的可见空窗；切换视图前先备好目标数据。
```

- [ ] **Step 3: 运行 prompt 测试确认通过**

Run: `npx tsx --test test/builder-prompt.test.ts test/prompt-assets.test.ts`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```powershell
git add prompts/system/builder-system.md test/builder-prompt.test.ts
git commit -m "prompts: 逐字文案/种子完整性/logo 可访问名/首帧数据就绪硬规则"
```

---

### Task 5: Judge 探针计划加严（登录后状态断言 + 引号文案逐字断言）

对应 handoff §4.5：不能把"表单存在"当登录功能通过；每场景至少一条动作后状态断言并逐字校验引号文案。现有 `prompts/judge/probe-planner.md` 断言模式段已区分"完成操作 vs 没发生"（第 66 行），缺认证态与引号文案的显式规则。

**Files:**
- Modify: `prompts/judge/probe-planner.md`
- Test: `test/prompt-assets.test.ts`

- [ ] **Step 1: 先写锚点断言（失败测试）**

`test/prompt-assets.test.ts` 第 179–180 行附近（planner 锚点）：

```ts
  const planner = loadPrompt("judge", "probe-planner");
  assert.match(planner, /独立的黑盒验收探针作者/);
```

在其后追加：

```ts
  assert.match(planner, /登录表单可见或页面跳转不等于登录成功/);
  assert.match(planner, /逐字纳入 locator 或终末 assertion/);
```

Run: `npx tsx --test test/prompt-assets.test.ts`
Expected: FAIL。

- [ ] **Step 2: 编辑 `prompts/judge/probe-planner.md`**

第 66 行（断言模式第 1 条 "断言必须区分……"）之后插入一条新 bullet（即在该行末尾后新增一行）：

```markdown
- 认证/登录类需求：提交凭据后必须断言证据声明的登录后状态（如昵称、账户入口或登出入口的逐字文案）；登录表单可见或页面跳转不等于登录成功，表单存在不能作为认证功能通过的依据。证据引号（含中文引号与反引号）声明的界面文案是定位与断言的首选字符串：覆盖该文案所属需求的 case 中，至少一条把关键文案（字段 label、placeholder、按钮或入口名）逐字纳入 locator 或终末 assertion。
```

- [ ] **Step 3: 运行确认通过**

Run: `npx tsx --test test/prompt-assets.test.ts test/llm-probe-planner.test.ts`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```powershell
git add prompts/judge/probe-planner.md test/prompt-assets.test.ts
git commit -m "prompts: Judge 探针对认证态与引号文案加严断言"
```

---

### Task 6: AGENTS.md 同步 + 全量验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 同步 AGENTS.md 索引行**

`AGENTS.md` 项目结构索引中：

- `catalog.ts` 行 `requirements.yaml → 需求树与 ProductContext.seedData；校验 ID 和依赖` 改为 `requirements.yaml → 需求树、ProductContext.seedData 与原子级 seedDeclarations（Seed data 逐字提取）；校验 ID 和依赖`。
- `builder/prompt.ts` 行 `compileBuilderPrompt / buildBuilderTaskPrompt：系统合同 + 模板填充 + fragments 拼装` 改为 `compileBuilderPrompt / buildBuilderTaskPrompt：系统合同 + 模板填充 + fragments 拼装 + 本包初始数据清单`。

- [ ] **Step 2: 全量验证**

Run: `npm run test:all`
Expected: typecheck 通过；单元/集成全 PASS（凭证测试 skip）；Chromium 测试全 PASS。

- [ ] **Step 3: Commit**

```powershell
git add AGENTS.md
git commit -m "docs: AGENTS.md 同步 seedDeclarations 与初始数据清单"
```

---

### Task 7（可选，由用户决定）: 本地生成+评测验证提分

需要 `.env` 网关凭据；生成耗时数小时，与 main-7 基线（prestashop 48.8 / keep 68.8 / bookstack 58.8）对比。建议先跑 bookstack（最小树，且失败簇全在本计划靶心上）：

```powershell
npm run eval:local -- --agent main --app bookstack
```

记录测试修订、模型与耗时。**不能**只看单测就声称提分（verification-before-completion）。

---

## 执行期增量（证据驱动）

实施后经 main-7 产物取证发现：Builder 在 `store.js` 注释中**主动裁决**不播种（"Shelf 4.3.1 is intentionally NOT seeded: it is created through the UI"），且 Judge 探针同构误读（把种子当 fill 创建值，断言的初始可见项却是另一需求的种子）。据此在 Task 5 之外补入 Judge 侧种子对策：`llm-probe-planner.ts` 的规划输入携带 `seedDeclarations`，`probe-planner.md` 种子规则明确"种子是动作前初始数据、不是本场景创建/修改的目标名，新名称须与种子名不同"。测试：`llm-probe-planner.test.ts` 种子转发断言、`prompt-assets.test.ts` 锚点。

## Self-Review

- **Spec 覆盖：** handoff §4.1 → Task 1；§4.3 → Task 2/3/4（"Email address" 逐字 → 改动 A；种子全量落库 + ARCHITECTURE.md 清单 → 改动 C + Task 2/3；logo "<产品名> logo" → 改动 B；参考图文案照抄 → 改动 A 保留原 placeholder 句）；§4.4 → 改动 D；§4.5 → Task 5；§4.6 → 计划头部防火墙自查；§4.7 → Task 6（test:all + AGENTS.md；无新增事件类型，types.ts 判别联合与 human-log.ts 无需变动）；§4.8 → Task 7（可选）。§4.2 按用户指示排除。
- **占位符扫描：** 无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致性：** `seedDeclarations: string[]` 在 Task 2 定义，Task 3 消费（`requirement.seedDeclarations.map(...)`），测试夹具统一在 Task 2 Step 4 加空数组；Task 3 测试直接覆写 `withSeeds.packet.requirements[0].seedDeclarations`。
- **风险点：** Task 1 的虚拟时钟分析（90min 窗口 ×2 + 退避序列）若与实现有出入，断言 `pauses.length >= 2` 可能不稳定——执行时以实际事件流为准微调阈值，但不得放宽到 < 2（否则达不到"反复出现"的回归意图）。
