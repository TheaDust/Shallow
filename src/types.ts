export type RequirementStatus = "todo" | "verified" | "blocked";

export interface AtomicRequirement {
  id: string;
  folderPath: string[];
  declarationIndex: number;
  name: string;
  text: string;
  dependencyIds: string[];
  scenarios: string[];
  references: string[];
  exactUiStrings: string[];
}

export interface RequirementCatalog {
  requirements: AtomicRequirement[];
  statusById: Record<string, RequirementStatus>;
}

export interface WorkPacket {
  id: string;
  requirementIds: string[];
  requirements: AtomicRequirement[];
  attempt: 1 | 2 | 3;
}

export interface ProcessCommand {
  executable: string;
  args: string[];
  cwd: "output" | "frontend" | "backend";
}

export interface PlatformContract {
  baseUrl: string;
  port: number;
  installCommands: ProcessCommand[];
  buildCommands: ProcessCommand[];
  startCommand: ProcessCommand;
  healthPath: string;
  buildTimeoutMs: number;
  startTimeoutMs: number;
}

export interface RunEvent {
  at: string;
  type: string;
  packetId?: string;
  detail?: Record<string, unknown>;
}
