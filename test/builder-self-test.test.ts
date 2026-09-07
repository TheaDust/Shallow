import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { builderSelfTestConfig } from "../src/builder/self-test.js";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Builder self-test uses a local pinned MCP entry and the installed Chromium", async () => {
  const config = builderSelfTestConfig({ baseUrl: "http://127.0.0.1:45678", artifactsDir: "artifacts" });
  assert.equal(config.enabled, false);
  assert.equal(config.command[0], process.execPath);
  await access(config.command[1]);
  await access(config.command[config.command.indexOf("--executable-path") + 1]);
  assert.ok(config.command.includes("--isolated"));
  assert.ok(config.command.includes("--headless"));
  assert.equal(config.command[config.command.indexOf("--allowed-origins") + 1], "http://127.0.0.1:45678");
  assert.ok(!config.command.includes("--allow-unrestricted-file-access"));
  assert.doesNotMatch(JSON.stringify(config), /npx|@latest/);
  for (const baseUrl of ["http://127.0.0.1:3000", "https://example.com:45678", "http://user:pass@localhost:45678"]) {
    assert.throws(() => builderSelfTestConfig({ baseUrl, artifactsDir: "artifacts" }), /local non-evaluation port/);
  }
});

test("Builder MCP executes a save-and-refresh self-test from a separate candidate directory", { timeout: 45_000 }, async () => {
  await withTempDir("shallow-self-test-", async (directory) => {
    const server = await startFixtureServer();
    const config = builderSelfTestConfig({ baseUrl: server.baseUrl, artifactsDir: join(directory, "artifacts") });
    const mcp = startMcp(config.command, directory);
    try {
      await mcp.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "shallow-test", version: "1" } });
      mcp.notify("notifications/initialized");
      const tools = await mcp.request("tools/list", {}) as { tools: Array<{ name: string }> };
      assert.ok(tools.tools.some((tool) => tool.name === "browser_navigate"));
      assert.ok(tools.tools.some((tool) => tool.name === "browser_type"));
      const navigated = await mcp.request("tools/call", { name: "browser_navigate", arguments: { url: server.baseUrl } });
      assert.notEqual(navigated.isError, true, JSON.stringify(navigated));
      const snapshotResult = await mcp.request("tools/call", { name: "browser_snapshot", arguments: {} });
      const snapshot = (snapshotResult.content as Array<{ text?: string }>).map((item) => item.text ?? "").join("\n");
      const textbox = snapshot.match(/textbox[^\n]*?\[ref=(e\d+)\]/)?.[1];
      const save = snapshot.match(/button[^\n]*?\[ref=(e\d+)\]/)?.[1];
      assert.ok(textbox && save, snapshot);
      const typed = await mcp.request("tools/call", { name: "browser_type", arguments: { target: textbox, text: "Ada-self-test" } });
      assert.notEqual(typed.isError, true, JSON.stringify(typed));
      const clicked = await mcp.request("tools/call", { name: "browser_click", arguments: { target: save } });
      assert.notEqual(clicked.isError, true, JSON.stringify(clicked));
      const reloaded = await mcp.request("tools/call", { name: "browser_navigate", arguments: { url: server.baseUrl } });
      assert.notEqual(reloaded.isError, true, JSON.stringify(reloaded));
      const checked = await mcp.request("tools/call", { name: "browser_snapshot", arguments: {} });
      assert.notEqual(checked.isError, true, JSON.stringify(checked));
      assert.match(JSON.stringify(checked), /Ada-self-test/);
      const closed = await mcp.request("tools/call", { name: "browser_close", arguments: {} });
      assert.notEqual(closed.isError, true, JSON.stringify(closed));
    } finally {
      await mcp.close();
      await server.stop();
    }
  });
});

function startMcp(command: string[], cwd: string) {
  const child = spawn(command[0], command.slice(1), { cwd, stdio: "pipe", windowsHide: true });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  const failPending = (error: Error) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on("error", failPending);
  const exited = new Promise<void>((resolveExit) => child.once("close", () => {
    failPending(new Error("MCP process exited"));
    lines.close();
    resolveExit();
  }));
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  return {
    async request(method: string, params: unknown): Promise<Record<string, unknown>> {
      const id = ++nextId;
      let timer: NodeJS.Timeout | undefined;
      try {
        return await new Promise<Record<string, unknown>>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 20_000);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        });
      } finally { clearTimeout(timer); pending.delete(id); }
    },
    notify(method: string) { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`); },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5_000);
      try { await exited; } finally { clearTimeout(timer); }
    },
  };
}
