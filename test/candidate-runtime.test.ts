import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { SdkOpenCodeRuntime } from "../src/builder/opencode-sdk.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CandidateRuntime } from "../src/candidate-runtime.js";
import { runPipeline } from "../src/pipeline.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import { FakeGitOps } from "./fakes/fake-git-ops.js";
import { FakeProbePlanner } from "./fakes/fake-probe-planner.js";
import { startCandidateMcp } from "../src/builder/candidate-mcp.js";
import { CommandAppLifecycle, FinalVerifier } from "../src/final-verifier.js";
import type { PlatformContract, RunEvent } from "../src/types.js";
import { reservePort } from "./helpers/fixture-server.js";
import { withTempDir } from "./helpers/temp-dir.js";

async function fixture(run: (context: {
  output: string; workspace: string; candidate: CandidateRuntime; contract: PlatformContract;
  events: RunEvent[]; counts: () => Promise<string>;
}) => Promise<void>) {
  await withTempDir("shallow-candidate-", async (root) => {
    const output = join(root, "output");
    const workspace = join(root, "runtime");
    await mkdir(output);
    const log = join(root, "commands.txt");
    await writeFile(log, "");
    await writeFile(join(output, "package.json"), JSON.stringify({ private: true }));
    await writeFile(join(output, "view.txt"), "current");
    await writeFile(join(output, "install.cjs"), String.raw`const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, 'install\n'); fs.mkdirSync('node_modules', {recursive:true}); fs.writeFileSync('node_modules/owned.txt', 'installed');`);
    await writeFile(join(output, "build.cjs"), String.raw`const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, 'build\n'); fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/index.html', '<main>' + fs.readFileSync('view.txt','utf8') + '</main>');`);
    await writeFile(join(output, "server.cjs"), `const fs = require('node:fs'); const path = require('node:path');
require('node:http').createServer((req,res) => {res.setHeader('content-type','text/html');
fs.writeFileSync(path.join(process.env.SHALLOW_DATA_DIR, 'requests.txt'), 'data');
res.end(req.url === '/health' ? 'ok' : fs.readFileSync('dist/index.html'));}).listen(Number(process.env.PORT),'127.0.0.1');`);
    const port = await reservePort();
    const contract: PlatformContract = { port, baseUrl: `http://127.0.0.1:${port}`, healthPath: "/health",
      installCommands: [{ executable: process.execPath, args: ["install.cjs"], cwd: "output" }],
      buildCommands: [{ executable: process.execPath, args: ["build.cjs"], cwd: "output" }],
      startCommand: { executable: process.execPath, args: ["server.cjs"], cwd: "output" },
      buildTimeoutMs: 5_000, startTimeoutMs: 5_000 };
    const candidate = new CandidateRuntime(output, workspace, contract);
    const events: RunEvent[] = [];
    candidate.setRecorder(async (event) => { events.push(event); });
    try { await run({ output, workspace, candidate, contract, events, counts: () => readFile(log, "utf8") }); }
    finally { await candidate.close(); }
  });
}

test("one owned build serves Builder self-test, Judge and final Chromium smoke", async () => {
  await fixture(async ({ output, workspace, candidate, contract, counts, events }) => {
    candidate.beginBuilder();
    const selfTest = await candidate.builderPrepare();
    assert.match(await (await fetch(selfTest.baseUrl)).text(), /current/);
    await candidate.endBuilder();
    await assert.rejects(fetch(selfTest.baseUrl));
    const judged = await candidate.start(output, contract);
    assert.match(await (await fetch(judged.baseUrl)).text(), /current/);
    await judged.assertUnchanged?.();
    await judged.stop();
    const report = await new FinalVerifier(undefined, candidate, candidate).verify(output, contract);
    assert.equal(report.ok, true, report.message);
    assert.equal(report.candidate?.buildId, judged.candidate?.buildId);
    assert.notEqual(report.candidate?.runtimeId, judged.candidate?.runtimeId);
    assert.equal(await counts(), "install\nbuild\n");
    assert.equal(await readFile(join(workspace, "data/requests.txt"), "utf8"), "data");
    assert.equal(events.filter((event) => event.type === "candidate_prepared" && event.detail?.reused).length, 2);
  });
});

