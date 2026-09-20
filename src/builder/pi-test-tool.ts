import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { toolEnvironment } from "../process-lifecycle.js";

const FRONTEND_TIMEOUT_MS = 600_000;
const BACKEND_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 30_000;

const parameters = Type.Object({
  target: Type.Union([Type.Literal("frontend"), Type.Literal("backend"), Type.Literal("all")], {
    description: "Which application test suite to run: frontend Vitest, backend node:test, or both in sequence",
  }),
  filter: Type.Optional(Type.String({
    description: "Optional single test-file name or substring pattern; run only matching tests",
  })),
});

export interface TestToolOptions {
  spawnFn?: typeof spawn;
  frontendTimeoutMs?: number;
  backendTimeoutMs?: number;
}

interface SuiteResult {
  target: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  output: string;
}

/**
 * Bounded-memory test runner for the Builder: tests run single-worker so the
 * suite's peak RSS stays small inside the evaluation cgroup. Spawning uses the
 * current Node executable and the project's own Vitest entry, so no npm shim
 * processes or watch modes are involved.
 */
export function createTestTool(cwd: string, options: TestToolOptions = {}): ToolDefinition<typeof parameters> {
  const spawnFn = options.spawnFn ?? spawn;
  const timeouts = { frontend: options.frontendTimeoutMs ?? FRONTEND_TIMEOUT_MS, backend: options.backendTimeoutMs ?? BACKEND_TIMEOUT_MS };
  return {
    name: "run_tests",
    label: "Run tests (bounded memory)",
    description:
      "Run the application's traditional tests with bounded memory (single worker, no watch mode). " +
      "frontend runs the Vitest suite in frontend/, backend runs node:test in backend/, all runs both in sequence. " +
      "Pass filter to run only one test file/pattern. Returns exit code, duration and the output tail (failures print at the end).",
    promptSnippet: "run_tests: bounded-memory test runner (frontend/backend/all, single worker)",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const targets = params.target === "all" ? (["frontend", "backend"] as const) : ([params.target] as const);
      const results: SuiteResult[] = [];
      for (const target of targets) {
        results.push(await runSuite(spawnFn, cwd, target, timeouts[target], params.filter, signal));
      }
      return {
        content: [{ type: "text" as const, text: results.map(formatResult).join("\n\n") }],
        details: {
          results: results.map(result => ({ target: result.target, command: result.command,
            exitCode: result.exitCode, durationMs: result.durationMs, timedOut: result.timedOut })),
        },
      };
    },
  };
}

async function runSuite(spawnFn: typeof spawn, cwd: string, target: "frontend" | "backend", timeoutMs: number,
  filter: string | undefined, signal: AbortSignal | undefined): Promise<SuiteResult> {
  const directory = join(cwd, target);
  let file: string;
  let args: string[];
  let command: string;
  if (target === "frontend") {
    const vitestEntry = join(directory, "node_modules", "vitest", "vitest.mjs");
    await access(vitestEntry).catch(() => {
      throw new Error("frontend Vitest is not installed (frontend/node_modules/vitest missing); run the platform install command first, then retry run_tests");
    });
    file = process.execPath;
    args = [vitestEntry, "run", "--maxWorkers=1", ...(filter ? [filter] : [])];
    command = `vitest run --maxWorkers=1${filter ? ` ${filter}` : ""}`;
  } else {
    await access(directory).catch(() => {
      throw new Error("backend/ directory does not exist yet; create the backend before running backend tests");
    });
    file = process.execPath;
    args = ["--test", "--test-concurrency=1", ...(filter ? [filter] : [])];
    command = `node --test --test-concurrency=1${filter ? ` ${filter}` : ""}`;
  }
  const started = Date.now();
  const child = spawnFn(file, args, { cwd: directory, env: { ...toolEnvironment(), CI: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let truncated = false;
  const onData = (chunk: Buffer | string) => {
    output += chunk.toString();
    if (output.length > MAX_OUTPUT_CHARS) { output = output.slice(-MAX_OUTPUT_CHARS); truncated = true; }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  let timedOut = false;
  const abort = () => { child.kill(); };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  try {
    const exitCode = await new Promise<number | null>((resolvePromise, reject) => { child.once("error", reject); child.once("exit", resolvePromise); });
    signal?.throwIfAborted();
    return { target, command, exitCode, durationMs: Date.now() - started, timedOut,
      output: (truncated ? `[output truncated to the last ${MAX_OUTPUT_CHARS} characters]\n` : "") + output.trim() };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

function formatResult(result: SuiteResult): string {
  const outcome = result.timedOut ? "timed out" : `exit code ${result.exitCode ?? "unknown"}`;
  return `[${result.target}] ${result.command}\n${outcome}, duration ${(result.durationMs / 1_000).toFixed(1)}s\n${result.output || "(no output)"}`;
}
