import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  OpenCodeSdkBuilder,
  type OpenCodeRuntime,
} from "../src/builder/opencode-sdk.js";
import { buildBuilderPrompt } from "../src/builder/prompt.js";
import type { BuilderRequest } from "../src/builder/port.js";
import type { WorkPacket } from "../src/types.js";
import { FakeBuilder } from "./fakes/fake-builder.js";

test("Builder prompt exposes the packet and platform contract but not global state", () => {
  const request = builderRequest(1);

  const prompt = buildBuilderPrompt(request);

  assert.match(prompt, /REQ-PROFILE/);
  assert.match(prompt, /Keep a profile name after refresh/);
  assert.match(prompt, /Save a profile/);
  assert.match(prompt, /reference\/profile\.png/);
  assert.match(prompt, /C:\\candidate-app/);
  assert.match(prompt, /npm --prefix frontend run build/);
  assert.match(prompt, /http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(prompt, /SECRET-OTHER-REQ/);
  assert.doesNotMatch(prompt, /acceptedSha|global budget|\/workspace\/tests/i);
  assert.doesNotMatch(prompt, /Capability Kernel|use React|use Vue/i);
});

test("Builder repair prompt includes only the observed Shadow report", () => {
  const prompt = buildBuilderPrompt({
    ...builderRequest(2),
    shadowReport: {
      packetId: "packet-req-profile",
      verdict: "fail",
      passedCases: [],
      failures: [
        {
          caseId: "save-profile",
          stepIndex: 3,
          category: "assertion",
          message: "Expected Saved, received Error",
        },
      ],
    },
  });

  assert.match(prompt, /Expected Saved, received Error/);
  assert.doesNotMatch(prompt, /official|hidden test/i);
  assert.doesNotMatch(prompt, /root cause before/i);
});

test("Builder third attempt requires root-cause analysis before editing", () => {
  const prompt = buildBuilderPrompt({
    ...builderRequest(3),
    requireRootCauseFirst: true,
    shadowReport: {
      packetId: "packet-req-profile",
      verdict: "fail",
      passedCases: [],
      failures: [
        {
          caseId: "save-profile",
          stepIndex: 3,
          category: "assertion",
          message: "Value did not persist",
        },
      ],
    },
  });

  assert.match(prompt, /identify and state the root cause before editing/i);
});

test("Builder starts one runtime and creates one short session per call", async () => {
  const runtime = new RecordingRuntime();
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 1_000 });

  const first = await builder.run(builderRequest(1));
  const second = await builder.run(builderRequest(2));
  await builder.close();

  assert.deepEqual(runtime.startedDirectories, ["C:\\candidate-app"]);
  assert.deepEqual(runtime.createdTitles, [
    "packet-req-profile attempt 1",
    "packet-req-profile attempt 2",
  ]);
  assert.equal(runtime.prompts.length, 2);
  assert.equal(first.sessionId, "session-1");
  assert.equal(second.sessionId, "session-2");
  assert.equal(first.outcome, "completed");
  assert.equal(runtime.closeCount, 1);
});

test("Builder aborts the active session when its prompt times out", async () => {
  const runtime = new RecordingRuntime();
  runtime.promptResult = new Promise(() => undefined);
  const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs: 5 });

  const result = await builder.run(builderRequest(1));
  await builder.close();

  assert.equal(result.outcome, "timed_out");
  assert.deepEqual(runtime.abortedSessions, ["session-1"]);
});

test("FakeBuilder copies only the test fixture app into output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallow-fake-builder-"));
  try {
    const builder = new FakeBuilder();
    const result = await builder.run({
      ...builderRequest(1),
      outputDir: directory,
    });

    assert.equal(result.outcome, "completed");
    await access(join(directory, "server.mjs"));
    const packageJson = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(packageJson.scripts.start, "node server.mjs");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class RecordingRuntime implements OpenCodeRuntime {
  startedDirectories: string[] = [];
  createdTitles: string[] = [];
  prompts: Array<{ sessionId: string; text: string }> = [];
  abortedSessions: string[] = [];
  closeCount = 0;
  promptResult: Promise<string> = Promise.resolve("implemented");

  async start(directory: string): Promise<void> {
    this.startedDirectories.push(directory);
  }

  async createSession(title: string): Promise<string> {
    this.createdTitles.push(title);
    return `session-${this.createdTitles.length}`;
  }

  async prompt(sessionId: string, text: string): Promise<string> {
    this.prompts.push({ sessionId, text });
    return this.promptResult;
  }

  async abort(sessionId: string): Promise<void> {
    this.abortedSessions.push(sessionId);
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function builderRequest(attempt: 1 | 2 | 3): BuilderRequest {
  return {
    packet: packet(attempt),
    outputDir: "C:\\candidate-app",
    requireRootCauseFirst: false,
    platformContract: {
      baseUrl: "http://127.0.0.1:3000",
      port: 3000,
      installCommands: [
        { executable: "npm", args: ["install"], cwd: "frontend" },
      ],
      buildCommands: [
        { executable: "npm", args: ["run", "build"], cwd: "frontend" },
      ],
      startCommand: {
        executable: "npm",
        args: ["run", "start"],
        cwd: "backend",
      },
      healthPath: "/health",
      buildTimeoutMs: 120_000,
      startTimeoutMs: 30_000,
    },
  };
}

function packet(attempt: 1 | 2 | 3): WorkPacket {
  return {
    id: "packet-req-profile",
    requirementIds: ["REQ-PROFILE"],
    attempt,
    requirements: [
      {
        id: "REQ-PROFILE",
        folderPath: ["ROOT", "PROFILE"],
        declarationIndex: 0,
        name: "Profile",
        text: "Keep a profile name after refresh.",
        dependencyIds: [],
        scenarios: ["Save a profile\nTHEN: The value remains after refresh."],
        references: ["reference/profile.png"],
        exactUiStrings: ["Profile name", "Save"],
      },
    ],
  };
}
