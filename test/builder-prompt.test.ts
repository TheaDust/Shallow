import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  OpenCodeSdkBuilder,
  type OpenCodePromptInput,
  type OpenCodeRuntime,
  type OpenCodeServerExit,
} from "../src/builder/opencode-sdk.js";
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
import { withTempDir } from "./helpers/temp-dir.js";
import { ExecutionFault } from "../src/execution-fault.js";

test("Builder exposes runtime startup failure as terminal infrastructure", async () => {
  const runtime = new RecordingRuntime();
  runtime.start = async () => { throw Object.assign(new Error("missing opencode"), { code: "ENOENT" }); };
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 1000 });
  try {
    await assert.rejects(builder.run(builderRequest(1)), (error: unknown) => {
      assert.ok(error instanceof ExecutionFault);
      assert.equal(error.code, "builder_start");
      assert.equal(error.retryable, false);
      return true;
    });
  } finally { await builder.close(); }
});

test("Builder prompt compiles a Chinese system contract and dynamic task prompt", () => {
  const compiled = compileBuilderPrompt(implementRequest());

  assert.match(compiled.systemPrompt, /唯一代码实现者/);
  assert.match(compiled.systemPrompt, /Builder 浏览器自测/);
  assert.match(compiled.systemPrompt, /browser_snapshot/);
  assert.match(compiled.systemPrompt, /服务端数据隔离/);
  assert.match(compiled.systemPrompt, /由控制器停止自测应用/);
  assert.match(compiled.systemPrompt, /`candidate` MCP 的 `prepare`/);
  assert.match(compiled.systemPrompt, /SHALLOW_DATA_DIR/);
  assert.match(compiled.systemPrompt, /持续增量扩展/);
  assert.match(compiled.systemPrompt, /至少检查一个边界输入/);
  assert.match(compiled.taskPrompt, /浏览器自测：/);
  assert.match(compiled.taskPrompt, /通过 \| 失败 \| 未执行/);
  assert.doesNotMatch(compiled.systemPrompt, /REQ-PROFILE/);
  assert.match(compiled.taskPrompt, /# 行动：实现当前工作包/);
  assert.match(compiled.taskPrompt, /可观察验收判据/);
  assert.match(compiled.taskPrompt, /不猜测外部测试/);
  assert.match(compiled.taskPrompt, /ARCHITECTURE\.md/);
  assert.match(compiled.taskPrompt, /REQ-PROFILE/);
  assert.match(compiled.taskPrompt, /Root description/);
  assert.match(compiled.taskPrompt, /Profile area/);
  assert.match(compiled.taskPrompt, /Keep a profile name after refresh\./);
  assert.match(compiled.taskPrompt, /The value remains after refresh\./);
  assert.match(compiled.taskPrompt, /reference\/profile\.png/);
  assert.match(compiled.taskPrompt, /Profile name \| Save/);
  assert.match(compiled.taskPrompt, /type="text"/);
  assert.match(compiled.taskPrompt, /绝不能依赖 HTML5 required 或 pattern/);
  assert.match(compiled.taskPrompt, /npm --prefix frontend run build/);
  assert.match(compiled.taskPrompt, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(compiled.taskPrompt, /PORT/);
  assert.match(compiled.taskPrompt, /同源相对路径/);
  assert.doesNotMatch(compiled.taskPrompt, /SECRET-OTHER-REQ/);
  assert.doesNotMatch(compiled.taskPrompt, /acceptedSha|global budget|\/workspace\/tests/i);
  assert.doesNotMatch(compiled.taskPrompt, /use React|use Vue/i);
  assert.deepEqual(compiled.fragmentIds, [
    "accessible_web_controls",
    "server_persistence",
  ]);
  assert.match(compiled.taskPrompt, /结果：完成 \| 阻塞/);
});

test("Builder memory guidance precedes final preparation in every packet mode", () => {
  for (const request of [implementRequest(), repairRequest("repair"), repairRequest("root_cause_repair")]) {
    const { systemPrompt, taskPrompt } = compileBuilderPrompt(request);
    assert.match(taskPrompt, /需求与平台合同优先/);
    assert.match(taskPrompt, /没有变化时保持文件不动/);
    assert.match(taskPrompt, /通常控制在约 60 行/);
    assert.match(taskPrompt, /保留必要约定时可适当超出/);
    assert.match(taskPrompt, /## 模块与入口/);
    assert.match(taskPrompt, /空小节可省略/);
    const memory = taskPrompt.indexOf("按需更新项目根");
    const preparation = taskPrompt.indexOf("调用 `candidate.prepare`");
    assert.ok(memory >= 0 && preparation > memory);
    assert.match(systemPrompt, /项目文档（包括 `ARCHITECTURE.md`）修改都会使之前的构建凭据失效/);
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

test("Repair prompt carries only the cleaned shadow observation", () => {
  const compiled = compileBuilderPrompt(repairRequest("repair"));

  assert.match(compiled.taskPrompt, /# 行动：根据外部黑盒观察修复当前工作包/);
  assert.match(compiled.taskPrompt, /## 已通过的观察/);
  assert.match(compiled.taskPrompt, /open-page/);
  assert.match(compiled.taskPrompt, /## 失败观察/);
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
  assert.match(compiled.taskPrompt, /根因：/);
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

test("Builder sends the system contract and task prompt through separate runtime channels", async () => {
  const runtime = new RecordingRuntime();
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 1_000 });

  const first = await builder.run(builderRequest(1));
  const second = await builder.run(builderRequest(2));
  await builder.close();

  assert.deepEqual(runtime.startedDirectories, ["C:\\candidate-app"]);
  assert.deepEqual(runtime.createdTitles, [
    "packet-req-profile implement",
    "packet-req-profile repair",
  ]);
  assert.equal(runtime.prompts.length, 2);
  assert.match(runtime.prompts[0].input.systemPrompt, /唯一代码实现者/);
  assert.match(runtime.prompts[0].input.taskPrompt, /当前工作包/);
  assert.doesNotMatch(runtime.prompts[0].input.systemPrompt, /REQ-PROFILE/);
  assert.match(runtime.prompts[1].input.taskPrompt, /根据外部黑盒观察修复/);
  assert.equal(first.sessionId, "session-1");
  assert.equal(second.sessionId, "session-2");
  assert.equal(first.outcome, "completed");
  assert.equal(runtime.closeCount, 1);
});

test("Builder attaches only the current packet's readable requirement images", async () => {
  await withTempDir("shallow-builder-images-", async (directory) => {
    await mkdir(join(directory, "reference"));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await writeFile(join(directory, "reference", "profile.png"), png);
    const runtime = new RecordingRuntime();
    const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 1_000, requirementsDir: directory });
    const result = await builder.run(builderRequest(1));
    await builder.close();
    assert.equal(result.outcome, "completed");
    assert.equal(runtime.prompts[0].input.images?.length, 1);
    assert.equal(runtime.prompts[0].input.images?.[0].dataUrl, `data:image/png;base64,${png.toString("base64")}`);
    assert.match(runtime.prompts[0].input.taskPrompt, /已附加图片/);
    assert.doesNotMatch(JSON.stringify(result), /data:image|base64/);
  });
});

test("Builder aborts the active session when its prompt times out", async () => {
  const runtime = new RecordingRuntime();
  runtime.promptResult = new Promise(() => undefined);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 5, promptSettleTimeoutMs: 10 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "timed_out");
  assert.deepEqual(runtime.abortedSessions, ["session-1"]);
});

test("Builder terminates an unsettled runtime before returning and restarts it for repair", async () => {
  const runtime = new RecordingRuntime();
  runtime.promptResult = new Promise(() => undefined);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 5, promptSettleTimeoutMs: 10 });
  assert.equal((await builder.run(builderRequest(1))).outcome, "timed_out");
  assert.equal(runtime.closeCount, 1);
  runtime.promptResult = Promise.resolve("repaired");
  assert.equal((await builder.run(builderRequest(2))).outcome, "completed");
  assert.equal(runtime.startedDirectories.length, 2);
  await builder.close();
});

test("Builder forcibly closes its runtime when the abort endpoint hangs", async () => {
  const runtime = new RecordingRuntime();
  runtime.promptResult = new Promise(() => undefined);
  runtime.abort = () => new Promise(() => undefined);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 5, promptSettleTimeoutMs: 10 });
  assert.equal((await builder.run(builderRequest(1))).outcome, "failed");
  assert.equal(runtime.closeCount, 1);
  await builder.close();
});

test("Builder distinguishes the evaluation default from the probe port", () => {
  const request = implementRequest();
  request.platformContract.port = 3210;
  request.platformContract.baseUrl = "http://127.0.0.1:3210";
  const compiled = compileBuilderPrompt(request);
  assert.match(compiled.taskPrompt, /未设置时使用 3000/);
  assert.match(compiled.taskPrompt, /PORT=3210/);
});

test("Builder aborts the orphan session when the prompt call fails", async () => {
  const runtime = new GhostRuntime();
  runtime.failPrompt = new TypeError("fetch failed");
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 60_000, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "failed");
  assert.match(result.summary, /fetch failed/);
  assert.deepEqual(runtime.events, ["prompt-start", "abort"]);
});

test("Builder keeps the root cause in the failure summary", async () => {
  const runtime = new GhostRuntime();
  runtime.failPrompt = Object.assign(new TypeError("fetch failed"), {
    cause: new Error("Headers Timeout Error (headers timeout: 300000ms)"),
  });
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 60_000, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "failed");
  assert.match(result.summary, /fetch failed/);
  assert.match(result.summary, /Headers Timeout Error/);
});

