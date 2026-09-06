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
  type ArcEventsPort,
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
    const arcEvents = new RecordingArcEvents();

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
        arcEvents,
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
    assert.deepEqual(arcEvents.runnerStates, ["running", "completed"]);
    assert.deepEqual(arcEvents.requirementStates, [
      ["REQ-PROFILE", "implement", "running"],
      ["REQ-PROFILE", "implement", "completed"],
      ["REQ-PROFILE", "test", "passed"],
    ]);
    assert.deepEqual(arcEvents.commitSignals, ["git_commit"]);
    assert.deepEqual(arcEvents.builderDiagnostics, [
      ["packet-req-profile", "completed", "Fake builder completed"],
    ]);
    assert.deepEqual(Object.keys(arcEvents.requirementRows), ["REQ-PROFILE"]);
    assert.deepEqual(Object.keys(arcEvents.scenarioRows), ["REQ-PROFILE::0"]);
    const events = (await readFile(ledgerFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { type: string }).type);
    assert.deepEqual(events, [
      "pipeline_started",
      "packet_selected",
      "builder_started",
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

test("Pipeline records image fallback diagnostics without image payloads", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    class ImageFallbackBuilder extends FakeBuilder {
      override async run(request: BuilderRequest): Promise<BuilderResult> {
        return { ...await super.run(request), referenceImages: {
          mode: "text_fallback", attachedCount: 0,
          skipped: [{ reference: "reference/missing.png", reason: "unreadable_image" }],
        } };
      }
    }
    await runPipeline(options(requirementsFile, outputDir, ledgerFile), {
      builder: new ImageFallbackBuilder(), planner: new FakeProbePlanner([workingPlan()]),
      runner: new PlaywrightProbeRunner(), git: new FakeGitOps(["baseline", "accepted"]),
      appLifecycle: new RecordingLifecycle(), clock: fixedClock(), finalVerifier: new RecordingFinalVerifier(),
    });
    const ledger = await readFile(ledgerFile, "utf8");
    const events = ledger.trim().split("\n").map((line) => JSON.parse(line) as { type: string; detail?: Record<string, unknown> });
    assert.equal(events.find((event) => event.type === "builder_reference_images")?.detail?.mode, "text_fallback");
    assert.doesNotMatch(ledger, /data:image|base64/);
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

    assert.deepEqual(
      builder.requests.map((request) => request.mode),
      ["implement", "repair"],
    );
    const repairRequest = builder.requests[1];
    assert.equal(repairRequest.mode, "repair");
    if (repairRequest.mode !== "repair") assert.fail("expected repair request");
    assert.ok(repairRequest.shadowObservation.failures.length > 0);
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

    assert.deepEqual(
      builder.requests.map((request) => request.mode),
      ["implement", "repair", "root_cause_repair"],
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
    const delivery = builder.requests[1];
    assert.equal(delivery.mode, "delivery_repair");
    if (delivery.mode !== "delivery_repair") assert.fail("expected delivery repair");
    assert.equal(delivery.deliveryFailure.stage, "build");
    assert.equal(delivery.deliveryFailure.actual, "production build failed");
    assert.equal("packet" in delivery, false);
    assert.equal(summary.status, "delivered");
    assert.equal(summary.acceptedSha, "delivery-fixed");
    assert.deepEqual(git.captureMessages, [
      "shallow: initial state",
      "shallow: accept packet-req-profile",
      "shallow: accept delivery repair",
    ]);
  });
});

test("Pipeline E2E blocks a packet when the probe planner keeps failing", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const git = new FakeGitOps(["baseline"]);

    const summary = await runPipeline(
      { ...options(requirementsFile, outputDir, ledgerFile), plannerRetryDelayMs: 0 },
      {
        builder,
        planner: new FakeProbePlanner([]),
        runner: new PlaywrightProbeRunner(),
        git,
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.equal(builder.requests.length, 1);
    assert.deepEqual(git.restoredShas, ["baseline"]);
    assert.deepEqual(summary.blockedRequirementIds, ["REQ-PROFILE"]);
    assert.equal(summary.status, "partial");
    const events = (await readFile(ledgerFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { type: string }).type);
    assert.ok(events.includes("probe_planner_retry"));
    assert.ok(events.includes("probe_planner_failed"));
    assert.ok(events.includes("packet_blocked"));
  });
});

