import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

import type {
  BuilderPort,
  BuilderRequest,
  BuilderResult,
} from "../src/builder/port.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import type { ProbePlan } from "../src/judge/probe-schema.js";
import type {
  FinalVerificationReport,
  FinalVerifierPort,
} from "../src/final-verifier.js";
import {
  runPipeline,
  type AppLifecycle,
  type Clock,
} from "../src/pipeline.js";
import type { PlatformContract } from "../src/types.js";
import { FakeBuilder } from "./fakes/fake-builder.js";
import { FakeGitOps } from "./fakes/fake-git-ops.js";
import { FakeProbePlanner } from "./fakes/fake-probe-planner.js";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Pipeline E2E schedules, builds, probes in Chromium, and accepts", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const planner = new FakeProbePlanner([workingPlan()]);
    const git = new FakeGitOps(["baseline", "accepted"]);
    const lifecycle = new RecordingLifecycle();
    const finalVerifier = new RecordingFinalVerifier();

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner,
        runner: new PlaywrightProbeRunner(),
        git,
        appLifecycle: lifecycle,
        clock: fixedClock(),
        finalVerifier,
      },
    );

    assert.deepEqual(summary.verifiedRequirementIds, ["REQ-PROFILE"]);
    assert.deepEqual(summary.blockedRequirementIds, []);
    assert.equal(summary.acceptedSha, "accepted");
    assert.deepEqual(git.captureMessages, [
      "shallow: initial state",
      "shallow: accept packet-req-profile",
    ]);
    assert.equal(builder.requests.length, 1);
    assert.equal(planner.packets.length, 1);
    assert.equal(lifecycle.startCount, 1);
    assert.equal(lifecycle.stopCount, 1);
    assert.equal(builder.closeCount, 1);
    assert.equal(finalVerifier.calls, 1);
    const events = (await readFile(ledgerFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { type: string }).type);
    assert.deepEqual(events, [
      "pipeline_started",
      "packet_selected",
      "builder_finished",
      "probe_planned",
      "probe_finished",
      "packet_accepted",
      "delivery_started",
      "delivery_finished",
      "pipeline_finished",
    ]);
  });
});

test("Pipeline E2E repairs the app and reruns the same behavior probes", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FixtureVariantBuilder([true, false]);
    const planner = new FakeProbePlanner([workingPlan()]);
    const git = new FakeGitOps(["baseline", "accepted"]);

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner,
        runner: new PlaywrightProbeRunner(),
        git,
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.deepEqual(builder.requests.map((request) => request.packet.attempt), [1, 2]);
    assert.equal(builder.requests[1].requireRootCauseFirst, false);
    assert.equal(builder.requests[1].shadowReport?.verdict, "fail");
    assert.equal(planner.packets.length, 1);
    assert.equal(summary.acceptedSha, "accepted");
    assert.deepEqual(summary.verifiedRequirementIds, ["REQ-PROFILE"]);
  });
});

test("Pipeline E2E stops after two repairs, restores baseline, and blocks the packet", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FixtureVariantBuilder([true, true, true]);
    const git = new FakeGitOps(["baseline"]);

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner: new FakeProbePlanner([workingPlan()]),
        runner: new PlaywrightProbeRunner(),
        git,
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.deepEqual(builder.requests.map((request) => request.packet.attempt), [1, 2, 3]);
    assert.deepEqual(
      builder.requests.map((request) => request.requireRootCauseFirst),
      [false, false, true],
    );
    assert.deepEqual(git.restoredShas, ["baseline"]);
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.deepEqual(summary.blockedRequirementIds, ["REQ-PROFILE"]);
  });
});

test("Pipeline E2E refines a missing locator without another Builder attempt", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const planner = new FakeProbePlanner([missingLocatorPlan(), workingPlan()]);

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner,
        runner: new PlaywrightProbeRunner(),
        git: new FakeGitOps(["baseline", "accepted"]),
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.equal(builder.requests.length, 1);
    assert.equal(planner.refinements.length, 1);
    assert.match(planner.refinements[0].snapshot, /Profile name|Save/);
    assert.deepEqual(summary.verifiedRequirementIds, ["REQ-PROFILE"]);
  });
});

test("Pipeline E2E reports failure when independent final verification fails", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder: new FakeBuilder(),
        planner: new FakeProbePlanner([workingPlan()]),
        runner: new PlaywrightProbeRunner(),
        git: new FakeGitOps(["baseline", "accepted"]),
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier({
          ok: false,
          stage: "build",
          message: "production build failed",
        }),
      },
    );

    assert.equal(summary.status, "failed");
  });
});

test("Pipeline E2E allows one delivery repair and reruns full final verification", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const git = new FakeGitOps(["baseline", "accepted", "delivery-fixed"]);
    const finalVerifier = new SequencedFinalVerifier([
      { ok: false, stage: "build", message: "production build failed" },
      { ok: true, stage: "complete", message: "Final verification passed" },
    ]);

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner: new FakeProbePlanner([workingPlan()]),
        runner: new PlaywrightProbeRunner(),
        git,
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier,
      },
    );

    assert.equal(finalVerifier.calls, 2);
    assert.equal(builder.requests.length, 2);
    assert.equal(builder.requests[1].packet.id, "delivery-repair");
    assert.equal(builder.requests[1].requireRootCauseFirst, true);
    assert.equal(builder.requests[1].shadowReport?.failures[0].message, "production build failed");
    assert.equal(summary.status, "delivered");
    assert.equal(summary.acceptedSha, "delivery-fixed");
    assert.deepEqual(git.captureMessages, [
      "shallow: initial state",
      "shallow: accept packet-req-profile",
      "shallow: accept delivery repair",
    ]);
  });
});

