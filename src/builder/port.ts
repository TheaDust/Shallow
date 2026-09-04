import type { PlatformContract, ShadowReport, WorkPacket } from "../types.js";

export interface BuilderRequest {
  packet: WorkPacket;
  outputDir: string;
  platformContract: PlatformContract;
  shadowReport?: ShadowReport;
  requireRootCauseFirst: boolean;
}

export interface BuilderResult {
  sessionId: string;
  outcome: "completed" | "failed" | "timed_out";
  summary: string;
}

export interface BuilderPort {
  run(request: BuilderRequest): Promise<BuilderResult>;
  close(): Promise<void>;
}
