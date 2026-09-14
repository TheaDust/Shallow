import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PiWorkerClient } from "../src/builder/pi-worker-client.js";
import { withTempDir } from "./helpers/temp-dir.js";

function completion(res: ServerResponse, tool?: { name: string; arguments: Record<string, unknown> }, finish = "stop") {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { role: "assistant", content: "done" };
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: tool ? "tool_calls" : finish }]) {
    res.write(`data: ${JSON.stringify({ id: "response", choices: [{ index: 0, ...choice }] })}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

async function fixture(handler: (body: Record<string, unknown>, response: ServerResponse, count: number) => void,
  check: (client: PiWorkerClient, app: string, root: string) => Promise<void>) {
  await withTempDir("shallow-pi-errors-", async root => {
    const app = join(root, "app"); await mkdir(app);
    let count = 0;
    const server = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      handler(JSON.parse(raw), res, ++count);
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const client = new PiWorkerClient({ apiKey: "test-key", model: "test/model", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, join(root, "sessions"));
    try { await check(client, app, root); }
    finally { await client.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
}
const prompt = { systemPrompt: "Use tools when requested.", taskPrompt: "do the task", timeoutMs: 10_000, sessionKey: "implementation" };

test("Authentication failure is not retried and its session is not reused", { timeout: 30_000 }, async () => {
  let count = 0;
  await fixture((_body, res, n) => { count = n; if (n === 1) { res.writeHead(401); res.end(JSON.stringify({ error: { message: "Invalid API key" } })); } else completion(res); }, async (client, app) => {
    const failed = await client.run({ ...prompt, outputDir: app });
    assert.equal(failed.outcome, "failed"); assert.equal(count, 1);
    const recovered = await client.run({ ...prompt, outputDir: app });
    assert.equal(recovered.outcome, "completed", recovered.summary);
    assert.notEqual(failed.sessionId, recovered.sessionId);
    assert.equal(recovered.execution?.resumed, false);
  });
});

test("Truncated assistant output is failure, not successful completion", async () => {
  await fixture((_body, res) => completion(res, undefined, "length"), async (client, app) => {
    const result = await client.run({ ...prompt, outputDir: app });
    assert.equal(result.outcome, "failed");
  });
});

test("A hanging gateway is cancelled and the client can start a fresh worker", { timeout: 30_000 }, async () => {
  let hang = true;
  await fixture((_body, res) => { if (!hang) completion(res); }, async (client, app) => {
    const result = await client.run({ ...prompt, timeoutMs: 1_000, outputDir: app });
    assert.equal(result.outcome, "timed_out");
    hang = false;
    assert.equal((await client.run({ ...prompt, outputDir: app })).outcome, "completed");
  });
});

for (const afterTool of [false, true]) {
  test(`Image rejection is eligible for fallback only before tools: afterTool=${afterTool}`, { timeout: 30_000 }, async () => {
    await fixture((_body, res, count) => {
      if (afterTool && count === 1) return completion(res, { name: "write", arguments: { path: "proof.txt", content: "written" } });
      res.writeHead(400); res.end(JSON.stringify({ error: { message: "This model does not support image input" } }));
    }, async (client, app, root) => {
      await writeFile(join(root, "image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
      const result = await client.run({ ...prompt, outputDir: app, requirementsDir: root, references: ["image.png"] });
      assert.equal(result.outcome, "failed");
      assert.equal(result.referenceImages?.attachedCount, 1);
      assert.equal(result.imageUnsupported, !afterTool);
      if (afterTool) assert.equal(await readFile(join(app, "proof.txt"), "utf8"), "written");
    });
  });
}
