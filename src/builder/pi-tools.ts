import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createBashToolDefinition, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { toolEnvironment } from "../process-lifecycle.js";

export async function assertToolPath(root: string, input: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const path = resolve(canonicalRoot, input);
  const contained = (value: string) => {
    const rel = relative(canonicalRoot, value);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel.split(/[\\/]/).some(part => part.toLowerCase() === ".arc")) {
      throw new Error("Tool path is outside the application or accesses private .arc evidence");
    }
  };
  contained(path);
  let parent = path;
  while (true) {
    try { contained(await realpath(parent)); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  return path;
}

export function assertToolCommand(command: string): void {
  // Defense in depth, not an OS sandbox. Deployment controls filesystem visibility.
  if (/\.arc|run-ledger|run-log|\/workspace\/tests|\.codex|\.pi[\\/]|(?:^|[\s"'])\.\.[\\/]/i.test(command)) {
    throw new Error("Command accesses controller/private or external paths");
  }
}

export function createPiTools(cwd: string): ToolDefinition[] {
  const files = [createReadToolDefinition(cwd), createEditToolDefinition(cwd), createWriteToolDefinition(cwd)] as unknown as ToolDefinition[];
  const guarded = files.map(tool => ({ ...tool, execute: async (...args: Parameters<typeof tool.execute>) => {
    const params = args[1] as { path: string };
    await assertToolPath(cwd, params.path);
    return (tool.execute as ToolDefinition["execute"])(args[0], args[1], args[2], args[3], args[4]);
  } })) as ToolDefinition[];
  const shell = createBashToolDefinition(cwd, { operations: {
    exec: async (command, directory, { onData, signal, timeout }) => {
      assertToolCommand(command);
      await assertToolPath(cwd, directory);
      signal?.throwIfAborted();
      const windows = process.platform === "win32";
      const child = spawn(windows ? "powershell.exe" : "/bin/bash",
        windows ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] : ["--noprofile", "--norc", "-c", command],
        { cwd: directory, env: toolEnvironment(), windowsHide: true, detached: false, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", onData); child.stderr.on("data", onData);
      let timer: NodeJS.Timeout | undefined;
      const abort = () => child.kill();
      signal?.addEventListener("abort", abort, { once: true });
      let timedOut = false;
      if (timeout && timeout > 0) timer = setTimeout(() => { timedOut = true; abort(); }, timeout * 1000);
      try {
        const exitCode = await new Promise<number | null>((res, rej) => { child.once("error", rej); child.once("exit", res); });
        signal?.throwIfAborted();
        if (timedOut) throw new Error("Command timed out");
        return { exitCode };
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        child.stdout.destroy(); child.stderr.destroy();
      }
    },
  } });
  // Retain the SDK schema and output truncation, replace only the execution backend.
  shell.name = "shell";
  shell.description = `Run a short ${process.platform === "win32" ? "PowerShell" : "Bash"} command in the application. Use this for file searches and targeted tests. Do not start persistent servers.`;
  return [...guarded, shell as unknown as ToolDefinition];
}
