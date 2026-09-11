import assert from "node:assert/strict";
import { test } from "node:test";

import { fillTemplate, loadBuilderPrompt } from "../src/builder/prompt-assets.js";
import { PROMPT_FRAGMENTS } from "../src/builder/prompt-fragments.js";
import { readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("fillTemplate replaces every provided placeholder", () => {
  assert.equal(
    fillTemplate("A={{A}}\nB={{B}}\nA={{A}}", { A: "1", B: "2" }),
    "A=1\nB=2\nA=1",
  );
});

test("fillTemplate throws and lists residual placeholders", () => {
  assert.throws(
    () => fillTemplate("ok {{KNOWN}} bad {{UNKNOWN}}", { KNOWN: "x" }),
    /UNKNOWN/,
  );
});

test("fillTemplate refuses values that contain placeholder syntax", () => {
  assert.throws(
    () => fillTemplate("{{A}}", { A: "{{B}}", B: "x" }),
    /placeholder A contains literal/,
  );
  assert.throws(
    () => fillTemplate("{{A}}", { B: "x", A: "{{B}}" }),
    /placeholder A contains literal/,
  );
});

test("fillTemplate deduplicates residual placeholder names", () => {
  assert.throws(() => fillTemplate("{{U}}{{U}}", {}), (error: Error) => {
    assert.match(error.message, /U/);
    assert.doesNotMatch(error.message, /U, U/);
    return true;
  });
});

test("loadBuilderPrompt reads an asset verbatim with LF endings", () => {
  assert.equal(
    loadBuilderPrompt("fragments", "repository-collaboration"),
    "【仓库协作业务】\n仓库、组织、分支、提交、议题、合并请求、评论和成员等对象应具有稳定标识、明确父对象和一致的权限关系。创建、编辑、关闭、删除或权限变更后，列表、详情、计数和刷新后的状态必须一致。对象编号只在其规定的父级范围内唯一。不要为场景中的仓库名、分支名、对象编号或用户名建立硬编码结果。",
  );
});

test("loadBuilderPrompt normalizes CRLF line endings", async () => {
  const probe = fileURLToPath(
    new URL("../prompts/fragments/__crlf-probe__.md", import.meta.url),
  );
  await writeFile(probe, "第一行\r\n第二行\r\n", "utf8");
  try {
    assert.equal(loadBuilderPrompt("fragments", "__crlf-probe__"), "第一行\n第二行");
  } finally {
    await rm(probe, { force: true });
  }
});

test("loadBuilderPrompt caches by category and name", () => {
  const first = loadBuilderPrompt("fragments", "repository-collaboration");
  assert.ok(first === loadBuilderPrompt("fragments", "repository-collaboration"));
});

test("loadBuilderPrompt throws a locating error for missing assets", () => {
  assert.throws(
    () => loadBuilderPrompt("system", "does-not-exist"),
    /system\/does-not-exist/,
  );
});

test("each prompt fragment id maps to exactly one file and there are no orphans", async () => {
  const directory = fileURLToPath(
    new URL("../prompts/fragments", import.meta.url),
  );
  const files = new Set(
    (await readdir(directory)).filter((name) => name.endsWith(".md")),
  );
  for (const id of Object.keys(PROMPT_FRAGMENTS)) {
    const file = `${id.replaceAll("_", "-")}.md`;
    assert.ok(files.has(file), `missing fragment file: ${file}`);
    files.delete(file);
  }
  assert.deepEqual([...files], []);
});

test("fixed system assets keep their Chinese anchors", () => {
  const seedData = loadBuilderPrompt("system", "seed-data");
  assert.match(seedData, /内置或可复现/);
  assert.ok(seedData.includes("{{SEED_DATA}}"));
  const images = loadBuilderPrompt("system", "reference-images");
  assert.match(images, /已附加图片/);
  assert.ok(images.includes("{{ATTACHED_REFERENCES}}"));
  assert.ok(images.includes("{{UNAVAILABLE_REFERENCES}}"));
  assert.match(loadBuilderPrompt("system", "reference-images-text-fallback"), /图片输入不受支持/);
  const platform = loadBuilderPrompt("system", "platform-contract");
  assert.match(platform, /未设置时使用 3000/);
  for (const key of ["PROBE_PORT", "INSTALL_COMMANDS", "BUILD_COMMANDS", "START_COMMAND", "HEALTH_PATH", "BASE_URL"]) {
    assert.ok(platform.includes(`{{${key}}}`));
  }
  assert.ok(
    loadBuilderPrompt("system", "builder-system").includes("唯一代码实现者"),
  );
  assert.match(loadBuilderPrompt("system", "builder-system"), /持续增量扩展/);
  assert.match(loadBuilderPrompt("system", "builder-system"), /不为通过当前检查引入一次性变通/);
  assert.ok(
    loadBuilderPrompt("system", "receipt").includes("结果：完成 | 阻塞"),
  );
  assert.ok(
    loadBuilderPrompt("system", "receipt").includes("{{主要变更}}"),
  );
});

test("action assets carry their placeholders", () => {
  const selfTest = loadBuilderPrompt("system", "self-test");
  assert.match(selfTest, /当前工作包的一条关键用户路径/);
  assert.match(selfTest, /不替代独立 Judge 验收/);
  assert.match(selfTest, /交付修复只检查健康状态/);
  assert.match(selfTest, /临时业务对象/);
  assert.match(selfTest, /`candidate` MCP 的 `prepare`/);
  assert.match(selfTest, /SHALLOW_DATA_DIR/);
  assert.match(selfTest, /至少检查一个边界输入（空值或非法输入）/);
  assert.match(loadBuilderPrompt("system", "candidate-prepare"), /本工具不执行 Judge 验收/);
  assert.match(loadBuilderPrompt("system", "candidate-stop"), /释放端口/);
  const repair = loadBuilderPrompt("system", "action-repair");
  assert.ok(repair.includes("{{PASSED_CASE_IDS}}"));
  assert.ok(repair.includes("{{FAILURES}}"));

  const rootCause = loadBuilderPrompt("system", "action-root-cause-repair");
  assert.ok(rootCause.includes("{{PASSED_CASE_IDS}}"));
  assert.ok(rootCause.includes("{{FAILURES}}"));

  const delivery = loadBuilderPrompt("system", "action-delivery-repair");
  for (const placeholder of [
    "{{FAILURE_STAGE}}",
    "{{FAILURE_COMMAND}}",
    "{{FAILURE_EXPECTED}}",
    "{{FAILURE_ACTUAL}}",
    "{{PLATFORM_CONTRACT}}",
  ]) {
    assert.ok(delivery.includes(placeholder), `missing ${placeholder}`);
  }

  const implement = loadBuilderPrompt("system", "action-implement");
  assert.ok(implement.includes("# 行动：实现当前工作包"));
  assert.match(implement, /可观察验收判据/);
  assert.match(implement, /空值、超长或非法输入/);
  assert.match(implement, /不猜测外部测试/);
});

test("task templates carry their placeholders", () => {
  const packetPlaceholders = [
    "{{PACKET_ID}}",
    "{{PACKET_ATTEMPT}}",
    "{{OUTPUT_DIR}}",
    "{{ACTION}}",
    "{{PROJECT_CONTEXT}}",
    "{{WORK_PACKET}}",
    "{{PLATFORM_CONTRACT}}",
    "{{FRAGMENTS}}",
  ];
  for (const name of [
    "task-implement",
    "task-repair",
    "task-root-cause-repair",
  ]) {
    const template = loadBuilderPrompt("system", name);
    for (const placeholder of packetPlaceholders) {
      assert.ok(template.includes(placeholder), `${name} missing ${placeholder}`);
    }
  }
  const delivery = loadBuilderPrompt("system", "task-delivery-repair");
  for (const placeholder of ["{{OUTPUT_DIR}}", "{{ACTION}}", "{{FRAGMENTS}}"]) {
    assert.ok(delivery.includes(placeholder), `missing ${placeholder}`);
  }
  assert.ok(!delivery.includes("{{PACKET_ID}}"));
});

test("prompt assets contain no CR characters", async () => {
  const categories = ["system", "fragments"] as const;
  for (const category of categories) {
    const directory = fileURLToPath(
      new URL(`../prompts/${category}`, import.meta.url),
    );
    for (const file of await readdir(directory)) {
      if (!file.endsWith(".md") || file === "__crlf-probe__.md") continue;
      const text = loadBuilderPrompt(category, file.slice(0, -3));
      assert.ok(!text.includes("\r"), `CR found in ${category}/${file}`);
    }
  }
});
