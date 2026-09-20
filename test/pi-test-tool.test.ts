import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { createTestTool } from "../src/builder/pi-test-tool.js";
import { withTempDir } from "./helpers/temp-dir.js";

interface SpawnCall { file: string; args: string[]; cwd: string }

class FakeStream extends EventEmitter {
  destroy(): void { this.removeAllListeners(); }
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", null));
    return true;
  }
}

function fakeSpawn(behavior?: (child: FakeChild, call: SpawnCall) => void) {
  const calls: SpawnCall[] = [];
  const spawnFn = (file: string, args?: readonly string[], options?: { cwd?: string }): FakeChild => {
    const call: SpawnCall = { file, args: [...(args ?? [])], cwd: options?.cwd ?? "" };
    calls.push(call);
    const child = new FakeChild();
    queueMicrotask(() => {
      if (behavior) behavior(child, call);
      else { child.stdout.emit("data", "ok\n"); child.emit("exit", 0); }
    });
    return child;
  };
  return { calls, spawnFn: spawnFn as never };
}

async function makeApp(root: string, { frontend = true, backend = true } = {}): Promise<void> {
  if (frontend) {
    await mkdir(join(root, "frontend", "node_modules", "vitest"), { recursive: true });
    await writeFile(join(root, "frontend", "node_modules", "vitest", "vitest.mjs"), "", "utf8");
  }
  if (backend) await mkdir(join(root, "backend"), { recursive: true });
}

function execute(tool: ReturnType<typeof createTestTool>, params: { target: string; filter?: string }, signal?: AbortSignal) {
  return tool.execute("call-1", params as never, signal as never, {} as never, {} as never);
}

test("run_tests runs the frontend Vitest suite single-worker in frontend/", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root);
    const { calls, spawnFn } = fakeSpawn();
    const tool = createTestTool(root, { spawnFn });
    const result = await execute(tool, { target: "frontend", filter: "HomePage" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, process.execPath);
    assert.deepEqual(calls[0].args.slice(1), ["run", "--maxWorkers=1", "HomePage"]);
    assert.match(calls[0].args[0], /frontend[\\/]node_modules[\\/]vitest[\\/]vitest\.mjs$/);
    assert.match(calls[0].cwd, /frontend$/);
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /exit code 0/);
    assert.match(text, /vitest run --maxWorkers=1 HomePage/);
  });
});

test("run_tests runs backend node:test with single concurrency in backend/", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root);
    const { calls, spawnFn } = fakeSpawn();
    const tool = createTestTool(root, { spawnFn });
    await execute(tool, { target: "backend" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["--test", "--test-concurrency=1"]);
    assert.match(calls[0].cwd, /backend$/);
  });
});

test("run_tests target=all runs frontend then backend in sequence", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root);
    const { calls, spawnFn } = fakeSpawn();
    const tool = createTestTool(root, { spawnFn });
    const result = await execute(tool, { target: "all" });
    assert.equal(calls.length, 2);
    assert.match(calls[0].cwd, /frontend$/);
    assert.match(calls[1].cwd, /backend$/);
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /\[frontend\]/);
    assert.match(text, /\[backend\]/);
  });
});

test("run_tests reports failures with the output tail and a non-zero exit code", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root);
    const { spawnFn } = fakeSpawn(child => {
      child.stderr.emit("data", "FAIL src/App.test.tsx > renders\n");
      child.emit("exit", 1);
    });
    const tool = createTestTool(root, { spawnFn });
    const result = await execute(tool, { target: "frontend" });
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /exit code 1/);
    assert.match(text, /FAIL src\/App\.test\.tsx > renders/);
  });
});

test("run_tests truncates very long output to the tail", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root);
    const { spawnFn } = fakeSpawn(child => {
      child.stdout.emit("data", `start-marker${"x".repeat(40_000)}end-marker`);
      child.emit("exit", 0);
    });
    const tool = createTestTool(root, { spawnFn });
    const result = await execute(tool, { target: "frontend" });
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /output truncated to the last 30000 characters/);
    assert.match(text, /end-marker/);
    assert.doesNotMatch(text, /start-marker/);
    assert.ok(text.length < 31_000, `expected bounded output, got ${text.length}`);
  });
});

test("run_tests kills a suite that exceeds its timeout", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root);
    let childRef: FakeChild | undefined;
    const { spawnFn } = fakeSpawn(child => { childRef = child; /* never exits on its own; the timeout must kill it */ });
    const tool = createTestTool(root, { spawnFn, frontendTimeoutMs: 20 });
    const result = await execute(tool, { target: "frontend" });
    assert.ok(childRef!.killed, "suite process was not killed on timeout");
    const text = (result.content[0] as { text: string }).text;
    assert.match(text, /timed out/);
  });
});

test("run_tests points at installation when the frontend Vitest entry is missing", async () => {
  await withTempDir("shallow-test-tool-", async root => {
    await makeApp(root, { frontend: false });
    const { calls, spawnFn } = fakeSpawn();
    const tool = createTestTool(root, { spawnFn });
    await assert.rejects(execute(tool, { target: "frontend" }), /Vitest is not installed.*install command first/s);
    assert.equal(calls.length, 0);
  });
});
