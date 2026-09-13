import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import { probePlanSha256, type ProbePlan } from "../src/judge/probe-schema.js";
import { runPipeline, type PipelineDeps, type PipelineOptions } from "../src/pipeline.js";
import type { RunEvent, ShadowReport } from "../src/types.js";
import { FakeBuilder } from "./fakes/fake-builder.js";
import { FakeGitOps } from "./fakes/fake-git-ops.js";
import { FakeProbePlanner } from "./fakes/fake-probe-planner.js";
import { withTempDir } from "./helpers/temp-dir.js";

for (const firstRecovery of ["unchanged", "still-ambiguous"] as const) {
  test(`Home ambiguity recovers after ${firstRecovery} refinement and unlocks the dependent packet in Chromium`, async () => {
    await withRecovery(async ({ options, deps, builder, git }) => {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end('<nav><button><span class="sidebar__label">home</span></button></nav><main><ul><li class="note-card__label">home</li></ul></main>');
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") assert.fail("expected server address");
      const original = homePlan("tab");
      const planner = new FakeProbePlanner([original,
        firstRecovery === "unchanged" ? original : homePlan("link"), homePlan("button"), dependentPlan()]);
      const reports: ShadowReport[] = [];
      const publicLogs: string[] = [];
      let unchangedChecks = 0;
      try {
        const runner = new PlaywrightProbeRunner();
        const summary = await runPipeline(options, { ...deps, planner,
          appLifecycle: { start: async () => ({ baseUrl: `http://127.0.0.1:${address.port}`,
            assertUnchanged: async () => { unchangedChecks += 1; }, stop: async () => {} }) },
          runner: { run: async (plan, runOptions) => {
            const report = await runner.run(plan, runOptions);
            reports.push(report);
            return report;
          } },
          logSink: { write: (chunk) => { publicLogs.push(chunk); } },
        });
        assert.equal(summary.status, "delivered");
        assert.deepEqual(summary.verifiedRequirementIds, ["REQ-1.1", "REQ-2.1"]);
        assert.deepEqual(git.restoredShas, []);
        assert.deepEqual(builder.requests.map((request) => [request.mode, "packet" in request ? request.packet.attempt : undefined]),
          [["implement", 1], ["implement", 1]]);
        assert.equal(planner.refinements.length, 2);
        assert.equal(reports.length, firstRecovery === "unchanged" ? 3 : 4);
        assert.equal(unchangedChecks, reports.length);
        const failure = planner.refinements[0].failures[0];
        assert.equal(failure.caseId, "REQ-1.1-happy");
        assert.equal(failure.stepIndex, 1);
        assert.match(failure.message, /strict mode violation.*Home/);
        assert.match(failure.locatorSnapshot ?? "", /button "home"/);
        assert.equal(failure.locatorAttempts?.length, 2);
        assert.equal(failure.locatorAttempts?.[0].locator.by, "role");
        assert.match(failure.locatorAttempts?.[1].message ?? "", /resolved to 2 elements/);
        if (firstRecovery === "unchanged") {
          assert.match(planner.refinements[1].feedback?.validationError ?? "", /new locator candidate/);
        }
        const evidenceDir = join(dirname(options.ledgerFile!), "evidence");
        const evidence = await Promise.all((await readdir(evidenceDir)).sort()
          .map(async (file) => JSON.parse(await readFile(join(evidenceDir, file), "utf8"))));
        assert.equal(evidence[0].planSha256, probePlanSha256(original));
        assert.deepEqual(evidence[0].failures[0].locators, [
          { by: "role", role: "tab", name: "Home" }, { by: "text", text: "Home" },
        ]);
        if (firstRecovery === "still-ambiguous") {
          assert.equal(evidence.length, 2);
          assert.notEqual(evidence[0].planSha256, evidence[1].planSha256);
          assert.equal(evidence[1].failures[0].locators[0].role, "link");
        }
        assert.doesNotMatch(publicLogs.join(""), /sidebar__label|note-card__label|locatorAttempts|locatorSnapshot|"cases"\s*:\s*\[/);
        assert.doesNotMatch(JSON.stringify(builder.requests), /strict mode violation|locatorAttempts|locatorSnapshot/);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  });
}

test("Unchanged refinements exhaust two Judge calls without rerunning the same plan or repairing the app", async () => {
  await withRecovery(async ({ options, deps, builder, git }) => {
    const planner = new FakeProbePlanner([homePlan("tab")]);
    let runs = 0;
    const summary = await runPipeline(options, { ...deps, planner, runner: { run: async () => {
      runs += 1;
      return locatorReport();
    } } });
    assert.equal(runs, 1);
    assert.equal(planner.refinements.length, 2);
    assert.equal(builder.requests.length, 1);
    assert.deepEqual(git.restoredShas, ["baseline"]);
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.deepEqual(summary.blockedRequirementIds, ["REQ-1.1"]);
    const events = await readEvents(options);
    assert.deepEqual(events.filter((event) => event.type === "probe_refinement_failed")
      .map((event) => event.detail?.refinementAttempt), [1, 2]);
  });
});

for (const expiration of ["before-refinement", "during-refinement", "after-rerun"] as const) {
  test(`Locator recovery honors budget exhaustion ${expiration}`, async () => {
    await withRecovery(async ({ options, deps }) => {
      let time = 0;
      let refinements = 0;
      let runs = 0;
      const planner = new FakeProbePlanner([homePlan("tab")]);
      planner.refineLocators = async () => {
        refinements += 1;
        if (expiration === "during-refinement") time = 60_000;
        return homePlan("button");
      };
      const summary = await runPipeline(options, { ...deps, planner, clock: { nowMs: () => time },
        runner: { run: async () => {
          runs += 1;
          if (expiration === "before-refinement" || (expiration === "after-rerun" && runs === 2)) time = 60_000;
          return locatorReport();
        } },
      });
      assert.equal(refinements, expiration === "before-refinement" ? 0 : 1);
      assert.equal(runs, expiration === "after-rerun" ? 2 : 1);
      assert.equal(summary.status, "partial");
    });
  });
}

test("A real behavior failure after locator recovery keeps the three Builder attempts and shared recovery quota", async () => {
  await withRecovery(async ({ options, deps, builder }) => {
    const planner = new FakeProbePlanner([homePlan("tab"), homePlan("link"), homePlan("button")]);
    let runs = 0;
    const summary = await runPipeline(options, { ...deps, planner, runner: { run: async () => {
      runs += 1;
      if (runs === 1 || runs === 2) return locatorReport();
      return { ...locatorReport(), verdict: "fail", failures: [
        { caseId: "REQ-1.1-happy", stepIndex: 2, category: "assertion", message: "required region is hidden" },
      ] };
    } } });
    assert.equal(planner.refinements.length, 2);
    assert.equal(runs, 5);
    assert.deepEqual(builder.requests.map((request) => request.mode), ["implement", "repair", "root_cause_repair"]);
    assert.equal(summary.status, "partial");
  });
});

test("Locator recovery quota stays exhausted when a later Builder repair has a locator failure", async () => {
  await withRecovery(async ({ options, deps, builder }) => {
    const planner = new FakeProbePlanner([homePlan("tab"), homePlan("link"), homePlan("button")]);
    let runs = 0;
    const summary = await runPipeline(options, { ...deps, planner, runner: { run: async () => {
      runs += 1;
      return runs === 3 ? { ...locatorReport(), verdict: "fail", failures: [
        { caseId: "REQ-1.1-happy", stepIndex: 2, category: "assertion", message: "required region is hidden" },
      ] } : locatorReport();
    } } });
    assert.equal(planner.refinements.length, 2);
    assert.equal(runs, 4);
    assert.deepEqual(builder.requests.map((request) => request.mode), ["implement", "repair"]);
    assert.deepEqual(summary.blockedRequirementIds, ["REQ-1.1"]);
  });
});

test("Locator recovery does not swallow fatal planner errors or accept changed assertions", async () => {
  for (const invalid of ["fatal", "behavior", "mutation"] as const) {
    await withRecovery(async ({ options, deps, git }) => {
      let refinements = 0;
      let runs = 0;
      const planner = new FakeProbePlanner([homePlan("tab")]);
      planner.refineLocators = async (original) => {
        refinements += 1;
        if (invalid === "fatal") throw new ProbePlannerError("transport", "HTTP 401", { httpStatus: 401 });
        const changed = invalid === "mutation" ? original : homePlan("button");
        changed.cases[0].steps.pop();
        return changed;
      };
      const result = runPipeline(options, { ...deps, planner, runner: { run: async () => {
        runs += 1;
        return locatorReport();
      } } });
      if (invalid === "fatal") await assert.rejects(result, /HTTP 401/);
      else assert.equal((await result).status, "partial");
      assert.equal(refinements, invalid === "fatal" ? 1 : 2);
      assert.equal(runs, 1);
      assert.deepEqual(git.restoredShas, ["baseline"]);
    });
  }
});

function homePlan(role: string): ProbePlan {
  return { packetId: "packet-req-1-1", cases: [{ id: "REQ-1.1-happy", requirementIds: ["REQ-1.1"], purpose: "happy_path",
    steps: [{ op: "goto", path: "/" },
      { op: "expectVisible", locator: { by: "role", role, name: role === "button" ? "home" : "Home",
        ...(role === "button" ? { exact: true } : { fallbacks: [{ by: "text", text: "Home" }] }) } },
      { op: "expectVisible", locator: { by: "role", role: "main" } }],
  }] };
}

function dependentPlan(): ProbePlan {
  return { packetId: "packet-req-2-1", cases: [{ id: "REQ-2.1-happy", requirementIds: ["REQ-2.1"], purpose: "happy_path",
    steps: [{ op: "goto", path: "/" }, { op: "expectVisible", locator: { by: "role", role: "main" } }],
  }] };
}

function locatorReport(): ShadowReport {
  return { packetId: "packet-req-1-1", verdict: "inconclusive", passedCases: [], failures: [
    { caseId: "REQ-1.1-happy", stepIndex: 1, category: "locator", message: "strict mode violation",
      locatorSnapshot: '- navigation:\n  - button "home"\n- main:\n  - listitem: home' },
  ] };
}

async function readEvents(options: PipelineOptions): Promise<RunEvent[]> {
  return (await readFile(options.ledgerFile!, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
}

async function withRecovery(callback: (fixture: {
  options: PipelineOptions; deps: PipelineDeps; builder: FakeBuilder; git: FakeGitOps;
}) => Promise<void>): Promise<void> {
  await withTempDir("shallow-locator-recovery-", async (directory) => {
    const requirementsFile = join(directory, "requirements.yaml");
    await writeFile(requirementsFile, JSON.stringify({ id: "ROOT", name: "Keep", type: "FOLDER", dependencies: [], children: [
      { id: "REQ-1.1", name: "Enter Website", type: "ATOMIC", description: "Open the application and display the home page.", dependencies: [] },
      { id: "REQ-2.1", name: "Workspace", type: "ATOMIC", description: "Display the notes workspace.", dependencies: ["REQ-1.1"] },
    ] }));
    const options: PipelineOptions = { requirementsFile, outputDir: join(directory, "output"),
      ledgerFile: join(directory, "private", "run-ledger.jsonl"), totalBudgetMs: 60_000, plannerRetryDelayMs: 0,
      platformContract: { baseUrl: "http://127.0.0.1:43210", port: 43210, installCommands: [], buildCommands: [],
        startCommand: { executable: "node", args: [], cwd: "output" }, healthPath: "/health", buildTimeoutMs: 1000, startTimeoutMs: 1000 },
    };
    const builder = new FakeBuilder();
    const git = new FakeGitOps(["baseline", "root-accepted", "child-accepted"]);
    const deps: PipelineDeps = { builder, git, planner: new FakeProbePlanner([homePlan("tab")]),
      runner: { run: async () => locatorReport() }, clock: { nowMs: () => 0 },
      appLifecycle: { start: async () => ({ baseUrl: options.platformContract.baseUrl, stop: async () => {} }) },
      finalVerifier: { verify: async () => ({ ok: true, stage: "complete", message: "fixture ready" }) },
    };
    await callback({ options, deps, builder, git });
  });
}
