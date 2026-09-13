import {
  createOpencodeClient,
  type Config,
  type createOpencode,
  type OpencodeClient,
} from "@opencode-ai/sdk";
import { spawnSync, type ChildProcess } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";

import { spawnProcess } from "../process-spawn.js";
import { pickFreePort, type GatewayConfig } from "../runtime-config.js";

import { compileBuilderPrompt } from "./prompt.js";
import { fillTemplate, loadBuilderPrompt } from "./prompt-assets.js";
import { loadReferenceImages, type ReferenceImage } from "./reference-images.js";
import type { BuilderPort, BuilderRequest, BuilderResult } from "./port.js";
import { ExecutionFault } from "../execution-fault.js";
import { sanitizeDiagnosticText } from "../diagnostics.js";
import { builderSelfTestConfig, SELF_TEST_MCP_NAME, CANDIDATE_MCP_NAME, type BuilderSelfTestOptions } from "./self-test.js";
import type { CandidateRuntime } from "../candidate-runtime.js";
import type { McpRemoteConfig } from "@opencode-ai/sdk";

export interface OpenCodePromptInput {
  systemPrompt: string;
  taskPrompt: string;
  images?: ReferenceImage[];
}

export interface OpenCodeRuntime {
  start(directory: string): Promise<void>;
  createSession(title: string): Promise<string>;
  prompt(sessionId: string, input: OpenCodePromptInput): Promise<string>;
  abort(sessionId: string): Promise<void>;
  close(): Promise<void>;
  serverExit?(): OpenCodeServerExit | undefined;
}

export interface OpenCodeSdkBuilderOptions {
  timeoutMs: number;
  promptSettleTimeoutMs?: number;
  requirementsDir?: string;
  /** Stop the OpenCode server after every Builder call so each run starts from a clean baseline. */
  releaseRuntimeAfterRun?: boolean;
}

interface PreparedBuilderRun {
  title: string;
  baseInput: OpenCodePromptInput;
  input: OpenCodePromptInput;
  referenceImages?: BuilderResult["referenceImages"];
}

type RuntimeConfigPermission = NonNullable<
  CreateOpencodeInstanceOptions["config"]
>["permission"];

// The SDK Config typing predates granular permission rules; the opencode runtime
// schema (https://opencode.ai/config.json) accepts path-scoped read/edit denies.
const BUILDER_TOOL_PERMISSION = {
  read: {
    "**/.arc/**": "deny",
    ".arc/**": "deny",
    "**\\.arc\\**": "deny",
    ".arc\\**": "deny",
  },
  edit: {
    "**/.arc/**": "deny",
    ".arc/**": "deny",
    "**\\.arc\\**": "deny",
    ".arc\\**": "deny",
  },
  bash: { "*.arc*": "deny" },
  external_directory: "deny",
} as const;

const BUILDER_PERMISSION_CONFIG = BUILDER_TOOL_PERMISSION as unknown as RuntimeConfigPermission;

// OpenCode subsystems the Builder never uses (snapshot undo, sharing, update
// checks, plugin extras) still hold state for the server's whole lifetime;
// switch them off so the container budget goes to the model session.
export const OPENCODE_MEMORY_ENV = {
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_EMBEDDED_WEB_UI: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
} as const;

const MEMORY_CONFIG: Pick<
  Config,
  "snapshot" | "autoupdate" | "share" | "formatter" | "lsp" | "watcher"
> = {
  snapshot: false,
  autoupdate: false,
  share: "disabled",
  formatter: false,
  lsp: false,
  watcher: { ignore: ["node_modules/**", "dist/**", ".git/**", ".arc/**"] },
};

class ImageInputUnsupportedError extends Error {}

type CreateOpencodeInstanceOptions = NonNullable<
  Parameters<typeof createOpencode>[0]
> & { fetch: typeof fetch; onServerExit?: (exit: OpenCodeServerExit) => void };

export interface OpenCodeServerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const MAX_SERVER_RESTARTS = 2;

const CGROUP_MEMORY_FILES = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory.current",
  "/sys/fs/cgroup/memory.events",
] as const;

