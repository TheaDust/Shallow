import type { BuilderPort, BuilderRequest, BuilderRunOptions, BuilderResult } from "./port.js";
import { compileBuilderPrompt } from "./prompt.js";
import type { CodingAgentPort, CodingAgentRequest } from "./execution-port.js";
import { loadPrompt } from "../prompt-assets.js";

export class PromptBuilder implements BuilderPort {
  private textOnly = false;
  constructor(private client: CodingAgentPort, private options: { timeoutMs: number; requirementsDir?: string }) {}
  async run(request: BuilderRequest, options: BuilderRunOptions = {}): Promise<BuilderResult> {
    const timeoutMs = Math.min(this.options.timeoutMs, options.timeoutMs ?? this.options.timeoutMs);
    const deadline = Date.now() + timeoutMs;
    const input: CodingAgentRequest = { ...compileBuilderPrompt(request), outputDir: request.outputDir,
      timeoutMs, sessionKey: options.sessionKey, platformContract: request.platformContract, requirementsDir: this.options.requirementsDir,
      references: "packet" in request ? request.packet.requirements.flatMap(req => req.references) : [], textOnly: this.textOnly };
    if (options.continuationFeedback) input.taskPrompt += "\n\n" + loadPrompt("system", "implementation-continuation")
      .replace("{{FAILURE}}", () => options.continuationFeedback!);
    let result = await this.client.run(input);
    if (result.imageUnsupported && !this.textOnly && Date.now() < deadline) {
      this.textOnly = true;
      result = await this.client.run({ ...input, textOnly: true, timeoutMs: deadline - Date.now() });
    }
    // Session paths and SDK internals stay private to the execution adapter.
    return { sessionId: result.sessionId, outcome: result.outcome, summary: result.summary, referenceImages: result.referenceImages, execution: result.execution,
      ...(result.gatewayFailure ? { gatewayFailure: result.gatewayFailure } : {}) };
  }
  close(): Promise<void> { return this.client.close(); }
}
