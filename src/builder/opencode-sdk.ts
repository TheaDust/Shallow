import {
  createOpencodeClient,
  createOpencodeServer,
  type createOpencode,
  type OpencodeClient,
} from "@opencode-ai/sdk";
import { Agent, fetch as undiciFetch } from "undici";
import { pickFreePort, type GatewayConfig } from "../runtime-config.js";

import { compileBuilderPrompt } from "./prompt.js";
import { fillTemplate, loadBuilderPrompt } from "./prompt-assets.js";
import { loadReferenceImages, type ReferenceImage } from "./reference-images.js";
import type { BuilderPort, BuilderRequest, BuilderResult } from "./port.js";
import { ExecutionFault } from "../execution-fault.js";
import { builderSelfTestConfig, SELF_TEST_MCP_NAME, type BuilderSelfTestOptions } from "./self-test.js";

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
}

export interface OpenCodeSdkBuilderOptions {
  timeoutMs: number;
  promptSettleTimeoutMs?: number;
  requirementsDir?: string;
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

class ImageInputUnsupportedError extends Error {}

type CreateOpencodeInstanceOptions = NonNullable<
  Parameters<typeof createOpencode>[0]
> & { fetch: typeof fetch };

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

async function createProductionInstance(
  options: CreateOpencodeInstanceOptions,
): Promise<{ client: OpencodeClient; server: { url: string; close(): void } }> {
  const server = await createOpencodeServer({
    port: options.port,
    config: options.config,
    timeout: 5_000,
  });
  const client = createOpencodeClient({
    baseUrl: server.url,
    fetch: options.fetch,
  });
  return { client, server };
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
    let sessionId = await this.runtime.createSession(title);
    let cancelled = false;
    const finish = (outcome: BuilderResult["outcome"], summary: string): BuilderResult => ({
      sessionId, outcome, summary, ...(referenceImages ? { referenceImages } : {}),
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
        referenceImages = { ...referenceImages!, mode: "text_fallback", attachedCount: 0 };
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
          timeout = setTimeout(() => resolve({ kind: "timed_out" }), this.options.timeoutMs);
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
  private client?: OpencodeClient;
  private server?: { close(): void };
  private directory?: string;
  private readonly abortedSessions = new Set<string>();

  constructor(
    private readonly gateway: GatewayConfig,
    private readonly create: CreateOpencodeInstance = createProductionInstance,
    private readonly selfTest?: BuilderSelfTestOptions,
  ) {}

  async start(directory: string): Promise<void> {
    const model = this.gateway.model;
    const instance = await this.create({
      port: await pickFreePort(),
      fetch: sdkFetch,
      config: {
        ...(this.selfTest ? { mcp: { [SELF_TEST_MCP_NAME]: builderSelfTestConfig(this.selfTest) } } : {}),
        model: `shallow-gateway/${model}`,
        small_model: `shallow-gateway/${model}`,
        enabled_providers: ["shallow-gateway"],
        permission: BUILDER_PERMISSION_CONFIG,
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
    try {
      if (this.selfTest) {
        try {
          const connected = await client.mcp.connect({ path: { name: SELF_TEST_MCP_NAME }, query: { directory }, signal: AbortSignal.timeout(15_000) });
          const status = await client.mcp.status({ query: { directory }, signal: AbortSignal.timeout(5_000) });
          if (connected.error || connected.data !== true || status.error || status.data?.[SELF_TEST_MCP_NAME]?.status !== "connected") {
            throw new Error("Playwright MCP is not connected");
          }
        } catch (error) {
          throw new ExecutionFault("builder", "builder_self_test", false, { cause: error });
        }
      }
      if (this.client !== client || this.abortedSessions.has(sessionId)) throw new Error("OpenCode prompt cancelled before dispatch");
      return await this.sendPrompt(client, directory, sessionId, input);
    } finally {
      if (this.selfTest && this.client === client) await this.disconnectSelfTest(client, directory);
    }
  }

  private async disconnectSelfTest(client: OpencodeClient, directory: string): Promise<void> {
    try {
      const response = await client.mcp.disconnect({ path: { name: SELF_TEST_MCP_NAME }, query: { directory }, signal: AbortSignal.timeout(5_000) });
      if (response.error || response.data !== true) throw new Error("MCP disconnect failed");
    } catch (error) {
      throw new ExecutionFault("builder", "builder_self_test", false, { cause: error });
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
    if (this.selfTest) this.abortedSessions.add(sessionId);
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
    try {
      if (this.selfTest && client && directory) await this.disconnectSelfTest(client, directory);
    } finally {
      this.server?.close();
      this.server = undefined;
      this.directory = undefined;
      this.abortedSessions.clear();
    }
  }

  private requireStarted(): { client: OpencodeClient; directory: string } {
    if (!this.client || !this.directory) throw new Error("OpenCode runtime is not started");
    return { client: this.client, directory: this.directory };
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
