import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";

import { buildBuilderPrompt } from "./prompt.js";
import type { BuilderPort, BuilderRequest, BuilderResult } from "./port.js";

export interface OpenCodeRuntime {
  start(directory: string): Promise<void>;
  createSession(title: string): Promise<string>;
  prompt(sessionId: string, text: string): Promise<string>;
  abort(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export interface OpenCodeSdkBuilderOptions {
  timeoutMs: number;
  promptSettleTimeoutMs?: number;
}

async function waitForPromptSettlement(
  promptPromise: Promise<string>,
  timeoutMs: number,
): Promise<void> {
  const settled = promptPromise.then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([
    settled,
    new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, timeoutMs);
    }),
  ]);
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
    const sessionId = await this.runtime.createSession(
      `${request.packet.id} attempt ${request.packet.attempt}`,
    );
    const prompt = buildBuilderPrompt(request);
    const promptPromise = this.runtime.prompt(sessionId, prompt);
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
        try {
          await this.runtime.abort(sessionId);
        } catch {
          return { sessionId, outcome: "failed", summary: "OpenCode session abort failed" };
        }
        await waitForPromptSettlement(
          promptPromise,
          this.options.promptSettleTimeoutMs ?? 5_000,
        );
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

  constructor(private readonly model?: string) {}

  async start(directory: string): Promise<void> {
    const instance = await createOpencode();
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

  async prompt(sessionId: string, text: string): Promise<string> {
    const { client, directory } = this.requireStarted();
    const model = parseModelReference(this.model);
    const response = await client.session.prompt({
      path: { id: sessionId },
      query: { directory },
      body: {
        ...(model ? { model } : {}),
        parts: [{ type: "text", text }],
      },
    });
    if (response.error || !response.data) {
      throw new Error(`OpenCode prompt failed: ${formatSdkError(response.error)}`);
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

function parseModelReference(
  value: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return {
    providerID: value.slice(0, separator),
    modelID: value.slice(separator + 1),
  };
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
