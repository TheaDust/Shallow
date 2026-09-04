import type { ProbePlanner } from "../../src/judge/llm-probe-planner.js";
import type { ProbePlan } from "../../src/judge/probe-schema.js";
import type { WorkPacket } from "../../src/types.js";

export class FakeProbePlanner implements ProbePlanner {
  readonly packets: WorkPacket[] = [];
  readonly refinements: Array<{ original: ProbePlan; snapshot: string }> = [];
  private planIndex = 0;

  constructor(private readonly plans: ProbePlan[]) {}

  async plan(packet: WorkPacket): Promise<ProbePlan> {
    this.packets.push(packet);
    const plan = this.plans[this.planIndex] ?? this.plans.at(-1);
    this.planIndex += 1;
    if (!plan) throw new Error("FakeProbePlanner has no plan");
    return structuredClone(plan);
  }

  async refineLocators(original: ProbePlan, snapshot: string): Promise<ProbePlan> {
    this.refinements.push({ original, snapshot });
    const plan = this.plans[this.planIndex] ?? this.plans.at(-1);
    this.planIndex += 1;
    if (!plan) throw new Error("FakeProbePlanner has no refinement plan");
    return structuredClone(plan);
  }
}