test("new source and untracked files invalidate the build but retain owned dependencies", async () => {
  await fixture(async ({ output, candidate, contract, counts }) => {
    await mkdir(join(output, "dist"));
    await writeFile(join(output, "dist/index.html"), "old-output");
    await candidate.prepare();
    await writeFile(join(output, "view.txt"), "new-source");
    await writeFile(join(output, "new-business.txt"), "new");
    const app = await candidate.start(output, contract);
    assert.match(await (await fetch(app.baseUrl)).text(), /new-source/);
    assert.equal(await counts(), "install\nbuild\nbuild\n");
    await app.stop();
  });
});

test("output audit changes do not invalidate a build; runtime data stays outside it", async () => {
  await fixture(async ({ output, candidate, contract, counts }) => {
    const app = await candidate.start(output, contract);
    await mkdir(join(output, ".arc"));
    await writeFile(join(output, ".arc/events.jsonl"), "audit");
    await app.assertUnchanged?.();
    await app.stop();
    await candidate.prepare();
    assert.equal(await counts(), "install\nbuild\n");
    await assert.rejects(access(join(candidate.directory, ".arc")));
  });
});

for (const mutation of ["source", "artifact", "dependency", "new-file"] as const) {
  test(`verification rejects ${mutation} mutation after launch`, async () => {
    await fixture(async ({ output, candidate, contract }) => {
      const app = await candidate.start(output, contract);
      const path = mutation === "source" ? join(output, "view.txt")
        : mutation === "artifact" ? join(candidate.directory, "dist/index.html")
        : mutation === "dependency" ? join(candidate.directory, "node_modules/owned.txt")
        : join(output, "late.txt");
      await writeFile(path, "changed");
      await assert.rejects(candidate.assertCurrent(app.candidate!), /evidence is invalid/);
      await app.stop();
    });
  });
}

test("deleted source and old private artifacts are removed on rebuild", async () => {
  await fixture(async ({ output, candidate }) => {
    await writeFile(join(output, "obsolete.txt"), "old");
    await candidate.prepare();
    await writeFile(join(candidate.directory, "dist/obsolete.html"), "old");
    await rm(join(output, "obsolete.txt"));
    await candidate.prepare();
    await assert.rejects(access(join(candidate.directory, "obsolete.txt")));
    await assert.rejects(access(join(candidate.directory, "dist/obsolete.html")));
  });
});

test("dependency declaration changes and missing install state cause reinstall", async () => {
  await fixture(async ({ output, candidate, counts }) => {
    await candidate.prepare();
    await writeFile(join(output, "package-lock.json"), "{}");
    await candidate.prepare();
    await rm(join(candidate.directory, "node_modules"), { recursive: true });
    await candidate.prepare();
    assert.equal(await counts(), "install\nbuild\ninstall\nbuild\ninstall\nbuild\n");
  });
});

test("local dependencies and installation scripts include application source in the install key", async () => {
  await fixture(async ({ output, candidate, counts }) => {
    await writeFile(join(output, "package.json"), JSON.stringify({ scripts: { prepare: "node generate.cjs" } }));
    await candidate.prepare();
    await writeFile(join(output, "view.txt"), "changed");
    await candidate.prepare();
    assert.equal(await counts(), "install\nbuild\ninstall\nbuild\n");
  });
});

test("failed build cannot create a reusable credential", async () => {
  await fixture(async ({ output, candidate, contract, counts }) => {
    await writeFile(join(output, "build.cjs"), "process.exit(2)");
    const report = await new FinalVerifier(undefined, candidate, candidate).verify(output, contract);
    assert.equal(report.ok, false);
    assert.equal(report.stage, "build");
    await assert.rejects(candidate.prepare(), /exited 2/);
    assert.equal(await counts(), "install\ninstall\n");
  });
});