test("Builder reports the original failure when the orphan abort also fails", async () => {
  const runtime = new GhostRuntime();
  runtime.failPrompt = new TypeError("fetch failed");
  runtime.failAbort = true;
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 60_000, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "failed");
  assert.match(result.summary, /fetch failed/);
  assert.match(result.summary, /OpenCode session abort failed/);
  assert.deepEqual(runtime.events, ["prompt-start", "abort"]);
});

test("Builder waits for the prompt to settle after abort before returning timed_out", async () => {
  const runtime = new GhostRuntime();
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 5, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  runtime.events.push("returned");
  await builder.close();

  assert.equal(result.outcome, "timed_out");
  assert.deepEqual(runtime.events, ["prompt-start", "abort", "prompt-settled", "returned"]);
});

test("Builder reports failure when the abort call itself fails", async () => {
  const runtime = new GhostRuntime();
  runtime.failAbort = true;
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 5, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "failed");
  assert.equal(result.summary, "OpenCode session abort failed");
});

test("Builder restarts the runtime and re-issues the task after the server was killed", async () => {
  const runtime = new KilledServerRuntime(1);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 60_000, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "completed");
  assert.equal(runtime.startedDirectories.length, 2);
  assert.equal(runtime.prompts.length, 2);
  assert.deepEqual(runtime.prompts[0].input, runtime.prompts[1].input);
  assert.equal(result.sessionId, "session-2");
});

