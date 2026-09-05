import type { BuilderPromptInput } from "./prompt-input.js";

export type BuilderRequest = BuilderPromptInput;

export interface BuilderResult {
  sessionId: string;
  outcome: "completed" | "failed" | "timed_out";
  summary: string;
}

export interface BuilderPort {
  run(request: BuilderRequest): Promise<BuilderResult>;
  close(): Promise<void>;
}
