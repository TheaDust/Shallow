/**
 * In-process gateway provider descriptor. The context window is the only
 * per-run tunable: the raw baseline keeps a single long session and asks for a
 * larger window so automatic compaction does not drop earlier modules, while
 * the controller's short per-packet sessions keep the default.
 */
export const DEFAULT_CONTEXT_WINDOW = 256_000;

export function piProviderModel(model: string, contextWindow: number = DEFAULT_CONTEXT_WINDOW) {
  return {
    id: model, name: model, reasoning: true, input: ["text", "image"] as ("text" | "image")[],
    contextWindow, maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
      maxTokensField: "max_tokens" as const, supportsStrictMode: false, requiresReasoningContentOnAssistantMessages: true },
  };
}
