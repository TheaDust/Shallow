import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sanitizeDiagnosticText } from "./run-state.js";
import type { AtomicRequirement } from "./types.js";

const ARC_TABLES = [
  "requirements",
  "scenarios",
  "interfaces",
  "tests",
  "call_edges",
  "node_states",
  "node_contracts",
] as const;

const NODE_STATE_BY_PHASE_STATUS: Record<string, string> = {
  "design:running": "DESIGNING",
  "design:completed": "DESIGNED",
  "design:failed": "FAILED",
  "implement:running": "IMPLEMENTING",
  "implement:completed": "IMPLEMENTED",
  "implement:failed": "FAILED",
  "test:passed": "PASSED",
  "test:failed": "FAILED",
};

export interface ArcRequirementRow {
  req_id: string;
  id: string;
  name: string;
  description: string;
  visual_reference: string[];
  scenarios: Array<{ id: string; name: string; steps: ArcScenarioStep[] }>;
  parent_id: string | null;
  children_ids: string[];
  dependencies: string[];
}

export interface ArcScenarioRow {
  scenario_id: string;
  id: string;
  name: string;
  req_id: string;
  steps: ArcScenarioStep[];
}

export interface ArcScenarioStep {
  keyword: string;
  content: string;
}

export class ArcEventSink {
  private readonly eventsFile: string;
  private readonly traceDir: string;

  constructor(outputDir: string) {
    const arcDir = join(outputDir, ".arc");
    this.eventsFile = join(arcDir, "runner-events.jsonl");
    this.traceDir = join(arcDir, "traceability");
  }

  async init(): Promise<void> {
    await mkdir(this.traceDir, { recursive: true });
    for (const table of ARC_TABLES) {
      const path = this.tablePath(table);
      try {
        await readFile(path, "utf8");
      } catch {
        await writeJsonAtomic(path, {});
      }
    }
  }

  async runnerState(
    state: "running" | "completed" | "failed",
    message?: string,
  ): Promise<void> {
    await this.appendEvent({
      type: "runner_state",
      state,
      timestamp: arcTimestamp(),
      message: message ?? null,
    });
  }

  async requirementState(
    reqId: string,
    phase: "design" | "implement" | "test",
    status: "running" | "completed" | "failed" | "passed",
  ): Promise<void> {
    await this.appendEvent({
      type: "requirement_state",
      node_id: reqId,
      phase,
      status,
      timestamp: arcTimestamp(),
      message: null,
    });
    const nodeState = NODE_STATE_BY_PHASE_STATUS[`${phase}:${status}`];
    if (!nodeState) return;
    await this.upsertNodeState(reqId, nodeState, phase);
  }

  async commitHistorySignal(reason: string): Promise<void> {
    await this.appendEvent({
      type: "signal",
      reason,
      timestamp: arcTimestamp(),
      refresh: {
        submission: false,
        logs: false,
        commit_history: true,
        traceability_selected: false,
        traceability_all: false,
        preview: false,
      },
    });
  }

  async builderDiagnostic(
    packetId: string,
    outcome: "completed" | "failed" | "timed_out",
    summary: string,
  ): Promise<void> {
    await this.appendEvent({
      type: "signal",
      reason: "builder_receipt_recorded",
      packet_id: packetId,
      outcome,
      message: sanitizeDiagnosticText(summary),
      timestamp: arcTimestamp(),
      refresh: {
        submission: false,
        logs: true,
        commit_history: false,
        traceability_selected: false,
        traceability_all: false,
        preview: false,
      },
    });
  }

  async storeRequirementTree(
    requirementRows: Record<string, ArcRequirementRow>,
    scenarioRows: Record<string, ArcScenarioRow>,
  ): Promise<void> {
    await writeJsonAtomic(this.tablePath("requirements"), requirementRows);
    await writeJsonAtomic(this.tablePath("scenarios"), scenarioRows);
    await this.appendEvent({
      type: "signal",
      reason: "requirement_tree_stored",
      timestamp: arcTimestamp(),
      refresh: {
        submission: true,
        logs: false,
        commit_history: false,
        traceability_selected: true,
        traceability_all: true,
        preview: false,
      },
    });
  }

  private async upsertNodeState(
    reqId: string,
    state: string,
    phase: string,
  ): Promise<void> {
    const path = this.tablePath("node_states");
    const rows = await readJsonObject(path);
    rows[reqId] = {
      req_id: reqId,
      state,
      phase,
      updated_at: arcTimestamp(),
    };
    await writeJsonAtomic(path, rows);
  }

  private async appendEvent(record: Record<string, unknown>): Promise<void> {
    await mkdir(join(this.eventsFile, ".."), { recursive: true });
    await appendFile(this.eventsFile, `${JSON.stringify(record)}\n`, "utf8");
  }

  private tablePath(table: (typeof ARC_TABLES)[number]): string {
    return join(this.traceDir, `${table}.json`);
  }
}

export function buildArcRequirementRows(requirements: AtomicRequirement[]): {
  requirementRows: Record<string, ArcRequirementRow>;
  scenarioRows: Record<string, ArcScenarioRow>;
} {
  const requirementRows: Record<string, ArcRequirementRow> = {};
  const scenarioRows: Record<string, ArcScenarioRow> = {};
  for (const requirement of requirements) {
    const scenarios: ArcRequirementRow["scenarios"] = [];
    for (const [index, text] of requirement.scenarios.entries()) {
      const row = parseScenarioRow(requirement.id, index, text);
      scenarios.push({
        id: row.scenario_id,
        name: row.name,
        steps: row.steps,
      });
      scenarioRows[row.scenario_id] = row;
    }
    requirementRows[requirement.id] = {
      req_id: requirement.id,
      id: requirement.id,
      name: requirement.name,
      description: requirement.text,
      visual_reference: [...requirement.references],
      scenarios,
      parent_id: requirement.folderPath.at(-1) ?? null,
      children_ids: [],
      dependencies: [...requirement.dependencyIds],
    };
  }
  return { requirementRows, scenarioRows };
}

export function arcTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function parseScenarioRow(
  reqId: string,
  index: number,
  text: string,
): ArcScenarioRow {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const name = lines[0] ?? `scenario ${index}`;
  const steps = lines.slice(1).map((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return { keyword: "THEN", content: line };
    return {
      keyword: line.slice(0, separator).trim(),
      content: line.slice(separator + 1).trim(),
    };
  });
  const scenarioId = `${reqId}::${index}`;
  return {
    scenario_id: scenarioId,
    id: scenarioId,
    name,
    req_id: reqId,
    steps,
  };
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
