import { access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  OpenCodeSdkBuilder,
  SdkOpenCodeRuntime,
} from "./src/builder/opencode-sdk.js";
import { parseCliArgs } from "./src/cli.js";
import { CommandAppLifecycle, FinalVerifier } from "./src/final-verifier.js";
import { GitCliOps } from "./src/git-ops.js";
import { LlmProbePlanner } from "./src/judge/llm-probe-planner.js";
import { PlaywrightProbeRunner } from "./src/judge/playwright-probe-runner.js";
import {
  runPipeline,
  type PipelineOptions,
  type RunSummary,
} from "./src/pipeline.js";
import {
  createArcPlatformContract,
  deriveModelTimeouts,
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
  const gateway = readGatewayConfig(await mergeGatewayEnv(env, envFile));
  const requirementsFile = join(cli.requirementsDir, "requirements.yaml");
  try {
    await access(requirementsFile);
  } catch {
    throw new Error(`requirements.yaml is not readable at ${requirementsFile}`);
  }
  await mkdir(cli.outputDir, { recursive: true });
  const runId = `${process.pid}-${Date.now()}`;
  const pipelineOptions: PipelineOptions = {
    requirementsFile,
    outputDir: cli.outputDir,
    ledgerFile: join(tmpdir(), "shallowcode-runs", runId, "run-ledger.jsonl"),
    totalBudgetMs: cli.budgetMs,
    platformContract: createArcPlatformContract(),
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
  const runtime = new SdkOpenCodeRuntime(gateway.model);
  const builder = new OpenCodeSdkBuilder(runtime, {
    timeoutMs: modelTimeouts.builderTimeoutMs,
  });
  const planner = new LlmProbePlanner({
    ...gateway,
    timeoutMs: modelTimeouts.plannerTimeoutMs,
  });
  const runner = new PlaywrightProbeRunner();
  const lifecycle = new CommandAppLifecycle();
  const git = await GitCliOps.open(pipelineOptions.outputDir);
  const finalVerifier = new FinalVerifier(runner, lifecycle);
  return runPipeline(pipelineOptions, {
    builder,
    planner,
    runner,
    git,
    appLifecycle: lifecycle,
    clock: { nowMs: () => Date.now() },
    finalVerifier,
  });
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
