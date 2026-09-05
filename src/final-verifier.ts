import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

import type { AppLifecycle } from "./pipeline.js";
import { spawnProcess } from "./process-spawn.js";
import { PlaywrightProbeRunner } from "./judge/playwright-probe-runner.js";
import type { PlatformContract, ProcessCommand } from "./types.js";

export interface FinalVerificationReport {
  ok: boolean;
  stage: "install" | "build" | "readiness" | "browser" | "complete";
  message: string;
}

export interface FinalVerifierPort {
  verify(outputDir: string, contract: PlatformContract): Promise<FinalVerificationReport>;
}

export class FinalVerifier implements FinalVerifierPort {
  constructor(
    private readonly runner: Pick<PlaywrightProbeRunner, "run"> = new PlaywrightProbeRunner(),
    private readonly lifecycle: AppLifecycle = new CommandAppLifecycle(),
  ) {}

  async verify(
    outputDir: string,
    contract: PlatformContract,
  ): Promise<FinalVerificationReport> {
    try {
      for (const command of contract.installCommands) {
        await runCommand(outputDir, command, contract.buildTimeoutMs);
      }
    } catch (error) {
      return { ok: false, stage: "install", message: compactError(error) };
    }

    try {
      for (const command of contract.buildCommands) {
        await runCommand(outputDir, command, contract.buildTimeoutMs);
      }
    } catch (error) {
      return { ok: false, stage: "build", message: compactError(error) };
    }

    let application: Awaited<ReturnType<AppLifecycle["start"]>>;
    try {
      application = await this.lifecycle.start(outputDir, contract);
    } catch (error) {
      return { ok: false, stage: "readiness", message: compactError(error) };
    }

    try {
      const report = await this.runner.run(
        {
          packetId: "final-verification",
          cases: [
            {
              id: "root-page",
              requirementIds: ["delivery"],
              purpose: "happy_path",
              steps: [
                { op: "goto", path: "/" },
                {
                  op: "expectVisible",
                  locator: { by: "role", role: "main" },
                },
              ],
            },
          ],
        },
        {
          baseUrl: application.baseUrl,
          stepTimeoutMs: contract.startTimeoutMs,
          caseTimeoutMs: contract.startTimeoutMs,
        },
      );
      if (report.verdict !== "pass") {
        return {
          ok: false,
          stage: "browser",
          message: report.failures.map((failure) => failure.message).join("; "),
        };
      }
      return { ok: true, stage: "complete", message: "Final verification passed" };
    } finally {
      await application.stop();
    }
  }
}

export class CommandAppLifecycle implements AppLifecycle {
  async start(outputDir: string, contract: PlatformContract) {
    const child = spawnCommand(outputDir, contract.startCommand, {
      ...process.env,
      PORT: String(contract.port),
    });
    let spawnError: Error | undefined;
    let stderr = "";
    child.on("error", (error) => { spawnError = error; });
    // Drain both pipes: a verbose server can otherwise block before readiness.
    child.stdout?.resume();
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8_000); });
    try {
      await waitForReadiness(
        `${contract.baseUrl}${contract.healthPath}`,
        contract.startTimeoutMs,
        () => spawnError?.message ?? (child.exitCode !== null || child.signalCode !== null
          ? `Application exited before readiness: ${stderr || child.exitCode || child.signalCode}`
          : undefined),
      );
    } catch (error) {
      await stopProcess(child);
      throw error;
    }
    return {
      baseUrl: contract.baseUrl,
      stop: () => stopProcess(child),
    };
  }
}

async function runCommand(
  outputDir: string,
  command: ProcessCommand,
  timeoutMs: number,
): Promise<void> {
  const child = spawnCommand(outputDir, command, process.env);
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout = (stdout + chunk).slice(-8_000);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_000);
  });

  let timeout: NodeJS.Timeout | undefined;
  let result: { kind: "exit"; code: number } | { kind: "timeout" };
  try {
    result = await Promise.race([
      new Promise<{ kind: "exit"; code: number }>((resolvePromise, reject) => {
        child.once("error", reject);
        child.once("close", (code) =>
          resolvePromise({ kind: "exit", code: code ?? -1 }),
        );
      }),
      new Promise<{ kind: "timeout" }>((resolvePromise) => {
        timeout = setTimeout(() => resolvePromise({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (result.kind === "timeout") {
    await stopProcess(child);
    throw new Error(`${renderCommand(command)} timed out after ${timeoutMs}ms`);
  }
  if (result.code !== 0) {
    throw new Error(
      `${renderCommand(command)} exited ${result.code}: ${stderr.trim() || stdout.trim()}`,
    );
  }
}

function spawnCommand(
  outputDir: string,
  command: ProcessCommand,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawnProcess(command.executable, command.args, {
    cwd: commandCwd(outputDir, command.cwd),
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commandCwd(
  outputDir: string,
  cwd: ProcessCommand["cwd"],
): string {
  if (cwd === "output") return resolve(outputDir);
  return resolve(outputDir, cwd);
}

async function waitForReadiness(
  url: string,
  timeoutMs: number,
  failure: () => string | undefined,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = failure();
    if (message) throw new Error(message);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok && !failure()) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Application did not become ready at ${url}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolvePromise());
      killer.once("close", () => resolvePromise());
    });
  } else {
    signalProcessGroup(child.pid, "SIGTERM");
  }
  let timer: NodeJS.Timeout | undefined;
  let onExit: () => void = () => {};
  try {
    await Promise.race([
      new Promise<void>((resolvePromise) => {
        onExit = resolvePromise;
        if (child.exitCode !== null || child.signalCode !== null) resolvePromise();
        else child.once("exit", onExit);
      }),
      new Promise<void>((resolvePromise) => { timer = setTimeout(resolvePromise, 2_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    child.off("exit", onExit);
  }
  if (process.platform !== "win32") signalProcessGroup(child.pid, "SIGKILL");
  else if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function renderCommand(command: ProcessCommand): string {
  return [command.executable, ...command.args].join(" ");
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 1_500);
}
