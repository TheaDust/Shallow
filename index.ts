import { access, mkdir } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  OpenCodeSdkBuilder,
  SdkOpenCodeRuntime,
} from "./src/builder/opencode-sdk.js";
import { ArcEventSink } from "./src/arc-protocol.js";
import { parseCliArgs } from "./src/cli.js";
import { CommandAppLifecycle, FinalVerifier } from "./src/final-verifier.js";
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
  const cli = parseCliArgs(argv);
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
  process.stderr.write(`[ShallowCode] 运行日志文件：${runLogFile}\n`);
  const runtime = new SdkOpenCodeRuntime(gateway);
  const builder = new OpenCodeSdkBuilder(runtime, {
    timeoutMs: modelTimeouts.builderTimeoutMs,
    requirementsDir: dirname(pipelineOptions.requirementsFile),
  });
  const planner = new LlmProbePlanner({
    ...gateway,
    timeoutMs: modelTimeouts.plannerTimeoutMs,
  });
  const runner = new PlaywrightProbeRunner();
  const lifecycle = new CommandAppLifecycle();
  const git = await GitCliOps.open(pipelineOptions.outputDir);
  const finalVerifier = new FinalVerifier(runner, lifecycle);
  const arcEvents = new ArcEventSink(pipelineOptions.outputDir);
  await arcEvents.init();
  return runPipeline(pipelineOptions, {
    builder,
    planner,
    runner,
    git,
    appLifecycle: lifecycle,
    clock: { nowMs: () => Date.now() },
    finalVerifier,
    arcEvents,
    logSink: createRunLogSink(runLogFile),
  });
}

function createRunLogSink(runLogFile: string): LogSink {
  const runLogDir = dirname(runLogFile);
  mkdirSync(runLogDir, { recursive: true });
  const formatter = new HumanRunFormatter();
  return {
    write: (chunk) => {
      process.stderr.write(chunk);
      const line = formatter.format(chunk);
      if (line === null) return;
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
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
