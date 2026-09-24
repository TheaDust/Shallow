import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { compileBuilderPrompt } from "../src/builder/prompt.js";
import type {
  BuilderPromptInput,
  BuilderProjectContext,
  BuilderShadowObservation,
} from "../src/builder/prompt-input.js";
import type { BuilderRequest } from "../src/builder/port.js";
import type {
  AtomicRequirement,
  PlatformContract,
  WorkPacket,
} from "../src/types.js";
import { FakeBuilder } from "./fakes/fake-builder.js";

test("Builder prompt compiles a Chinese system contract and dynamic task prompt", () => {
  const compiled = compileBuilderPrompt(implementRequest());

  assert.match(compiled.systemPrompt, /唯一代码实现者/);
  assert.match(compiled.systemPrompt, /Builder 开发检查/);
  assert.match(compiled.systemPrompt, /传统测试/);
  assert.match(compiled.systemPrompt, /保留种子数据/);
  assert.match(compiled.systemPrompt, /释放进程/);
  assert.doesNotMatch(compiled.systemPrompt, /MCP/);
  assert.match(compiled.systemPrompt, /SHALLOW_DATA_DIR/);
  assert.match(compiled.systemPrompt, /持续增量扩展/);
  assert.match(compiled.systemPrompt, /必要的开发检查/);
  assert.match(compiled.systemPrompt, /全新的独立会话/);
  assert.match(compiled.systemPrompt, /唯一交接面/);
  assert.match(compiled.systemPrompt, /复杂或边界逻辑必须编写传统测试并用 run_tests 运行/);
  assert.match(compiled.systemPrompt, /browser 是昂贵工具/);
  assert.match(compiled.systemPrompt, /清晰稳定的模块与接口边界/);
  assert.match(compiled.systemPrompt, /延续既有栈，不得换栈重写/);
  assert.match(compiled.systemPrompt, /React \+ Vite \+ TypeScript/);
  assert.match(compiled.systemPrompt, /hash 路由/);
  assert.match(compiled.systemPrompt, /必须使用 HashRouter/);
  assert.match(compiled.systemPrompt, /@testing-library\/react/);
  assert.match(compiled.systemPrompt, /按其所属控件或文本逐字实现/);
  assert.match(compiled.systemPrompt, /不得缩写、加长、同义替换或翻译/);
  assert.match(compiled.systemPrompt, /种子清单/);
  assert.match(compiled.systemPrompt, /明确列为预置或既有的实体/);
  assert.match(compiled.systemPrompt, /logo 等返回首页入口的角色和可访问名以需求明示为准/);
  assert.match(compiled.systemPrompt, /用户可操作时，目标数据应已加载或能等待加载完成/);
  assert.match(compiled.taskPrompt, /浏览器未执行/);
  assert.match(compiled.taskPrompt, /未执行/);
  assert.match(compiled.taskPrompt, /需求核对/);
  assert.doesNotMatch(compiled.systemPrompt, /REQ-PROFILE/);
  assert.match(compiled.taskPrompt, /# 行动：实现当前工作包/);
  assert.match(compiled.taskPrompt, /先规划，再实施/);
  assert.match(compiled.taskPrompt, /严格符合需求文档/);
  assert.match(compiled.taskPrompt, /覆盖本包每条需求和场景新增的具体约束/);
  assert.match(compiled.taskPrompt, /完整业务链路/);
  assert.match(compiled.taskPrompt, /不要为某个示例数据/);
  assert.match(compiled.taskPrompt, /ARCHITECTURE\.md/);
  assert.match(compiled.taskPrompt, /REQ-PROFILE/);
  assert.match(compiled.taskPrompt, /Root description/);
  assert.match(compiled.taskPrompt, /Profile area/);
  assert.match(compiled.taskPrompt, /Keep a profile name after refresh\./);
  assert.match(compiled.taskPrompt, /The value remains after refresh\./);
  assert.match(compiled.taskPrompt, /reference\/profile\.png/);
  assert.match(compiled.taskPrompt, /Profile name \| Save/);
  assert.match(compiled.taskPrompt, /引号原词（须按原文区分界面名称、数据值与示例）/);
  assert.match(compiled.taskPrompt, /输入控件使用符合用途的原生类型/);
  assert.match(compiled.taskPrompt, /不只依赖浏览器原生校验气泡/);
  assert.match(compiled.taskPrompt, /同名操作可以重复/);
  assert.match(compiled.taskPrompt, /打开对象的方式依需求/);
  assert.match(compiled.taskPrompt, /<h1>–<h6>/);
  assert.match(compiled.taskPrompt, /要求 menu\/menuitem 时提供相应角色与键盘行为/);
  assert.match(compiled.taskPrompt, /按需求使用 table、row、cell/);
  assert.match(compiled.taskPrompt, /使用 status 或 alert/);
  assert.match(compiled.taskPrompt, /原生 disabled/);
  assert.match(compiled.taskPrompt, /对话框有可访问名称/);
  assert.match(compiled.taskPrompt, /次要操作是否悬停后出现，依据需求和参考图决定/);
  assert.match(compiled.taskPrompt, /可访问的 option、radio、checkbox/);
  assert.match(compiled.taskPrompt, /背景不可操作/);
  assert.match(compiled.taskPrompt, /npm --prefix frontend run build/);
  assert.match(compiled.taskPrompt, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(compiled.taskPrompt, /PORT/);
  assert.match(compiled.taskPrompt, /同源相对路径/);
  assert.doesNotMatch(compiled.taskPrompt, /SECRET-OTHER-REQ/);
  assert.doesNotMatch(compiled.taskPrompt, /acceptedSha|global budget|\/workspace\/tests/i);
  // 技术栈缺省（React+Vite）只出现在固定系统合同里；任务模板不向既有项目推销换栈
  assert.doesNotMatch(compiled.taskPrompt, /use React|use Vue/i);
  assert.deepEqual(compiled.fragmentIds, [
    "accessible_web_controls",
    "server_persistence",
  ]);
  assert.match(compiled.taskPrompt, /结果：完成 \| 阻塞/);
});

test("Module and consolidated repair prompts bound self-test and keep implementation notes optional", () => {
  for (const request of [implementRequest(), repairRequest("repair")]) {
    const compiled = compileBuilderPrompt(request);
    assert.match(compiled.systemPrompt, /传统测试/);
    assert.match(compiled.taskPrompt, /ARCHITECTURE\.md/);
    assert.match(compiled.taskPrompt, /不超过十行/);
    assert.doesNotMatch(compiled.taskPrompt, /再重新 `prepare` 并完成关键路径检查/);
  }
});

test("Builder includes all seed data in implementation and both packet repair modes", () => {
  const item = `固定验证码 123456；${"完整预置值。".repeat(400)}末尾标记`;
  for (const request of [implementRequest(), repairRequest("repair"), repairRequest("root_cause_repair")]) {
    if (request.mode === "delivery_repair") throw new Error("unexpected mode");
    request.projectContext.product.seedData = [{ category: "账户预置", items: [item] }];
    const { taskPrompt } = compileBuilderPrompt(request);
    assert.match(taskPrompt, /## 种子数据/);
    assert.match(taskPrompt, /账户预置/);
    assert.ok(taskPrompt.includes(item));
    assert.match(taskPrompt, /内置或可复现/);
  }
  assert.doesNotMatch(compileBuilderPrompt(implementRequest()).taskPrompt, /## 种子数据/);
  assert.doesNotMatch(compileBuilderPrompt(deliveryRequest()).taskPrompt, /## 种子数据/);
});

test("Work packet renders the aggregated verbatim seed checklist and omits it when empty", () => {
  const withSeeds = implementRequest();
  if (withSeeds.mode === "delivery_repair") throw new Error("unexpected mode");
  withSeeds.packet.requirements[0].seedDeclarations = ['shelf "Shelf 4.3.1"', 'account "demo@example.com"'];
  const seeded = compileBuilderPrompt(withSeeds).taskPrompt;
  assert.match(seeded, /### 本包初始数据原文摘录/);
  assert.match(seeded, /逐字保留实体及关系/);
  assert.ok(seeded.includes('- REQ-PROFILE：shelf "Shelf 4.3.1"'));
  assert.ok(seeded.includes('- REQ-PROFILE：account "demo@example.com"'));

  const withoutSeeds = compileBuilderPrompt(implementRequest()).taskPrompt;
  assert.doesNotMatch(withoutSeeds, /本包初始数据原文摘录/);

  const repaired = compileBuilderPrompt(repairRequest("repair")).taskPrompt;
  assert.doesNotMatch(repaired, /本包初始数据原文摘录/);
});

test("Repair prompt carries only the cleaned shadow observation", () => {
  const compiled = compileBuilderPrompt(repairRequest("repair"));

  assert.match(compiled.taskPrompt, /# 行动：检查并修复需求偏差/);
  assert.match(compiled.taskPrompt, /category 为 locator 的观测尚不能证明业务失败/);
  assert.match(compiled.taskPrompt, /已通过的用例标识/);
  assert.match(compiled.taskPrompt, /open-page/);
  assert.match(compiled.taskPrompt, /允许使用的失败观测/);
  assert.match(compiled.taskPrompt, /save-profile/);
  assert.match(compiled.taskPrompt, /Expected Saved, received Error/);
  assert.doesNotMatch(compiled.taskPrompt, /"verdict"|JSON|black-box report/i);
  assert.match(compiled.taskPrompt, /ARCHITECTURE\.md/);
  assert.match(compiled.taskPrompt, /结果：完成 \| 阻塞/);
});

test("Root-cause repair frames the last allowed attempt", () => {
  const compiled = compileBuilderPrompt(repairRequest("root_cause_repair"));

  assert.match(compiled.taskPrompt, /# 行动：执行最后一次根因修复/);
  assert.match(compiled.taskPrompt, /身份认证和权限判断/);
  assert.match(compiled.taskPrompt, /不超过三句话/);
  assert.match(compiled.taskPrompt, /根因/);
  assert.match(compiled.taskPrompt, /结果：完成 \| 阻塞/);
});

test("Delivery repair renders the failure without any work packet context", () => {
  const compiled = compileBuilderPrompt(deliveryRequest());

  assert.match(compiled.taskPrompt, /# 行动：修复最终交付故障/);
  assert.match(compiled.taskPrompt, /失败阶段：\nbuild/);
  assert.match(compiled.taskPrompt, /失败命令：\n未提供/);
  assert.match(compiled.taskPrompt, /平台构建命令成功退出并生成生产构建产物/);
  assert.match(compiled.taskPrompt, /实际观察：\nproduction build failed/);
  assert.match(compiled.taskPrompt, /【交付合同】/);
  assert.doesNotMatch(compiled.taskPrompt, /当前工作包|delivery-repair/);
  assert.doesNotMatch(compiled.taskPrompt, /REQ-PROFILE/);
  assert.doesNotMatch(
    compiled.taskPrompt,
    /【状态与持久化】|【身份与权限】|【仓库协作业务】|【电子表格业务】/,
  );
  assert.deepEqual(compiled.fragmentIds, ["delivery_contract"]);
  assert.match(compiled.taskPrompt, /结果：完成 \| 阻塞/);
});

test("Startup failures append the delivery contract on top of the product base", () => {
  const compiled = compileBuilderPrompt(
    repairRequest("repair", {
      applicationStartupFailed: true,
      failures: [
        {
          caseId: "<application>",
          stepIndex: -1,
          category: "runner",
          message: "Application exited before readiness with code 1",
        },
      ],
    }),
  );

  assert.match(compiled.taskPrompt, /【交付合同】/);
  assert.match(compiled.taskPrompt, /【状态与持久化】/);
  assert.match(compiled.taskPrompt, /Application exited before readiness/);
});

test("Builder distinguishes the evaluation default from the probe port", () => {
  const request = implementRequest();
  request.platformContract.port = 3210;
  request.platformContract.baseUrl = "http://127.0.0.1:3210";
  const compiled = compileBuilderPrompt(request);
  assert.match(compiled.taskPrompt, /未设置时使用 3000/);
  assert.match(compiled.taskPrompt, /PORT=3210/);
});

test("Builder receives every discovered extra port and omits the clause when there are none", () => {
  const withoutExtra = compileBuilderPrompt(implementRequest());
  assert.doesNotMatch(withoutExtra.taskPrompt, /额外监听/);
  assert.doesNotMatch(withoutExtra.taskPrompt, /ERR_SERVER_ALREADY_LISTEN/);

  const request = implementRequest();
  request.platformContract.extraPorts = [3301, 4400];
  const compiled = compileBuilderPrompt(request);
  assert.match(compiled.taskPrompt, /3301/);
  assert.match(compiled.taskPrompt, /4400/);
  assert.match(compiled.taskPrompt, /ARC_EXTRA_PORTS=0/);
  assert.match(compiled.taskPrompt, /ERR_SERVER_ALREADY_LISTEN/);
});

test("FakeBuilder copies only the test fixture app into output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallow-fake-builder-"));
  try {
    const builder = new FakeBuilder();
    const result = await builder.run({
      ...builderRequest(1),
      outputDir: directory,
    });

    assert.equal(result.outcome, "completed");
    await access(join(directory, "server.mjs"));
    const packageJson = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(packageJson.scripts.start, "node server.mjs");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function implementRequest(): BuilderPromptInput {
  return {
    mode: "implement",
    packet: packetFixture(),
    projectContext: projectContextFixture(),
    outputDir: "C:\\candidate-app",
    platformContract: contractFixture(),
  };
}

function repairRequest(
  mode: "repair" | "root_cause_repair",
  overrides?: Partial<BuilderShadowObservation>,
): BuilderPromptInput {
  return {
    mode,
    packet: packetFixture(),
    projectContext: projectContextFixture(),
    shadowObservation: {
      packetId: "packet-req-profile",
      passedCaseIds: ["open-page"],
      failures: [
        {
          caseId: "save-profile",
          stepIndex: 3,
          category: "assertion",
          message: "Expected Saved, received Error",
        },
      ],
      applicationStartupFailed: false,
      ...overrides,
    },
    outputDir: "C:\\candidate-app",
    platformContract: contractFixture(),
  };
}

function deliveryRequest(): BuilderPromptInput {
  return {
    mode: "delivery_repair",
    deliveryFailure: {
      stage: "build",
      expected: "平台构建命令成功退出并生成生产构建产物",
      actual: "production build failed",
    },
    outputDir: "C:\\candidate-app",
    platformContract: contractFixture(),
  };
}

function projectContextFixture(): BuilderProjectContext {
  return {
    product: {
      kind: "generic_web",
      rootId: "ROOT",
      rootName: "Demo Product",
      description: "Root description.",
      seedData: [],
    },
    ancestors: [
      { id: "PROFILE", name: "Profile", description: "Profile area" },
    ],
    satisfiedDependencies: [
      {
        id: "REQ-BASE",
        name: "Base profile",
        contract: "The base profile stores a name.",
      },
    ],
  };
}

function packetFixture(): WorkPacket {
  return {
    id: "packet-req-profile",
    requirementIds: ["REQ-PROFILE"],
    attempt: 1,
    requirements: [requirementFixture()],
  };
}

function requirementFixture(): AtomicRequirement {
  return {
    id: "REQ-PROFILE",
    folderPath: ["ROOT", "PROFILE"],
    declarationIndex: 0,
    name: "Profile",
    text: "Keep a profile name after refresh.",
    dependencyIds: [],
    scenarios: ["Save a profile\nTHEN: The value remains after refresh."],
    references: ["reference/profile.png"],
    exactUiStrings: ["Profile name", "Save"],
    seedDeclarations: [],
    product: {
      kind: "generic_web",
      rootId: "ROOT",
      rootName: "Demo Product",
      description: "Root description.",
      seedData: [],
    },
    ancestors: [
      { id: "PROFILE", name: "Profile", description: "Profile area" },
    ],
  };
}

function contractFixture(): PlatformContract {
  return {
    baseUrl: "http://127.0.0.1:3000",
    port: 3000,
    evaluationPort: 3000,
    installCommands: [
      { executable: "npm", args: ["install"], cwd: "frontend" },
    ],
    buildCommands: [
      { executable: "npm", args: ["run", "build"], cwd: "frontend" },
    ],
    startCommand: {
      executable: "npm",
      args: ["run", "start"],
      cwd: "backend",
    },
    healthPath: "/health",
    buildTimeoutMs: 120_000,
    startTimeoutMs: 30_000,
  };
}

function builderRequest(attempt: 1 | 2 | 3): BuilderRequest {
  const packet = { ...packetFixture(), attempt };
  const projectContext = projectContextFixture();
  const outputDir = "C:\\candidate-app";
  const platformContract = contractFixture();
  if (attempt === 1) {
    return { mode: "implement", packet, projectContext, outputDir, platformContract };
  }
  return {
    mode: attempt === 2 ? "repair" : "root_cause_repair",
    packet,
    projectContext,
    shadowObservation: {
      packetId: packet.id,
      passedCaseIds: [],
      failures: [
        {
          caseId: "save-profile",
          stepIndex: 3,
          category: "assertion",
          message: "Value did not persist",
        },
      ],
      applicationStartupFailed: false,
    },
    outputDir,
    platformContract,
  };
}