async function cgroupMemorySummary(): Promise<string | undefined> {
  const parts: string[] = [];
  for (const file of CGROUP_MEMORY_FILES) {
    try {
      const value = (await readFile(file, "utf8")).trim().replace(/\s+/g, " ");
      parts.push(`${file.split("/").at(-1)}=${value}`);
    } catch {
      continue;
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export type CreateOpencodeInstance = (
  options: CreateOpencodeInstanceOptions,
) => Promise<{ client: OpencodeClient; server: { url: string; close(): void } }>;

// opencode only answers session.prompt after the whole model session completes,
// so the default 300s undici headers timeout would kill every long build; the
// builder-level timeoutMs race plus the abort path remain the real bound.
const longPollAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export const sdkFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  if (input instanceof globalThis.Request) {
    const method = input.method;
    const hasBody = method !== "GET" && method !== "HEAD" && input.body != null;
    const body = hasBody ? await input.clone().arrayBuffer() : undefined;
    return undiciFetch(input.url, {
      method,
      headers: [...input.headers],
      body,
      signal: input.signal ?? undefined,
      dispatcher: longPollAgent,
    });
  }
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    init as Parameters<typeof undiciFetch>[1],
  );
}) as unknown as typeof fetch;

const SERVER_START_TIMEOUT_MS = 20_000;
const SERVER_STOP_GRACE_MS = 3_000;
const SERVER_TAIL_LINES = 60;

async function createProductionInstance(
  options: CreateOpencodeInstanceOptions,
): Promise<{ client: OpencodeClient; server: { url: string; close(): void } }> {
  const hostname = options.hostname ?? "127.0.0.1";
  const args = ["serve", `--hostname=${hostname}`, `--port=${options.port}`];
  const config = options.config as { logLevel?: string; provider?: Record<string, { options?: { apiKey?: string } }> } | undefined;
  if (config?.logLevel) args.push(`--log-level=${config.logLevel}`);
  const proc = spawnProcess(process.platform === "win32" ? "opencode.cmd" : "opencode", args, {
    env: { ...process.env, ...OPENCODE_MEMORY_ENV, OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}) },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const secrets = config?.provider?.["shallow-gateway"]?.options?.apiKey;
  const tail: string[] = [];
  const capture = (chunk: unknown): void => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim().length > 0) tail.push(line);
    }
    while (tail.length > SERVER_TAIL_LINES) tail.shift();
  };
  proc.stdout?.on("data", capture);
  proc.stderr?.on("data", capture);

  let started = false;
  let stopping = false;
  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (error: Error) => void;
  const urlPromise = new Promise<string>((resolvePromise, reject) => {
    resolveUrl = resolvePromise;
    rejectUrl = reject;
  });
  let startupTimer: NodeJS.Timeout | undefined = setTimeout(() => {
    stopServer(proc);
    rejectUrl(new Error(`Timeout waiting for server to start after ${SERVER_START_TIMEOUT_MS}ms`));
  }, SERVER_START_TIMEOUT_MS);
  proc.once("error", (error) => {
    if (startupTimer) clearTimeout(startupTimer);
    rejectUrl(error);
  });
  proc.once("exit", (code, signal) => {
    if (startupTimer) clearTimeout(startupTimer);
    options.onServerExit?.({ code, signal });
    if (stopping || !started) {
      if (!started) {
        const diagnostics = sanitizeDiagnosticText(tail.join("\n"), secrets ? [secrets] : []);
        rejectUrl(new Error(`Server exited with code ${code} signal ${signal}: ${diagnostics}`));
      }
      return;
    }
    const diagnostics = sanitizeDiagnosticText(tail.join("\n"), secrets ? [secrets] : []);
    void cgroupMemorySummary().then((memory) => {
      process.stderr.write(`[ShallowCode] warning: OpenCode server exited code=${code} signal=${signal}${memory ? ` container[${memory}]` : ""}\n${diagnostics}\n`);
    });
  });
  let output = "";
  proc.stdout?.on("data", (chunk) => {
    if (started) return;
    output += String(chunk);
    for (const line of output.split("\n")) {
      if (!line.startsWith("opencode server listening")) continue;
      const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
      if (!match) {
        stopServer(proc);
        rejectUrl(new Error(`Failed to parse server url from output: ${line}`));
        return;
      }
      started = true;
      if (startupTimer) clearTimeout(startupTimer);
      resolveUrl(match[1]);
      return;
    }
  });

  const url = await urlPromise;
  const client = createOpencodeClient({ baseUrl: url, fetch: options.fetch });
  return { client, server: { url, close() { stopping = true; stopServer(proc); } } };
}

