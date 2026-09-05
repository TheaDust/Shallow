import { access, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import { SdkOpenCodeRuntime } from "../src/builder/opencode-sdk.js";
import type { OpenCodePromptInput } from "../src/builder/opencode-sdk.js";
import { ArcEventSink } from "../src/arc-protocol.js";
import { parseCliArgs } from "../src/cli.js";
import {
  deriveModelTimeouts,
  readEnvFile,
  readGatewayConfig,
  type GatewayConfig,
} from "../src/runtime-config.js";

export interface RootModule {
  index: number;
  total: number;
  id: string;
  name: string;
  subtree: Record<string, unknown>;
}

export async function baselineMain(
  argv: string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  envFile: string | null = resolve(fileURLToPath(new URL("../.env", import.meta.url))),
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

  const modules = loadRootModules(parse(await readFile(requirementsFile, "utf8")));
  const systemPrompt = (
    await readFile(
      fileURLToPath(new URL("./system.md", import.meta.url)),
      "utf8",
    )
  ).replace(/\r\n/g, "\n");

  const startedAt = Date.now();
  const perPromptTimeoutMs = deriveModelTimeouts(cli.budgetMs).builderTimeoutMs;
  const runtime = new SdkOpenCodeRuntime(gateway);
  const arcEvents = new ArcEventSink(cli.outputDir);
  await arcEvents.init();
  await arcEvents.runnerState("running", "baseline started");
  const completed: string[] = [];
  const failed: string[] = [];

  try {
    await runtime.start(cli.outputDir);
    const sessionId = await runtime.createSession("baseline");
    log(`模型 ${gateway.model}，共 ${modules.length} 个 ROOT 子树，单次调用上限 ${Math.round(perPromptTimeoutMs / 1000)}s`);
    for (const module of modules) {
      if (cli.budgetMs > 0 && Date.now() - startedAt >= cli.budgetMs) {
        log(`预算耗尽，跳过剩余模块：${modules.slice(module.index - 1).map((m) => m.id).join(", ")}`);
        break;
      }
      log(`实现 ${module.index}/${module.total}：${module.id} - ${module.name}`);
      await arcEvents.requirementState(module.id, "implement", "running");
      const outcome = await promptWithTimeout(
        runtime,
        sessionId,
        { systemPrompt, taskPrompt: modulePrompt(module, cli.requirementsDir, completed) },
        perPromptTimeoutMs,
      );
      if (outcome === "completed") {
        completed.push(module.id);
        await arcEvents.requirementState(module.id, "implement", "completed");
      } else {
        failed.push(module.id);
        await arcEvents.requirementState(module.id, "implement", "failed");
      }
      log(`模块 ${module.id} ${outcome === "completed" ? "完成" : "失败或超时"}`);
    }
    await arcEvents.runnerState(
      "completed",
      `baseline completed: ${completed.length}/${modules.length} modules`,
    );
  } catch (error) {
    await arcEvents
      .runnerState("failed", formatError(error))
      .catch(() => {});
    throw error;
  } finally {
    await runtime.close();
  }

  log(
    `结束：完成 ${completed.length}/${modules.length}，失败 ${failed.length}${
      failed.length > 0 ? `（${failed.join(", ")}）` : ""
    }，耗时 ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
  return 0;
}

type PromptOutcome = "completed" | "timed_out" | "failed";

async function promptWithTimeout(
  runtime: SdkOpenCodeRuntime,
  sessionId: string,
  input: OpenCodePromptInput,
  timeoutMs: number,
): Promise<PromptOutcome> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const promptPromise = runtime.prompt(sessionId, input);
    const outcome = await Promise.race([
      promptPromise.then(
        () => "completed" as const,
        (error: unknown) => {
          log(`OpenCode 调用失败：${formatError(error)}`);
          return "failed" as const;
        },
      ),
      new Promise<"timed_out">((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout("timed_out"), timeoutMs);
      }),
    ]);
    if (outcome === "timed_out") {
      try {
        await runtime.abort(sessionId);
      } catch (error) {
        log(`abort 失败：${formatError(error)}`);
      }
    }
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function loadRootModules(document: unknown): RootModule[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("requirements.yaml must contain a ROOT mapping");
  }
  const root = document as Record<string, unknown>;
  if (String(root.id ?? "").trim() !== "ROOT") {
    throw new Error("requirements.yaml must contain a ROOT mapping");
  }
  const children = Array.isArray(root.children) ? root.children : [];
  const subtrees = children.filter(
    (child): child is Record<string, unknown> =>
      Boolean(child) && typeof child === "object" && !Array.isArray(child),
  );
  if (subtrees.length === 0) {
    throw new Error("ROOT must contain at least one child module");
  }
  return subtrees.map((subtree, position) => {
    const id = String(subtree.id ?? subtree.req_id ?? "").trim();
    if (!id) throw new Error(`ROOT child ${position + 1} has no id`);
    return {
      index: position + 1,
      total: subtrees.length,
      id,
      name: String(subtree.name ?? id).trim(),
      subtree,
    };
  });
}

function modulePrompt(
  module: RootModule,
  requirementsDir: string,
  completedIds: string[],
): string {
  const completed = completedIds.length > 0 ? completedIds.join(", ") : "none";
  return [
    `实现 ROOT 模块 ${module.index}/${module.total}：${module.id} - ${module.name}`,
    "",
    `需求源目录：${requirementsDir}`,
    `已完成的 ROOT 模块：${completed}`,
    "",
    "在当前目标目录完整实现以下子树（含全部后代）：",
    "```json",
    JSON.stringify(module.subtree, null, 2),
    "```",
    "",
    "结束时总结本次改动的文件。不要启动长期运行的服务器。",
  ].join("\n");
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

function log(message: string): void {
  process.stderr.write(`[baseline] ${message}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  baselineMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      log(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
