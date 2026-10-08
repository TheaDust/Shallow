import type { AtomicRequirement } from "../types.js";
import type { ProbeCase, ProbePlan, ProbeStep } from "./probe-schema.js";
import { maskRequirementLiterals, requirementSentences } from "../requirement-text.js";

export interface ScenarioOutcome {
  scenarioId: string;
  stepIndex: number;
  /** Required for a source step containing more than one result clause. */
  clauseIndex?: number;
  text: string;
  requirementId: string;
  /** Observable facts nested under the stable outcome key. Facets never create
   * a new traceability identity; they only make the claimed assertion coverage
   * precise enough to reject URL/count/persistence omissions. */
  facets: ObservableFacet[];
}

export type ObservableFacetKind = "text" | "visibility" | "state" | "count" | "url" | "persistence";

export interface ObservableFacet {
  id: string;
  kind: ObservableFacetKind;
  text: string;
  phase: "immediate" | "after_reload";
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
        facets: observableFacets(text),
        ...(clauses.length > 1 ? { clauseIndex } : {}) }));
    });
  }));
}

/**
 * Keep the outcome identity stable and describe only facts that can be checked
 * by the bounded DSL. This deliberately does not split on commas: spreadsheet
 * formulas, coordinates, formatting values and human-readable status strings
 * frequently contain commas. The planner still receives the complete source
 * text and must assert every explicitly listed field.
 */
export function observableFacets(text: string): ObservableFacet[] {
  const masked = maskRequirementLiterals(text);
  const afterReload = /\b(?:after|following)\s+(?:a\s+)?(?:reload|refresh|reopen(?:ing)?)\b|\b(?:persists?|remains?|retains?)\b[^.!?]*\b(?:reload|refresh|reopen(?:ing)?)\b/i.test(masked);
  const phase = afterReload ? "after_reload" as const : "immediate" as const;
  const facets: ObservableFacet[] = [];
  const add = (kind: ObservableFacetKind, value = text): void => {
    if (facets.some(item => item.kind === kind && item.text === value && item.phase === phase)) return;
    facets.push({ id: `${kind}:${facets.filter(item => item.kind === kind).length}`, kind, text: value, phase });
  };
  if (/\b(?:page\s+)?(?:address|url)\b/i.test(masked)) add("url");
  // Count is identified from the contract shape, not from a product noun. A
  // complete quoted status such as “Replaced 3 cells” remains one text facet;
  // its exact text assertion is also a valid count-bearing assertion.
  if (/\b(?:count|number|total)\b/i.test(masked) || /\b\d+\s+[\p{L}][\p{L}\p{N}_-]*\b/u.test(text)) add("count");
  const statePattern = /\b(?:status|state|active|inactive|revoked|archived|current\s+session|selected|highlighted|checked|unchecked|gone|absent|removed)\b/i;
  const stateSegments = commaSegments(text).filter(segment => statePattern.test(maskRequirementLiterals(segment)));
  if (stateSegments.length > 1) for (const segment of stateSegments) add("state", segment);
  else if (statePattern.test(masked)) add("state");
  const visible = /\b(?:display(?:s|ed)?|show(?:s|n)?|visible|exposes?|appears?|marker|heading|link|field|label)\b/i.test(masked);
  const literals = /\bor\b/i.test(masked) ? [] : observableLiterals(text);
  if (visible && literals.length > 0) for (const literal of literals) add("visibility", literal);
  else if (visible) add("visibility");
  if (afterReload) add("persistence");
  if (facets.length === 0) add("text");
  return facets;
}

