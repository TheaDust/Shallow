import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ownProcessTree, toolEnvironment } from "../src/process-lifecycle.js";

test("Owned process tree removes descendants even when their parent has already exited", async () => {
  const script = `process.stdin.once('data', () => { const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore', windowsHide:true}); console.log(c.pid); c.unref(); process.exit(0); });`;
  const parent = spawn(process.execPath, ["-e", script], { detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(parent, "exit");
  const tree = await ownProcessTree(parent);
  try {
    const output = once(parent.stdout, "data");
    parent.stdin.end("go");
    const [pidText] = await output;
    const pid = Number(String(pidText).trim());
    assert.ok(pid > 0);
    await exited;
    await tree.stop();
    // Windows reaps immediately. Linux may briefly retain a dead orphan as a zombie.
    if (process.platform === "win32") assert.throws(() => process.kill(pid, 0), /ESRCH/);
    else {
      const { readFile } = await import("node:fs/promises");
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      assert.ok(!stat || /\) Z /.test(stat));
    }
  } finally { await tree.stop(); }
});

test("Tool environments retain runtime paths but exclude gateway credentials", () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "do-not-inherit";
  try {
    const env = toolEnvironment();
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.MODEL, undefined);
    assert.ok(Object.keys(env).some(key => key.toLowerCase() === "path"));
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});

test("Tool environments inherit npm/Playwright mirror settings set by the adapter entry", () => {
  const priorRegistry = process.env.npm_config_registry;
  const priorHost = process.env.PLAYWRIGHT_DOWNLOAD_HOST;
  process.env.npm_config_registry = "https://registry.npmmirror.com";
  process.env.PLAYWRIGHT_DOWNLOAD_HOST = "https://npmmirror.com/mirrors/playwright";
  try {
    const env = toolEnvironment();
    assert.equal(env.npm_config_registry, "https://registry.npmmirror.com");
    assert.equal(env.PLAYWRIGHT_DOWNLOAD_HOST, "https://npmmirror.com/mirrors/playwright");
  } finally {
    if (priorRegistry === undefined) delete process.env.npm_config_registry;
    else process.env.npm_config_registry = priorRegistry;
    if (priorHost === undefined) delete process.env.PLAYWRIGHT_DOWNLOAD_HOST;
    else process.env.PLAYWRIGHT_DOWNLOAD_HOST = priorHost;
  }
});
