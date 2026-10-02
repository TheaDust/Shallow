import type { AtomicRequirement } from "../types.js";
import type { ProbeCase, ProbePlan } from "./probe-schema.js";
import { maskRequirementLiterals, requirementSentences } from "../requirement-text.js";

export interface ScenarioOutcome {
  scenarioId: string;
  stepIndex: number;
  /** Required for a source step containing more than one result clause. */
  clauseIndex?: number;
  text: string;
  requirementId: string;
}

export interface OutcomeCheck {
  scenarioId: string;
  stepIndex: number;
  clauseIndex?: number;
  /** Zero-based assertion positions relative to the tested suffix, after setupStepCount. */
  assertionIndexes: number[];
}

export interface UncoveredOutcome {
  scenarioId: string;
  stepIndex: number;
  clauseIndex?: number;
  reason: string;
}

export function scenarioOutcomes(requirements: readonly AtomicRequirement[]): ScenarioOutcome[] {
  return requirements.flatMap(requirement => (requirement.scenarioContracts ?? []).flatMap(scenario => {
    let inThen = false;
    return scenario.steps.flatMap((step, stepIndex) => {
      const keyword = step.keyword.toUpperCase();
      if (keyword !== "AND" && keyword !== "BUT") inThen = keyword === "THEN";
      if (!inThen) return [];
      const clauses = outcomeClauses(step.content);
      return clauses.map((text, clauseIndex) => ({ scenarioId: scenario.id, stepIndex, text, requirementId: requirement.id,
        ...(clauses.length > 1 ? { clauseIndex } : {}) }));
    });
  }));
}

/** Split explicit result coordination, preserving alternatives and quoted data as a unit. */
function outcomeClauses(text: string): string[] {
  const seedMarker = maskRequirementLiterals(text).search(/\bSeed (?:data|values):/i);
  const source = seedMarker < 0 ? text : text.slice(0, seedMarker);
  return requirementSentences(source).flatMap(sentence => {
    const clauses: string[] = [];
    let start = 0;
    for (const separator of maskRequirementLiterals(sentence).matchAll(/;\s*|\s+(?:and|but)\s+/gi)) {
      const clause = sentence.slice(start, separator.index).trim().replace(/,$/, "");
      if (clause) clauses.push(clause);
      start = separator.index! + separator[0].length;
    }
    const tail = sentence.slice(start).trim();
    if (tail) clauses.push(tail);
    return clauses;
  });
}

export function outcomeKey(value: Pick<OutcomeCheck, "scenarioId" | "stepIndex" | "clauseIndex">): string {
  return JSON.stringify([value.scenarioId, value.stepIndex, value.clauseIndex ?? 0]);
}

export function validateOutcomeChecks(probeCase: ProbeCase, requirements: readonly AtomicRequirement[]): void {
  const outcomes = new Map(scenarioOutcomes(requirements).map(item => [outcomeKey(item), item]));
  const seen = new Set<string>();
  for (const check of probeCase.outcomeChecks ?? []) {
    const key = outcomeKey(check);
    const outcome = outcomes.get(key);
    if (!outcome) throw new Error(`Case ${probeCase.id} references an undeclared scenario outcome: ${key}`);
    if (outcome.clauseIndex !== undefined && check.clauseIndex === undefined) {
      throw new Error(`Case ${probeCase.id} must map each compound result separately with clauseIndex: ${key}`);
    }
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
    omissions.get(outcomeKey(item)) ?? { scenarioId: item.scenarioId, stepIndex: item.stepIndex,
      ...(item.clauseIndex === undefined ? {} : { clauseIndex: item.clauseIndex }), reason: `scenario result has no assertion mapping: ${item.text}` });
}

/** Account for every outcome at planning time, including honest DSL limitations. */
export function assertCoverageAccountedFor(plan: ProbePlan, requirements: readonly AtomicRequirement[]): void {
  const outcomes = new Map(scenarioOutcomes(requirements).map(item => [outcomeKey(item), item]));
  const expected = new Set(outcomes.keys());
  const covered = new Set(plan.cases.flatMap(item => (item.outcomeChecks ?? []).map(outcomeKey)));
  const omitted = new Set<string>();
  for (const item of plan.uncoveredOutcomes ?? []) {
    const key = outcomeKey(item);
    if (!expected.has(key) || covered.has(key) || omitted.has(key) ||
      (outcomes.get(key)?.clauseIndex !== undefined && item.clauseIndex === undefined)) throw new Error(`Invalid uncovered scenario outcome: ${key}`);
    omitted.add(key);
  }
  const missing = [...expected].filter(key => !covered.has(key) && !omitted.has(key));
  if (missing.length) throw new Error(`ProbePlan has unaccounted scenario outcomes: ${missing.join(", ")}`);
}

export function preservesOutcomeCoverage(before: ProbeCase, after: ProbeCase): boolean {
  const covered = new Set((after.outcomeChecks ?? []).map(outcomeKey));
  return (before.outcomeChecks ?? []).every(item => covered.has(outcomeKey(item)));
}
