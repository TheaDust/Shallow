import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { WorkPacket } from "../types.js";
import type { ProbePlanner } from "./llm-probe-planner.js";
import { parseProbePlan, type ProbePlan } from "./probe-schema.js";

/**
 * Disk-backed probe plan cache keyed by audit packet ID.
 *
 * Plans are generated in parallel with Builder execution and read from disk
 * during the consolidated or module-boundary audit, eliminating the serial
 * LLM latency. After locator refinement the refined plan overwrites the entry.
 */
export class PlanCache {
  private readonly directory: string;

  constructor(runDirectory: string) {
    this.directory = join(runDirectory, "plans");
  }

  async read(packetId: string): Promise<ProbePlan | undefined> {
    try {
      const raw = await readFile(this.pathFor(packetId), "utf8");
      return parseProbePlan(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  async write(packetId: string, plan: ProbePlan): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.pathFor(packetId), JSON.stringify(plan), { encoding: "utf8", mode: 0o600 });
  }
  private pathFor(packetId: string): string {
    return join(this.directory, `${sanitise(packetId)}.json`);
  }
}

function sanitise(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}

/**
 * Kick off plan generation alongside Builder execution.
 * The returned promise resolves independently of the Builder; its result is
 * written to the cache when ready so the audit can read from disk later.
 */
export function spawnPlanGeneration(
  packet: WorkPacket,
  auditPacketId: string,
  planner: Pick<ProbePlanner, "plan">,
  cache: PlanCache,
  timeoutMs: number,
): Promise<ProbePlan | undefined> {
  return planner.plan(packet, undefined, { timeoutMs })
    .then(async (plan) => {
      await cache.write(auditPacketId, plan);
      return plan;
    })
    .catch(() => undefined);
}