test("Pipeline E2E treats an application start failure as a repairable attempt", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const lifecycle = new FlakyLifecycle(1);

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner: new FakeProbePlanner([workingPlan()]),
        runner: new PlaywrightProbeRunner(),
        git: new FakeGitOps(["baseline", "accepted"]),
        appLifecycle: lifecycle,
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.deepEqual(
      builder.requests.map((request) => request.mode),
      ["implement", "repair"],
    );
    const repairRequest = builder.requests[1];
    assert.equal(repairRequest.mode, "repair");
    if (repairRequest.mode !== "repair") assert.fail("expected repair request");
    assert.equal(
      repairRequest.shadowObservation.failures[0].caseId,
      "<application>",
    );
    assert.equal(repairRequest.shadowObservation.applicationStartupFailed, true);
    assert.deepEqual(summary.verifiedRequirementIds, ["REQ-PROFILE"]);
    assert.equal(summary.status, "delivered");
    const events = (await readFile(ledgerFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { type: string }).type);
    assert.ok(events.includes("application_start_failed"));
  });
});

test("Pipeline E2E converts a throwing Builder into a failed attempt", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new ThrowingBuilder(1);

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner: new FakeProbePlanner([workingPlan()]),
        runner: new PlaywrightProbeRunner(),
        git: new FakeGitOps(["baseline", "accepted"]),
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.deepEqual(
      builder.requests.map((request) => request.mode),
      ["implement", "repair"],
    );
    const repairRequest = builder.requests[1];
    assert.equal(repairRequest.mode, "repair");
    if (repairRequest.mode !== "repair") assert.fail("expected repair request");
    assert.equal(repairRequest.shadowObservation.failures[0].caseId, "<builder>");
    assert.deepEqual(summary.verifiedRequirementIds, ["REQ-PROFILE"]);
  });
});

test("Pipeline E2E accepts a packet regardless of misleading blocking receipt words", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder(
      ["completed"],
      ["结果：阻塞\n检查：失败\n风险：无法继续"],
    );

    const summary = await runPipeline(
      options(requirementsFile, outputDir, ledgerFile),
      {
        builder,
        planner: new FakeProbePlanner([workingPlan()]),
        runner: new PlaywrightProbeRunner(),
        git: new FakeGitOps(["baseline", "accepted"]),
        appLifecycle: new RecordingLifecycle(),
        clock: fixedClock(),
        finalVerifier: new RecordingFinalVerifier(),
      },
    );

    assert.equal(summary.status, "delivered");
    assert.equal(summary.acceptedSha, "accepted");
    const events = (await readFile(ledgerFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; detail?: { summary?: string } });
    const finished = events.find((event) => event.type === "builder_finished");
    assert.equal(
      finished?.detail?.summary,
      "结果：阻塞\n检查：失败\n风险：无法继续",
    );
  });
});

test("Pipeline E2E ignores misleading success receipt words when probes keep failing", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FixtureVariantBuilder(
      [true, true, true],
      ["结果：完成\n检查：通过"],
    );
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

    assert.deepEqual(
      builder.requests.map((request) => request.mode),
      ["implement", "repair", "root_cause_repair"],
    );
    assert.deepEqual(git.restoredShas, ["baseline"]);
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.deepEqual(summary.blockedRequirementIds, ["REQ-PROFILE"]);
  });
});

test("Pipeline reports partial when the budget expires with untouched requirements", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    let ticks = 0;
    const summary = await runPipeline(options(requirementsFile, outputDir, ledgerFile), {
      builder, planner: new FakeProbePlanner([]), runner: new PlaywrightProbeRunner(),
      git: new FakeGitOps(), appLifecycle: new RecordingLifecycle(),
      clock: { nowMs: () => ticks++ === 0 ? 0 : 60_000 },
      finalVerifier: new RecordingFinalVerifier(),
    });
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.equal(builder.requests.length, 0);
  });
});

test("Pipeline stops starting packet repairs once the budget is exhausted", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const git = new FakeGitOps();
    let time = 0;
    const summary = await runPipeline(options(requirementsFile, outputDir, ledgerFile), {
      builder, planner: new FakeProbePlanner([workingPlan()]), git,
      runner: { async run(plan) {
        time = 60_000;
        return { packetId: plan.packetId, verdict: "fail", passedCases: [], failures: [{ caseId: "save", stepIndex: 1, category: "assertion", message: "wrong value" }] };
      } },
      appLifecycle: new RecordingLifecycle(), clock: { nowMs: () => time },
      finalVerifier: new RecordingFinalVerifier(),
    });
    assert.equal(builder.requests.length, 1);
    assert.deepEqual(git.restoredShas, ["baseline"]);
    assert.equal(summary.status, "partial");
  });
});