function stopServer(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === "win32" && proc.pid) {
    const result = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    if (!result.error && result.status === 0) return;
  }
  proc.kill();
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
  }, SERVER_STOP_GRACE_MS).unref();
}

async function waitForPromptSettlement(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OpenCodeSdkBuilder implements BuilderPort {
  private startedDirectory?: string;
  private closed = false;
  private imageInputUnsupported = false;

  constructor(
    private readonly runtime: OpenCodeRuntime,
    private readonly options: OpenCodeSdkBuilderOptions,
  ) {}

  async run(request: BuilderRequest): Promise<BuilderResult> {
    if (this.closed) throw new Error("OpenCodeSdkBuilder is closed");
    try {
      await this.ensureStarted(request.outputDir);
    } catch (error) {
      throw new ExecutionFault("builder", "builder_start", false, { cause: error });
    }
    const prepared = await this.prepareRun(request);
    const deadline = Date.now() + this.options.timeoutMs;
    let restarts = 0;
    try {
      for (;;) {
        let result: BuilderResult | undefined;
        let failure: unknown;
        try {
          const remaining = restarts === 0 ? this.options.timeoutMs : Math.max(1_000, deadline - Date.now());
          result = await this.dispatchRun(prepared, remaining);
        } catch (error) {
          failure = error;
        }
        const exit = this.runtime.serverExit?.();
        // The eval container SIGKILLs the OpenCode server mid-prompt; restart and re-issue
        // the same task so an environment kill does not burn a packet attempt.
        if (exit && restarts < MAX_SERVER_RESTARTS && Date.now() < deadline &&
          (failure !== undefined || result?.outcome === "failed")) {
          restarts += 1;
          process.stderr.write(
            `[ShallowCode] warning: OpenCode server was killed (code=${exit.code} signal=${exit.signal}); restarting and re-issuing the Builder task (restart ${restarts}/${MAX_SERVER_RESTARTS})\n`,
          );
          await this.resetRuntime();
          try {
            await this.ensureStarted(request.outputDir);
          } catch (error) {
            throw new ExecutionFault("builder", "builder_start", false, { cause: error });
          }
          continue;
        }
        if (failure !== undefined) throw failure;
        return result!;
      }
    } finally {
      if (this.options.releaseRuntimeAfterRun) await this.resetRuntime();
    }
  }

  private async prepareRun(request: BuilderRequest): Promise<PreparedBuilderRun> {
    const title =
      request.mode === "delivery_repair"
        ? "delivery repair"
        : `${request.packet.id} ${request.mode}`;
    const baseInput = compileBuilderPrompt(request);
    const input: OpenCodePromptInput = { ...baseInput };
    let referenceImages: BuilderResult["referenceImages"];
    if (request.mode !== "delivery_repair") {
      const references = request.packet.requirements.flatMap((item) => item.references);
      if (references.length > 0) {
        const loaded = this.imageInputUnsupported
          ? { images: [], skipped: [] }
          : this.options.requirementsDir
          ? await loadReferenceImages(this.options.requirementsDir, references)
          : { images: [], skipped: references.map((reference) => ({ reference, reason: "requirements_unavailable" })) };
        referenceImages = {
          mode: this.imageInputUnsupported ? "text_fallback" : loaded.images.length > 0 ? "attached" : "unavailable",
          attachedCount: loaded.images.length,
          skipped: loaded.skipped,
        };
        input.images = loaded.images;
        input.taskPrompt += `\n\n${this.imageInputUnsupported
          ? loadBuilderPrompt("system", "reference-images-text-fallback")
          : fillTemplate(loadBuilderPrompt("system", "reference-images"), {
          ATTACHED_REFERENCES: loaded.images.map((item) => item.reference).join("\n") || "无",
          UNAVAILABLE_REFERENCES: loaded.skipped.map((item) => `${item.reference}: ${item.reason}`).join("\n") || "无",
        })}`;
      }
    }
    return { title, baseInput, input, referenceImages };
  }

  private async dispatchRun(prepared: PreparedBuilderRun, timeoutMs: number): Promise<BuilderResult> {
    const { title, baseInput, input } = prepared;
    let sessionId = await this.runtime.createSession(title);
    let cancelled = false;
    const finish = (outcome: BuilderResult["outcome"], summary: string): BuilderResult => ({
      sessionId, outcome, summary, ...(prepared.referenceImages ? { referenceImages: prepared.referenceImages } : {}),
    });
    const promptPromise = (async () => {
      try {
        return await this.runtime.prompt(sessionId, input);
      } catch (error) {
        if (cancelled || !(error instanceof ImageInputUnsupportedError) || !input.images?.length) throw error;
        this.imageInputUnsupported = true;
        const stopped = await waitForPromptSettlement(this.runtime.abort(sessionId), this.options.promptSettleTimeoutMs ?? 5_000);
        if (!stopped) throw new Error("Image fallback session abort timed out");
        if (cancelled) throw error;
        // A rejected attachment stays in the old history. Never retry in that session.
        sessionId = await this.runtime.createSession(title);
        if (cancelled) {
          await this.runtime.abort(sessionId);
          throw error;
        }
        prepared.referenceImages = { ...prepared.referenceImages!, mode: "text_fallback", attachedCount: 0 };
        return this.runtime.prompt(sessionId, {
          systemPrompt: baseInput.systemPrompt,
          taskPrompt: `${baseInput.taskPrompt}\n\n${loadBuilderPrompt("system", "reference-images-text-fallback")}`,
        });
      }
    })();
    let timeout: NodeJS.Timeout | undefined;

    try {
      const result = await Promise.race([
        promptPromise.then((summary) => ({
          kind: "completed" as const,
          summary,
        })),
        new Promise<{ kind: "timed_out" }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: "timed_out" }), timeoutMs);
        }),
      ]);
      if (result.kind === "timed_out") {
        cancelled = true;
        const settleTimeoutMs = this.options.promptSettleTimeoutMs ?? 5_000;
        try {
          if (!await waitForPromptSettlement(this.runtime.abort(sessionId), settleTimeoutMs)) {
            throw new Error("abort timed out");
          }
        } catch {
          await this.resetRuntime();
          return finish("failed", "OpenCode session abort failed");
        }
        const settled = await waitForPromptSettlement(
          promptPromise.then(() => undefined, () => undefined), settleTimeoutMs,
        );
        if (!settled) await this.resetRuntime();
        return finish("timed_out", "OpenCode session timed out");
      }
      return finish("completed", result.summary);
    } catch (error) {
      cancelled = true;
      const summary = formatErrorSummary(error);
      const settleTimeoutMs = this.options.promptSettleTimeoutMs ?? 5_000;
      try {
        if (!await waitForPromptSettlement(this.runtime.abort(sessionId), settleTimeoutMs)) {
          throw new Error("abort timed out");
        }
      } catch {
        await this.resetRuntime();
        if (error instanceof ExecutionFault) throw error;
        return finish("failed", `${summary}; OpenCode session abort failed`);
      }
      if (error instanceof ExecutionFault) throw error;
      return finish("failed", summary);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.runtime.close();
  }

  private async resetRuntime(): Promise<void> {
    await this.runtime.close();
    this.startedDirectory = undefined;
  }

  private async ensureStarted(directory: string): Promise<void> {
    if (this.startedDirectory && this.startedDirectory !== directory) {
      throw new Error("One OpenCodeSdkBuilder cannot switch output directories");
    }
    if (!this.startedDirectory) {
      await this.runtime.start(directory);
      this.startedDirectory = directory;
    }
  }
}

