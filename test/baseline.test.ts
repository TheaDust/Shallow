import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { BASELINE_CONTEXT_WINDOW, deriveBaselinePromptTimeoutMs, loadRootModules, modulePrompt } from "../baseline/index.js";
import { createArcPlatformContract, deriveModelTimeouts } from "../src/runtime-config.js";

const fixture = resolve("test/fixtures/requirements.yaml");

test("baseline gives ROOT subtrees twice the main packet timeout while retaining budget scaling", () => {
  assert.equal(deriveBaselinePromptTimeoutMs(0), 16_200_000);
  assert.equal(deriveBaselinePromptTimeoutMs(600_000), 480_000);
  assert.equal(deriveBaselinePromptTimeoutMs(10_000_000), 8_000_000);
  assert.equal(deriveModelTimeouts(0).builderTimeoutMs, 5_400_000);
});

test("loadRootModules splits ROOT direct children in declaration order", async () => {
  const document = parse(await readFile(fixture, "utf8"));
  const modules = loadRootModules(document);

  assert.deepEqual(
    modules.map((module) => module.id),
    ["AREA-A", "AREA-B"],
  );
  assert.deepEqual(
    modules.map((module) => [module.index, module.total]),
    [
      [1, 2],
      [2, 2],
    ],
  );
  assert.equal(modules[0].name, "Account Area");
  assert.deepEqual(modules[0].subtree.children, [
    {
      id: "REQ-A",
      name: "Create a profile",
      type: "ATOMIC",
      dependencies: [],
      description:
        "The page shows “Profile name”, a `Save` button, and keeps the value.\nScreenshot reference:\n![profile](reference/profile.png)",
      scenarios: [
        {
          name: "Save a profile",
          steps: [
            { keyword: "GIVEN", content: "The profile page is open." },
            { keyword: "WHEN", content: "The user fills “Profile name” and clicks `Save`." },
            { keyword: "THEN", content: "The saved name remains visible after refresh." },
          ],
        },
        {
          name: "Reject an empty profile",
          steps: [
            { keyword: "WHEN", content: "The user clicks `Save` without a name." },
            { keyword: "THEN", content: "The page displays “Name is required”." },
          ],
        },
      ],
    },
    {
      id: "REQ-B",
      name: "Edit a profile",
      type: "ATOMIC",
      dependencies: ["REQ-A"],
      description: "The user can edit “Profile name” and click `Save changes`.",
      scenarios: [
        {
          name: "Edit the saved profile",
          steps: [
            { keyword: "GIVEN", content: "A saved profile exists." },
            { keyword: "THEN", content: "The edited value persists." },
          ],
        },
      ],
    },
  ]);
});

test("loadRootModules rejects documents without a ROOT mapping", () => {
  assert.throws(() => loadRootModules({ id: "NOT-ROOT", children: [{ id: "A" }] }), /ROOT mapping/);
  assert.throws(() => loadRootModules(null), /ROOT mapping/);
  assert.throws(() => loadRootModules(["ROOT"]), /ROOT mapping/);
});

test("loadRootModules rejects ROOT without child modules", () => {
  assert.throws(() => loadRootModules({ id: "ROOT" }), /at least one child/);
  assert.throws(() => loadRootModules({ id: "ROOT", children: [] }), /at least one child/);
});

test("loadRootModules rejects children without ids", () => {
  assert.throws(() => loadRootModules({ id: "ROOT", children: [{ name: "No id" }] }), /has no id/);
});

test("baseline system prompt mirrors the shared platform contract wording", async () => {
  const prompt = await readFile(resolve("baseline/system.md"), "utf8");
  for (const anchor of [
    "目标应用由 frontend 和 backend 两个目录组成。",
    "后端必须读取 PORT 环境变量，未设置时使用 3000。",
    "前端必须通过同源相对路径调用后端，不得在构建产物中硬编码主机或端口。",
    "npm run build",
    "npm run start",
    "/health",
    "/api/health",
    "未知路径",
    "404",
    "ROOT 的一个直接子树",
    "传统测试用 run_tests",
    "frontend 运行 Vitest",
    "backend 运行 node:test",
    "shell 中的传统测试命令会被拒绝",
    "GIVEN 初态、WHEN 操作和全部 THEN 结果",
    "待创建的输入不作为种子",
    "独立的 `http.createServer(handler)`",
    "监听所有网卡",
    "仅当 ARC_EXTRA_PORTS=0 时跳过额外端口",
    "不得搜索或读取官方测试、评分或控制器内部状态",
    "仅依赖已确认身份、路由和权限",
    "权限未知时先确认",
    "身份或对象变化后重新校验",
    "后台继续校验每次读取和写入的权限",
    "用可控的未完成 Promise 延迟正文或列表响应",
    "在本次实施计划中列出每个新场景实际依赖的既有前置",
    "实施前用相关既有测试或最小公开交互逐项检查现状",
    "断言目标对象、所需权限与初态，再执行新行为和全部结果",
    "前置检查可以复用",
    "未确认的前置在完成总结中说明",
  ]) {
    assert.ok(prompt.includes(anchor), anchor);
  }
  // The baseline reads the file verbatim: no template placeholders and no packet concepts.
  assert.doesNotMatch(prompt, /\{\{/);
  assert.doesNotMatch(prompt, /工作包|PACKET/);
});

test("baseline module prompt preserves Stage contracts and renders actual platform ports", () => {
  const description = "Extend the previous stage application when available; otherwise use a blank template. Only this stage's tests are executed.";
  const [module] = loadRootModules({
    id: "ROOT", name: "GitHub - Stage 3", description,
    children: [{ id: "REQ-5", name: "Issues", dependencies: ["REQ-3-3"], children: [] }],
  });
  const prompt = modulePrompt(module, "requirements/current-stage", [], createArcPlatformContract("linux", 41234, 3100, [3301, 3401]));

  assert.match(prompt, /产品\/阶段：GitHub - Stage 3/);
  assert.ok(prompt.includes(description));
  assert.ok(prompt.includes(JSON.stringify(module.subtree, null, 2)));
  assert.match(prompt, /PORT=41234/);
  assert.match(prompt, /正式评测端口 3100/);
  assert.match(prompt, /额外监听端口：/);
  assert.match(prompt, /3301、3401/);
  assert.match(prompt, /ARC_EXTRA_PORTS=0 PORT=41234/);
  assert.doesNotMatch(prompt, /\{\{/);
  assert.doesNotMatch(prompt, /工作包|PACKET/);
});

test("baseline module prompt omits extra-port requirements when the contract has none", () => {
  const [module] = loadRootModules({ id: "ROOT", children: [{ id: "A" }] });
  const prompt = modulePrompt(module, "requirements", ["EARLIER"], createArcPlatformContract("linux", 41235, 3000, []));
  assert.match(prompt, /已完成的 ROOT 模块：EARLIER/);
  assert.match(prompt, /PORT=41235/);
  assert.match(prompt, /正式评测端口 3000/);
  assert.doesNotMatch(prompt, /额外监听|ARC_EXTRA_PORTS|3301/);
});

test("baseline asks the shared worker for a 1M context window", () => {
  assert.equal(BASELINE_CONTEXT_WINDOW, 1_000_000);
});