test("Pipeline restores every unaccepted delivery repair and never reports it as delivered", async () => {
  for (const outcome of ["completed", "failed", "timed_out"] as const) {
    await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
      const builder = new FakeBuilder(["completed", outcome]);
      const git = new FakeGitOps();
      const finalVerifier = new SequencedFinalVerifier([
        { ok: false, stage: "build", message: "broken build" },
        { ok: outcome !== "completed", stage: "browser", message: "repair verification" },
      ]);
      const summary = await runPipeline(options(requirementsFile, outputDir, ledgerFile), {
        builder, planner: new FakeProbePlanner([workingPlan()]), git, finalVerifier,
        runner: { async run(plan) { return { packetId: plan.packetId, verdict: "pass", passedCases: plan.cases.map((item) => item.id), failures: [] }; } },
        appLifecycle: new RecordingLifecycle(), clock: fixedClock(),
      });
      assert.equal(summary.status, "failed", outcome);
      assert.equal(summary.acceptedSha, "accepted");
      assert.deepEqual(git.restoredShas, ["accepted"]);
      assert.equal(git.captureMessages.length, 2);
    });
  }
});

test("Pipeline restores the baseline and emits failure when the runner unexpectedly throws", async () => {
  await withPipelineFiles(async ({ requirementsFile, outputDir, ledgerFile }) => {
    const builder = new FakeBuilder();
    const git = new FakeGitOps();
    const arcEvents = new RecordingArcEvents();
    const lifecycle = new RecordingLifecycle();
    await assert.rejects(runPipeline(options(requirementsFile, outputDir, ledgerFile), {
      builder, planner: new FakeProbePlanner([workingPlan()]), git, arcEvents,
      runner: { async run() { throw new Error("unexpected runner failure"); } },
      appLifecycle: lifecycle, clock: fixedClock(), finalVerifier: new RecordingFinalVerifier(),
    }), /unexpected runner failure/);
    assert.deepEqual(git.restoredShas, ["baseline"]);
    assert.deepEqual(arcEvents.runnerStates, ["running", "failed"]);
    assert.equal(lifecycle.stopCount, 1);
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

class RecordingArcEvents implements ArcEventsPort {
  runnerStates: string[] = [];
  requirementStates: Array<[string, string, string]> = [];
  commitSignals: string[] = [];
  requirementRows: Record<string, unknown> = {};
  scenarioRows: Record<string, unknown> = {};
  builderDiagnostics: Array<[string, string, string]> = [];

  async runnerState(state: "running" | "completed" | "failed"): Promise<void> {
    this.runnerStates.push(state);
  }

  async requirementState(
    reqId: string,
    phase: "design" | "implement" | "test",
    status: "running" | "completed" | "failed" | "passed",
  ): Promise<void> {
    this.requirementStates.push([reqId, phase, status]);
  }

  async commitHistorySignal(reason: string): Promise<void> {
    this.commitSignals.push(reason);
  }

  async storeRequirementTree(
    requirementRows: Record<string, unknown>,
    scenarioRows: Record<string, unknown>,
  ): Promise<void> {
    this.requirementRows = requirementRows;
    this.scenarioRows = scenarioRows;
  }

  async builderDiagnostic(
    packetId: string,
    outcome: string,
    summary: string,
  ): Promise<void> {
    this.builderDiagnostics.push([packetId, outcome, summary]);
  }
}

class FixtureVariantBuilder implements BuilderPort {
  readonly requests: BuilderRequest[] = [];
  private callIndex = 0;

  constructor(
    private readonly brokenByCall: boolean[],
    private readonly summaries?: string[],
  ) {}

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
    const summary =
      this.summaries?.[this.callIndex] ??
      this.summaries?.at(-1) ??
      "fixture written";
    this.callIndex += 1;
    return {
      sessionId: `variant-${this.callIndex}`,
      outcome: "completed",
      summary,
    };
  }

  async close(): Promise<void> {}
}

class FlakyLifecycle implements AppLifecycle {
  private calls = 0;

  constructor(private readonly failures: number) {}

  async start(outputDir: string) {
    this.calls += 1;
    if (this.calls <= this.failures) {
      throw new Error("fixture application failed to start");
    }
    const server = await startFixtureServer(outputDir);
    return {
      baseUrl: server.baseUrl,
      stop: async () => {
        await server.stop();
      },
    };
  }
}

class ThrowingBuilder implements BuilderPort {
  readonly requests: BuilderRequest[] = [];
  private calls = 0;

  constructor(private readonly failures: number) {}

  async run(request: BuilderRequest): Promise<BuilderResult> {
    this.requests.push(request);
    this.calls += 1;
    if (this.calls <= this.failures) {
      throw new Error("OpenCode runtime crashed");
    }
    await cp(resolve("test/fixtures/app"), request.outputDir, {
      recursive: true,
      force: true,
    });
    return {
      sessionId: `throwing-${this.calls}`,
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
