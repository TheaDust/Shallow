import type { BuilderResult } from "./port.js";

/** Engine-independent prompt execution shared by the controller and raw baseline. */
export interface CodingAgentRequest {
  systemPrompt: string;
  taskPrompt: string;
  outputDir: string;
  timeoutMs: number;
  sessionKey?: string;
  requirementsDir?: string;
  references?: string[];
  textOnly?: boolean;
}
export interface CodingAgentResult extends BuilderResult {
  imageUnsupported?: boolean;
  toolCalls?: number;
  compactions?: number;
}
export interface CodingAgentPort {
  /** Resolve only after owned processes have exited. Failure invalidates the session key. */
  run(request: CodingAgentRequest): Promise<CodingAgentResult>;
  close(): Promise<void>;
}