test("Builder stops restarting after the server-death budget is exhausted", async () => {
  const runtime = new KilledServerRuntime(Number.POSITIVE_INFINITY);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 60_000, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "failed");
  assert.equal(runtime.startedDirectories.length, 3);
  assert.equal(runtime.prompts.length, 3);
});

test("Builder does not restart a live server after an ordinary prompt failure", async () => {
  const runtime = new KilledServerRuntime(0, 1);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 60_000, promptSettleTimeoutMs: 2_000 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "failed");
  assert.equal(runtime.startedDirectories.length, 1);
});

test("Builder releases the runtime after each call when configured", async () => {
  const runtime = new RecordingRuntime();
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 1_000, releaseRuntimeAfterRun: true });

  assert.equal((await builder.run(builderRequest(1))).outcome, "completed");
  assert.equal(runtime.closeCount, 1);
  assert.equal((await builder.run(builderRequest(2))).outcome, "completed");
  assert.equal(runtime.closeCount, 2);
  assert.equal(runtime.startedDirectories.length, 2);
  await builder.close();
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

class RecordingRuntime implements OpenCodeRuntime {
  startedDirectories: string[] = [];
  createdTitles: string[] = [];
  prompts: Array<{ sessionId: string; input: OpenCodePromptInput }> = [];
  abortedSessions: string[] = [];
  closeCount = 0;
  promptResult: Promise<string> = Promise.resolve("implemented");

  async start(directory: string): Promise<void> {
    this.startedDirectories.push(directory);
  }

  async createSession(title: string): Promise<string> {
    this.createdTitles.push(title);
    return `session-${this.createdTitles.length}`;
  }

  async prompt(
    sessionId: string,
    input: OpenCodePromptInput,
  ): Promise<string> {
    this.prompts.push({ sessionId, input });
    return this.promptResult;
  }

  async abort(sessionId: string): Promise<void> {
    this.abortedSessions.push(sessionId);
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class GhostRuntime implements OpenCodeRuntime {
  events: string[] = [];
  failAbort = false;
  failPrompt?: Error;
  private rejectPrompt?: (error: Error) => void;

  async start(): Promise<void> {}

  async createSession(): Promise<string> {
    return "session-1";
  }

  async prompt(): Promise<string> {
    this.events.push("prompt-start");
    if (this.failPrompt) {
      return Promise.reject(this.failPrompt);
    }
    return new Promise((_resolve, reject) => {
      this.rejectPrompt = reject;
    });
  }

  async abort(): Promise<void> {
    this.events.push("abort");
    if (this.failAbort) throw new Error("abort endpoint down");
    const reject = this.rejectPrompt;
    if (reject) {
      queueMicrotask(() => {
        reject(new Error("session aborted"));
        this.events.push("prompt-settled");
      });
    }
  }

  async close(): Promise<void> {}
}

class KilledServerRuntime implements OpenCodeRuntime {
  startedDirectories: string[] = [];
  createdSessions: string[] = [];
  prompts: Array<{ sessionId: string; input: OpenCodePromptInput }> = [];
  private exit?: OpenCodeServerExit;
  private promptCount = 0;

  constructor(
    private readonly killedPrompts: number,
    private readonly failingPrompts = 0,
  ) {}

  async start(directory: string): Promise<void> {
    this.startedDirectories.push(directory);
    this.exit = undefined;
  }

  async createSession(): Promise<string> {
    const id = `session-${this.createdSessions.length + 1}`;
    this.createdSessions.push(id);
    return id;
  }

  async prompt(sessionId: string, input: OpenCodePromptInput): Promise<string> {
    this.prompts.push({ sessionId, input });
    this.promptCount += 1;
    if (this.promptCount <= this.killedPrompts) {
      this.exit = { code: null, signal: "SIGKILL" };
      throw new TypeError("fetch failed");
    }
    if (this.promptCount <= this.killedPrompts + this.failingPrompts) {
      throw new TypeError("fetch failed");
    }
    return "implemented";
  }

  async abort(): Promise<void> {}

  async close(): Promise<void> {}

  serverExit(): OpenCodeServerExit | undefined {
    return this.exit;
  }
}

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
