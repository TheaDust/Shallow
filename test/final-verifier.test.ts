import assert from "node:assert/strict";
import { access, cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { FinalVerifier } from "../src/final-verifier.js";
import type { PlatformContract, ProcessCommand } from "../src/types.js";
import { reservePort } from "./helpers/fixture-server.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Final Verifier runs fixed commands, readiness, and a real browser smoke", async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    await cp(resolve("test/fixtures/app"), outputDir, { recursive: true, force: true });
    const port = await reservePort();
    const contract = contractFor(port, [writeMarker("installed.txt")], [writeMarker("built.txt")]);

    const report = await new FinalVerifier().verify(outputDir, contract);

    assert.deepEqual(report, { ok: true, stage: "complete", message: "Final verification passed" });
    assert.equal(await readFile(join(outputDir, "installed.txt"), "utf8"), "ok");
    assert.equal(await readFile(join(outputDir, "built.txt"), "utf8"), "ok");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });
});

test("Final Verifier stops before launch and reports the failing build command", async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    await cp(resolve("test/fixtures/app"), outputDir, { recursive: true, force: true });
    const port = await reservePort();
    const contract = contractFor(port, [], [
      {
        executable: process.execPath,
        args: ["-e", "process.stderr.write('build broke'); process.exit(3)"],
        cwd: "output",
      },
    ]);

    const report = await new FinalVerifier().verify(outputDir, contract);

    assert.equal(report.ok, false);
    assert.equal(report.stage, "build");
    assert.match(report.message, /build broke/);
    await assert.rejects(access(join(outputDir, "started.txt")));
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });
});

test("Final Verifier reports readiness failure and terminates its start process", async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    const port = await reservePort();
    const contract = contractFor(port, [], []);
    contract.startTimeoutMs = 100;
    contract.startCommand = {
      executable: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync('started.txt','yes'); setInterval(() => {}, 1000)",
      ],
      cwd: "output",
    };

    const report = await new FinalVerifier().verify(outputDir, contract);

    assert.equal(report.ok, false);
    assert.equal(report.stage, "readiness");
    assert.equal(await readFile(join(outputDir, "started.txt"), "utf8"), "yes");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });
});

test("Final Verifier clears command timeout handles after an early exit", async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    const port = await reservePort();
    const contract = contractFor(port, [writeMarker("installed.txt")], [
      {
        executable: process.execPath,
        args: ["-e", "process.exit(2)"],
        cwd: "output",
      },
    ]);
    contract.buildTimeoutMs = 30_000;
    const before = timeoutResourceCount();

    await new FinalVerifier().verify(outputDir, contract);

    assert.equal(timeoutResourceCount(), before);
  });
});

function contractFor(
  port: number,
  installCommands: ProcessCommand[],
  buildCommands: ProcessCommand[],
): PlatformContract {
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    installCommands,
    buildCommands,
    startCommand: {
      executable: process.execPath,
      args: ["server.mjs"],
      cwd: "output",
    },
    healthPath: "/health",
    buildTimeoutMs: 2_000,
    startTimeoutMs: 2_000,
  };
}

function writeMarker(file: string): ProcessCommand {
  return {
    executable: process.execPath,
    args: [
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(file)}, 'ok')`,
    ],
    cwd: "output",
  };
}

function timeoutResourceCount(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
}