export class SdkOpenCodeRuntime implements OpenCodeRuntime {
  private candidateSession?: { id: string; epoch: number };
  private client?: OpencodeClient;
  private server?: { close(): void };
  private directory?: string;
  private lastServerExit?: OpenCodeServerExit;
  private instanceActive = false;
  private readonly connectedMcps = new WeakSet<OpencodeClient>();
  private readonly abortedSessions = new Set<string>();

  constructor(
    private readonly gateway: GatewayConfig,
    private readonly create: CreateOpencodeInstance = createProductionInstance,
    private readonly selfTest?: BuilderSelfTestOptions,
    private readonly candidateTools?: { runtime: CandidateRuntime; config: McpRemoteConfig },
  ) {}

  async start(directory: string): Promise<void> {
    const model = this.gateway.model;
    this.lastServerExit = undefined;
    this.instanceActive = true;
    const instance = await this.create({
      port: await pickFreePort(),
      fetch: sdkFetch,
      onServerExit: (exit) => { if (this.instanceActive) this.lastServerExit = exit; },
      config: {
        ...(this.selfTest || this.candidateTools ? { mcp: {
          ...(this.selfTest ? { [SELF_TEST_MCP_NAME]: builderSelfTestConfig(this.selfTest) } : {}),
          ...(this.candidateTools ? { [CANDIDATE_MCP_NAME]: this.candidateTools.config } : {}),
        } } : {}),
        model: `shallow-gateway/${model}`,
        small_model: `shallow-gateway/${model}`,
        enabled_providers: ["shallow-gateway"],
        permission: BUILDER_PERMISSION_CONFIG,
        ...MEMORY_CONFIG,
        provider: {
          "shallow-gateway": {
            npm: "@ai-sdk/openai-compatible",
            name: "ShallowCode Gateway",
            options: {
              apiKey: this.gateway.apiKey,
              baseURL: this.gateway.baseUrl,
              timeout: false,
            },
            models: { [model]: {
              id: model, name: model, tool_call: true, attachment: true,
              // Permit forwarding; the gateway may still reject image input.
              modalities: { input: ["text", "image"], output: ["text"] },
            } },
          },
        },
      },
    });
    this.client = instance.client;
    this.server = instance.server;
    this.directory = directory;
  }

