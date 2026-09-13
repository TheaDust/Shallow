import { access, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  OpenCodeSdkBuilder,
  SdkOpenCodeRuntime,
} from "./src/builder/opencode-sdk.js";
import { ArcEventSink } from "./src/arc-protocol.js";
import { localDefaultOutputDir, parseCliArgs } from "./src/cli.js";
import { FinalVerifier } from "./src/final-verifier.js";
import { CandidateRuntime } from "./src/candidate-runtime.js";
import { startCandidateMcp } from "./src/builder/candidate-mcp.js";
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
  parseProbePortOverride,
  parseRunDirOverride,
  pickFreePort,
  readEnvFile,
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
  const probePort = parseProbePortOverride(mergedEnv) ?? (await pickFreePort());
  const runDir = parseRunDirOverride(mergedEnv) ?? join(tmpdir(), "shallowcode-runs");
  const pipelineOptions: PipelineOptions = {
    requirementsFile,
    outputDir: cli.outputDir,
    ledgerFile: join(runDir, runId, "run-ledger.jsonl"),
    totalBudgetMs: cli.budgetMs,
    platformContract: createArcPlatformContract(process.platform, probePort),
  };
  const summary = await execute({
    gateway,
    pipelineOptions,
    modelTimeouts: deriveModelTimeouts(cli.budgetMs),
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
  const { gateway, pipelineOptions, modelTimeouts } = context;
  const runLogFile = join(dirname(pipelineOptions.ledgerFile), "run-log.txt");
  await assertPrivateRunDirectory(pipelineOptions.outputDir, dirname(runLogFile));
  process.stderr.write(`[ShallowCode] 运行日志文件：${runLogFile}\n`);
  const candidate = new CandidateRuntime(pipelineOptions.outputDir,
    join(dirname(runLogFile), "candidate"), pipelineOptions.platformContract);
  const candidateMcp = await startCandidateMcp(candidate, [gateway.apiKey]);
  try {
    const runtime = new SdkOpenCodeRuntime(gateway, undefined, {
      baseUrl: pipelineOptions.platformContract.baseUrl,
      artifactsDir: join(dirname(pipelineOptions.ledgerFile), "builder-self-test"),
    }, { runtime: candidate, config: candidateMcp.config });
    const builder = new OpenCodeSdkBuilder(runtime, {
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
          usage: { status: "unavailable" },
        },
      });
    } finally {
      await arcEvents.rebuild().catch(projectionWarning);
    }
  } finally {
    await candidateMcp.close();
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