test("Builder cancellation stops in-flight preparation and rejects late tool calls", async () => {
  await fixture(async ({ output, candidate, contract, counts }) => {
    await writeFile(join(output, "build.cjs"), "setInterval(() => {}, 1000)");
    candidate.beginBuilder();
    const preparation = candidate.builderPrepare();
    const rejected = assert.rejects(preparation, /abort|cancel/i);
    const deadline = Date.now() + 5_000;
    while (!(await counts()).includes("install") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    await candidate.endBuilder();
    await rejected;
    await assert.rejects(candidate.builderPrepare(), /inactive/);
    await assert.rejects(fetch(contract.baseUrl));
  });
});

test("late source writes during a build cannot produce a credential", async () => {
  await fixture(async ({ output, candidate }) => {
    const build = await readFile(join(output, "build.cjs"), "utf8");
    await writeFile(join(output, "build.cjs"), `${build}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(output, "view.txt"))}, 'late');`);
    await assert.rejects(candidate.prepare(), /changed during preparation/);
  });
});

test("an old healthy process occupying the target port cannot pass verification", async () => {
  await fixture(async ({ output, candidate, contract }) => {
    await candidate.prepare();
    const old = await new CommandAppLifecycle().start(candidate.directory, { ...contract, dataDirectory: join(candidate.directory, "node_modules") });
    try {
      await assert.rejects(candidate.start(output, contract), /already occupied/);
      assert.equal((await fetch(`${contract.baseUrl}/health`)).ok, true, "unowned process must not be killed");
    } finally { await old.stop(); }
  });
});

test("real MCP client can only prepare during Builder phase and does not receive verification identity", async () => {
  await fixture(async ({ candidate, counts }) => {
    const bridge = await startCandidateMcp(candidate);
    const client = new Client({ name: "candidate-test", version: "1" });
    try {
      assert.equal((await fetch(bridge.config.url, { method: "POST" })).status, 401);
      await client.connect(new StreamableHTTPClientTransport(new URL(bridge.config.url), { requestInit: { headers: bridge.config.headers } }));
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), ["prepare", "stop"]);
      assert.equal((await client.callTool({ name: "prepare", arguments: {} })).isError, true);
      candidate.beginBuilder();
      const result = await client.callTool({ name: "prepare", arguments: {} });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.match(JSON.stringify(result), /baseUrl/);
      assert.doesNotMatch(JSON.stringify(result), /candidateId|buildId|inputDigest|applicationDigest|probe/);
      assert.notEqual((await client.callTool({ name: "stop", arguments: {} })).isError, true);
      await candidate.endBuilder();
      assert.equal((await client.callTool({ name: "prepare", arguments: {} })).isError, true);
      assert.equal(await counts(), "install\nbuild\n");
    } finally { await client.close(); await bridge.close(); }
  });
});

test("SDK connects both MCPs and closes candidate admission and processes after the prompt", async () => {
  await fixture(async ({ output, candidate, contract, workspace }) => {
    const bridge = await startCandidateMcp(candidate);
    const calls: string[] = [];
    const runtime = new SdkOpenCodeRuntime({ apiKey: "test", baseUrl: "http://gateway.invalid", model: "test" }, async (options) => {
      assert.deepEqual(options.config?.mcp?.candidate, bridge.config);
      return { server: { url: "http://localhost:1", close() {} }, client: createOpencodeClient({
        baseUrl: "http://localhost:1", fetch: async (input) => {
          const path = new URL((input as Request).url).pathname;
          calls.push(path);
          if (path === "/mcp") return Response.json({ playwright: { status: "connected" }, candidate: { status: "connected" } });
          if (path.endsWith("/connect") || path.endsWith("/disconnect")) return Response.json(true);
          await candidate.builderPrepare();
          return Response.json({ info: {}, parts: [{ type: "text", text: "done" }] });
        },
      }) };
    }, { baseUrl: contract.baseUrl, artifactsDir: join(workspace, "browser") }, { runtime: candidate, config: bridge.config });
    try {
      await runtime.start(output);
      assert.equal(await runtime.prompt("fixture", { systemPrompt: "test", taskPrompt: "test" }), "done");
      assert.ok(calls.includes("/mcp/candidate/connect"));
      assert.ok(calls.includes("/mcp/candidate/disconnect"));
      assert.ok(calls.includes("/mcp/playwright/disconnect"));
      await assert.rejects(candidate.builderPrepare(), /inactive/);
      await assert.rejects(fetch(contract.baseUrl));
    } finally { await runtime.close(); await bridge.close(); }
  });
});