function observableLiterals(text: string): string[] {
  const values = [...text.matchAll(/`([^`]+)`|“([^”]+)”|"([^"\n]+)"/g)]
    .map(match => (match[1] ?? match[2] ?? match[3]).replace(/\s+/g, " ").trim())
    .filter(value => value.length > 0 && value.length <= 256);
  return [...new Set(values)];
}

function commaSegments(text: string): string[] {
  const masked = maskRequirementLiterals(text);
  const segments: string[] = [];
  let start = 0;
  for (const match of masked.matchAll(/,\s*/g)) {
    const value = text.slice(start, match.index).trim();
    if (value) segments.push(value);
    start = match.index! + match[0].length;
  }
  const tail = text.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
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
  }
  validateResultAssertionIndexes(probeCase, `Case ${probeCase.id}`);
}

function observableFacetIssue(
  probeCase: ProbeCase,
  outcomes: ReadonlyMap<string, ScenarioOutcome>,
  check: OutcomeCheck,
): string | undefined {
  const setupStepCount = probeCase.setupStepCount ?? 0;
  const business = probeCase.steps.slice(setupStepCount);
  const outcome = outcomes.get(outcomeKey(check));
  if (!outcome) return undefined;
  const assertions = check.assertionIndexes.map(index => business[index]).filter(step => step?.op.startsWith("expect"));
  for (const facet of outcome.facets) {
    if (facet.kind === "url" && !assertions.some(step => step.op === "expectUrlContains")) {
      return "explicit page address/URL result is not mapped to expectUrlContains";
    }
    if (facet.kind === "count" && !assertions.some(step => assertionProvesCount(step, facet.text))) {
      return "explicit count result is not mapped to a count-bearing assertion";
    }
    if (facet.kind === "state" && facet.text !== outcome.text &&
      !assertions.some(step => assertionProvesState(step, facet.text))) {
      return `state fact ${JSON.stringify(facet.text)} is not proven by a mapped assertion`;
    }
    if (facet.kind === "visibility" && facet.text !== outcome.text &&
      !assertions.some(step => assertionMentions(step, facet.text))) {
      return `displayed field ${JSON.stringify(facet.text)} is not proven by a mapped assertion`;
    }
    if (facet.phase === "after_reload") {
      let reloadIndex = -1;
      for (let index = business.length - 1; index >= 0; index -= 1) {
        if (business[index].op === "reload") { reloadIndex = index; break; }
      }
      if (reloadIndex < 0 || !check.assertionIndexes.some(index => index > reloadIndex)) {
        return "reload/refresh result is not asserted after a reload step";
      }
    }
  }
  return undefined;
}

function assertionMentions(step: ProbeStep, expected: string): boolean {
  const target = expected.replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) return false;
  const values: string[] = [];
  if ("locator" in step) {
    const locator = step.locator;
    values.push(locator.by === "role" ? locator.name ?? "" : locator.text);
  }
  if (step.op === "expectText") values.push(step.text, ...(step.anyOf ?? []));
  if (step.op === "expectValue") values.push(step.value);
  return values.some(value => value.replace(/\s+/g, " ").trim().toLowerCase().includes(target));
}

function assertionProvesCount(step: ProbeStep, evidence: string): boolean {
  const numeric = /\b(\d+)\b/.exec(evidence)?.[1];
  const word = /\b(zero|one)\b/i.exec(evidence)?.[1]?.toLowerCase();
  const expected = numeric === undefined ? word === "zero" ? 0 : word === "one" ? 1 : undefined : Number(numeric);
  if (step.op === "expectCount") return expected === undefined || step.count === expected;
  if (step.op === "expectAccessibleCount") {
    if (expected === undefined) return true;
    if (step.exact === expected) return true;
    return /\b(?:at least|minimum(?: of)?)\b/i.test(evidence) && step.minimum === expected;
  }
  return step.op === "expectText" && (expected === undefined
    ? /\d|count|total/i.test([step.text, ...(step.anyOf ?? [])].join(" "))
    : [step.text, ...(step.anyOf ?? [])].some(value => new RegExp(`(^|\\D)${expected}(?:\\D|$)`).test(value)));
}

function assertionProvesState(step: ProbeStep, evidence: string): boolean {
  const targets = [...observableLiterals(evidence),
    ...[...evidence.matchAll(/\b(active|inactive|revoked|archived|selected|highlighted|checked|unchecked)\b/gi)]
      .map(match => match[1])];
  if (!targets.length) return step.op === "expectText" || step.op === "expectAttribute" ||
    step.op === "expectVisible" || step.op === "expectHidden";
  const absent = /\b(?:gone|absent|removed|hidden|no longer)\b/i.test(evidence);
  return targets.some(target => assertionMentions(step, target)) && (absent
    ? step.op === "expectHidden" || step.op === "expectCount" && step.count === 0
    : step.op === "expectVisible" || step.op === "expectText" || step.op === "expectAttribute" ||
      step.op === "expectValue" || step.op === "expectCount");
}

/** Describe the actual index space so an existing feedback retry can correct the mapping. */
export function validateResultAssertionIndexes(
  probeCase: Pick<ProbeCase, "steps" | "setupStepCount" | "outcomeChecks">,
  location: string,
): void {
  const setupStepCount = probeCase.setupStepCount ?? 0;
  const business = probeCase.steps.slice(setupStepCount);
  const allowed = business.flatMap((step, index) => step.op.startsWith("expect") ? [`${index}:${step.op}`] : []);
  for (const [index, check] of (probeCase.outcomeChecks ?? []).entries()) {
    if (!check.assertionIndexes.length || check.assertionIndexes.some(value => !business[value]?.op.startsWith("expect"))) {
      throw new Error(`${location}.outcomeChecks[${index}].assertionIndexes [${check.assertionIndexes.join(", ")}] must reference result assertions after preparation; ` +
        `setupStepCount=${setupStepCount}. Indexes are zero-based relative to the business suffix, including the terminal assertion. ` +
        `Valid assertion indexes: [${allowed.join(", ")}].`);
    }
  }
}

/** Missing mappings and explicit omissions both prevent a complete verified verdict. */
export function probeCoverageGaps(plan: ProbePlan, requirements: readonly AtomicRequirement[]): UncoveredOutcome[] {
  const outcomes = new Map(scenarioOutcomes(requirements).map(item => [outcomeKey(item), item]));
  const covered = new Set(plan.cases.flatMap(item => (item.outcomeChecks ?? []).map(outcomeKey)));
  const omissions = new Map((plan.uncoveredOutcomes ?? []).map(item => [outcomeKey(item), item]));
  const missing = [...outcomes.values()].filter(item => !covered.has(outcomeKey(item))).map(item =>
    omissions.get(outcomeKey(item)) ?? { scenarioId: item.scenarioId, stepIndex: item.stepIndex,
      ...(item.clauseIndex === undefined ? {} : { clauseIndex: item.clauseIndex }), reason: `scenario result has no assertion mapping: ${item.text}` });
  const semantic = [...outcomes.values()].flatMap(outcome => {
    const key = outcomeKey(outcome);
    if (!covered.has(key)) return [];
    const mappings = plan.cases.flatMap(probeCase => (probeCase.outcomeChecks ?? [])
      .filter(check => outcomeKey(check) === key).map(check => ({ probeCase, check })));
    const issues = mappings.map(({ probeCase, check }) => observableFacetIssue(probeCase, outcomes, check));
    if (issues.some(issue => issue === undefined)) return [];
    return [{ scenarioId: outcome.scenarioId, stepIndex: outcome.stepIndex,
      ...(outcome.clauseIndex === undefined ? {} : { clauseIndex: outcome.clauseIndex }),
      reason: issues[0] ?? `scenario result lacks semantic assertion coverage: ${outcome.text}` }];
  });
  return [...missing, ...semantic];
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
  const semantic = probeCoverageGaps(plan, requirements).filter(item => covered.has(outcomeKey(item)));
  if (semantic.length) {
    throw new Error(`ProbePlan has scenario outcomes without semantic assertion coverage: ${semantic.map(item =>
      `${outcomeKey(item)} (${item.reason})`).join(", ")}`);
  }
}

export function preservesOutcomeCoverage(before: ProbeCase, after: ProbeCase): boolean {
  const covered = new Set((after.outcomeChecks ?? []).map(outcomeKey));
  return (before.outcomeChecks ?? []).every(item => covered.has(outcomeKey(item)));
}
