import assert from "node:assert/strict";
import { access, cp, readFile, writeFile } from "node:fs/promises";
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

test("Final Verifier reports a missing start executable as a readiness failure", async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    const contract = contractFor(await reservePort(), [], []);
    contract.startCommand.executable = join(outputDir, "missing-server.exe");
    const report = await new FinalVerifier().verify(outputDir, contract);
    assert.equal(report.ok, false);
    assert.equal(report.stage, "readiness");
    assert.match(report.message, /ENOENT/);
  });
});

test("Final Verifier drains verbose startup logs before checking health", async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    const port = await reservePort();
    const contract = contractFor(port, [], []);
    contract.startTimeoutMs = 5_000;
    contract.startCommand = {
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(1024*1024), () => process.stderr.write('x'.repeat(1024*1024), () => require('node:http').createServer((req,res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/health' ? 'ok' : '<main>ready</main>'); }).listen(Number(process.env.PORT), '127.0.0.1')));"],
      cwd: "output",
    };
    const report = await new FinalVerifier().verify(outputDir, contract);
    assert.equal(report.ok, true, report.message);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  });
});

test("Final Verifier stops a POSIX launcher's server child as well as the launcher", { skip: process.platform === "win32" }, async () => {
  await withTempDir("shallow-final-", async (outputDir) => {
    await cp(resolve("test/fixtures/app"), outputDir, { recursive: true });
    await writeFile(join(outputDir, "launcher.cjs"), "require('node:child_process').spawn(process.execPath, ['server.mjs'], { stdio: 'inherit' }); setInterval(() => {}, 1000);");
    const port = await reservePort();
    const contract = contractFor(port, [], []);
    contract.startCommand.args = ["launcher.cjs"];
    const report = await new FinalVerifier().verify(outputDir, contract);
    assert.equal(report.ok, true, report.message);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try {
        await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(100) });
      } catch {
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    assert.fail("server child kept its port open after verification");
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
