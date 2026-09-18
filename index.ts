import { access, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { PromptBuilder } from "./src/builder/prompt-builder.js";
import { PiWorkerClient } from "./src/builder/pi-worker-client.js";
import { ArcEventSink } from "./src/arc-protocol.js";
import { localDefaultOutputDir, parseCliArgs } from "./src/cli.js";
import { FinalVerifier } from "./src/final-verifier.js";
import { CandidateRuntime } from "./src/candidate-runtime.js";
import { GitCliOps } from "./src/git-ops.js";
import { HumanRunFormatter } from "./src/human-log.js";
import { LlmProbePlanner } from "./src/judge/llm-probe-planner.js";
import { PlaywrightProbeRunner } from "./src/judge/playwright-probe-runner.js";
import {
  runPipeline,
  type PipelineOptions,
  type RunSummary,
} from "./src/pipeline.js";
import type { LogSink } from "./src/run-state.js";
import { sanitizeDiagnosticText } from "./src/diagnostics.js";
import { PROBE_PLAN_JSON_SCHEMA } from "./src/judge/probe-schema.js";
import {
  createArcPlatformContract,
  deriveModelTimeouts,
  parseEvaluationPort,
  parseProbePortOverride,
  parseRunDirOverride,
  pickFreePort,
  readEnvFile,
  resolveSseCaptureDir,
  readGatewayConfig,
  type GatewayConfig,
} from "./src/runtime-config.js";

export interface AgentExecutionContext {
  gateway: GatewayConfig;
  pipelineOptions: PipelineOptions;
  modelTimeouts: {
    builderTimeoutMs: number;
    plannerTimeoutMs: number;
  };
  /** Opt-in raw SSE capture directory for the Pi worker (`SHALLOW_CAPTURE_SSE`). */
  sseCaptureDir?: string | null;
}

export type AgentExecution = (
  context: AgentExecutionContext,
) => Promise<RunSummary>;

export async function main(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  execute: AgentExecution = executeProduction,
  envFile: string | null = ".env",
): Promise<number> {
  const cli = parseCliArgs(argv, { defaultOutputDir: localDefaultOutputDir("main") });
  const mergedEnv = await mergeGatewayEnv(env, envFile);
  const gateway = readGatewayConfig(mergedEnv);
  const requirementsFile = join(cli.requirementsDir, "requirements.yaml");
  try {
    await access(requirementsFile);
  } catch {
    throw new Error(`requirements.yaml is not readable at ${requirementsFile}`);
  }
  await mkdir(cli.outputDir, { recursive: true });
  const runId = `${process.pid}-${Date.now()}`;
  const evaluationPort = parseEvaluationPort(mergedEnv) ?? 3000;
  const probePortOverride = parseProbePortOverride(mergedEnv);
  if (probePortOverride !== null && probePortOverride === evaluationPort) {
    throw new Error(`SHALLOW_PROBE_PORT must differ from the evaluation port ${evaluationPort}`);
  }
  const probePort = probePortOverride ?? (await pickFreePort([evaluationPort]));
  const runDir = parseRunDirOverride(mergedEnv) ?? join(tmpdir(), "shallowcode-runs");
  const sseCaptureDir = resolveSseCaptureDir(mergedEnv, join(runDir, runId, "sse-capture"));
  const pipelineOptions: PipelineOptions = {
    requirementsFile,
    outputDir: cli.outputDir,
    ledgerFile: join(runDir, runId, "run-ledger.jsonl"),
    totalBudgetMs: cli.budgetMs,
    platformContract: createArcPlatformContract(process.platform, probePort, evaluationPort),
  };
  const summary = await execute({
    gateway,
    pipelineOptions,
    modelTimeouts: deriveModelTimeouts(cli.budgetMs),
    sseCaptureDir,
  }).catch((error: unknown) => {
    throw new Error(sanitizeDiagnosticText(error instanceof Error ? error.message : String(error), [gateway.apiKey]));
  });
  return summary.status === "failed" ? 1 : 0;
}

async function mergeGatewayEnv(
  env: Record<string, string | undefined>,
  envFile: string | null,
): Promise<Record<string, string | undefined>> {
  if (!envFile) return env;
  const merged: Record<string, string | undefined> = {
    ...(await readEnvFile(envFile)),
  };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

async function executeProduction(
  context: AgentExecutionContext,
): Promise<RunSummary> {
  const { gateway, pipelineOptions, modelTimeouts, sseCaptureDir } = context;
  const runLogFile = join(dirname(pipelineOptions.ledgerFile), "run-log.txt");
  await assertPrivateRunDirectory(pipelineOptions.outputDir, dirname(runLogFile));
  process.stderr.write(`[ShallowCode] 运行日志文件：${runLogFile}\n`);
  if (sseCaptureDir) process.stderr.write(`[ShallowCode] SSE 抓包已启用（仅诊断用途）：${sseCaptureDir}\n`);
  const candidate = new CandidateRuntime(pipelineOptions.outputDir,
    join(dirname(runLogFile), "candidate"), pipelineOptions.platformContract);
  try {
    const builder = new PromptBuilder(new PiWorkerClient(gateway, join(dirname(runLogFile), "pi-sessions"), sseCaptureDir ?? undefined), {
      timeoutMs: modelTimeouts.builderTimeoutMs,
      requirementsDir: dirname(pipelineOptions.requirementsFile),
    });
    const planner = new LlmProbePlanner({
      ...gateway,
      timeoutMs: modelTimeouts.plannerTimeoutMs,
    });
    const runner = new PlaywrightProbeRunner();
    const lifecycle = candidate;
    const git = await GitCliOps.open(pipelineOptions.outputDir);
    const finalVerifier = new FinalVerifier(runner, lifecycle, candidate);
    const logSink = createRunLogSink(runLogFile);
    const projectionWarning = (error: unknown): void => {
      try { logSink.write(`${JSON.stringify({ at: new Date().toISOString(), type: "arc_projection_failed",
        detail: { message: sanitizeDiagnosticText(String(error), [gateway.apiKey]) } })}\n`); } catch { /* Diagnostic only. */ }
    };
    const arcEvents = new ArcEventSink(pipelineOptions.outputDir, {
      journalFile: join(dirname(runLogFile), "arc-projection.jsonl"),
    });
    await arcEvents.init().catch(projectionWarning);
    const promptDir = new URL("./prompts/", import.meta.url);
    const promptHash = createHash("sha256");
    for (const name of (await readdir(promptDir, { recursive: true })).filter((name) => name.endsWith(".md")).sort()) {
      const path = name.replaceAll("\\", "/");
      promptHash.update(path).update("\0").update((await readFile(new URL(path, promptDir), "utf8")).replace(/\r\n/g, "\n"));
    }
    try {
      return await runPipeline(pipelineOptions, {
        builder,
        planner,
        runner,
        git,
        appLifecycle: lifecycle,
        candidate,
        clock: { nowMs: () => Date.now() },
        finalVerifier,
        arcEvents,
        logSink,
        diagnosticSecrets: [gateway.apiKey],
        runMetadata: { model: gateway.model, ...modelTimeouts,
          promptSha256: promptHash.digest("hex"),
          probeSchemaSha256: createHash("sha256").update(JSON.stringify(PROBE_PLAN_JSON_SCHEMA)).digest("hex"),
        },
      });
    } finally {
      await arcEvents.rebuild().catch(projectionWarning);
    }
  } finally {
    await candidate.close();
  }
}

export async function assertPrivateRunDirectory(outputDir: string, runDir: string): Promise<void> {
  const contained = (candidate: string, controller: string): boolean => {
    const path = relative(candidate, controller);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith("..\\") && !path.startsWith("../"));
  };
  if (contained(resolve(outputDir), resolve(runDir))) throw new Error("Run diagnostics directory must be outside the candidate output directory");
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  if (contained(await realpath(outputDir), await realpath(runDir))) throw new Error("Run diagnostics directory resolves inside the candidate output directory");
}

function createRunLogSink(runLogFile: string): LogSink {
  const runLogDir = dirname(runLogFile);
  const formatter = new HumanRunFormatter();
  return {
    write: (chunk) => {
      process.stderr.write(chunk);
      const line = formatter.format(chunk);
      if (line === null) return;
      mkdirSync(runLogDir, { recursive: true });
      appendFileSync(runLogFile, `${line}\n`, "utf8");
    },
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
}
