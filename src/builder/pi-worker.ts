import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AuthStorage, ModelRegistry, SessionManager, SettingsManager, DefaultResourceLoader, createAgentSession } from "@mariozechner/pi-coding-agent";
import { createPiTools } from "./pi-tools.js";
import { installSseCapture } from "./sse-capture.js";
import { installSseResilience } from "./sse-resilience.js";
import { closeSharedBrowser } from "./pi-browser-tool.js";
import { PiExecutionCollector } from "./pi-execution-stats.js";
import { piProviderModel } from "./pi-model-config.js";
import { loadReferenceImages } from "./reference-images.js";
import type { PiWorkerRequest, PiWorkerResult } from "./pi-worker-client.js";
import { fillTemplate, loadPrompt } from "../prompt-assets.js";

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
    models: [piProviderModel(input.gateway.model, input.contextWindow)],
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
    tools: ["read", "edit", "write", "shell", "run_tests", "browser"], customTools: createPiTools(input.outputDir) });
  if (modelFallbackMessage) throw new Error(modelFallbackMessage);
  let toolCalls = 0;
  let compactions = 0;
  const collector = new PiExecutionCollector();
  const unsubscribe = session.subscribe(event => {
    const atMs = Date.now();
    if (event.type === "tool_execution_start") { toolCalls++; collector.toolStarted(event.toolCallId, event.toolName, atMs); }
    else if (event.type === "tool_execution_end") collector.toolEnded(event.toolCallId, atMs);
    else if (event.type === "turn_end") collector.turnEnded();
    else if (event.type === "message_start" && event.message.role === "assistant") collector.modelStarted(atMs);
    else if (event.type === "message_end" && event.message.role === "assistant") collector.modelEnded(atMs);
    if (event.type === "compaction_end") compactions++;
  });
  const loaded = !input.textOnly && input.requirementsDir && input.references?.length
    ? await loadReferenceImages(input.requirementsDir, input.references) : { images: [], skipped: input.textOnly ? [] : (input.references ?? []).map(reference => ({ reference, reason: "requirements_unavailable" })) };
  const images = input.textOnly ? [] : loaded.images.map(image => ({ type: "image" as const, mimeType: image.mime, data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) }));
  // Install capture first so it tees the raw body, then resilience outermost so
  // the client reads a repaired stream while diagnostics keep the original bytes.
  const capture = input.sseCaptureDir ? installSseCapture(input.sseCaptureDir, input.sessionKey ?? "builder") : undefined;
  const resilience = installSseResilience(raw => process.stderr.write(`[ShallowCode] 检测到损坏的网关 SSE 事件：${raw}\n`));
  try {
    const imageNote = !input.references?.length ? "" : input.textOnly ? loadPrompt("system", "reference-images-text-fallback")
      : fillTemplate(loadPrompt("system", "reference-images"), {
        ATTACHED_REFERENCES: loaded.images.map(image => `- ${image.reference}`).join("\n") || "无",
        UNAVAILABLE_REFERENCES: loaded.skipped.map(item => `- ${item.reference}: ${item.reason}`).join("\n") || "无",
      });
    await session.prompt(`${input.taskPrompt}\n\n${imageNote}`, { images, expandPromptTemplates: false });
    const last = session.messages.at(-1);
    const success = last?.role === "assistant" && last.stopReason === "stop";
    const summary = last?.role === "assistant" ? last.errorMessage || last.content.filter(part => part.type === "text").map(part => part.text).join("\n") : "Pi did not reach a terminal assistant response";
    const stats = collector.summarize(session.getSessionStats().tokens);
    return { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(),
      outcome: success ? "completed" : "failed", summary: summary.slice(-8_000), toolCalls, compactions, peakRssBytes: process.resourceUsage().maxRSS * 1024,
      usage: stats.usage, timing: stats.timing,
      imageUnsupported: !success && images.length > 0 && toolCalls === 0 && /\b(?:image(?:_url| input|s)?|vision|multimodal)\b.{0,60}\b(?:not supported|unsupported)\b|\b(?:model|endpoint|provider)\b.{0,40}\b(?:does not support|cannot accept)\b.{0,30}\bimage/i.test(summary),
      ...(input.references?.length ? { referenceImages: { mode: input.textOnly ? "text_fallback" : images.length ? "attached" : "unavailable", attachedCount: images.length, skipped: loaded.skipped } as const } : {}),
    };
  } finally { unsubscribe(); session.dispose(); resilience.uninstall(); await capture?.uninstall(); await closeSharedBrowser(); }
}
