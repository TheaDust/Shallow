import type { ProbePlanner, ProbePlannerFeedback } from "../../src/judge/llm-probe-planner.js";
import type { ProbePlan } from "../../src/judge/probe-schema.js";
import type { ProbeFailure, WorkPacket } from "../../src/types.js";

export class FakeProbePlanner implements ProbePlanner {
  readonly packets: WorkPacket[] = [];
  readonly refinements: Array<{ original: ProbePlan; failures: ProbeFailure[]; feedback?: ProbePlannerFeedback }> = [];
  private planIndex = 0;

  constructor(private readonly plans: ProbePlan[]) {}

  async plan(packet: WorkPacket): Promise<ProbePlan> {
    this.packets.push(packet);
    const plan = this.plans[this.planIndex] ?? this.plans.at(-1);
    this.planIndex += 1;
    if (!plan) throw new Error("FakeProbePlanner has no plan");
    return structuredClone(plan);
  }

  async refineLocators(original: ProbePlan, failures: ProbeFailure[], feedback?: ProbePlannerFeedback): Promise<ProbePlan> {
    this.refinements.push(structuredClone({ original, failures, feedback }));
    const plan = this.plans[this.planIndex] ?? this.plans.at(-1);
    this.planIndex += 1;
    if (!plan) throw new Error("FakeProbePlanner has no refinement plan");
    return structuredClone(plan);
  }
}