  serverExit(): OpenCodeServerExit | undefined {
    return this.lastServerExit;
  }

  async createSession(title: string): Promise<string> {
    const { client, directory } = this.requireStarted();
    const response = await client.session.create({
      body: { title },
      query: { directory },
    });
    if (response.error || !response.data) {
      throw new Error(`OpenCode session creation failed: ${formatSdkError(response.error)}`);
    }
    return response.data.id;
  }

  async prompt(sessionId: string, input: OpenCodePromptInput): Promise<string> {
    const { client, directory } = this.requireStarted();
    const epoch = this.candidateTools?.runtime.beginBuilder();
    if (epoch !== undefined) this.candidateSession = { id: sessionId, epoch };
    try {
      if (this.mcpNames().length > 0) this.connectedMcps.add(client);
      for (const name of this.mcpNames()) {
        try {
          const connected = await client.mcp.connect({ path: { name }, query: { directory }, signal: AbortSignal.timeout(15_000) });
          const status = await client.mcp.status({ query: { directory }, signal: AbortSignal.timeout(5_000) });
          if (connected.error || connected.data !== true || status.error || status.data?.[name]?.status !== "connected") {
            throw new Error(`${name} MCP is not connected`);
          }
        } catch (error) {
          throw new ExecutionFault("builder", "builder_self_test", false, { cause: error });
        }
      }
      if (this.client !== client || this.abortedSessions.has(sessionId)) throw new Error("OpenCode prompt cancelled before dispatch");
      return await this.sendPrompt(client, directory, sessionId, input);
    } catch (error) {
      await this.reportOpencodeLog();
      throw error;
    } finally {
      try { if (epoch !== undefined) await this.candidateTools?.runtime.endBuilder(epoch); }
      finally { if (this.client === client) await this.disconnectSelfTest(client, directory); }
    }
  }

  private async reportOpencodeLog(): Promise<void> {
    if (this.create !== createProductionInstance) return;
    try {
      const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
      const tail = await readOpencodeLogTail(dataHome);
      if (!tail) return;
      process.stderr.write(`[ShallowCode] warning: OpenCode server log tail:\n${sanitizeDiagnosticText(tail, [this.gateway.apiKey], 3_000)}\n`);
    } catch {
      return;
    }
  }

  private mcpNames(): string[] {
    return [...(this.selfTest ? [SELF_TEST_MCP_NAME] : []), ...(this.candidateTools ? [CANDIDATE_MCP_NAME] : [])];
  }

  private async disconnectSelfTest(client: OpencodeClient, directory: string): Promise<void> {
    if (!this.connectedMcps.has(client)) return;
    this.connectedMcps.delete(client);
    const results = await Promise.allSettled(this.mcpNames().map(async (name) => {
      const response = await client.mcp.disconnect({ path: { name }, query: { directory }, signal: AbortSignal.timeout(5_000) });
      if (response.error || response.data !== true) {
        throw new Error(`${name} MCP disconnect failed: ${response.error ? formatSdkError(response.error) : `status ${String(response.data)}`}`);
      }
    }));
    for (const result of results) {
      if (result.status !== "rejected") continue;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      process.stderr.write(`[ShallowCode] warning: builder self-test cleanup failed: ${sanitizeDiagnosticText(message, [this.gateway.apiKey])}\n`);
    }
  }

