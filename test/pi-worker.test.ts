import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PiWorkerClient } from "../src/builder/pi-worker-client.js";
import { withTempDir } from "./helpers/temp-dir.js";
import { readEnvFile, readGatewayConfig } from "../src/runtime-config.js";

test("Pi SDK executes tools and resumes persisted history in a new worker", { timeout: 60_000 }, async () => {
  await withTempDir("shallow-pi-", async root => {
    const app = join(root, "app"); await mkdir(app);
    const requests: Array<{ model: string; messages: Array<{ role: string; content: unknown }> }> = [];
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body); requests.push(request);
      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer test-secret");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const tool = requests.length === 1;
      const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "hello.txt", content: "persisted" }) } }] } : { role: "assistant", content: "done" };
      res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const client = new PiWorkerClient({ apiKey: "test-secret", baseUrl: `http://127.0.0.1:${port}/v1`, model: "test/model" }, join(root, "sessions"));
    try {
      const input = { outputDir: app, systemPrompt: "Write the requested file.", taskPrompt: "remember alpha; write hello", sessionKey: "implementation", timeoutMs: 25_000 };
      const first = await client.run(input);
      assert.equal(first.outcome, "completed", first.summary);
      assert.equal(first.toolCalls, 1);
      assert.equal(await readFile(join(app, "hello.txt"), "utf8"), "persisted");
      const second = await client.run({ ...input, taskPrompt: "continue beta" });
      assert.equal(second.outcome, "completed", second.summary);
      assert.equal(second.sessionId, first.sessionId);
      assert.equal(second.toolCalls, 0);
      assert.ok(JSON.stringify(requests.at(-1)?.messages).includes("remember alpha"));
      assert.ok(requests.every(request => request.model === "test/model"));
      assert.ok(!JSON.stringify(requests).includes("test-secret"));
    } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
});

test("Pi credential smoke performs file editing, shell checks, and session resume", { skip: process.env.RUN_CREDENTIAL_SMOKE !== "1", timeout: 180_000 }, async () => {
  await withTempDir("shallow-pi-gateway-", async root => {
    const app = join(root, "app"); await mkdir(app);
    const gateway = readGatewayConfig({ ...await readEnvFile(".env"), ...process.env });
    const client = new PiWorkerClient(gateway, join(root, "sessions"));
    try {
      const input = { outputDir: app, sessionKey: "smoke", timeoutMs: 80_000,
        systemPrompt: "Perform only the requested file operations in this application directory. Use the provided tools. shell runs PowerShell on Windows and Bash on Linux.",
        taskPrompt: "Use write to create proof.txt containing alpha. Use read to check it. Use edit to replace alpha with beta. Use shell to read proof.txt. Remember the code word ORCHARD. Then finish." };
      const first = await client.run(input);
      assert.equal(first.outcome, "completed", first.summary);
      assert.equal((await readFile(join(app, "proof.txt"), "utf8")).trim(), "beta");
      assert.ok((first.toolCalls ?? 0) >= 4);
      const second = await client.run({ ...input, taskPrompt: "Write the code word I asked you to remember into remembered.txt, then finish." });
      assert.equal(second.outcome, "completed", second.summary);
      assert.equal(second.sessionId, first.sessionId);
      assert.equal((await readFile(join(app, "remembered.txt"), "utf8")).trim(), "ORCHARD");
    } finally { await client.close(); }
  });
});
