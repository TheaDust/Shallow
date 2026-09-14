import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AuthStorage, ModelRegistry, SessionManager, SettingsManager, DefaultResourceLoader, createAgentSession } from "@mariozechner/pi-coding-agent";
import { createPiTools } from "./pi-tools.js";
import { loadReferenceImages } from "./reference-images.js";
import type { PiWorkerRequest, PiWorkerResult } from "./pi-worker-client.js";
import { fillTemplate, loadBuilderPrompt } from "./prompt-assets.js";

// Wait for ownership to be established by the parent before executing anything.
process.once("message", (request: PiWorkerRequest) => {
  void run(request).then(send, error => send({ sessionId: "unavailable", outcome: "failed", summary: error instanceof Error ? error.message : String(error) }));
});
process.on("disconnect", () => process.exit(1));

function send(result: PiWorkerResult): void {
  // Parent receives a bounded receipt, then kills the owned job/group and awaits cleanup.
  process.send?.(result);
}

async function run(input: PiWorkerRequest): Promise<PiWorkerResult> {
  const agentDir = join(input.sessionDir, "config");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("shallow-gateway", input.gateway.apiKey);
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider("shallow-gateway", {
    baseUrl: input.gateway.baseUrl, api: "openai-completions", apiKey: "SHALLOW_RUNTIME_CREDENTIAL",
    models: [{ id: input.gateway.model, name: input.gateway.model, reasoning: false,
      input: ["text", "image"], contextWindow: 128_000, maxTokens: 16_384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
        maxTokensField: "max_tokens", supportsStrictMode: false, requiresReasoningContentOnAssistantMessages: true },
    }],
  });
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 1_000,
    provider: { maxRetries: 0, timeoutMs: input.timeoutMs } }, compaction: { enabled: true }, enableInstallTelemetry: false });
  const resourceLoader = new DefaultResourceLoader({ cwd: input.outputDir, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: input.systemPrompt });
  await resourceLoader.reload();
  const manager = input.sessionFile ? SessionManager.open(input.sessionFile) : SessionManager.create(input.outputDir, input.sessionDir);
  if (resolve(manager.getCwd()) !== resolve(input.outputDir)) throw new Error("Persisted Pi session workspace mismatch");
  const { session, modelFallbackMessage } = await createAgentSession({ cwd: input.outputDir, agentDir,
    authStorage, modelRegistry, model: modelRegistry.find("shallow-gateway", input.gateway.model),
    settingsManager, resourceLoader, sessionManager: manager,
    tools: ["read", "edit", "write", "shell"], customTools: createPiTools(input.outputDir), thinkingLevel: "off" });
  if (modelFallbackMessage) throw new Error(modelFallbackMessage);
  let toolCalls = 0;
  let compactions = 0;
  const unsubscribe = session.subscribe(event => {
    if (event.type === "tool_execution_start") toolCalls++;
    if (event.type === "compaction_end") compactions++;
  });
  const loaded = !input.textOnly && input.requirementsDir && input.references?.length
    ? await loadReferenceImages(input.requirementsDir, input.references) : { images: [], skipped: input.textOnly ? [] : (input.references ?? []).map(reference => ({ reference, reason: "requirements_unavailable" })) };
  const images = input.textOnly ? [] : loaded.images.map(image => ({ type: "image" as const, mimeType: image.mime, data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) }));
  try {
    const imageNote = !input.references?.length ? "" : input.textOnly ? loadBuilderPrompt("system", "reference-images-text-fallback")
      : fillTemplate(loadBuilderPrompt("system", "reference-images"), {
        ATTACHED_REFERENCES: loaded.images.map(image => `- ${image.reference}`).join("\n") || "无",
        UNAVAILABLE_REFERENCES: loaded.skipped.map(item => `- ${item.reference}: ${item.reason}`).join("\n") || "无",
      });
    await session.prompt(`${input.taskPrompt}\n\n${imageNote}`, { images, expandPromptTemplates: false });
    const last = session.messages.at(-1);
    const success = last?.role === "assistant" && last.stopReason === "stop";
    const summary = last?.role === "assistant" ? last.errorMessage || last.content.filter(part => part.type === "text").map(part => part.text).join("\n") : "Pi did not reach a terminal assistant response";
    return { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(),
      outcome: success ? "completed" : "failed", summary: summary.slice(-8_000), toolCalls, compactions, peakRssBytes: process.resourceUsage().maxRSS * 1024,
      imageUnsupported: !success && images.length > 0 && toolCalls === 0 && /\b(?:image(?:_url| input|s)?|vision|multimodal)\b.{0,60}\b(?:not supported|unsupported)\b|\b(?:model|endpoint|provider)\b.{0,40}\b(?:does not support|cannot accept)\b.{0,30}\bimage/i.test(summary),
      ...(input.references?.length ? { referenceImages: { mode: input.textOnly ? "text_fallback" : images.length ? "attached" : "unavailable", attachedCount: images.length, skipped: loaded.skipped } as const } : {}),
    };
  } finally { unsubscribe(); session.dispose(); }
}
