import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { WorkPacket } from "../types.js";
import { planValidationFeedback, type ProbePlanner } from "./llm-probe-planner.js";
import { parseProbePlan, type ProbePlan } from "./probe-schema.js";
import { assertCoverageAccountedFor } from "./probe-coverage.js";

/** A packet as `parseProbePlan` accepts it: the cache must re-validate on read. */
type CachedPacket = Pick<WorkPacket, "id" | "requirementIds"> &
  Partial<Pick<WorkPacket, "requirements" | "prerequisites">>;

/**
 * Disk-backed probe plan cache keyed by audit packet ID.
 *
 * Plans and one validation-feedback retry run alongside Builder execution.
 * Module audits consume ready plans while remaining generation continues.
 * After locator refinement the refined plan overwrites the entry.
 * A cached plan is only reused when it still validates against its packet, so
 * coverage and locator-anchoring rules hold for the cache path too.
 */
export class PlanCache {
  private readonly directory: string;

  constructor(
    runDirectory: string,
    /** Optional product-visible mirror so a delivered run exposes its plans. */
    private readonly mirrorDirectory?: string,
  ) {
    this.directory = join(runDirectory, "plans");
  }

  async read(packet: CachedPacket): Promise<ProbePlan | undefined> {
    try {
      const raw = await readFile(this.pathFor(packet.id), "utf8");
      const plan = parseProbePlan(JSON.parse(raw), packet);
      if (packet.requirements) assertCoverageAccountedFor(plan, packet.requirements);
      return plan;
    } catch {
      return undefined;
    }
  }

  async write(packetId: string, plan: ProbePlan): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify(plan);
    await writeFile(this.pathFor(packetId), payload, { encoding: "utf8", mode: 0o600 });
    if (this.mirrorDirectory) {
      await mkdir(this.mirrorDirectory, { recursive: true }).catch(() => {});
      await writeFile(join(this.mirrorDirectory, this.fileName(packetId)), payload, { encoding: "utf8" }).catch(() => {});
    }
  }
  private pathFor(packetId: string): string {
    return join(this.directory, this.fileName(packetId));
  }
  private fileName(packetId: string): string {
    // Slugified ids are lossy (`A.1` and `A_1` collapse), so the digest keeps files distinct.
    const digest = createHash("sha256").update(packetId).digest("hex").slice(0, 16);
    return `${sanitise(packetId)}-${digest}.json`;
  }
}

function sanitise(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
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
  onFailure?: (error: unknown) => Promise<void>,
): Promise<ProbePlan | undefined> {
  const generate = async (): Promise<ProbePlan> => {
    try { return parseProbePlan(await planner.plan(packet, undefined, { timeoutMs }), packet); }
    catch (error) {
      const feedback = planValidationFeedback(error);
      if (!feedback) throw error;
      return parseProbePlan(await planner.plan(packet, feedback, { timeoutMs }), packet);
    }
  };
  return generate()
    .then(async (plan) => {
      await cache.write(auditPacketId, plan);
      return plan;
    })
    .catch(async error => {
      await onFailure?.(error).catch(() => {});
      return undefined;
    });
}
