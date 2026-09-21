import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PromptBuilder } from "../src/builder/prompt-builder.js";
import type { CodingAgentRequest, CodingAgentResult } from "../src/builder/execution-port.js";
import { loadRequirementCatalog } from "../src/catalog.js";
import { auditPackets } from "../src/scheduler.js";
import { createArcPlatformContract } from "../src/runtime-config.js";

async function fixture(results: CodingAgentResult[]) {
  const calls: CodingAgentRequest[] = [];
  const catalog = await loadRequirementCatalog(resolve("test/fixtures/requirements.yaml"));
  const packet = auditPackets(catalog)[0];
  const builder = new PromptBuilder({ run: async request => { calls.push(request); return results.shift()!; }, close: async () => {} },
    { timeoutMs: 1000, requirementsDir: resolve("test/fixtures") });
  const request = { mode: "implement" as const, packet, outputDir: "application", platformContract: createArcPlatformContract("linux", 43210),
    projectContext: { product: packet.requirements[0].product, ancestors: [], satisfiedDependencies: [] } };
  return { builder, calls, request };
}
const completed: CodingAgentResult = { sessionId: "done", outcome: "completed", summary: "done" };

test("Builder forwards structured gateway failure metadata to the controller", async () => {
  const gatewayFailure = { kind: "rate_limit", retryable: true, status: 429, retryAfterMs: 30_000 } as const;
  const f = await fixture([{ ...completed, outcome: "failed", gatewayFailure }]);
  assert.deepEqual((await f.builder.run(f.request)).gatewayFailure, gatewayFailure);
});

test("Engine-neutral Builder preserves separate prompts, references, key and smaller timeout", async () => {
  const f = await fixture([completed]);
  await f.builder.run(f.request, { timeoutMs: 300, sessionKey: "module" });
  assert.equal(f.calls[0].timeoutMs, 300);
  assert.equal(f.calls[0].sessionKey, "module");
  assert.deepEqual(f.calls[0].platformContract, f.request.platformContract);
  assert.ok(f.calls[0].references?.includes("reference/profile.png"));
  assert.match(f.calls[0].systemPrompt, /唯一代码实现者/);
  assert.match(f.calls[0].taskPrompt, /REQ-A/);
});

test("Continuation keeps the packet and adds concrete failure feedback", async () => {
  const f = await fixture([completed]);
  await f.builder.run(f.request, { sessionKey: "same-packet", continuationFeedback: "Missing export {{literal}}" });
  assert.equal(f.calls[0].sessionKey, "same-packet");
  assert.match(f.calls[0].taskPrompt, /Missing export \{\{literal\}\}/);
  assert.match(f.calls[0].taskPrompt, /REQ-A/);
});

test("Unsupported images fall back once and subsequent calls retain text mode", async () => {
  const f = await fixture([{ ...completed, outcome: "failed", imageUnsupported: true }, completed, completed]);
  assert.equal((await f.builder.run(f.request)).outcome, "completed");
  assert.equal((await f.builder.run(f.request)).outcome, "completed");
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].textOnly, false);
  assert.equal(f.calls[1].textOnly, true);
  assert.equal(f.calls[2].textOnly, true);
  assert.ok(f.calls[1].timeoutMs <= f.calls[0].timeoutMs);
});

test("Ordinary failures do not replay and repeated image rejection stops after one fallback", async () => {
  for (const imageUnsupported of [false, true]) {
    const failed: CodingAgentResult = { sessionId: "failed", outcome: "failed", summary: "failure", imageUnsupported };
    const f = await fixture([failed, failed]);
    assert.equal((await f.builder.run(f.request)).outcome, "failed");
    assert.equal(f.calls.length, imageUnsupported ? 2 : 1);
  }
});
