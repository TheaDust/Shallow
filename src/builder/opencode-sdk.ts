import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import { pickFreePort, type GatewayConfig } from "../runtime-config.js";

import { compileBuilderPrompt } from "./prompt.js";
import type { BuilderPort, BuilderRequest, BuilderResult } from "./port.js";

export interface OpenCodePromptInput {
  systemPrompt: string;
  taskPrompt: string;
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

  constructor(
    private readonly runtime: OpenCodeRuntime,
    private readonly options: OpenCodeSdkBuilderOptions,
  ) {}

  async run(request: BuilderRequest): Promise<BuilderResult> {
    if (this.closed) throw new Error("OpenCodeSdkBuilder is closed");
    await this.ensureStarted(request.outputDir);
    const title =
      request.mode === "delivery_repair"
        ? "delivery repair"
        : `${request.packet.id} ${request.mode}`;
    const sessionId = await this.runtime.createSession(title);
    const input = compileBuilderPrompt(request);
    const promptPromise = this.runtime.prompt(sessionId, input);
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
        const settleTimeoutMs = this.options.promptSettleTimeoutMs ?? 5_000;
        try {
          if (!await waitForPromptSettlement(this.runtime.abort(sessionId), settleTimeoutMs)) {
            throw new Error("abort timed out");
          }
        } catch {
          await this.resetRuntime();
          return { sessionId, outcome: "failed", summary: "OpenCode session abort failed" };
        }
        const settled = await waitForPromptSettlement(
          promptPromise.then(() => undefined, () => undefined), settleTimeoutMs,
        );
        if (!settled) await this.resetRuntime();
        return { sessionId, outcome: "timed_out", summary: "OpenCode session timed out" };
      }
      return { sessionId, outcome: "completed", summary: result.summary };
    } catch (error) {
      return {
        sessionId,
        outcome: "failed",
        summary: error instanceof Error ? error.message : String(error),
      };
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

  constructor(
    private readonly gateway: GatewayConfig,
    private readonly create: typeof createOpencode = createOpencode,
  ) {}

  async start(directory: string): Promise<void> {
    const model = this.gateway.model;
    const instance = await this.create({
      port: await pickFreePort(),
      config: {
        model: `shallow-gateway/${model}`,
        small_model: `shallow-gateway/${model}`,
        enabled_providers: ["shallow-gateway"],
        provider: {
          "shallow-gateway": {
            npm: "@ai-sdk/openai-compatible",
            name: "ShallowCode Gateway",
            options: {
              apiKey: this.gateway.apiKey,
              baseURL: this.gateway.baseUrl,
              timeout: false,
            },
            models: { [model]: { id: model, name: model, tool_call: true } },
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
    const response = await client.session.prompt({
      path: { id: sessionId },
      query: { directory },
      body: {
        model: { providerID: "shallow-gateway", modelID: this.gateway.model },
        system: input.systemPrompt,
        parts: [{ type: "text", text: input.taskPrompt }],
      },
    });
    if (response.error || !response.data) {
      throw new Error(`OpenCode prompt failed: ${formatSdkError(response.error)}`);
    }
    if (response.data.info.error) {
      throw new Error(`OpenCode model failed: ${formatSdkError(response.data.info.error)}`);
    }
    return response.data.parts
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  async abort(sessionId: string): Promise<void> {
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
    this.server?.close();
    this.client = undefined;
    this.server = undefined;
    this.directory = undefined;
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