  private async sendPrompt(client: OpencodeClient, directory: string, sessionId: string, input: OpenCodePromptInput): Promise<string> {
    const response = await client.session.prompt({
      path: { id: sessionId },
      query: { directory },
      body: {
        model: { providerID: "shallow-gateway", modelID: this.gateway.model },
        system: input.systemPrompt,
        parts: [
          { type: "text", text: input.taskPrompt },
          ...(input.images ?? []).map((image) => ({
            type: "file" as const, mime: image.mime, filename: image.reference, url: image.dataUrl,
          })),
        ],
      },
    });
    if (response.error || !response.data) {
      const message = `OpenCode prompt failed: ${formatSdkError(response.error)}`;
      if (input.images?.length && isImageInputUnsupported(message)) throw new ImageInputUnsupportedError(message);
      throw new Error(message);
    }
    if (response.data.info.error) {
      const message = `OpenCode model failed: ${formatSdkError(response.data.info.error)}`;
      // Once tools ran, this is a real Builder attempt, not a rejected input.
      const executed = response.data.parts.some((part) => part.type === "tool" || part.type === "step-finish");
      if (input.images?.length && !executed && isImageInputUnsupported(message)) throw new ImageInputUnsupportedError(message);
      throw new Error(message);
    }
    return response.data.parts
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  async abort(sessionId: string): Promise<void> {
    if (this.selfTest || this.candidateTools) this.abortedSessions.add(sessionId);
    if (this.candidateSession?.id === sessionId) await this.candidateTools?.runtime.endBuilder(this.candidateSession.epoch);
    const { client, directory } = this.requireStarted();
    const response = await client.session.abort({
      path: { id: sessionId },
      query: { directory },
    });
    if (response.error) {
      throw new Error(`OpenCode abort failed: ${formatSdkError(response.error)}`);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    const directory = this.directory;
    // Invalidate pending connects before awaiting cleanup; they must never dispatch a late model call.
    this.client = undefined;
    this.instanceActive = false;
    try {
      if (client && directory) await this.disconnectSelfTest(client, directory);
    } finally {
      try { await this.candidateTools?.runtime.endBuilder(); }
      finally {
        this.server?.close();
        this.server = undefined;
        this.directory = undefined;
        this.abortedSessions.clear();
        this.candidateSession = undefined;
      }
    }
  }

  private requireStarted(): { client: OpencodeClient; directory: string } {
    if (!this.client || !this.directory) throw new Error("OpenCode runtime is not started");
    return { client: this.client, directory: this.directory };
  }
}

export async function readOpencodeLogTail(dataHome: string, maxBytes = 65_536): Promise<string | undefined> {
  const logDir = join(dataHome, "opencode", "log");
  let names: string[];
  try {
    names = (await readdir(logDir)).filter((name) => name.endsWith(".log"));
  } catch {
    return undefined;
  }
  let newest: { path: string; mtimeMs: number } | undefined;
  for (const name of names) {
    try {
      const info = await stat(join(logDir, name));
      if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path: join(logDir, name), mtimeMs: info.mtimeMs };
    } catch {
      continue;
    }
  }
  if (!newest) return undefined;
  try {
    const info = await stat(newest.path);
    const length = Math.min(info.size, maxBytes);
    const handle = await open(newest.path, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, info.size - length);
      const lines = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
      const errors = lines.filter((line) => line.includes("level=ERROR"));
      return (errors.length > 0 ? errors : lines).slice(-8).join("\n") || undefined;
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function formatSdkError(error: unknown): string {
  if (error === undefined) return "missing response data";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isImageInputUnsupported(message: string): boolean {
  return /(?:does not support|do not support|doesn't support|cannot (?:accept|process))\s+(?:(?:the|this|any|input|inline|base64)\s+){0,3}(?:images?|image_url|vision|multimodal)\b/i.test(message)
    || /(?:images?(?:_url)?(?:\s+(?:input|content|messages?))?|vision|multimodal)\s+(?:(?:is|are)\s+)?(?:not supported|unsupported|only supported)\b/i.test(message)
    || /unsupported\s+(?:(?:content|input|media)\s+type[:\s"']*)?(?:images?|image_url|vision|multimodal)\b/i.test(message)
    || /不支持.{0,8}(?:图片|图像|视觉|多模态)/.test(message);
}

function formatErrorSummary(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  if (typeof current === "string" && current) parts.push(current);
  const unique = [...new Set(parts.filter((part) => part.length > 0))];
  return unique.join("; ") || String(error);
}
