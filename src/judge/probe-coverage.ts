import type { AtomicRequirement } from "../types.js";
import type { ProbeCase, ProbePlan } from "./probe-schema.js";

export interface ScenarioOutcome {
  scenarioId: string;
  stepIndex: number;
  text: string;
  requirementId: string;
}

export interface OutcomeCheck {
  scenarioId: string;
  stepIndex: number;
  /** Zero-based assertion positions relative to the tested suffix, after setupStepCount. */
  assertionIndexes: number[];
}

export interface UncoveredOutcome {
  scenarioId: string;
  stepIndex: number;
  reason: string;
}

export function scenarioOutcomes(requirements: readonly AtomicRequirement[]): ScenarioOutcome[] {
  return requirements.flatMap(requirement => (requirement.scenarioContracts ?? []).flatMap(scenario => {
    let inThen = false;
    return scenario.steps.flatMap((step, stepIndex) => {
      const keyword = step.keyword.toUpperCase();
      if (keyword !== "AND" && keyword !== "BUT") inThen = keyword === "THEN";
      return inThen ? [{ scenarioId: scenario.id, stepIndex, text: step.content, requirementId: requirement.id }] : [];
    });
  }));
}

function outcomeKey(value: Pick<OutcomeCheck, "scenarioId" | "stepIndex">): string {
  return JSON.stringify([value.scenarioId, value.stepIndex]);
}

export function validateOutcomeChecks(probeCase: ProbeCase, requirements: readonly AtomicRequirement[]): void {
  const outcomes = new Map(scenarioOutcomes(requirements).map(item => [outcomeKey(item), item]));
  const seen = new Set<string>();
  for (const check of probeCase.outcomeChecks ?? []) {
    const key = outcomeKey(check);
    if (!outcomes.has(key)) throw new Error(`Case ${probeCase.id} references an undeclared scenario outcome: ${key}`);
    if (seen.has(key)) throw new Error(`Case ${probeCase.id} repeats a scenario outcome: ${key}`);
    seen.add(key);
    const business = probeCase.steps.slice(probeCase.setupStepCount ?? 0);
    if (!check.assertionIndexes.length || check.assertionIndexes.some(index => !business[index]?.op.startsWith("expect"))) {
      throw new Error(`Case ${probeCase.id} scenario outcome ${key} must reference executed result assertions after preparation`);
    }
  }
}

/** Missing mappings and explicit omissions both prevent a complete verified verdict. */
export function probeCoverageGaps(plan: ProbePlan, requirements: readonly AtomicRequirement[]): UncoveredOutcome[] {
  const covered = new Set(plan.cases.flatMap(item => (item.outcomeChecks ?? []).map(outcomeKey)));
  const omissions = new Map((plan.uncoveredOutcomes ?? []).map(item => [outcomeKey(item), item]));
  return scenarioOutcomes(requirements).filter(item => !covered.has(outcomeKey(item))).map(item =>
    omissions.get(outcomeKey(item)) ?? { scenarioId: item.scenarioId, stepIndex: item.stepIndex, reason: "scenario outcome has no assertion mapping" });
}

/** Account for every outcome at planning time, including honest DSL limitations. */
export function assertCoverageAccountedFor(plan: ProbePlan, requirements: readonly AtomicRequirement[]): void {
  const expected = new Set(scenarioOutcomes(requirements).map(outcomeKey));
  const covered = new Set(plan.cases.flatMap(item => (item.outcomeChecks ?? []).map(outcomeKey)));
  const omitted = new Set<string>();
  for (const item of plan.uncoveredOutcomes ?? []) {
    const key = outcomeKey(item);
    if (!expected.has(key) || covered.has(key) || omitted.has(key)) throw new Error(`Invalid uncovered scenario outcome: ${key}`);
    omitted.add(key);
  }
  const missing = [...expected].filter(key => !covered.has(key) && !omitted.has(key));
  if (missing.length) throw new Error(`ProbePlan has unaccounted scenario outcomes: ${missing.join(", ")}`);
}

export function preservesOutcomeCoverage(before: ProbeCase, after: ProbeCase): boolean {
  const covered = new Set((after.outcomeChecks ?? []).map(outcomeKey));
  return (before.outcomeChecks ?? []).every(item => covered.has(outcomeKey(item)));
}