class RecordingLifecycle implements AppLifecycle {
  startCount = 0;
  stopCount = 0;

  async start(outputDir: string) {
    this.startCount += 1;
    const server = await startFixtureServer(outputDir);
    return {
      baseUrl: server.baseUrl,
      stop: async () => {
        this.stopCount += 1;
        await server.stop();
      },
    };
  }
}

class FixtureVariantBuilder implements BuilderPort {
  readonly requests: BuilderRequest[] = [];
  private callIndex = 0;

  constructor(private readonly brokenByCall: boolean[]) {}

  async run(request: BuilderRequest): Promise<BuilderResult> {
    this.requests.push(request);
    await cp(resolve("test/fixtures/app"), request.outputDir, {
      recursive: true,
      force: true,
    });
    if (this.brokenByCall[this.callIndex]) {
      const serverFile = join(request.outputDir, "server.mjs");
      const source = await readFile(serverFile, "utf8");
      await writeFile(
        serverFile,
        source.replace("status.textContent = 'Saved'", "status.textContent = 'Broken'"),
      );
    }
    this.callIndex += 1;
    return {
      sessionId: `variant-${this.callIndex}`,
      outcome: "completed",
      summary: "fixture written",
    };
  }

  async close(): Promise<void> {}
}

class RecordingFinalVerifier implements FinalVerifierPort {
  calls = 0;

  constructor(
    private readonly result: FinalVerificationReport = {
      ok: true,
      stage: "complete",
      message: "Final verification passed",
    },
  ) {}

  async verify(): Promise<FinalVerificationReport> {
    this.calls += 1;
    return this.result;
  }
}

class SequencedFinalVerifier implements FinalVerifierPort {
  calls = 0;

  constructor(private readonly results: FinalVerificationReport[]) {}

  async verify(): Promise<FinalVerificationReport> {
    const result = this.results[this.calls] ?? this.results.at(-1);
    this.calls += 1;
    if (!result) throw new Error("SequencedFinalVerifier has no result");
    return result;
  }
}

function workingPlan(): ProbePlan {
  return {
    packetId: "packet-req-profile",
    cases: [
      {
        id: "save-profile",
        requirementIds: ["REQ-PROFILE"],
        purpose: "happy_path",
        steps: [
          { op: "goto", path: "/" },
          {
            op: "fill",
            locator: { by: "label", text: "Profile name" },
            value: "Ada",
          },
          {
            op: "click",
            locator: { by: "role", role: "button", name: "Save" },
          },
          {
            op: "expectText",
            locator: { by: "role", role: "status" },
            text: "Saved",
          },
          { op: "reload" },
          {
            op: "expectValue",
            locator: { by: "label", text: "Profile name" },
            value: "Ada",
          },
        ],
      },
    ],
  };
}

function missingLocatorPlan(): ProbePlan {
  const plan = workingPlan();
  plan.cases[0].steps[2] = {
    op: "click",
    locator: { by: "role", role: "button", name: "Missing save" },
  };
  return plan;
}

function options(requirementsFile: string, outputDir: string, ledgerFile: string) {
  return {
    requirementsFile,
    outputDir,
    ledgerFile,
    totalBudgetMs: 60_000,
    platformContract: platformContract(),
  };
}

function platformContract(): PlatformContract {
  return {
    baseUrl: "http://127.0.0.1:3000",
    port: 3000,
    installCommands: [],
    buildCommands: [],
    startCommand: { executable: "node", args: ["server.mjs"], cwd: "output" },
    healthPath: "/health",
    buildTimeoutMs: 5_000,
    startTimeoutMs: 5_000,
  };
}

function fixedClock(): Clock {
  return { nowMs: () => 1_000 };
}

async function withPipelineFiles(
  callback: (files: {
    requirementsFile: string;
    outputDir: string;
    ledgerFile: string;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir("shallow-pipeline-", async (directory) => {
    const requirementsFile = join(directory, "requirements.yaml");
    const outputDir = join(directory, "output");
    const ledgerFile = join(directory, "state", "run-ledger.jsonl");
    await writeFile(
      requirementsFile,
      `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\ndescription: Root\nchildren:\n  - id: PROFILE\n    name: Profile\n    type: FOLDER\n    dependencies: []\n    description: Profile area\n    children:\n      - id: REQ-PROFILE\n        name: Save a profile\n        type: ATOMIC\n        dependencies: []\n        description: Keep a profile name after refresh.\n        scenarios:\n          - name: Save and refresh\n            steps:\n              - keyword: WHEN\n                content: The user enters a profile name and saves.\n              - keyword: THEN\n                content: The same name remains after refresh.\n`,
    );
    await callback({ requirementsFile, outputDir, ledgerFile });
  });
}
