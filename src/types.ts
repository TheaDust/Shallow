export type RequirementStatus = "todo" | "verified" | "blocked";

export type ProductKind =
  | "repository_collaboration"
  | "spreadsheet"
  | "generic_web";

export interface SeedDataCategory {
  category: string;
  items: string[];
}

export interface ProductContext {
  kind: ProductKind;
  rootId: string;
  rootName: string;
  description: string;
  seedData: SeedDataCategory[];
}

export interface RequirementAncestor {
  id: string;
  name: string;
  description: string;
}

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
  product: ProductContext;
  ancestors: RequirementAncestor[];
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

export interface ProbeFailure {
  caseId: string;
  stepIndex: number;
  category: "assertion" | "locator" | "navigation" | "timeout" | "runner";
  message: string;
  locatorSnapshot?: string;
}

export interface ShadowReport {
  packetId: string;
  verdict: "pass" | "fail" | "inconclusive";
  passedCases: string[];
  failures: ProbeFailure[];
}