for (const mutation of ["none", "probe", "commit", "delivery"] as const) {
  test(`pipeline binds acceptance to the candidate and rejects mutation at ${mutation}`, async () => {
    await fixture(async ({ output, workspace, candidate, contract, counts }) => {
      await mkdir(workspace, { recursive: true });
      const requirementsFile = join(workspace, "requirements.yaml");
      await writeFile(requirementsFile, `id: ROOT
name: Candidate fixture
type: ROOT
children:
  - id: REQ-PROFILE
    name: Main content
    type: ATOMIC
    dependencies: []
    description: Show current in the main content.
`);
      const ledgerFile = join(workspace, "run-ledger.jsonl");
      const git = new FakeGitOps(["baseline", "accepted"]);
      const capture = git.captureAccepted.bind(git);
      git.captureAccepted = async (message) => {
        const sha = await capture(message);
        if (mutation === "commit" && message.includes("accept packet")) await writeFile(join(output, "late.txt"), "late");
        return sha;
      };
      const browser = new PlaywrightProbeRunner();
      const run = runPipeline({ requirementsFile, outputDir: output,
        ledgerFile, totalBudgetMs: 0, platformContract: contract }, {
        builder: {
          async run() {
            candidate.beginBuilder();
            try { await candidate.builderPrepare(); }
            finally { await candidate.endBuilder(); }
            return { sessionId: "fixture-session", outcome: "completed", summary: "self-test prepared" };
          },
          async close() { await candidate.endBuilder(); },
        },
        planner: new FakeProbePlanner([{ packetId: "packet-req-profile", cases: [{ id: "main", requirementIds: ["REQ-PROFILE"],
          purpose: "happy_path", steps: [{ op: "goto", path: "/" }, { op: "expectText", locator: { by: "role", role: "main" }, text: "current" }] }] }]),
        runner: { async run(plan, options) {
          const report = await browser.run(plan, options);
          if (mutation === "probe") await writeFile(join(output, "late.txt"), "late");
          return report;
        } },
        git, appLifecycle: candidate, candidate, clock: { nowMs: () => Date.now() },
        finalVerifier: { async verify(directory, platform) {
          if (mutation === "delivery") await writeFile(join(output, "late.txt"), "late");
          return new FinalVerifier(browser, candidate, candidate).verify(directory, platform);
        } },
      });
      if (mutation === "none") {
        const result = await run;
        assert.equal(result.status, "delivered");
        assert.deepEqual(result.verifiedRequirementIds, ["REQ-PROFILE"]);
        assert.equal(await counts(), "install\nbuild\n");
        const events: RunEvent[] = (await readFile(ledgerFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
        const probe = events.find((event) => event.type === "probe_finished");
        const accepted = events.find((event) => event.type === "packet_accepted");
        assert.ok(probe?.type === "probe_finished" && accepted?.type === "packet_accepted");
        assert.deepEqual(accepted.detail?.candidate, probe.detail?.candidate);
        assert.ok(accepted.detail?.candidate?.applicationDigest);
      } else {
        await assert.rejects(run, /evidence is invalid/);
        const ledger = await readFile(ledgerFile, "utf8");
        if (mutation !== "delivery") assert.doesNotMatch(ledger, /"type":"packet_accepted"/);
        assert.deepEqual(git.restoredShas, [mutation === "delivery" ? "accepted" : "baseline"]);
      }
    });
  });
}
